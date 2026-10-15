//! 卡片版本历史:保存卡片时把旧内容存为一个版本(距上一个版本不足 10 分钟的保存不重复建版本),
//! 每张卡片最多保留 50 个。恢复由前端把版本内容载入编辑器后再保存完成。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, Result};

/// 相邻两个版本的最小间隔(以内容被保存的时间计)
const MIN_GAP_MS: i64 = 10 * 60 * 1000;
const MAX_VERSIONS: i64 = 50;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub id: i64,
    pub card_id: i64,
    pub title: String,
    pub saved_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: i64,
    pub card_id: i64,
    pub title: String,
    pub content_json: String,
    pub saved_at: i64,
}

/// 卡片更新前调用:把旧内容存为版本;force 为真时不受 10 分钟间隔限制(恢复历史版本后保存用)
pub fn snapshot(
    conn: &Connection,
    card_id: i64,
    old_title: &str,
    old_json: &str,
    old_saved_at: i64,
    new_title: &str,
    new_json: &str,
    force: bool,
) -> Result<()> {
    // 空内容没有保存价值;标题和正文都没变(只改了标签)也不建版本
    if old_json.is_empty() || (old_title == new_title && old_json == new_json) {
        return Ok(());
    }
    let last_saved: Option<i64> = conn.query_row(
        "SELECT MAX(saved_at) FROM card_version WHERE card_id = ?1",
        [card_id],
        |r| r.get(0),
    )?;
    if !force && last_saved.is_some_and(|t| old_saved_at - t < MIN_GAP_MS) {
        return Ok(());
    }
    // 与最新版本完全相同则不重复记录
    let last: Option<(String, String)> = conn
        .query_row(
            "SELECT title, content_json FROM card_version WHERE card_id = ?1 ORDER BY id DESC LIMIT 1",
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if last.is_some_and(|(t, c)| t == old_title && c == old_json) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO card_version(card_id, title, content_json, saved_at) VALUES(?1, ?2, ?3, ?4)",
        params![card_id, old_title, old_json, old_saved_at],
    )?;
    conn.execute(
        "DELETE FROM card_version WHERE card_id = ?1
         AND id NOT IN (SELECT id FROM card_version WHERE card_id = ?1 ORDER BY id DESC LIMIT ?2)",
        params![card_id, MAX_VERSIONS],
    )?;
    Ok(())
}

/// 卡片的历史版本列表(不含正文),最新的在前
pub fn list(conn: &Connection, card_id: i64) -> Result<Vec<VersionSummary>> {
    let mut st = conn.prepare(
        "SELECT id, card_id, title, saved_at FROM card_version WHERE card_id = ?1 ORDER BY id DESC",
    )?;
    let rows = st
        .query_map([card_id], |r| {
            Ok(VersionSummary {
                id: r.get(0)?,
                card_id: r.get(1)?,
                title: r.get(2)?,
                saved_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> Result<Version> {
    conn.query_row(
        "SELECT id, card_id, title, content_json, saved_at FROM card_version WHERE id = ?1",
        [id],
        |r| {
            Ok(Version {
                id: r.get(0)?,
                card_id: r.get(1)?,
                title: r.get(2)?,
                content_json: r.get(3)?,
                saved_at: r.get(4)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("历史版本 {id}")))
}

#[tauri::command]
pub fn version_list(db: State<Db>, card_id: i64) -> Result<Vec<VersionSummary>> {
    let conn = db.conn()?;
    list(&conn, card_id)
}

#[tauri::command]
pub fn version_get(db: State<Db>, id: i64) -> Result<Version> {
    let conn = db.conn()?;
    get(&conn, id)
}
