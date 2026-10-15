use rusqlite::Connection;

use crate::commands::{card, graph, image, kb, link, search, tag};
use crate::db;

fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    db::init(&conn).unwrap();
    conn
}

fn mk_card(conn: &Connection, kb_id: i64, title: &str, text: &str, tags: &[i64]) -> i64 {
    card::create(conn, kb_id, title, "", text, tags).unwrap().id
}

fn tmp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("zhishi-test-{tag}-{}-{nanos}", std::process::id()))
}

#[test]
fn image_store_dedup_and_validation() {
    let dir = tmp_dir("store");
    let a = image::save(&dir, b"hello", "PNG").unwrap();
    // 同内容去重,不同内容不同文件
    assert_eq!(a, image::save(&dir, b"hello", ".png").unwrap());
    assert_ne!(a, image::save(&dir, b"world", "png").unwrap());
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
    // 扩展名/空内容/超大被拒
    assert!(image::save(&dir, b"x", "exe").is_err());
    assert!(image::save(&dir, b"", "png").is_err());
    assert!(image::save(&dir, &vec![0u8; 3 * 1024 * 1024 + 1], "png").is_err());
    // 协议读取:合法文件名可读,非法/路径穿越/不存在返回 None
    let (bytes, mime) = image::read_for_protocol(&dir, &a).unwrap();
    assert_eq!((bytes.as_slice(), mime), (&b"hello"[..], "image/png"));
    assert!(image::read_for_protocol(&dir, "../x.png").is_none());
    assert!(image::read_for_protocol(&dir, "abc.png").is_none());
    assert!(image::read_for_protocol(&dir, &format!("{}.png", "0".repeat(64))).is_none());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn image_migrate_base64_to_files() {
    let conn = setup();
    let dir = tmp_dir("migrate");
    let k = kb::create(&conn, "k", "").unwrap().id;
    let doc = serde_json::json!({
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": "data:image/png;base64,aGVsbG8="}}]
    });
    let id = card::create(&conn, k, "t", &doc.to_string(), "", &[]).unwrap().id;
    assert_eq!(image::migrate_base64(&conn, &dir).unwrap(), 1);
    let json: String = conn
        .query_row("SELECT content_json FROM card WHERE id = ?1", [id], |r| r.get(0))
        .unwrap();
    assert!(json.contains(image::REF_PREFIX) && !json.contains("data:image"));
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    // 再次执行无可迁移内容
    assert_eq!(image::migrate_base64(&conn, &dir).unwrap(), 0);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn image_gc_removes_only_orphans() {
    let conn = setup();
    let dir = tmp_dir("gc");
    let k = kb::create(&conn, "k", "").unwrap().id;
    let used = image::save(&dir, b"used", "png").unwrap();
    let orphan = image::save(&dir, b"orphan", "png").unwrap();
    let doc = serde_json::json!({
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": format!("{}{}", image::REF_PREFIX, used)}}]
    });
    card::create(&conn, k, "t", &doc.to_string(), "", &[]).unwrap();
    // 刚创建的孤儿图片在保护期内不删
    assert_eq!(image::gc(&conn, &dir, std::time::Duration::from_secs(86400)).unwrap(), 0);
    assert_eq!(image::gc(&conn, &dir, std::time::Duration::ZERO).unwrap(), 1);
    assert!(dir.join(&used).exists());
    assert!(!dir.join(&orphan).exists());
    std::fs::remove_dir_all(&dir).ok();
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
fn fts_mixed_long_and_short_terms() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    mk_card(&conn, k, "Rust 入门", "Rust 是一门系统编程语言", &[]);
    mk_card(&conn, k, "Python", "脚本语言", &[]);
    // 长词 + 短词:FTS 缩小范围后再用 LIKE 过滤短词,摘要带高亮
    let hits = search::search(&conn, "系统编 语言", None, &[], 20).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].snippet.contains('\u{1}'));
    // 只含短词的 Python 卡片不应出现
    let hits = search::search(&conn, "Rust 语言", None, &[], 20).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "Rust 入门");
    // 长词命中但短词不命中
    assert!(search::search(&conn, "系统编 脚本", None, &[], 20).unwrap().is_empty());
    // 全短词:多个词都高亮
    let hits = search::search(&conn, "系统 语言", None, &[], 20).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].snippet.matches('\u{1}').count(), 2);
}

