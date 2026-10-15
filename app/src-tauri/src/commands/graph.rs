use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{params, params_from_iter, Connection};
use serde::Deserialize;
use tauri::State;

use crate::commands::{link, tag};
use crate::db::Db;
use crate::error::{AppError, Result};
use crate::models::{Graph, GraphNode, Link};

/// 全图最多返回的节点数,超出时按最近更新截断(建议用户改用聚焦子图)
const MAX_NODES: i64 = 1500;

/// focus 为空返回整个知识库;否则返回以 focus 为中心、depth 跳以内的子图(无向遍历)
pub fn get_graph(conn: &Connection, kb_id: i64, focus: Option<i64>, depth: i64) -> Result<Graph> {
    let all_links = link::list_by_kb(conn, kb_id)?;

    let ids: Vec<i64> = match focus {
        None => {
            let mut st = conn.prepare("SELECT id FROM card WHERE kb_id = ?1 ORDER BY updated_at DESC LIMIT ?2")?;
            let v = st.query_map([kb_id, MAX_NODES], |r| r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
            v
        }
        Some(f) => {
            let mut adj: HashMap<i64, Vec<i64>> = HashMap::new();
            for l in &all_links {
                adj.entry(l.src_id).or_default().push(l.dst_id);
                adj.entry(l.dst_id).or_default().push(l.src_id);
            }
            let mut seen: HashSet<i64> = HashSet::from([f]);
            let mut q = VecDeque::from([(f, 0i64)]);
            while let Some((n, d)) = q.pop_front() {
                if d >= depth.max(0) {
                    continue;
                }
                for &m in adj.get(&n).map(|v| v.as_slice()).unwrap_or(&[]) {
                    if seen.insert(m) {
                        q.push_back((m, d + 1));
                    }
                }
            }
            seen.into_iter().collect()
        }
    };

    let total_cards: i64 = conn.query_row("SELECT COUNT(*) FROM card WHERE kb_id = ?1", [kb_id], |r| r.get(0))?;
    let truncated = focus.is_none() && total_cards > MAX_NODES;
    let mut nodes = Vec::with_capacity(ids.len());
    if !ids.is_empty() {
        let id_params = (2..=ids.len() + 1).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT c.id, c.title, p.x, p.y FROM card c
             LEFT JOIN card_position p ON p.card_id = c.id
             WHERE c.kb_id = ?1 AND c.id IN ({id_params})"
        );
        let mut values = Vec::with_capacity(ids.len() + 1);
        values.push(kb_id);
        values.extend(ids.iter().copied());
        let mut st = conn.prepare(&sql)?;
        let rows = st.query_map(params_from_iter(values.iter()), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<f64>>(2)?,
                r.get::<_, Option<f64>>(3)?,
            ))
        })?;
        let found = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        let valid_ids: Vec<i64> = found.iter().map(|(id, _, _, _)| *id).collect();
        let card_tags = tag::of_cards(conn, &valid_ids)?;
        for (id, title, x, y) in found {
            nodes.push(GraphNode {
                id,
                title,
                x,
                y,
                tags: card_tags.get(&id).cloned().unwrap_or_default(),
            });
        }
    }
    let valid: HashSet<i64> = nodes.iter().map(|n| n.id).collect();
    let edges: Vec<Link> = all_links.into_iter().filter(|l| valid.contains(&l.src_id) && valid.contains(&l.dst_id)).collect();
    Ok(Graph { nodes, edges, truncated })
}

/// 保存卡片在地图上的位置(存在则覆盖)
pub fn save_positions(conn: &Connection, items: &[(i64, f64, f64)]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (id, x, y) in items {
        tx.execute(
            "INSERT INTO card_position(card_id, x, y) VALUES(?1, ?2, ?3)
             ON CONFLICT(card_id) DO UPDATE SET x = excluded.x, y = excluded.y",
            params![id, x, y],
        )
        .map_err(|e| AppError::from_constraint(e, "卡片不存在"))?;
    }
    tx.commit()?;
    Ok(())
}

/// 清除知识库内所有卡片的已保存位置,下次加载时重新自动布局
pub fn reset_positions(conn: &Connection, kb_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM card_position WHERE card_id IN (SELECT id FROM card WHERE kb_id = ?1)",
        [kb_id],
    )?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionInput {
    pub card_id: i64,
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub fn graph_save_positions(db: State<Db>, items: Vec<PositionInput>) -> Result<()> {
    let conn = db.conn()?;
    let v: Vec<(i64, f64, f64)> = items.iter().map(|p| (p.card_id, p.x, p.y)).collect();
    save_positions(&conn, &v)
}

#[tauri::command]
pub fn graph_reset_positions(db: State<Db>, kb_id: i64) -> Result<()> {
    let conn = db.conn()?;
    reset_positions(&conn, kb_id)
}

#[tauri::command(async)]
pub fn graph_get(db: State<Db>, kb_id: i64, focus_card_id: Option<i64>, depth: i64) -> Result<Graph> {
    let conn = db.conn()?;
    get_graph(&conn, kb_id, focus_card_id, depth)
}
