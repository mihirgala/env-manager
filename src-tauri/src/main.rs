// Thin backend by design: filesystem read/write, `git remote` lookup, local
// SQLite vault, `links.json` / `config.json` files, file stats for the
// watcher poll, `.env` backups, OS keychain hold, OS device name, and opening
// URLs in the system browser. No crypto, dotenv parsing, sync logic, or
// Supabase calls here — those live in `src/lib` (TypeScript) so they stay
// testable without Rust. See `docs/ARCHITECTURE.md`.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

// ---------------------------------------------------------------------------
// Paths (~/.env-manager/)
// ---------------------------------------------------------------------------

fn base_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "home directory not found".to_string())?;
    Ok(home.join(".env-manager"))
}

fn ensure_base() -> Result<PathBuf, String> {
    let dir = base_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create ~/.env-manager: {e}"))?;
    Ok(dir)
}

fn vault_db() -> Result<PathBuf, String> {
    Ok(ensure_base()?.join("vault.db"))
}

fn links_file() -> Result<PathBuf, String> {
    Ok(ensure_base()?.join("links.json"))
}

fn config_file() -> Result<PathBuf, String> {
    Ok(ensure_base()?.join("config.json"))
}

// ---------------------------------------------------------------------------
// Vault (SQLite)
// ---------------------------------------------------------------------------

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  local_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS env_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, file_name)
);
";

