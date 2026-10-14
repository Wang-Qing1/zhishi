use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

use crate::commands::tag;
use crate::db::{now_ms, Db};
use crate::error::{AppError, Result};
use crate::models::{Card, CardSummary};

fn norm_title(t: &str) -> String {
    let t = t.trim();
    if t.is_empty() { "未命名卡片".to_string() } else { t.to_string() }
}

/// 重建单张卡片的全文索引(标题 + 正文 + 标签名)
pub fn reindex(conn: &Connection, card_id: i64) -> Result<()> {
    conn.execute("DELETE FROM card_fts WHERE rowid = ?1", [card_id])?;
    conn.execute(
        "INSERT INTO card_fts(rowid, title, content_text, tags)
         SELECT c.id, c.title, c.content_text,
                COALESCE((SELECT group_concat(t.name, ' ') FROM card_tag ct JOIN tag t ON t.id = ct.tag_id WHERE ct.card_id = c.id), '')
         FROM card c WHERE c.id = ?1",
        [card_id],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, id: i64) -> Result<Card> {
    let mut card = conn
        .query_row(
            "SELECT id, kb_id, title, content_json, created_at, updated_at FROM card WHERE id = ?1",
            [id],
            |r| {
                Ok(Card {
                    id: r.get(0)?,
                    kb_id: r.get(1)?,
                    title: r.get(2)?,
                    content_json: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                    tags: vec![],
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("卡片 {id}")))?;
    card.tags = tag::of_card(conn, id)?;
    Ok(card)
}

pub fn create(
    conn: &Connection,
    kb_id: i64,
    title: &str,
    content_json: &str,
    content_text: &str,
    tag_ids: &[i64],
) -> Result<Card> {
    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    tx.execute(
        "INSERT INTO card(kb_id, title, content_json, content_text, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?5)",
        params![kb_id, norm_title(title), content_json, content_text, now],
    )
    .map_err(|e| AppError::from_constraint(e, "知识库不存在"))?;
    let id = tx.last_insert_rowid();
    tag::set_tags(&tx, id, kb_id, tag_ids)?;
    reindex(&tx, id)?;
    tx.execute("UPDATE kb SET updated_at = ?2 WHERE id = ?1", params![kb_id, now])?;
    tx.commit()?;
    get(conn, id)
}

pub fn update(
    conn: &Connection,
    id: i64,
    title: &str,
    content_json: &str,
    content_text: &str,
    tag_ids: &[i64],
) -> Result<Card> {
    let kb_id = get(conn, id)?.kb_id;
    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    tx.execute(
        "UPDATE card SET title = ?2, content_json = ?3, content_text = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, norm_title(title), content_json, content_text, now],
    )?;
    tag::set_tags(&tx, id, kb_id, tag_ids)?;
    reindex(&tx, id)?;
    tx.execute("UPDATE kb SET updated_at = ?2 WHERE id = ?1", params![kb_id, now])?;
    tx.commit()?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM card_fts WHERE rowid = ?1", [id])?;
    tx.execute("DELETE FROM card WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// 列表(不含正文 JSON);tag_ids 为 AND 过滤
pub fn list(conn: &Connection, kb_id: i64, tag_ids: &[i64], offset: i64, limit: i64) -> Result<Vec<CardSummary>> {
    let sql = format!(
        "SELECT c.id, c.kb_id, c.title, substr(c.content_text, 1, 120), c.updated_at FROM card c
         WHERE c.kb_id = ?1{} ORDER BY c.updated_at DESC, c.id DESC LIMIT ?2 OFFSET ?3",
        tag::filter_sql(tag_ids)
    );
    let mut st = conn.prepare(&sql)?;
    let mut rows = st
        .query_map(params![kb_id, limit.clamp(1, 1000), offset.max(0)], |r| {
            Ok(CardSummary {
                id: r.get(0)?,
                kb_id: r.get(1)?,
                title: r.get(2)?,
                excerpt: r.get(3)?,
                updated_at: r.get(4)?,
                tags: vec![],
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for c in rows.iter_mut() {
        c.tags = tag::of_card(conn, c.id)?;
    }
    Ok(rows)
}

#[tauri::command]
pub fn card_get(db: State<Db>, id: i64) -> Result<Card> {
    let conn = db.conn()?;
    get(&conn, id)
}

#[tauri::command]
pub fn card_create(
    db: State<Db>,
    kb_id: i64,
    title: String,
    content_json: String,
    content_text: String,
    tag_ids: Vec<i64>,
) -> Result<Card> {
    let conn = db.conn()?;
    create(&conn, kb_id, &title, &content_json, &content_text, &tag_ids)
}

#[tauri::command]
pub fn card_update(
    db: State<Db>,
    id: i64,
    title: String,
    content_json: String,
    content_text: String,
    tag_ids: Vec<i64>,
) -> Result<Card> {
    let conn = db.conn()?;
    update(&conn, id, &title, &content_json, &content_text, &tag_ids)
}

#[tauri::command]
pub fn card_delete(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    delete(&conn, id)
}

#[tauri::command]
pub fn card_list(db: State<Db>, kb_id: i64, tag_ids: Vec<i64>, offset: i64, limit: i64) -> Result<Vec<CardSummary>> {
    let conn = db.conn()?;
    list(&conn, kb_id, &tag_ids, offset, limit)
}
