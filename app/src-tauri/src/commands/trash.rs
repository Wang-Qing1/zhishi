//! 回收站:知识库/卡片软删除后的查看、恢复与永久删除。
//! 移入回收站见 kb::trash / card::trash;kb::delete / card::delete 是永久删除。

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::commands::{card, kb};
use crate::db::Db;
use crate::error::{AppError, Result};

/// 回收站内容保留天数,超期在应用启动时自动永久删除
pub const RETENTION_DAYS: i64 = 30;
pub const DAY_MS: i64 = 86_400_000;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashedKb {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub deleted_at: i64,
    pub card_count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashedCard {
    pub id: i64,
    pub kb_id: i64,
    pub kb_name: String,
    pub title: String,
    pub excerpt: String,
    pub deleted_at: i64,
    /// 所属知识库也在回收站里(恢复卡片前需先恢复知识库)
    pub kb_trashed: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashList {
    pub kbs: Vec<TrashedKb>,
    pub cards: Vec<TrashedCard>,
}

pub fn list(conn: &Connection) -> Result<TrashList> {
    let mut st = conn.prepare(
        "SELECT k.id, k.name, k.description, k.deleted_at,
                (SELECT COUNT(*) FROM card c WHERE c.kb_id = k.id AND c.deleted_at IS NULL)
         FROM kb k WHERE k.deleted_at IS NOT NULL ORDER BY k.deleted_at DESC",
    )?;
    let kbs = st
        .query_map([], |r| {
            Ok(TrashedKb {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                deleted_at: r.get(3)?,
                card_count: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut st = conn.prepare(
        "SELECT c.id, c.kb_id, k.name, c.title, substr(c.content_text, 1, 80), c.deleted_at, k.deleted_at IS NOT NULL
         FROM card c JOIN kb k ON k.id = c.kb_id
         WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC",
    )?;
    let cards = st
        .query_map([], |r| {
            Ok(TrashedCard {
                id: r.get(0)?,
                kb_id: r.get(1)?,
                kb_name: r.get(2)?,
                title: r.get(3)?,
                excerpt: r.get(4)?,
                deleted_at: r.get(5)?,
                kb_trashed: r.get::<_, i64>(6)? != 0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(TrashList { kbs, cards })
}

/// 永久删除回收站中的知识库(只能删已在回收站的)
pub fn purge_kb(conn: &Connection, id: i64) -> Result<()> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM kb WHERE id = ?1 AND deleted_at IS NOT NULL",
        [id],
        |r| r.get(0),
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("回收站中的知识库 {id}")));
    }
    kb::delete(conn, id)
}

/// 永久删除回收站中的卡片
pub fn purge_card(conn: &Connection, id: i64) -> Result<()> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM card WHERE id = ?1 AND deleted_at IS NOT NULL",
        [id],
        |r| r.get(0),
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("回收站中的卡片 {id}")));
    }
    card::delete(conn, id)
}

fn ids(conn: &Connection, sql: &str, cutoff: i64) -> Result<Vec<i64>> {
    let mut st = conn.prepare(sql)?;
    let v = st.query_map(params![cutoff], |r| r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(v)
}

/// 永久删除移入回收站时间早于 cutoff 的知识库和卡片,返回删除的项数
pub fn purge_expired(conn: &Connection, cutoff: i64) -> Result<usize> {
    let kbs = ids(conn, "SELECT id FROM kb WHERE deleted_at IS NOT NULL AND deleted_at < ?1", cutoff)?;
    for id in &kbs {
        kb::delete(conn, *id)?;
    }
    // 知识库被删时其卡片已级联删除,这里只剩独立删除的卡片
    let cards = ids(conn, "SELECT id FROM card WHERE deleted_at IS NOT NULL AND deleted_at < ?1", cutoff)?;
    for id in &cards {
        card::delete(conn, *id)?;
    }
    Ok(kbs.len() + cards.len())
}

#[tauri::command]
pub fn trash_list(db: State<Db>) -> Result<TrashList> {
    let conn = db.conn()?;
    list(&conn)
}

#[tauri::command]
pub fn trash_restore_kb(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    kb::restore(&conn, id)
}

#[tauri::command]
pub fn trash_restore_card(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    card::restore(&conn, id)
}

#[tauri::command]
pub fn trash_purge_kb(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    purge_kb(&conn, id)
}

#[tauri::command]
pub fn trash_purge_card(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    purge_card(&conn, id)
}

#[tauri::command]
pub fn trash_empty(db: State<Db>) -> Result<usize> {
    let conn = db.conn()?;
    purge_expired(&conn, i64::MAX)
}
