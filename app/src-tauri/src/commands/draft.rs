//! 卡片编辑草稿:编辑页停止输入后自动保存,崩溃或误关窗口后下次打开时可恢复。
//! card_id 为 0 表示尚未创建的新卡片(每个知识库最多一份)。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::db::{now_ms, Db};
use crate::error::{AppError, Result};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub kb_id: i64,
    pub card_id: i64,
    pub title: String,
    pub content_json: String,
    pub tag_ids: Vec<i64>,
    pub updated_at: i64,
}

/// 保存(覆盖)草稿
pub fn save(
    conn: &Connection,
    kb_id: i64,
    card_id: i64,
    title: &str,
    content_json: &str,
    tag_ids: &[i64],
) -> Result<()> {
    let tags = serde_json::to_string(tag_ids).map_err(|e| AppError::msg(e.to_string()))?;
    conn.execute(
        "INSERT INTO card_draft(kb_id, card_id, title, content_json, tag_ids, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(kb_id, card_id) DO UPDATE SET
           title = excluded.title, content_json = excluded.content_json,
           tag_ids = excluded.tag_ids, updated_at = excluded.updated_at",
        params![kb_id, card_id, title, content_json, tags, now_ms()],
    )
    .map_err(|e| AppError::from_constraint(e, "知识库不存在"))?;
    Ok(())
}

pub fn get(conn: &Connection, kb_id: i64, card_id: i64) -> Result<Option<Draft>> {
    let row = conn
        .query_row(
            "SELECT title, content_json, tag_ids, updated_at FROM card_draft WHERE kb_id = ?1 AND card_id = ?2",
            params![kb_id, card_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)),
        )
        .optional()?;
    Ok(row.map(|(title, content_json, tags, updated_at)| Draft {
        kb_id,
        card_id,
        title,
        content_json,
        tag_ids: serde_json::from_str(&tags).unwrap_or_default(),
        updated_at,
    }))
}

pub fn delete(conn: &Connection, kb_id: i64, card_id: i64) -> Result<()> {
    conn.execute("DELETE FROM card_draft WHERE kb_id = ?1 AND card_id = ?2", params![kb_id, card_id])?;
    Ok(())
}

/// 清理最后更新早于 cutoff 的草稿,返回删除数
pub fn purge_older_than(conn: &Connection, cutoff: i64) -> Result<usize> {
    Ok(conn.execute("DELETE FROM card_draft WHERE updated_at < ?1", [cutoff])?)
}

#[tauri::command]
pub fn draft_save(
    db: State<Db>,
    kb_id: i64,
    card_id: i64,
    title: String,
    content_json: String,
    tag_ids: Vec<i64>,
) -> Result<()> {
    let conn = db.conn()?;
    save(&conn, kb_id, card_id, &title, &content_json, &tag_ids)
}

#[tauri::command]
pub fn draft_get(db: State<Db>, kb_id: i64, card_id: i64) -> Result<Option<Draft>> {
    let conn = db.conn()?;
    get(&conn, kb_id, card_id)
}

#[tauri::command]
pub fn draft_delete(db: State<Db>, kb_id: i64, card_id: i64) -> Result<()> {
    let conn = db.conn()?;
    delete(&conn, kb_id, card_id)
}
