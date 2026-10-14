use rusqlite::{params_from_iter, Connection};
use tauri::State;

use crate::commands::tag;
use crate::db::Db;
use crate::error::Result;
use crate::models::SearchHit;

const HL_START: char = '\u{1}';
const HL_END: char = '\u{2}';

/// 全局搜索:所有词需 >=3 字符时走 FTS5 trigram(bm25 排序);含短词(如 2 字中文词)回退 LIKE
pub fn search(conn: &Connection, query: &str, kb_id: Option<i64>, tag_ids: &[i64], limit: i64) -> Result<Vec<SearchHit>> {
    let terms: Vec<&str> = query.split_whitespace().collect();
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let limit = limit.clamp(1, 200);
    let mut filters = tag::filter_sql(tag_ids);
    if let Some(k) = kb_id {
        filters.push_str(&format!(" AND c.kb_id = {k}"));
    }
    let use_fts = terms.iter().all(|t| t.chars().count() >= 3);

    let (sql, params): (String, Vec<String>) = if use_fts {
        // 每个词作为短语(双引号转义),词间 AND
        let m = terms.iter().map(|t| format!("\"{}\"", t.replace('"', "\"\""))).collect::<Vec<_>>().join(" ");
        (
            format!(
                "SELECT c.id, c.kb_id, k.name, c.title, snippet(card_fts, 1, char(1), char(2), '…', 24)
                 FROM card_fts JOIN card c ON c.id = card_fts.rowid JOIN kb k ON k.id = c.kb_id
                 WHERE card_fts MATCH ?1{filters} ORDER BY bm25(card_fts) LIMIT {limit}"
            ),
            vec![m],
        )
    } else {
        let mut conds = Vec::new();
        let mut ps = Vec::new();
        for (i, t) in terms.iter().enumerate() {
            let esc = t.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            ps.push(format!("%{esc}%"));
            let n = i + 1;
            conds.push(format!(
                "(c.title LIKE ?{n} ESCAPE '\\' OR c.content_text LIKE ?{n} ESCAPE '\\' OR EXISTS (SELECT 1 FROM card_tag ct JOIN tag t ON t.id = ct.tag_id WHERE ct.card_id = c.id AND t.name LIKE ?{n} ESCAPE '\\'))"
            ));
        }
        (
            format!(
                "SELECT c.id, c.kb_id, k.name, c.title, c.content_text FROM card c JOIN kb k ON k.id = c.kb_id
                 WHERE {}{filters} ORDER BY c.updated_at DESC LIMIT {limit}",
                conds.join(" AND ")
            ),
            ps,
        )
    };

    let mut st = conn.prepare(&sql)?;
    let mut hits = st
        .query_map(params_from_iter(params.iter()), |r| {
            let raw: String = r.get(4)?;
            Ok(SearchHit {
                card_id: r.get(0)?,
                kb_id: r.get(1)?,
                kb_name: r.get(2)?,
                title: r.get(3)?,
                snippet: if use_fts { raw } else { make_snippet(&raw, terms[0]) },
                tags: vec![],
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for h in hits.iter_mut() {
        h.tags = tag::of_card(conn, h.card_id)?;
    }
    Ok(hits)
}

/// LIKE 回退时手工生成摘要(忽略大小写,按字符截取,不会切坏中文)
fn make_snippet(text: &str, term: &str) -> String {
    let lc = |c: char| c.to_lowercase().next().unwrap_or(c);
    let hay: Vec<char> = text.chars().collect();
    let low: Vec<char> = hay.iter().map(|&c| lc(c)).collect();
    let needle: Vec<char> = term.chars().map(lc).collect();
    let pos = if needle.is_empty() || needle.len() > low.len() {
        None
    } else {
        (0..=low.len() - needle.len()).find(|&i| low[i..i + needle.len()] == needle[..])
    };
    match pos {
        Some(p) => {
            let start = p.saturating_sub(24);
            let end = (p + needle.len() + 48).min(hay.len());
            let mut s = String::new();
            if start > 0 {
                s.push('…');
            }
            s.extend(&hay[start..p]);
            s.push(HL_START);
            s.extend(&hay[p..p + needle.len()]);
            s.push(HL_END);
            s.extend(&hay[p + needle.len()..end]);
            if end < hay.len() {
                s.push('…');
            }
            s
        }
        None => hay.iter().take(72).collect(),
    }
}

#[tauri::command]
pub fn search_global(db: State<Db>, query: String, kb_id: Option<i64>, tag_ids: Vec<i64>, limit: i64) -> Result<Vec<SearchHit>> {
    let conn = db.conn()?;
    search(&conn, &query, kb_id, &tag_ids, limit)
}
