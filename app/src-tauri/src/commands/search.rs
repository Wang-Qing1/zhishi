use rusqlite::{params_from_iter, Connection};
use tauri::State;

use crate::commands::tag;
use crate::db::Db;
use crate::error::Result;
use crate::models::SearchHit;

const HL_START: char = '\u{1}';
const HL_END: char = '\u{2}';

fn like_param(term: &str) -> String {
    let esc = term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    format!("%{esc}%")
}

/// 单个词的 LIKE 条件(标题/正文/标签名任一包含),n 为参数序号
fn like_cond(n: usize) -> String {
    format!(
        "(c.title LIKE ?{n} ESCAPE '\\' OR c.content_text LIKE ?{n} ESCAPE '\\' OR EXISTS (SELECT 1 FROM card_tag ct JOIN tag t ON t.id = ct.tag_id WHERE ct.card_id = c.id AND t.name LIKE ?{n} ESCAPE '\\'))"
    )
}

/// 全局搜索:>=3 字符的词走 FTS5 trigram(bm25 排序),<3 字符的短词(如 2 字中文词)用 LIKE 过滤;
/// 有长词时 LIKE 只在 FTS 筛出的候选行上执行,全是短词时才整体回退到 LIKE
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
    let longs: Vec<&str> = terms.iter().copied().filter(|t| t.chars().count() >= 3).collect();
    let shorts: Vec<&str> = terms.iter().copied().filter(|t| t.chars().count() < 3).collect();
    let use_fts = !longs.is_empty();

    let (sql, params): (String, Vec<String>) = if use_fts {
        // 每个长词作为短语(双引号转义),词间 AND;短词作为额外 LIKE 条件
        let m = longs.iter().map(|t| format!("\"{}\"", t.replace('"', "\"\""))).collect::<Vec<_>>().join(" ");
        let mut ps = vec![m];
        let mut extra = String::new();
        for t in &shorts {
            ps.push(like_param(t));
            extra.push_str(&format!(" AND {}", like_cond(ps.len())));
        }
        (
            format!(
                "SELECT c.id, c.kb_id, k.name, c.title, snippet(card_fts, -1, char(1), char(2), '…', 24)
                 FROM card_fts JOIN card c ON c.id = card_fts.rowid JOIN kb k ON k.id = c.kb_id
                 WHERE card_fts MATCH ?1{extra}{filters} ORDER BY bm25(card_fts) LIMIT {limit}"
            ),
            ps,
        )
    } else {
        let mut conds = Vec::new();
        let mut ps = Vec::new();
        for (i, t) in terms.iter().enumerate() {
            ps.push(like_param(t));
            conds.push(like_cond(i + 1));
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
                snippet: if use_fts { raw } else { make_snippet(&raw, &terms) },
                tags: vec![],
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let card_ids: Vec<i64> = hits.iter().map(|h| h.card_id).collect();
    let tags = tag::of_cards(conn, &card_ids)?;
    for h in hits.iter_mut() {
        h.tags = tags.get(&h.card_id).cloned().unwrap_or_default();
    }
    Ok(hits)
}

/// LIKE 回退时手工生成摘要:以最早出现的词为锚点截取窗口,窗口内所有词的所有出现位置都高亮
/// (忽略大小写,按字符截取,不会切坏中文)
fn make_snippet(text: &str, terms: &[&str]) -> String {
    let lc = |c: char| c.to_lowercase().next().unwrap_or(c);
    let hay: Vec<char> = text.chars().collect();
    let low: Vec<char> = hay.iter().map(|&c| lc(c)).collect();
    let needles: Vec<Vec<char>> = terms
        .iter()
        .map(|t| t.chars().map(lc).collect::<Vec<char>>())
        .filter(|n| !n.is_empty())
        .collect();
    let matches_at = |i: usize, n: &[char]| i + n.len() <= low.len() && low[i..i + n.len()] == *n;
    let first = (0..low.len()).find(|&i| needles.iter().any(|n| matches_at(i, n)));
    let Some(p) = first else {
        return hay.iter().take(72).collect();
    };
    let start = p.saturating_sub(24);
    let mut end = (p + 72).min(hay.len());
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    let mut i = start;
    while i < end {
        // 在当前位置取最长的命中词
        let len = needles.iter().filter(|n| matches_at(i, n)).map(|n| n.len()).max();
        match len {
            Some(l) => {
                s.push(HL_START);
                s.extend(&hay[i..i + l]);
                s.push(HL_END);
                i += l;
                end = end.max(i);
            }
            None => {
                s.push(hay[i]);
                i += 1;
            }
        }
    }
    if end < hay.len() {
        s.push('…');
    }
    s
}

#[tauri::command(async)]
pub fn search_global(db: State<Db>, query: String, kb_id: Option<i64>, tag_ids: Vec<i64>, limit: i64) -> Result<Vec<SearchHit>> {
    let conn = db.conn()?;
    search(&conn, &query, kb_id, &tag_ids, limit)
}