fn db() -> Result<Connection, String> {
    let path = vault_db()?;
    let conn = Connection::open(&path).map_err(|e| format!("open vault.db: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("vault pragma: {e}"))?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("vault schema: {e}"))?;
    Ok(conn)
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRow {
    id: String,
    identity: String,
    display_name: String,
    folder_path: String,
    local_only: bool,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvSetRow {
    id: String,
    project_id: String,
    file_name: String,
    sha256: String,
    updated_at: String,
}

fn new_id() -> String {
    // Row-key fallback (display ids use crypto.randomUUID TS-side).
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let mut x = (nanos as u64).wrapping_mul(0x9E3779B97F4A7C15).wrapping_add(pid as u64);
    let mut hex = String::with_capacity(32);
    for _ in 0..32 {
        // xorshift for a few more distinct bits per call.
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        hex.push(char::from_digit((x % 16) as u32, 16).unwrap_or('0'));
    }
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[tauri::command]
fn project_add(identity: String, display_name: String, folder_path: String) -> Result<ProjectRow, String> {
    let conn = db()?;
    let id = new_id();
    let created = now_iso();
    conn.execute(
        "INSERT INTO projects (id, identity, display_name, folder_path, local_only, created_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)
         ON CONFLICT(identity) DO UPDATE SET folder_path = excluded.folder_path",
        params![id, identity, display_name, folder_path, created],
    )
    .map_err(|e| format!("project_add: {e}"))?;
    project_get_by_identity(identity)
}

#[tauri::command]
fn project_list() -> Result<Vec<ProjectRow>, String> {
    let conn = db()?;
    let mut stmt = conn
        .prepare("SELECT id, identity, display_name, folder_path, local_only, created_at FROM projects ORDER BY display_name")
        .map_err(|e| format!("project_list: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ProjectRow {
                id: r.get(0)?,
                identity: r.get(1)?,
                display_name: r.get(2)?,
                folder_path: r.get(3)?,
                local_only: r.get::<_, i64>(4)? != 0,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| format!("project_list: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("project_list: {e}"))
}

fn project_get_by_identity(identity: String) -> Result<ProjectRow, String> {
    let conn = db()?;
    conn.query_row(
        "SELECT id, identity, display_name, folder_path, local_only, created_at FROM projects WHERE identity = ?1",
        params![identity],
        |r| {
            Ok(ProjectRow {
                id: r.get(0)?,
                identity: r.get(1)?,
                display_name: r.get(2)?,
                folder_path: r.get(3)?,
                local_only: r.get::<_, i64>(4)? != 0,
                created_at: r.get(5)?,
            })
        },
    )
    .map_err(|e| format!("project not found: {e}"))
}

#[tauri::command]
fn project_get(id: String) -> Result<Option<ProjectRow>, String> {
    let conn = db()?;
    let mut stmt = conn
        .prepare("SELECT id, identity, display_name, folder_path, local_only, created_at FROM projects WHERE id = ?1")
        .map_err(|e| format!("project_get: {e}"))?;
    let mut rows = stmt.query_map(params![id], |r| {
        Ok(ProjectRow {
            id: r.get(0)?,
            identity: r.get(1)?,
            display_name: r.get(2)?,
            folder_path: r.get(3)?,
            local_only: r.get::<_, i64>(4)? != 0,
            created_at: r.get(5)?,
        })
    })
    .map_err(|e| format!("project_get: {e}"))?;
    match rows.next() {
        Some(r) => r.map(Some).map_err(|e| format!("project_get: {e}")),
        None => Ok(None),
    }
}

/// Unlink a project. Deletes vault rows only — `.env` files on disk are
/// never touched (no-lock-in rule).
#[tauri::command]
fn project_remove(id: String) -> Result<(), String> {
    let conn = db()?;
    conn.execute("DELETE FROM env_sets WHERE project_id = ?1", params![id])
        .map_err(|e| format!("project_remove: {e}"))?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| format!("project_remove: {e}"))?;
    Ok(())
}

#[tauri::command]
fn project_set_local_only(id: String, local_only: bool) -> Result<(), String> {
    let conn = db()?;
    conn.execute(
        "UPDATE projects SET local_only = ?1 WHERE id = ?2",
        params![if local_only { 1 } else { 0 }, id],
    )
    .map_err(|e| format!("project_set_local_only: {e}"))?;
    Ok(())
}

#[tauri::command]
fn envset_upsert(project_id: String, file_name: String, sha256: String) -> Result<EnvSetRow, String> {
    let conn = db()?;
    let id = new_id();
    let updated = now_iso();
    conn.execute(
        "INSERT INTO env_sets (id, project_id, file_name, sha256, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(project_id, file_name) DO UPDATE SET sha256 = excluded.sha256, updated_at = excluded.updated_at",
        params![id, project_id, file_name, sha256, updated],
    )
    .map_err(|e| format!("envset_upsert: {e}"))?;
    conn.query_row(
        "SELECT id, project_id, file_name, sha256, updated_at FROM env_sets WHERE project_id = ?1 AND file_name = ?2",
        params![project_id, file_name],
        |r| {
            Ok(EnvSetRow {
                id: r.get(0)?,
                project_id: r.get(1)?,
                file_name: r.get(2)?,
                sha256: r.get(3)?,
                updated_at: r.get(4)?,
            })
        },
    )
    .map_err(|e| format!("envset_upsert: {e}"))
}

#[tauri::command]
fn envset_list(project_id: String) -> Result<Vec<EnvSetRow>, String> {
    let conn = db()?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, file_name, sha256, updated_at FROM env_sets WHERE project_id = ?1 ORDER BY file_name")
        .map_err(|e| format!("envset_list: {e}"))?;
    let rows = stmt
        .query_map(params![project_id], |r| {
            Ok(EnvSetRow {
                id: r.get(0)?,
                project_id: r.get(1)?,
                file_name: r.get(2)?,
                sha256: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .map_err(|e| format!("envset_list: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("envset_list: {e}"))
}

// ---------------------------------------------------------------------------
// links.json / config.json (plain JSON files under ~/.env-manager/)
// ---------------------------------------------------------------------------

#[tauri::command]
fn links_read() -> Result<serde_json::Value, String> {
    let path = links_file()?;
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("links.json parse: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("links read: {e}")),
    }
}

#[tauri::command]
fn links_write(value: serde_json::Value) -> Result<(), String> {
    let path = links_file()?;
    ensure_base()?;
    let s = serde_json::to_string_pretty(&value).map_err(|e| format!("links serialize: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("links write: {e}"))?;
    Ok(())
}

#[tauri::command]
fn config_read() -> Result<serde_json::Value, String> {
    let path = config_file()?;
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("config.json parse: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("config read: {e}")),
    }
}

#[tauri::command]
fn config_write(value: serde_json::Value) -> Result<(), String> {
    let path = config_file()?;
    ensure_base()?;
    let s = serde_json::to_string_pretty(&value).map_err(|e| format!("config serialize: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("config write: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Env files: read/write/list/stat/backup (verbatim bytes, no parsing)
// ---------------------------------------------------------------------------

/// Read a `.env` file verbatim (no parsing — parsing is TS-side).
#[tauri::command]
fn read_env_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read_env_file {path}: {e}"))
}

/// Write a `.env` file verbatim. Callers (TS) preserve comments/order/quoting.
#[tauri::command]
fn write_env_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("write_env_file {path}: {e}"))?;
    Ok(())
}

/// List `.env*` files directly inside a folder (no recursion, files only).
#[tauri::command]
fn list_env_files(folder_path: String) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = Vec::new();
    let entries =
        std::fs::read_dir(&folder_path).map_err(|e| format!("list_env_files {folder_path}: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("list_env_files: {e}"))?;
        let file_type = entry.file_type().map_err(|e| format!("list_env_files: {e}"))?;
        if !file_type.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            if name == ".env" || name.starts_with(".env.") {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStat {
    mtime_ms: u64,
    size: u64,
}

/// mtime + size for the watcher poll. `Ok(None)` when the file is missing.
#[tauri::command]
fn file_stat(path: String) -> Result<Option<FileStat>, String> {
    match std::fs::metadata(&path) {
        Ok(meta) => {
            let mtime_ms = meta
                .modified()
                .map_err(|e| format!("file_stat {path}: {e}"))?
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Ok(Some(FileStat { mtime_ms, size: meta.len() }))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("file_stat {path}: {e}")),
    }
}

/// Copy `<path>` to `<path>.backup-<unix-seconds>`. Returns the backup path.
/// Used before applying a pulled/overwritten value — never silent overwrite.
#[tauri::command]
fn backup_env_file(path: String) -> Result<String, String> {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = format!("{path}.backup-{secs}");
    std::fs::copy(&path, &backup).map_err(|e| format!("backup {path}: {e}"))?;
    Ok(backup)
}

/// OS device name (hostname) for snapshot labels. No new crates: runs the
/// platform `hostname` tool, falls back to env vars, then a placeholder.
#[tauri::command]
fn device_name() -> String {
    if let Ok(out) = Command::new("hostname").output() {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    for key in ["COMPUTERNAME", "HOSTNAME", "HOST"] {
        if let Ok(name) = std::env::var(key) {
            let name = name.trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    "unknown-device".to_string()
}

/// Resolve `git remote get-url origin` for a folder.
/// Returns `Ok(None)` when the folder is not a git repo or has no `origin`.
#[tauri::command]
fn git_remote_get_url(path: String) -> Result<Option<String>, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["remote", "get-url", "origin"])
        .output()
        .map_err(|e| format!("git_remote_get_url: git not available: {e}"))?;
    if !out.status.success() {
        return Ok(None);
    }
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if url.is_empty() {
        Ok(None)
    } else {
        Ok(Some(url))
    }
}

/// Open a URL in the system browser (sign-in flow). OS integration only —
/// the auth exchange itself stays TS-side in `src/lib/cloud.ts`.
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|e| format!("open browser: {e}"))?;
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("open browser: {e}"))?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("open browser: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// OS keychain (P2: holds wrapped master key / session secrets)
// ---------------------------------------------------------------------------

#[tauri::command]
fn keychain_set(service: String, account: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| format!("keychain: {e}"))?;
    entry.set_password(&secret).map_err(|e| format!("keychain set: {e}"))?;
    Ok(())
}

#[tauri::command]
fn keychain_get(service: String, account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| format!("keychain: {e}"))?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain get: {e}")),
    }
}

#[tauri::command]
fn keychain_delete(service: String, account: String) -> Result<(), String> {
    let entry = keyring::Entry::new(&service, &account).map_err(|e| format!("keychain: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete: {e}")),
    }
}

#[tauri::command]
fn watch_stub(_path: String) -> Result<(), String> {
    // P1 ships polling via `file_stat` instead of a push watcher.
    Err("watch: polling via file_stat in P1 (see src/lib/tauri.ts)".to_string())
}

// ---------------------------------------------------------------------------
// OAuth sign-in window (OS window management only — no auth/product logic).
// Currently unused: sign-in runs via the system browser + pasted code
// (see `open_in_browser`), which proved more reliable across machines than
// an embedded popup. Kept for a future deep-link return path.
// ---------------------------------------------------------------------------

/// Host of the OAuth redirect back to the app. Must be allowlisted in
/// Supabase (Auth → URL Configuration → Redirect URLs) as
/// `https://env-manager.local/auth/callback`. The host never resolves — the
/// navigation is intercepted below before anything loads.
const OAUTH_CALLBACK_HOST: &str = "env-manager.local";

/// Pending OAuth result: `Some(code)` on success, `Some("github oauth: …")`
/// on provider error. Polled from TS via `take_oauth_code`.
struct OauthState(Mutex<Option<String>>);

/// Open the provider sign-in page in a small centered window.
#[tauri::command]
fn open_oauth_window(app: AppHandle, url: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("oauth") {
        w.close().map_err(|e| format!("oauth window: {e}"))?;
    }
    if let Some(state) = app.try_state::<OauthState>() {
        if let Ok(mut pending) = state.0.lock() {
            *pending = None;
        }
    }
    let parsed: tauri::Url = url.parse().map_err(|e| format!("oauth url: {e}"))?;
    let handle = app.clone();
    let handle = app.clone();
    tauri::WebviewWindowBuilder::new(&app, "oauth", tauri::WebviewUrl::External(parsed))
        .title("Sign in with GitHub")
        .inner_size(480.0, 640.0)
        .center()
        .focused(true)
        .on_navigation(move |nav_url| {
            if nav_url.host_str() != Some(OAUTH_CALLBACK_HOST) {
                return true;
            }
            let code = nav_url
                .query_pairs()
                .find(|(k, _)| k == "code")
                .map(|(_, v)| v.into_owned());
            let err = nav_url
                .query_pairs()
                .find(|(k, _)| k == "error")
                .map(|(_, v)| format!("github oauth: {v}"));
            if let Some(state) = handle.try_state::<OauthState>() {
                if let Ok(mut pending) = state.0.lock() {
                    *pending = code.or(err);
                }
            }
            // Block the navigation — there is nothing to load.
            false
        })
        .build()
        .map_err(|e| format!("oauth window: {e}"))?;
    Ok(())
}

/// Take the pending OAuth result, if any (clears it).
#[tauri::command]
fn take_oauth_code(state: State<OauthState>) -> Option<String> {
    state.0.lock().ok().and_then(|mut pending| pending.take())
}

#[tauri::command]
fn close_oauth_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("oauth") {
        w.close().map_err(|e| format!("close oauth window: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn is_oauth_window_open(app: AppHandle) -> bool {
    app.get_webview_window("oauth").is_some()
}

#[tauri::command]
fn keychain_stub(_action: String) -> Result<(), String> {
    // Kept for roadmap reference; real keychain_* commands are above.
    Err("keychain_stub: use keychain_set/get/delete".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(OauthState(Mutex::new(None)))        .invoke_handler(tauri::generate_handler![
            read_env_file,
            write_env_file,
            list_env_files,
            file_stat,
            backup_env_file,
            git_remote_get_url,
            device_name,
            open_in_browser,
            project_add,
            project_list,
            project_get,
            project_remove,
            project_set_local_only,
            envset_upsert,
            envset_list,
            links_read,
            links_write,
            config_read,
            config_write,
            keychain_set,
            keychain_get,
            keychain_delete,
            open_oauth_window,
            take_oauth_code,
            close_oauth_window,
            is_oauth_window_open,
            watch_stub,
            keychain_stub
        ])
        .run(tauri::generate_context!())
        .expect("error while running env-manager");
}
