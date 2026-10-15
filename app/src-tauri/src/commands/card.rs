use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use tauri::State;

use crate::commands::{kb, tag, version};
use crate::db::{now_ms, Db};
use crate::error::{AppError, Result};
use crate::models::{Card, CardPage, CardSummary};

const CARD_REF_PREFIX: &str = "zhishi-card://";

fn norm_title(t: &str) -> String {
    let t = t.trim();
    if t.is_empty() { "未命名卡片".to_string() } else { t.to_string() }
}

fn references_card(content_json: &str, card_id: i64) -> bool {
    fn contains_reference(value: &Value, href: &str) -> bool {
        match value {
            Value::Object(object) => {
                let is_reference = object.get("type").and_then(Value::as_str) == Some("link")
                    && object
                        .get("attrs")
                        .and_then(|attrs| attrs.get("href"))
                        .and_then(Value::as_str)
                        == Some(href);
                is_reference || object.values().any(|value| contains_reference(value, href))
            }
            Value::Array(items) => items.iter().any(|value| contains_reference(value, href)),
            _ => false,
        }
    }

    serde_json::from_str(content_json)
        .map(|value| contains_reference(&value, &format!("{CARD_REF_PREFIX}{card_id}")))
        .unwrap_or(false)
}

/// 重建单张卡片的全文索引(标题 + 正文 + 标签名)
pub fn reindex(conn: &Connection, card_id: i64) -> Result<()> {
    conn.execute("DELETE FROM card_fts WHERE rowid = ?1", [card_id])?;
    conn.execute(
        "INSERT INTO card_fts(rowid, title, content_text, tags)
         SELECT c.id, c.title, c.content_text,
                COALESCE((SELECT group_concat(t.name, ' ') FROM card_tag ct JOIN tag t ON t.id = ct.tag_id WHERE ct.card_id = c.id), '')
         FROM card c WHERE c.id = ?1 AND c.deleted_at IS NULL",
        [card_id],
    )?;
    Ok(())
}

