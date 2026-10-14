use rusqlite::Connection;

use crate::commands::{card, graph, kb, link, search, tag};
use crate::db;

fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    db::init(&conn).unwrap();
    conn
}

fn mk_card(conn: &Connection, kb_id: i64, title: &str, text: &str, tags: &[i64]) -> i64 {
    card::create(conn, kb_id, title, "", text, tags).unwrap().id
}

#[test]
fn kb_crud() {
    let conn = setup();
    assert!(kb::create(&conn, "  ", "").is_err());
    let k = kb::create(&conn, "Rust", "学习").unwrap();
    let k = kb::update(&conn, k.id, "Rust 笔记", "").unwrap();
    assert_eq!(k.name, "Rust 笔记");
    assert_eq!(kb::list(&conn).unwrap().len(), 1);
    kb::delete(&conn, k.id).unwrap();
    assert!(kb::get(&conn, k.id).is_err());
}

#[test]
fn fts_chinese_and_short_terms() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    mk_card(&conn, k, "Rust 入门", "Rust 是一门系统编程语言", &[]);
    mk_card(&conn, k, "Python", "脚本语言", &[]);
    // >=3 字符:FTS trigram
    assert_eq!(search::search(&conn, "系统编", None, &[], 20).unwrap().len(), 1);
    // 2 字符:LIKE 回退
    let hits = search::search(&conn, "语言", None, &[], 20).unwrap();
    assert_eq!(hits.len(), 2);
    assert!(hits[0].snippet.contains('\u{1}'));
    // 多词 AND
    assert_eq!(search::search(&conn, "系统编 Rust", None, &[], 20).unwrap().len(), 1);
    assert!(search::search(&conn, "   ", None, &[], 20).unwrap().is_empty());
}

#[test]
fn tags_filter_and_reindex() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let a = tag::create(&conn, k, "后端", "#f00").unwrap().id;
    let b = tag::create(&conn, k, "数据库", "#0f0").unwrap().id;
    assert!(tag::create(&conn, k, "后端", "#fff").is_err());
    let c1 = mk_card(&conn, k, "c1", "x", &[a, b]);
    let _c2 = mk_card(&conn, k, "c2", "y", &[a]);
    assert_eq!(card::list(&conn, k, &[a], 0, 50).unwrap().len(), 2);
    // 多标签为 OR:具备任一标签即命中,且不重复
    let any = card::list(&conn, k, &[a, b], 0, 50).unwrap();
    assert_eq!(any.len(), 2);
    let only_b = card::list(&conn, k, &[b], 0, 50).unwrap();
    assert_eq!(only_b.len(), 1);
    assert_eq!(only_b[0].id, c1);
    assert_eq!(only_b[0].tags.len(), 2);
    // 标签名被索引;重命名后搜索生效
    tag::update(&conn, b, "关系型存储", "#0f0").unwrap();
    assert_eq!(search::search(&conn, "关系型", None, &[], 20).unwrap().len(), 1);
    tag::delete(&conn, b).unwrap();
    assert!(search::search(&conn, "关系型", None, &[], 20).unwrap().is_empty());
    // 跨库标签被拒
    let k2 = kb::create(&conn, "k2", "").unwrap().id;
    assert!(card::create(&conn, k2, "t", "", "", &[a]).is_err());
}

#[test]
fn link_constraints_and_cascade() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let k2 = kb::create(&conn, "k2", "").unwrap().id;
    let a = mk_card(&conn, k, "A", "", &[]);
    let b = mk_card(&conn, k, "B", "", &[]);
    let x = mk_card(&conn, k2, "X", "", &[]);
    assert!(link::create(&conn, a, a, "related", "").is_err());
    assert!(link::create(&conn, a, x, "related", "").is_err());
    assert!(link::create(&conn, a, b, "bogus", "").is_err());
    link::create(&conn, a, b, "related", "").unwrap();
    assert!(link::create(&conn, a, b, "related", "").is_err());
    assert_eq!(link::list_by_card(&conn, b).unwrap().len(), 1);
    // 删除卡片级联删除关联
    card::delete(&conn, a).unwrap();
    assert!(link::list_by_card(&conn, b).unwrap().is_empty());
}

#[test]
fn kb_delete_cleans_fts() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    mk_card(&conn, k, "独特标题词", "独特正文内容", &[]);
    kb::delete(&conn, k).unwrap();
    assert!(search::search(&conn, "独特正文", None, &[], 20).unwrap().is_empty());
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM card_fts", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}

#[test]
fn graph_focus_depth() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let ids: Vec<i64> = (0..4).map(|i| mk_card(&conn, k, &format!("n{i}"), "", &[])).collect();
    // 链:0-1-2-3
    for w in ids.windows(2) {
        link::create(&conn, w[0], w[1], "related", "").unwrap();
    }
    assert_eq!(graph::get_graph(&conn, k, None, 0).unwrap().nodes.len(), 4);
    let g1 = graph::get_graph(&conn, k, Some(ids[0]), 1).unwrap();
    assert_eq!((g1.nodes.len(), g1.edges.len()), (2, 1));
    let g2 = graph::get_graph(&conn, k, Some(ids[1]), 2).unwrap();
    assert_eq!((g2.nodes.len(), g2.edges.len()), (4, 3));
}

#[test]
fn graph_positions_saved_and_reset() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let a = mk_card(&conn, k, "A", "", &[]);
    let b = mk_card(&conn, k, "B", "", &[]);
    assert!(graph::get_graph(&conn, k, None, 0).unwrap().nodes.iter().all(|n| n.x.is_none()));
    graph::save_positions(&conn, &[(a, 10.5, 20.0), (b, -3.0, 4.0)]).unwrap();
    // 再次保存覆盖
    graph::save_positions(&conn, &[(a, 99.0, 1.0)]).unwrap();
    let g = graph::get_graph(&conn, k, None, 0).unwrap();
    let na = g.nodes.iter().find(|n| n.id == a).unwrap();
    assert_eq!((na.x, na.y), (Some(99.0), Some(1.0)));
    assert!(graph::save_positions(&conn, &[(9999, 0.0, 0.0)]).is_err());
    graph::reset_positions(&conn, k).unwrap();
    assert!(graph::get_graph(&conn, k, None, 0).unwrap().nodes.iter().all(|n| n.x.is_none()));
    // 删除卡片级联删除位置
    graph::save_positions(&conn, &[(b, 1.0, 1.0)]).unwrap();
    card::delete(&conn, b).unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM card_position", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}
