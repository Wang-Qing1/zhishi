use rusqlite::{params, Connection};
use tauri::State;

use crate::commands::card::reindex;
use crate::db::Db;
use crate::error::{AppError, Result};
use crate::models::Tag;

fn row(r: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag { id: r.get(0)?, kb_id: r.get(1)?, name: r.get(2)?, color: r.get(3)?, card_count: r.get(4)? })
}

/// 知识库内所有标签(含使用次数)
pub fn list(conn: &Connection, kb_id: i64) -> Result<Vec<Tag>> {
    let mut st = conn.prepare(
        "SELECT t.id, t.kb_id, t.name, t.color, (SELECT COUNT(*) FROM card_tag ct WHERE ct.tag_id = t.id)
         FROM tag t WHERE t.kb_id = ?1 ORDER BY t.name",
    )?;
    let rows = st.query_map([kb_id], row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn of_card(conn: &Connection, card_id: i64) -> Result<Vec<Tag>> {
    let mut st = conn.prepare(
        "SELECT t.id, t.kb_id, t.name, t.color, 0 FROM tag t
         JOIN card_tag ct ON ct.tag_id = t.id WHERE ct.card_id = ?1 ORDER BY t.name",
    )?;
    let rows = st.query_map([card_id], row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn get(conn: &Connection, id: i64) -> Result<Tag> {
    conn.query_row(
        "SELECT id, kb_id, name, color, (SELECT COUNT(*) FROM card_tag WHERE tag_id = tag.id) FROM tag WHERE id = ?1",
        [id],
        row,
    )
    .map_err(|_| AppError::NotFound(format!("标签 {id}")))
}

fn check_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::msg("标签名称不能为空"));
    }
    Ok(n.to_string())
}

pub fn create(conn: &Connection, kb_id: i64, name: &str, color: &str) -> Result<Tag> {
    conn.execute(
        "INSERT INTO tag(kb_id, name, color) VALUES(?1, ?2, ?3)",
        params![kb_id, check_name(name)?, color],
    )
    .map_err(|e| AppError::from_constraint(e, "标签已存在或知识库不存在"))?;
    get(conn, conn.last_insert_rowid())
}

fn card_ids_of_tag(conn: &Connection, tag_id: i64) -> Result<Vec<i64>> {
    let mut st = conn.prepare("SELECT card_id FROM card_tag WHERE tag_id = ?1")?;
    let ids = st.query_map([tag_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(ids)
}

pub fn update(conn: &Connection, id: i64, name: &str, color: &str) -> Result<Tag> {
    let tx = conn.unchecked_transaction()?;
    let n = tx
        .execute("UPDATE tag SET name = ?2, color = ?3 WHERE id = ?1", params![id, check_name(name)?, color])
        .map_err(|e| AppError::from_constraint(e, "标签名称已存在"))?;
    if n == 0 {
        return Err(AppError::NotFound(format!("标签 {id}")));
    }
    for cid in card_ids_of_tag(&tx, id)? {
        reindex(&tx, cid)?;
    }
    tx.commit()?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let cards = card_ids_of_tag(&tx, id)?;
    tx.execute("DELETE FROM tag WHERE id = ?1", [id])?;
    for cid in cards {
        reindex(&tx, cid)?;
    }
    tx.commit()?;
    Ok(())
}

/// 覆盖设置卡片标签(多个);标签必须属于同一知识库
pub fn set_tags(conn: &Connection, card_id: i64, kb_id: i64, tag_ids: &[i64]) -> Result<()> {
    conn.execute("DELETE FROM card_tag WHERE card_id = ?1", [card_id])?;
    let mut ids = tag_ids.to_vec();
    ids.sort_unstable();
    ids.dedup();
    for tid in ids {
        let n = conn.execute(
            "INSERT INTO card_tag(card_id, tag_id) SELECT ?1, id FROM tag WHERE id = ?2 AND kb_id = ?3",
            params![card_id, tid, kb_id],
        )?;
        if n == 0 {
            return Err(AppError::msg("标签不存在或不属于该知识库"));
        }
    }
    Ok(())
}

/// 标签 AND 过滤的 SQL 片段(卡片别名必须为 c);ids 为 i64 直接内联,无注入风险
pub fn filter_sql(tag_ids: &[i64]) -> String {
    let mut ids = tag_ids.to_vec();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return String::new();
    }
    let list = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
    format!(
        " AND (SELECT COUNT(DISTINCT ct.tag_id) FROM card_tag ct WHERE ct.card_id = c.id AND ct.tag_id IN ({list})) = {}",
        ids.len()
    )
}

#[tauri::command]
pub fn tag_list(db: State<Db>, kb_id: i64) -> Result<Vec<Tag>> {
    let conn = db.conn()?;
    list(&conn, kb_id)
}

#[tauri::command]
pub fn tag_create(db: State<Db>, kb_id: i64, name: String, color: String) -> Result<Tag> {
    let conn = db.conn()?;
    create(&conn, kb_id, &name, &color)
}

#[tauri::command]
pub fn tag_update(db: State<Db>, id: i64, name: String, color: String) -> Result<Tag> {
    let conn = db.conn()?;
    update(&conn, id, &name, &color)
}

#[tauri::command]
pub fn tag_delete(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    delete(&conn, id)
}
