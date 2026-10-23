// Hide the console window on Windows release builds. Debug builds keep it so
// `pnpm tauri dev` stays useful for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Thin backend by design: filesystem read/write, `git remote` lookup, local
// SQLite vault, `links.json` / `config.json` files, file stats for the
// watcher poll, `.env` backups, and the OS device name. No crypto, dotenv
// parsing, or sync logic here — those live in `src/lib` (TypeScript) so they
// stay testable without Rust. See `docs/ARCHITECTURE.md`.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

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
// Portable vault (.db): one file, project metadata + encrypted snapshots
//
// The portable file is a separate SQLite database. Rust only copies opaque
// rows: envelopes stay JSON text and no plaintext hash is written. TS owns the
// format, validation, crypto, and merge policy.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortableProject {
    identity: String,
    display_name: String,
    folder_path: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortableSnapshot {
    identity: String,
    file_name: String,
    /// Opaque envelope JSON. Rust never parses or decrypts it.
    envelope: String,
    source: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortableVault {
    meta: HashMap<String, String>,
    projects: Vec<PortableProject>,
    snapshots: Vec<PortableSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultExportSummary {
    projects: u64,
    snapshots: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportProject {
    identity: String,
    display_name: String,
    folder_path: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportSnapshot {
    identity: String,
    file_name: String,
    envelope: String,
    plaintext_sha256: String,
    source: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultImport {
    projects: Vec<ImportProject>,
    snapshots: Vec<ImportSnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultImportSummary {
    projects_added: u64,
    projects_kept: u64,
    snapshots_added: u64,
    snapshots_skipped: u64,
}

/// Export the live vault to one `.db`. Rejects the live vault path itself.
#[tauri::command]
fn vault_export(
    path: String,
    salt: String,
    device_name: String,
    created_at: String,
) -> Result<VaultExportSummary, String> {
    let local = vault_db()?;
    let dest = PathBuf::from(&path);
    let same_file = dest.to_string_lossy().eq_ignore_ascii_case(&local.to_string_lossy())
        || (dest.exists()
            && local.exists()
            && dest.canonicalize().ok() == local.canonicalize().ok());
    if same_file {
        return Err("Choose a different file name — that is the live vault.".to_string());
    }
    let conn = db()?;
    portable_export(&conn, &dest, &salt, &device_name, &created_at)
}

/// Export every project and encrypted snapshot into one standalone SQLite file.
/// The destination is written to a temp path first, then swapped in.
fn portable_export(
    conn: &Connection,
    dest: &Path,
    salt: &str,
    device_name: &str,
    created_at: &str,
) -> Result<VaultExportSummary, String> {
    if salt.trim().is_empty() {
        return Err("vault_export: missing passphrase salt".to_string());
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("vault_export: create folder: {e}"))?;
        }
    }

    let temp = PathBuf::from(format!("{}.tmp-{}", dest.display(), std::process::id()));
    let _ = std::fs::remove_file(&temp);

    let result = (|| -> Result<VaultExportSummary, String> {
        conn.execute(
            "ATTACH DATABASE ?1 AS portable",
            params![temp.to_string_lossy().to_string()],
        )
        .map_err(|e| format!("vault_export: attach: {e}"))?;
        conn.execute_batch(
            "CREATE TABLE portable.meta (
               key   TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             CREATE TABLE portable.projects (
               identity     TEXT PRIMARY KEY,
               display_name TEXT NOT NULL,
               folder_path  TEXT NOT NULL,
               created_at   TEXT NOT NULL
             );
             CREATE TABLE portable.snapshots (
               identity   TEXT NOT NULL,
               file_name  TEXT NOT NULL,
               envelope   TEXT NOT NULL,
               source     TEXT NOT NULL,
               created_at TEXT NOT NULL
             );",
        )
        .map_err(|e| format!("vault_export: schema: {e}"))?;

        {
            let mut insert = conn
                .prepare("INSERT INTO portable.meta (key, value) VALUES (?1, ?2)")
                .map_err(|e| format!("vault_export: meta prepare: {e}"))?;
            for (key, value) in [
                ("format", "env-manager-vault"),
                ("version", "1"),
                ("createdAt", created_at),
                ("salt", salt),
                ("deviceName", device_name),
            ] {
                insert
                    .execute(params![key, value])
                    .map_err(|e| format!("vault_export: meta: {e}"))?;
            }
        }

        let projects = conn
            .execute(
                "INSERT INTO portable.projects (identity, display_name, folder_path, created_at)
                 SELECT identity, display_name, folder_path, created_at FROM main.projects",
                [],
            )
            .map_err(|e| format!("vault_export: projects: {e}"))?;
        let snapshots = conn
            .execute(
                "INSERT INTO portable.snapshots (identity, file_name, envelope, source, created_at)
                 SELECT p.identity, s.file_name, s.envelope, s.source, s.created_at
                 FROM main.snapshots s JOIN main.projects p ON p.id = s.project_id",
                [],
            )
            .map_err(|e| format!("vault_export: snapshots: {e}"))?;

        conn.execute("DETACH DATABASE portable", [])
            .map_err(|e| format!("vault_export: detach: {e}"))?;
        Ok(VaultExportSummary {
            projects: projects as u64,
            snapshots: snapshots as u64,
        })
    })();

    if result.is_err() {
        let _ = conn.execute("DETACH DATABASE portable", []);
        let _ = std::fs::remove_file(&temp);
        return result;
    }

    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| format!("vault_export: replace: {e}"))?;
    }
    if let Err(err) = std::fs::rename(&temp, &dest) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("vault_export: finish: {err}"));
    }
    result
}