/// 只查卡片所属知识库(不读正文和标签);卡片不存在返回 None
fn find_kb_id(conn: &Connection, id: i64) -> Result<Option<i64>> {
    Ok(conn
        .query_row("SELECT kb_id FROM card WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<Card> {
    let mut card = conn
        .query_row(
            "SELECT id, kb_id, title, content_json, created_at, updated_at FROM card WHERE id = ?1 AND deleted_at IS NULL",
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

/// 测试用的简写:不强制生成历史版本;正式代码直接调用 update_with
#[cfg(test)]
pub fn update(
    conn: &Connection,
    id: i64,
    title: &str,
    content_json: &str,
    content_text: &str,
    tag_ids: &[i64],
) -> Result<Card> {
    update_with(conn, id, title, content_json, content_text, tag_ids, false)
}

/// 更新卡片;同时把旧内容存为历史版本(force_version 为真时不受版本间隔限制)
pub fn update_with(
    conn: &Connection,
    id: i64,
    title: &str,
    content_json: &str,
    content_text: &str,
    tag_ids: &[i64],
    force_version: bool,
) -> Result<Card> {
    let (kb_id, old_title, old_json, old_saved_at): (i64, String, String, i64) = conn
        .query_row(
            "SELECT kb_id, title, content_json, updated_at FROM card WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("卡片 {id}")))?;
    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    let new_title = norm_title(title);
    version::snapshot(&tx, id, &old_title, &old_json, old_saved_at, &new_title, content_json, force_version)?;
    tx.execute(
        "UPDATE card SET title = ?2, content_json = ?3, content_text = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, new_title, content_json, content_text, now],
    )?;
    tag::set_tags(&tx, id, kb_id, tag_ids)?;
    reindex(&tx, id)?;
    tx.execute("UPDATE kb SET updated_at = ?2 WHERE id = ?1", params![kb_id, now])?;
    tx.commit()?;
    get(conn, id)
}

/// 移入回收站(软删除):保留关联/标签/位置,仅从全文索引中移除
pub fn trash(conn: &Connection, id: i64) -> Result<()> {
    let kb_id = find_kb_id(conn, id)?.ok_or_else(|| AppError::NotFound(format!("卡片 {id}")))?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE card SET deleted_at = ?2 WHERE id = ?1", params![id, now_ms()])?;
    tx.execute("DELETE FROM card_fts WHERE rowid = ?1", [id])?;
    kb::touch(&tx, kb_id)?;
    tx.commit()?;
    Ok(())
}

/// 从回收站恢复卡片;所属知识库也在回收站时需先恢复知识库
pub fn restore(conn: &Connection, id: i64) -> Result<()> {
    let (kb_id, kb_trashed): (i64, bool) = conn
        .query_row(
            "SELECT c.kb_id, k.deleted_at IS NOT NULL FROM card c JOIN kb k ON k.id = c.kb_id
             WHERE c.id = ?1 AND c.deleted_at IS NOT NULL",
            [id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("回收站中的卡片 {id}")))?;
    if kb_trashed {
        return Err(AppError::msg("请先恢复所属知识库"));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE card SET deleted_at = NULL WHERE id = ?1", [id])?;
    reindex(&tx, id)?;
    kb::touch(&tx, kb_id)?;
    tx.commit()?;
    Ok(())
}

/// 永久删除(清空回收站/过期清理用);用户点“删除”走 trash
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    let kb_id = find_kb_id(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM card_fts WHERE rowid = ?1", [id])?;
    tx.execute("DELETE FROM card WHERE id = ?1", [id])?;
    tx.execute("DELETE FROM card_draft WHERE card_id = ?1", [id])?;
    if let Some(k) = kb_id {
        kb::touch(&tx, k)?;
    }
    tx.commit()?;
    Ok(())
}

/// Paginated card list with optional title substring search and OR tag filtering.
pub fn list_page(
    conn: &Connection,
    kb_id: i64,
    tag_ids: &[i64],
    keyword: &str,
    offset: i64,
    limit: i64,
) -> Result<CardPage> {
    let keyword = keyword.trim();
    let escaped = keyword.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{escaped}%");
    let filters = format!("{} AND c.deleted_at IS NULL", tag::filter_sql(tag_ids));
    let total = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM card c
             WHERE c.kb_id = ?1 AND (?2 = '' OR c.title LIKE ?3 ESCAPE '\\'){filters}"
        ),
        params![kb_id, keyword, pattern],
        |r| r.get(0),
    )?;
    let mut st = conn.prepare(&format!(
        "SELECT c.id, c.kb_id, c.title, substr(c.content_text, 1, 120), c.updated_at FROM card c
         WHERE c.kb_id = ?1 AND (?2 = '' OR c.title LIKE ?3 ESCAPE '\\'){filters}
         ORDER BY c.updated_at DESC, c.id DESC LIMIT ?4 OFFSET ?5"
    ))?;
    let mut items = st
        .query_map(
            params![kb_id, keyword, pattern, limit.clamp(1, 100), offset.max(0)],
            |r| {
                Ok(CardSummary {
                    id: r.get(0)?,
                    kb_id: r.get(1)?,
                    title: r.get(2)?,
                    excerpt: r.get(3)?,
                    updated_at: r.get(4)?,
                    tags: vec![],
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let tags = tag::of_cards(conn, &items.iter().map(|c| c.id).collect::<Vec<_>>())?;
    for item in items.iter_mut() {
        item.tags = tags.get(&item.id).cloned().unwrap_or_default();
    }
    Ok(CardPage { items, total })
}

pub fn search_titles(conn: &Connection, kb_id: i64, query: &str) -> Result<Vec<CardSummary>> {
    Ok(list_page(conn, kb_id, &[], query, 0, 50)?.items)
}

pub fn backlinks(conn: &Connection, kb_id: i64, card_id: i64) -> Result<Vec<CardSummary>> {
    if find_kb_id(conn, card_id)? != Some(kb_id) {
        return Err(AppError::NotFound(format!("知识库 {kb_id} 中的卡片 {card_id}")));
    }

    let mut st = conn.prepare(
        "SELECT id, kb_id, title, substr(content_text, 1, 120), updated_at, content_json
         FROM card
         WHERE kb_id = ?1 AND id != ?2 AND deleted_at IS NULL AND content_json LIKE ?3
         ORDER BY updated_at DESC, id DESC",
    )?;
    let candidates = st
        .query_map(
            params![kb_id, card_id, format!("%{CARD_REF_PREFIX}{card_id}%")],
            |r| {
                Ok((
                    CardSummary {
                        id: r.get(0)?,
                        kb_id: r.get(1)?,
                        title: r.get(2)?,
                        excerpt: r.get(3)?,
                        updated_at: r.get(4)?,
                        tags: vec![],
                    },
                    r.get::<_, String>(5)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut items: Vec<CardSummary> = candidates
        .into_iter()
        .filter_map(|(summary, content)| references_card(&content, card_id).then_some(summary))
        .collect();
    let tags = tag::of_cards(conn, &items.iter().map(|c| c.id).collect::<Vec<_>>())?;
    for item in &mut items {
        item.tags = tags.get(&item.id).cloned().unwrap_or_default();
    }
    Ok(items)
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
    force_version: Option<bool>,
) -> Result<Card> {
    let conn = db.conn()?;
    update_with(&conn, id, &title, &content_json, &content_text, &tag_ids, force_version.unwrap_or(false))
}

#[tauri::command]
pub fn card_delete(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    trash(&conn, id)
}

#[tauri::command(async)]
pub fn card_list_page(
    db: State<Db>,
    kb_id: i64,
    tag_ids: Vec<i64>,
    keyword: String,
    offset: i64,
    limit: i64,
) -> Result<CardPage> {
    let conn = db.conn()?;
    list_page(&conn, kb_id, &tag_ids, &keyword, offset, limit)
}

#[tauri::command]
pub fn card_search_titles(db: State<Db>, kb_id: i64, query: String) -> Result<Vec<CardSummary>> {
    let conn = db.conn()?;
    search_titles(&conn, kb_id, &query)
}

#[tauri::command]
pub fn card_backlinks(db: State<Db>, kb_id: i64, card_id: i64) -> Result<Vec<CardSummary>> {
    let conn = db.conn()?;
    backlinks(&conn, kb_id, card_id)
}
