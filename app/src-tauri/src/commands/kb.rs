use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use tauri::State;

use crate::db::{now_ms, Db};
use crate::error::{AppError, Result};
use crate::models::Kb;

const SEL: &str = "SELECT k.id, k.name, k.description, k.created_at, k.updated_at, \
    (SELECT COUNT(*) FROM card c WHERE c.kb_id = k.id AND c.deleted_at IS NULL) FROM kb k";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Kb> {
    Ok(Kb {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
        card_count: r.get(5)?,
    })
}

fn check_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::msg("知识库名称不能为空"));
    }
    Ok(n.to_string())
}

pub fn list(conn: &Connection) -> Result<Vec<Kb>> {
    let mut st = conn.prepare(&format!("{SEL} WHERE k.deleted_at IS NULL ORDER BY k.updated_at DESC"))?;
    let rows = st.query_map([], row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> Result<Kb> {
    conn.query_row(&format!("{SEL} WHERE k.id = ?1 AND k.deleted_at IS NULL"), [id], row)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("知识库 {id}")))
}

pub fn create(conn: &Connection, name: &str, description: &str) -> Result<Kb> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO kb(name, description, created_at, updated_at) VALUES(?1, ?2, ?3, ?3)",
        params![check_name(name)?, description.trim(), now],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, name: &str, description: &str) -> Result<Kb> {
    let n = conn.execute(
        "UPDATE kb SET name = ?2, description = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, check_name(name)?, description.trim(), now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("知识库 {id}")));
    }
    get(conn, id)
}

/// 按名称/描述模糊搜索知识库(空格分隔的多个词全部命中,不区分大小写)
pub fn search(conn: &Connection, query: &str, limit: i64) -> Result<Vec<Kb>> {
    let terms: Vec<&str> = query.split_whitespace().collect();
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let mut conds = Vec::new();
    let mut ps = Vec::new();
    for (i, t) in terms.iter().enumerate() {
        let esc = t.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        ps.push(format!("%{esc}%"));
        let n = i + 1;
        conds.push(format!("(k.name LIKE ?{n} ESCAPE '\\' OR k.description LIKE ?{n} ESCAPE '\\')"));
    }
    let sql = format!(
        "{SEL} WHERE k.deleted_at IS NULL AND {} ORDER BY k.updated_at DESC LIMIT {}",
        conds.join(" AND "),
        limit.clamp(1, 50)
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(params_from_iter(ps.iter()), row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// 刷新知识库的更新时间(卡片/关联变化时调用,用于列表的“最近更新”排序)
pub fn touch(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE kb SET updated_at = ?2 WHERE id = ?1", params![id, now_ms()])?;
    Ok(())
}

/// 移入回收站(软删除);其下卡片、标签、关联原样保留,随知识库一起隐藏
pub fn trash(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute(
        "UPDATE kb SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("知识库 {id}")));
    }
    Ok(())
}

/// 从回收站恢复知识库
pub fn restore(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute(
        "UPDATE kb SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id, now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("回收站中的知识库 {id}")));
    }
    Ok(())
}

/// 永久删除:级联删除卡片/标签/关联;FTS 行需手动清理
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM card_fts WHERE rowid IN (SELECT id FROM card WHERE kb_id = ?1)", [id])?;
    tx.execute("DELETE FROM kb WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn kb_list(db: State<Db>) -> Result<Vec<Kb>> {
    let conn = db.conn()?;
    list(&conn)
}

#[tauri::command]
pub fn kb_search(db: State<Db>, query: String, limit: i64) -> Result<Vec<Kb>> {
    let conn = db.conn()?;
    search(&conn, &query, limit)
}

#[tauri::command]
pub fn kb_get(db: State<Db>, id: i64) -> Result<Kb> {
    let conn = db.conn()?;
    get(&conn, id)
}

#[tauri::command]
pub fn kb_create(db: State<Db>, name: String, description: String) -> Result<Kb> {
    let conn = db.conn()?;
    create(&conn, &name, &description)
}

#[tauri::command]
pub fn kb_update(db: State<Db>, id: i64, name: String, description: String) -> Result<Kb> {
    let conn = db.conn()?;
    update(&conn, id, &name, &description)
}

#[tauri::command]
pub fn kb_delete(db: State<Db>, id: i64) -> Result<()> {
    let conn = db.conn()?;
    trash(&conn, id)
}
