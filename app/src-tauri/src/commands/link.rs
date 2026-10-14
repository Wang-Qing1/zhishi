use rusqlite::{params, Connection};
use tauri::State;

use crate::db::{now_ms, Db};
use crate::error::{AppError, Result};
use crate::models::Link;

pub const RELATION_TYPES: &[&str] = &["related", "prerequisite", "contains", "cites", "contradicts"];

const SEL: &str = "SELECT l.id, l.kb_id, l.src_id, l.dst_id, s.title, d.title, l.relation_type, l.note
    FROM card_link l JOIN card s ON s.id = l.src_id JOIN card d ON d.id = l.dst_id";

pub fn row(r: &rusqlite::Row) -> rusqlite::Result<Link> {
    Ok(Link {
        id: r.get(0)?,
        kb_id: r.get(1)?,
        src_id: r.get(2)?,
        dst_id: r.get(3)?,
        src_title: r.get(4)?,
        dst_title: r.get(5)?,
        relation_type: r.get(6)?,
        note: r.get(7)?,
    })
}

fn kb_of(conn: &Connection, card_id: i64) -> Result<i64> {
    conn.query_row("SELECT kb_id FROM card WHERE id = ?1", [card_id], |r| r.get(0))
        .map_err(|_| AppError::NotFound(format!("卡片 {card_id}")))
}

pub fn create(conn: &Connection, src_id: i64, dst_id: i64, relation_type: &str, note: &str) -> Result<Link> {
    if src_id == dst_id {
        return Err(AppError::msg("不能关联卡片自身"));
    }
    if !RELATION_TYPES.contains(&relation_type) {
        return Err(AppError::msg(format!("未知关系类型: {relation_type}")));
    }
    let kb = kb_of(conn, src_id)?;
    if kb != kb_of(conn, dst_id)? {
        return Err(AppError::msg("只能关联同一知识库内的卡片"));
    }
    conn.execute(
        "INSERT INTO card_link(kb_id, src_id, dst_id, relation_type, note, created_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        params![kb, src_id, dst_id, relation_type, note.trim(), now_ms()],
    )
    .map_err(|e| AppError::from_constraint(e, "该关联已存在"))?;
    let id = conn.last_insert_rowid();
    Ok(conn.query_row(&format!("{SEL} WHERE l.id = ?1"), [id], row)?)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM card_link WHERE id = ?1", [id])?;
    Ok(())
}

/// 与某卡片相关的全部关联(出入边)
pub fn list_by_card(conn: &Connection, card_id: i64) -> Result<Vec<Link>> {
    let mut st = conn.prepare(&format!("{SEL} WHERE l.src_id = ?1 OR l.dst_id = ?1 ORDER BY l.id"))?;
    let rows = st.query_map([card_id], row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn list_by_kb(conn: &Connection, kb_id: i64) -> Result<Vec<Link>> {
    let mut st = conn.prepare(&format!("{SEL} WHERE l.kb_id = ?1 ORDER BY l.id"))?;
    let rows = st.query_map([kb_id], row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn link_create(db: State<Db>, src_id: i64, dst_id: i64, relation_type: String, note: String) -> Result<Link> {
    let conn = db.conn()?;
    create(&conn, src_id, dst_id, &relation_type, &note)
}

#[tauri::command]
pub fn link_delete(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    delete(&conn, id)
}

#[tauri::command]
pub fn link_list_by_card(db: State<Db>, card_id: i64) -> Result<Vec<Link>> {
    let conn = db.conn()?;
    list_by_card(&conn, card_id)
}