/// Read a portable vault without modifying it. TS validates the returned rows.
#[tauri::command]
fn vault_read(path: String) -> Result<PortableVault, String> {
    portable_read(Path::new(&path))
}

fn portable_read(path: &Path) -> Result<PortableVault, String> {
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("open vault file: {e}"))?;
    if !table_exists(&conn, "meta")?
        || !table_exists(&conn, "projects")?
        || !table_exists(&conn, "snapshots")?
    {
        return Err("This is not an env-manager vault (.db) file.".to_string());
    }

    let mut meta: HashMap<String, String> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT key, value FROM meta")
            .map_err(|e| format!("vault_read meta: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("vault_read meta: {e}"))?;
        for row in rows {
            let (key, value) = row.map_err(|e| format!("vault_read meta: {e}"))?;
            meta.insert(key, value);
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT identity, display_name, folder_path, created_at
             FROM projects ORDER BY display_name",
        )
        .map_err(|e| format!("vault_read projects: {e}"))?;
    let projects = stmt
        .query_map([], |r| {
            Ok(PortableProject {
                identity: r.get(0)?,
                display_name: r.get(1)?,
                folder_path: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(|e| format!("vault_read projects: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("vault_read projects: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT identity, file_name, envelope, source, created_at
             FROM snapshots ORDER BY identity, file_name, created_at",
        )
        .map_err(|e| format!("vault_read snapshots: {e}"))?;
    let snapshots = stmt
        .query_map([], |r| {
            Ok(PortableSnapshot {
                identity: r.get(0)?,
                file_name: r.get(1)?,
                envelope: r.get(2)?,
                source: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(|e| format!("vault_read snapshots: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("vault_read snapshots: {e}"))?;

    Ok(PortableVault {
        meta,
        projects,
        snapshots,
    })
}

/// Merge already-decrypted/re-encrypted rows in one transaction. Rows are
/// matched by identity; duplicate snapshot content is skipped. No deletes of
/// existing projects, and retention still applies.
#[tauri::command]
fn vault_import(payload: VaultImport) -> Result<VaultImportSummary, String> {
    let mut conn = db()?;
    portable_import(&mut conn, payload)
}

fn portable_import(
    conn: &mut Connection,
    payload: VaultImport,
) -> Result<VaultImportSummary, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("vault_import: transaction: {e}"))?;

    let mut ids: HashMap<String, String> = HashMap::new();
    let mut projects_added = 0u64;
    let mut projects_kept = 0u64;

    for project in &payload.projects {
        if project.identity.trim().is_empty() {
            return Err("vault_import: project identity is required".to_string());
        }
        let inserted = tx
            .execute(
                "INSERT INTO projects (id, identity, display_name, folder_path, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(identity) DO NOTHING",
                params![
                    new_id(),
                    project.identity,
                    project.display_name,
                    project.folder_path,
                    project.created_at
                ],
            )
            .map_err(|e| format!("vault_import: project: {e}"))?;
        if inserted > 0 {
            projects_added += 1;
        } else {
            projects_kept += 1;
        }
        let id: String = tx
            .query_row(
                "SELECT id FROM projects WHERE identity = ?1",
                params![project.identity],
                |r| r.get(0),
            )
            .map_err(|e| format!("vault_import: project lookup: {e}"))?;
        ids.insert(project.identity.clone(), id);
    }

    let mut snapshots_added = 0u64;
    let mut snapshots_skipped = 0u64;
    let mut retention: HashSet<(String, String)> = HashSet::new();

    for snapshot in &payload.snapshots {
        let Some(project_id) = ids.get(&snapshot.identity) else {
            snapshots_skipped += 1;
            continue;
        };
        let exists: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM snapshots
                 WHERE project_id = ?1 AND file_name = ?2 AND plaintext_sha256 = ?3",
                params![project_id, snapshot.file_name, snapshot.plaintext_sha256],
                |r| r.get(0),
            )
            .map_err(|e| format!("vault_import: duplicate check: {e}"))?;
        if exists > 0 {
            snapshots_skipped += 1;
            continue;
        }
        tx.execute(
            "INSERT INTO snapshots
               (id, project_id, file_name, envelope, plaintext_sha256, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                new_id(),
                project_id,
                snapshot.file_name,
                snapshot.envelope,
                snapshot.plaintext_sha256,
                snapshot.source,
                snapshot.created_at
            ],
        )
        .map_err(|e| format!("vault_import: snapshot: {e}"))?;
        snapshots_added += 1;
        retention.insert((project_id.clone(), snapshot.file_name.clone()));
    }

    for (project_id, file_name) in retention {
        tx.execute(
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
        .map_err(|e| format!("vault_import: retention: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("vault_import: commit: {e}"))?;
    Ok(VaultImportSummary {
        projects_added,
        projects_kept,
        snapshots_added,
        snapshots_skipped,
    })
}

#[cfg(test)]
mod portable_tests {
    use super::*;

    fn test_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "env-manager-portable-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn local_vault(path: &Path) -> Connection {
        let conn = Connection::open(path).expect("open temp vault");
        conn.execute_batch(SCHEMA).expect("schema");
        conn
    }

    fn payload(identity: &str, count: usize) -> VaultImport {
        VaultImport {
            projects: vec![ImportProject {
                identity: identity.to_string(),
                display_name: "Example".to_string(),
                folder_path: "C:\\projects\\example".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            }],
            snapshots: (0..count)
                .map(|i| ImportSnapshot {
                    identity: identity.to_string(),
                    file_name: ".env".to_string(),
                    envelope: format!("{{\"ciphertext\":\"{i}\"}}"),
                    plaintext_sha256: format!("hash-{i}"),
                    source: "import".to_string(),
                    created_at: format!("2026-01-{:02}T00:00:00Z", i + 1),
                })
                .collect(),
        }
    }

    #[test]
    fn export_read_and_merge_with_retention() {
        let dir = test_dir();
        let source_path = dir.join("source.db");
        let target_path = dir.join("target.db");
        let portable_path = dir.join("portable.db");

        {
            let source = local_vault(&source_path);
            source
                .execute(
                    "INSERT INTO projects
                       (id, identity, display_name, folder_path, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        "p1",
                        "github.com/foo/bar",
                        "Example",
                        "C:\\projects\\example",
                        "2026-01-01T00:00:00Z"
                    ],
                )
                .expect("project");
            source
                .execute(
                    "INSERT INTO snapshots
                       (id, project_id, file_name, envelope, plaintext_sha256, source, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        "s1",
                        "p1",
                        ".env",
                        "{\"ciphertext\":\"abc\"}",
                        "local-hash",
                        "local",
                        "2026-01-02T00:00:00Z"
                    ],
                )
                .expect("snapshot");
            let summary =
                portable_export(&source, &portable_path, "salt-a", "machine-a", "2026-01-03T00:00:00Z")
                    .expect("export");
            assert_eq!((summary.projects, summary.snapshots), (1, 1));
        }

        let read = portable_read(&portable_path).expect("read");
        assert_eq!(
            read.meta.get("format").map(String::as_str),
            Some("env-manager-vault")
        );
        assert_eq!(read.meta.get("salt").map(String::as_str), Some("salt-a"));
        assert_eq!(read.projects.len(), 1);
        assert_eq!(read.projects[0].identity, "github.com/foo/bar");
        assert_eq!(read.snapshots.len(), 1);
        assert_eq!(read.snapshots[0].envelope, "{\"ciphertext\":\"abc\"}");

        {
            let mut target = local_vault(&target_path);
            let first = portable_import(&mut target, payload("github.com/foo/bar", 1))
                .expect("first import");
            assert_eq!(first.projects_added, 1);
            assert_eq!(first.snapshots_added, 1);

            let second = portable_import(&mut target, payload("github.com/foo/bar", 1))
                .expect("repeat import");
            assert_eq!(second.projects_kept, 1);
            assert_eq!(second.snapshots_added, 0);
            assert_eq!(second.snapshots_skipped, 1);

            let third = portable_import(&mut target, payload("github.com/foo/bar", 26))
                .expect("bulk import");
            assert_eq!(third.snapshots_added, 25);
            let kept: i64 = target
                .query_row(
                    "SELECT COUNT(*) FROM snapshots WHERE file_name = '.env'",
                    [],
                    |r| r.get(0),
                )
                .expect("count");
            assert_eq!(kept, SNAPSHOT_RETENTION);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ---------------------------------------------------------------------------
// Parent-folder scan (read-only: names + git remotes, never file contents)
// ---------------------------------------------------------------------------

/// Shared cancel flag for the in-flight scan (`scan_cancel` flips it).
#[derive(Default)]
struct ScanCancel(Arc<AtomicBool>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanRow {
    folder_path: String,
    repo_root: String,
    repo_subpath: String,
    git_remote: Option<String>,
    env_files: Vec<String>,
    is_git: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    scanned: u64,
    found: u64,
}

fn find_git_root(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start);
    while let Some(dir) = current {
        if dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

fn relative_posix(root: &Path, folder: &Path) -> String {
    match folder.strip_prefix(root) {
        Ok(relative) => relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("/"),
        Err(_) => String::new(),
    }
}

fn scan_blocking(
    app: AppHandle,
    root: String,
    max_depth: u32,
    skip_dirs: Vec<String>,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<ScanRow>, String> {
    let root_path = PathBuf::from(&root);
    let meta = std::fs::metadata(&root_path).map_err(|e| format!("scan root {root}: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("scan root {root}: not a folder"));
    }

    let depth_limit = if max_depth == 0 { 3 } else { max_depth };
    let skip: HashSet<String> = skip_dirs.iter().map(|name| name.to_lowercase()).collect();
    let mut remote_cache: HashMap<PathBuf, Option<String>> = HashMap::new();
    let mut rows: Vec<ScanRow> = Vec::new();
    let mut stack: Vec<(PathBuf, u32, Option<PathBuf>)> =
        vec![(root_path.clone(), 0, find_git_root(&root_path))];
    let mut scanned: u64 = 0;
    const VISIT_CAP: u64 = 20_000;

    while let Some((dir, depth, repo_root)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) || scanned >= VISIT_CAP {
            break;
        }
        scanned += 1;
        if scanned % 200 == 0 {
            let _ = app.emit(
                "scan://progress",
                ScanProgress { scanned, found: rows.len() as u64 },
            );
        }

        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            // Permission errors and disappearing folders are skipped.
            Err(_) => continue,
        };

        let mut env_files: Vec<String> = Vec::new();
        let mut children: Vec<PathBuf> = Vec::new();
        for entry in entries.flatten() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            // Never follow symlinks (loops + escaping the chosen root).
            if file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if file_type.is_dir() {
                if name.starts_with('.') || skip.contains(&name.to_lowercase()) {
                    continue;
                }
                if depth < depth_limit {
                    children.push(entry.path());
                }
            } else if file_type.is_file() && (name == ".env" || name.starts_with(".env.")) {
                // Raw names only; TS applies `isTrackableEnvFile`.
                env_files.push(name);
            }
        }

        if !env_files.is_empty() {
            env_files.sort();
            let (row_root, row_subpath, is_git) = match &repo_root {
                Some(repo) => (repo.clone(), relative_posix(repo, &dir), true),
                None => (dir.clone(), String::new(), false),
            };
            let git_remote = if is_git {
                let cached = remote_cache.get(&row_root).cloned();
                match cached {
                    Some(value) => value,
                    None => {
                        let value = git_remote_get_url(row_root.to_string_lossy().to_string())
                            .ok()
                            .flatten();
                        remote_cache.insert(row_root.clone(), value.clone());
                        value
                    }
                }
            } else {
                None
            };
            rows.push(ScanRow {
                folder_path: dir.to_string_lossy().to_string(),
                repo_root: row_root.to_string_lossy().to_string(),
                repo_subpath: row_subpath,
                git_remote,
                env_files,
                is_git,
            });
        }

        for child in children {
            let child_repo = if child.join(".git").exists() {
                Some(child.clone())
            } else {
                repo_root.clone()
            };
            stack.push((child, depth + 1, child_repo));
        }
    }

    let _ = app.emit(
        "scan://progress",
        ScanProgress { scanned, found: rows.len() as u64 },
    );
    Ok(rows)
}

#[tauri::command]
async fn scan_env_projects(
    app: AppHandle,
    state: State<'_, ScanCancel>,
    root: String,
    max_depth: u32,
    skip_dirs: Vec<String>,
) -> Result<Vec<ScanRow>, String> {
    state.0.store(false, Ordering::SeqCst);
    let cancel = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        scan_blocking(app, root, max_depth, skip_dirs, cancel)
    })
    .await
    .map_err(|e| format!("scan task failed: {e}"))?
}

#[tauri::command]
fn scan_cancel(state: State<'_, ScanCancel>) {
    state.0.store(true, Ordering::SeqCst);
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
        .manage(ScanCancel::default())
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
            vault_export,
            vault_read,
            vault_import,
            scan_env_projects,
            scan_cancel,
            links_read,
            links_write,
            config_read,
            config_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running env-manager");
}