#[test]
fn kb_search_by_name_and_description() {
    let conn = setup();
    let a = kb::create(&conn, "Rust 笔记", "系统编程").unwrap().id;
    kb::create(&conn, "英语", "词汇与语法").unwrap();
    mk_card(&conn, a, "无关标题", "", &[]);
    assert_eq!(kb::search(&conn, "rust", 10).unwrap().len(), 1);
    assert_eq!(kb::search(&conn, "语法", 10).unwrap().len(), 1);
    assert_eq!(kb::search(&conn, "rust 编程", 10).unwrap().len(), 1);
    assert!(kb::search(&conn, "rust 语法", 10).unwrap().is_empty());
    assert!(kb::search(&conn, "%", 10).unwrap().is_empty());
    assert!(kb::search(&conn, "  ", 10).unwrap().is_empty());
    // 不会把卡片标题当成知识库结果
    assert!(kb::search(&conn, "无关标题", 10).unwrap().is_empty());
}

#[test]
fn fts_snippet_highlights_title_only_match() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    mk_card(&conn, k, "独特标题词", "完全无关的正文", &[]);
    let hits = search::search(&conn, "独特标题", None, &[], 20).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].snippet.contains('\u{1}'));
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
    assert_eq!(card::list_page(&conn, k, &[a], "", 0, 50).unwrap().items.len(), 2);
    // 多标签为 OR:具备任一标签即命中,且不重复
    let any = card::list_page(&conn, k, &[a, b], "", 0, 50).unwrap().items;
    assert_eq!(any.len(), 2);
    let only_b = card::list_page(&conn, k, &[b], "", 0, 50).unwrap().items;
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
fn paged_card_list_filters_title_and_or_tags() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let backend = tag::create(&conn, k, "后端", "#f00").unwrap().id;
    let storage = tag::create(&conn, k, "存储", "#0f0").unwrap().id;
    mk_card(&conn, k, "Rust 数据库", "SQLite", &[backend]);
    mk_card(&conn, k, "Rust 服务", "API", &[storage]);
    mk_card(&conn, k, "Python", "脚本", &[]);

    let page = card::list_page(&conn, k, &[backend, storage], "Rust", 0, 1).unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(page.items.len(), 1);
    assert!(page.items[0].title.starts_with("Rust"));

    let second = card::list_page(&conn, k, &[backend, storage], "Rust", 1, 1).unwrap();
    assert_eq!(second.total, 2);
    assert_eq!(second.items.len(), 1);
    assert_ne!(page.items[0].id, second.items[0].id);

    let escaped = card::list_page(&conn, k, &[], "%", 0, 24).unwrap();
    assert_eq!(escaped.total, 0);
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
fn kb_touched_on_card_delete_and_link_change() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let a = mk_card(&conn, k, "A", "", &[]);
    let b = mk_card(&conn, k, "B", "", &[]);
    let stamp = |conn: &Connection| kb::get(conn, k).unwrap().updated_at;
    let reset = |conn: &Connection| conn.execute("UPDATE kb SET updated_at = 0", []).unwrap();

    reset(&conn);
    let l = link::create(&conn, a, b, "related", "").unwrap();
    assert!(stamp(&conn) > 0);
    reset(&conn);
    link::delete(&conn, l.id).unwrap();
    assert!(stamp(&conn) > 0);
    reset(&conn);
    card::delete(&conn, a).unwrap();
    assert!(stamp(&conn) > 0);
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
