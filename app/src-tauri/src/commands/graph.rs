use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::Connection;
use tauri::State;

use crate::commands::{link, tag};
use crate::db::Db;
use crate::error::Result;
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

    let set: HashSet<i64> = ids.iter().copied().collect();
    let mut nodes = Vec::with_capacity(ids.len());
    for id in ids {
        if let Ok(title) = conn.query_row("SELECT title FROM card WHERE id = ?1 AND kb_id = ?2", [id, kb_id], |r| r.get::<_, String>(0)) {
            nodes.push(GraphNode { id, title, tags: tag::of_card(conn, id)? });
        }
    }
    let edges: Vec<Link> = all_links.into_iter().filter(|l| set.contains(&l.src_id) && set.contains(&l.dst_id)).collect();
    Ok(Graph { nodes, edges })
}

#[tauri::command]
pub fn graph_get(db: State<Db>, kb_id: i64, focus_card_id: Option<i64>, depth: i64) -> Result<Graph> {
    let conn = db.conn()?;
    get_graph(&conn, kb_id, focus_card_id, depth)
}
