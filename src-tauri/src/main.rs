// Thin backend by design: filesystem read/write, `git remote` lookup, local
// SQLite vault, `links.json` / `config.json` files, file stats for the
// watcher poll, `.env` backups, and the OS device name. No crypto, dotenv
// parsing, or sync logic here — those live in `src/lib` (TypeScript) so they
// stay testable without Rust. See `docs/ARCHITECTURE.md`.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

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
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name        TEXT NOT NULL,
  envelope         TEXT NOT NULL,
  plaintext_sha256 TEXT NOT NULL,
  source           TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_lookup
  ON snapshots (project_id, file_name, created_at DESC);
";

/// Rows kept per `(project_id, file_name)` — recent restore points only.
const SNAPSHOT_RETENTION: i64 = 20;

fn table_exists(conn: &Connection, name: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![name],
            |r| r.get(0),
        )
        .map_err(|e| format!("vault schema check: {e}"))?;
    Ok(count > 0)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| format!("vault schema check: {e}"))?;
    let mut rows = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| format!("vault schema check: {e}"))?;
    for name in rows.by_ref() {
        if name.map_err(|e| format!("vault schema check: {e}"))? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn db() -> Result<Connection, String> {
    let path = vault_db()?;
    let conn = Connection::open(&path).map_err(|e| format!("open vault.db: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("vault pragma: {e}"))?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("vault version: {e}"))?;
    if version < 1 {
        // Existing P1 installs carry `local_only` + `env_sets` (row ids and
        // sha256 only — no secrets). Drop both; snapshots replace them.
        if table_exists(&conn, "projects")? && column_exists(&conn, "projects", "local_only")? {
            conn.execute_batch("ALTER TABLE projects DROP COLUMN local_only;")
                .map_err(|e| format!("vault migration (local_only): {e}"))?;
        }
        conn.execute_batch("DROP TABLE IF EXISTS env_sets;")
            .map_err(|e| format!("vault migration (env_sets): {e}"))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| format!("vault schema: {e}"))?;
        conn.execute_batch("PRAGMA user_version = 1;")
            .map_err(|e| format!("vault version: {e}"))?;
    }
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
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotRow {
    id: String,
    project_id: String,
    file_name: String,
    /// Opaque envelope JSON. Rust never parses, hashes, or decrypts it.
    envelope: String,
    plaintext_sha256: String,
    source: String,
    created_at: String,
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

fn project_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: r.get(0)?,
        identity: r.get(1)?,
        display_name: r.get(2)?,
        folder_path: r.get(3)?,
        created_at: r.get(4)?,
    })
}

const PROJECT_COLUMNS: &str = "id, identity, display_name, folder_path, created_at";

#[tauri::command]
fn project_add(identity: String, display_name: String, folder_path: String) -> Result<ProjectRow, String> {
    let conn = db()?;
    let id = new_id();
    let created = now_iso();
    // Duplicate identities keep their original folder: re-pointing a link
    // silently would move snapshots to the wrong repo (scan UI explains it).
    conn.execute(
        "INSERT INTO projects (id, identity, display_name, folder_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(identity) DO NOTHING",
        params![id, identity, display_name, folder_path, created],
    )
    .map_err(|e| format!("project_add: {e}"))?;
    project_get_by_identity(identity)
}

#[tauri::command]
fn project_list() -> Result<Vec<ProjectRow>, String> {
    let conn = db()?;
    let mut stmt = conn
        .prepare(&format!("SELECT {PROJECT_COLUMNS} FROM projects ORDER BY display_name"))
        .map_err(|e| format!("project_list: {e}"))?;
    let rows = stmt
        .query_map([], project_from_row)
        .map_err(|e| format!("project_list: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("project_list: {e}"))
}

fn project_get_by_identity(identity: String) -> Result<ProjectRow, String> {
    let conn = db()?;
    conn.query_row(
        &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE identity = ?1"),
        params![identity],
        project_from_row,
    )
    .map_err(|e| format!("project not found: {e}"))
}

#[tauri::command]
fn project_get(id: String) -> Result<Option<ProjectRow>, String> {
    let conn = db()?;
    let mut stmt = conn
        .prepare(&format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1"))
        .map_err(|e| format!("project_get: {e}"))?;
    let mut rows = stmt
        .query_map(params![id], project_from_row)
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
    // Explicit delete keeps the vault tidy even if an old connection ran
    // without `PRAGMA foreign_keys = ON`.
    conn.execute("DELETE FROM snapshots WHERE project_id = ?1", params![id])
        .map_err(|e| format!("project_remove: {e}"))?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| format!("project_remove: {e}"))?;
    Ok(())
}

const SNAPSHOT_COLUMNS: &str =
    "id, project_id, file_name, envelope, plaintext_sha256, source, created_at";

fn snapshot_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<SnapshotRow> {
    Ok(SnapshotRow {
        id: r.get(0)?,
        project_id: r.get(1)?,
        file_name: r.get(2)?,
        envelope: r.get(3)?,
        plaintext_sha256: r.get(4)?,
        source: r.get(5)?,
        created_at: r.get(6)?,
    })
}

/// Append one encrypted snapshot, keeping only the newest 20 per file.
#[tauri::command]
fn snapshot_put(
    project_id: String,
    file_name: String,
    envelope: String,
    plaintext_sha256: String,
    source: String,
) -> Result<SnapshotRow, String> {
    let conn = db()?;
    let id = new_id();
    let created = now_iso();
    conn.execute(
        "INSERT INTO snapshots (id, project_id, file_name, envelope, plaintext_sha256, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, project_id, file_name, envelope, plaintext_sha256, source, created],
    )
    .map_err(|e| format!("snapshot_put: {e}"))?;
    conn.execute(
        "DELETE FROM snapshots
         WHERE project_id = ?1 AND file_name = ?2
           AND id NOT IN (
             SELECT id FROM snapshots
             WHERE project_id = ?1 AND file_name = ?2
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?3
           )",
        params![project_id, file_name, SNAPSHOT_RETENTION],
    )
    .map_err(|e| format!("snapshot_put retention: {e}"))?;
    conn.query_row(
        &format!("SELECT {SNAPSHOT_COLUMNS} FROM snapshots WHERE id = ?1"),
        params![id],
        snapshot_from_row,
    )
    .map_err(|e| format!("snapshot_put: {e}"))
}

#[tauri::command]
fn snapshot_latest(project_id: String, file_name: String) -> Result<Option<SnapshotRow>, String> {
    let conn = db()?;
    let row = conn.query_row(
        &format!(
            "SELECT {SNAPSHOT_COLUMNS} FROM snapshots
             WHERE project_id = ?1 AND file_name = ?2
             ORDER BY created_at DESC, rowid DESC LIMIT 1"
        ),
        params![project_id, file_name],
        snapshot_from_row,
    );
    match row {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("snapshot_latest: {e}")),
    }
}

#[tauri::command]
fn snapshot_list(project_id: String, file_name: String, limit: u32) -> Result<Vec<SnapshotRow>, String> {
    let conn = db()?;
    let limit = if limit == 0 { SNAPSHOT_RETENTION } else { limit as i64 };
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SNAPSHOT_COLUMNS} FROM snapshots
             WHERE project_id = ?1 AND file_name = ?2
             ORDER BY created_at DESC, rowid DESC LIMIT ?3"
        ))
        .map_err(|e| format!("snapshot_list: {e}"))?;
    let rows = stmt
        .query_map(params![project_id, file_name, limit], snapshot_from_row)
        .map_err(|e| format!("snapshot_list: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("snapshot_list: {e}"))
}

#[tauri::command]
fn snapshot_delete(id: String) -> Result<(), String> {
    let conn = db()?;
    conn.execute("DELETE FROM snapshots WHERE id = ?1", params![id])
        .map_err(|e| format!("snapshot_delete: {e}"))?;
    Ok(())
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_env_file,
            write_env_file,
            list_env_files,
            file_stat,
            backup_env_file,
            git_remote_get_url,
            device_name,
            project_add,
            project_list,
            project_get,
            project_remove,
            snapshot_put,
            snapshot_latest,
            snapshot_list,
            snapshot_delete,
            links_read,
            links_write,
            config_read,
            config_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running env-manager");
}
