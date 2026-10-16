use rusqlite::Connection;

use crate::commands::{backup, card, draft, graph, image, kb, link, search, tag, trash, version};
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
fn backup_roundtrip_restores_db_and_images() {
    let root = tmp_dir("backup");
    let (img_a, img_b) = (root.join("img_a"), root.join("img_b"));
    let (zip_path, backups) = (root.join("b.zip"), root.join("app_b").join("backups"));
    std::fs::create_dir_all(&root).unwrap();

    let a = setup();
    let k = kb::create(&a, "备份库", "").unwrap().id;
    let pic = image::save(&img_a, b"pic", "png").unwrap();
    let doc = serde_json::json!({
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": format!("{}{}", image::REF_PREFIX, pic)}}]
    });
    card::create(&a, k, "c", &doc.to_string(), "正文内容用于搜索", &[]).unwrap();
    backup::export(&a, &img_a, &zip_path).unwrap();

    let mut b = setup();
    kb::create(&b, "另一个库", "").unwrap();
    backup::restore(&mut b, &backups, &img_b, &zip_path).unwrap();
    let names: Vec<String> = kb::list(&b).unwrap().into_iter().map(|k| k.name).collect();
    assert_eq!(names, vec!["备份库".to_string()]);
    assert!(img_b.join(&pic).exists());
    // 全文索引随数据库一起恢复
    assert_eq!(search::search(&b, "用于搜索", None, &[], 20).unwrap().len(), 1);
    // 恢复前自动备份了原数据
    assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 1);
    // 恢复后可继续正常写入
    kb::create(&b, "新建", "").unwrap();
    assert_eq!(kb::list(&b).unwrap().len(), 2);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn backup_restore_rejects_bad_files() {
    let root = tmp_dir("backup-bad");
    std::fs::create_dir_all(&root).unwrap();
    let backups = root.join("backups");
    let imgs = root.join("imgs");
    let mut conn = setup();
    kb::create(&conn, "保留", "").unwrap();

    // 不是 zip
    let fake = root.join("fake.zip");
    std::fs::write(&fake, b"nope").unwrap();
    assert!(backup::restore(&mut conn, &backups, &imgs, &fake).is_err());

    // 来自更新版本
    let newer = root.join("newer.db");
    {
        let n = Connection::open(&newer).unwrap();
        n.execute_batch("PRAGMA user_version = 999; CREATE TABLE kb(id); CREATE TABLE card(id);").unwrap();
    }
    let newer_zip = root.join("newer.zip");
    backup::pack(&newer, &imgs, &newer_zip).unwrap();
    assert!(backup::restore(&mut conn, &backups, &imgs, &newer_zip).is_err());

    // 失败后当前数据不变
    assert_eq!(kb::list(&conn).unwrap().len(), 1);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn trash_card_hides_everywhere_and_restores() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let t = tag::create(&conn, k, "标签一", "#f00").unwrap().id;
    let a = mk_card(&conn, k, "A", "独特正文内容", &[t]);
    let b = mk_card(&conn, k, "B", "", &[]);
    link::create(&conn, a, b, "related", "").unwrap();

    card::trash(&conn, a).unwrap();
    // 列表/详情/更新/搜索/关联/地图/计数都看不到
    assert!(card::get(&conn, a).is_err());
    assert!(card::update(&conn, a, "x", "", "", &[]).is_err());
    assert_eq!(card::list_page(&conn, k, &[], "", 0, 50).unwrap().total, 1);
    assert!(search::search(&conn, "独特正文", None, &[], 20).unwrap().is_empty());
    assert!(search::search(&conn, "正文", None, &[], 20).unwrap().is_empty());
    assert!(link::list_by_card(&conn, b).unwrap().is_empty());
    assert!(link::list_by_kb(&conn, k).unwrap().is_empty());
    assert!(link::create(&conn, a, b, "cites", "").is_err());
    let g = graph::get_graph(&conn, k, None, 0).unwrap();
    assert_eq!((g.nodes.len(), g.edges.len()), (1, 0));
    assert_eq!(tag::list(&conn, k).unwrap()[0].card_count, 0);
    assert_eq!(kb::get(&conn, k).unwrap().card_count, 1);
    // 标签改名不会把回收站卡片重新写入索引
    tag::update(&conn, t, "标签二", "#f00").unwrap();
    assert!(search::search(&conn, "独特正文", None, &[], 20).unwrap().is_empty());
    let listed = trash::list(&conn).unwrap();
    assert_eq!((listed.kbs.len(), listed.cards.len()), (0, 1));
    assert_eq!(listed.cards[0].id, a);
    assert!(!listed.cards[0].kb_trashed);

    card::restore(&conn, a).unwrap();
    assert!(card::get(&conn, a).is_ok());
    assert_eq!(search::search(&conn, "独特正文", None, &[], 20).unwrap().len(), 1);
    assert_eq!(link::list_by_card(&conn, b).unwrap().len(), 1);
    assert_eq!(kb::get(&conn, k).unwrap().card_count, 2);
    assert_eq!(tag::list(&conn, k).unwrap()[0].card_count, 1);
    assert!(trash::list(&conn).unwrap().cards.is_empty());
    // 不在回收站的卡片不能“恢复”或“永久删除”
    assert!(card::restore(&conn, a).is_err());
    assert!(trash::purge_card(&conn, a).is_err());
}

#[test]
fn trash_kb_hides_and_restore_rules() {
    let conn = setup();
    let k = kb::create(&conn, "回收库", "").unwrap().id;
    let c1 = mk_card(&conn, k, "c1", "独特内容一", &[]);
    mk_card(&conn, k, "c2", "独特内容二", &[]);
    card::trash(&conn, c1).unwrap();
    kb::trash(&conn, k).unwrap();

    assert!(kb::list(&conn).unwrap().is_empty());
    assert!(kb::get(&conn, k).is_err());
    assert!(kb::search(&conn, "回收库", 10).unwrap().is_empty());
    assert!(search::search(&conn, "独特内容", None, &[], 20).unwrap().is_empty());
    assert!(kb::trash(&conn, k).is_err());
    let listed = trash::list(&conn).unwrap();
    assert_eq!(listed.kbs.len(), 1);
    assert_eq!(listed.kbs[0].card_count, 1);
    assert!(listed.cards[0].kb_trashed);
    // 知识库还在回收站时不能单独恢复卡片
    assert!(card::restore(&conn, c1).is_err());

    kb::restore(&conn, k).unwrap();
    assert_eq!(kb::list(&conn).unwrap().len(), 1);
    assert_eq!(search::search(&conn, "独特内容", None, &[], 20).unwrap().len(), 1);
    card::restore(&conn, c1).unwrap();
    assert_eq!(search::search(&conn, "独特内容", None, &[], 20).unwrap().len(), 2);
}

#[test]
fn trash_purge_expiry_and_empty() {
    let conn = setup();
    let k1 = kb::create(&conn, "k1", "").unwrap().id;
    let k2 = kb::create(&conn, "k2", "").unwrap().id;
    let old_card = mk_card(&conn, k2, "old", "", &[]);
    let new_card = mk_card(&conn, k2, "new", "", &[]);
    mk_card(&conn, k1, "in-k1", "独特内容", &[]);
    kb::trash(&conn, k1).unwrap();
    card::trash(&conn, old_card).unwrap();
    card::trash(&conn, new_card).unwrap();
    // 把 k1 和 old_card 的删除时间改成很久以前
    conn.execute("UPDATE kb SET deleted_at = 1 WHERE id = ?1", [k1]).unwrap();
    conn.execute("UPDATE card SET deleted_at = 1 WHERE id = ?1", [old_card]).unwrap();

    assert_eq!(trash::purge_expired(&conn, 1000).unwrap(), 2);
    let left = trash::list(&conn).unwrap();
    assert_eq!((left.kbs.len(), left.cards.len()), (0, 1));
    assert_eq!(left.cards[0].id, new_card);
    // 永久删除后卡片、全文索引都已清理
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM card", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM card_fts", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);

    // 手动永久删除、清空
    let k3 = kb::create(&conn, "k3", "").unwrap().id;
    kb::trash(&conn, k3).unwrap();
    trash::purge_kb(&conn, k3).unwrap();
    assert!(trash::purge_kb(&conn, k2).is_err());
    assert_eq!(trash::purge_expired(&conn, i64::MAX).unwrap(), 1);
    assert!(trash::list(&conn).unwrap().cards.is_empty());
    assert_eq!(kb::list(&conn).unwrap().len(), 1);
}

#[test]
fn version_snapshot_throttle_and_prune() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let c = card::create(&conn, k, "t", r#"{"a":0}"#, "", &[]).unwrap().id;
    let count = |conn: &Connection| version::list(conn, c).unwrap().len();

    // 第一次更新:旧内容入版本
    card::update(&conn, c, "t", r#"{"a":1}"#, "", &[]).unwrap();
    assert_eq!(count(&conn), 1);
    let first = version::list(&conn, c).unwrap()[0].id;
    assert_eq!(version::get(&conn, first).unwrap().content_json, r#"{"a":0}"#);
    // 间隔不足 10 分钟:不再建版本
    card::update(&conn, c, "t", r#"{"a":2}"#, "", &[]).unwrap();
    assert_eq!(count(&conn), 1);
    // force:不受间隔限制,保存的是更新前的内容
    card::update_with(&conn, c, "t", r#"{"a":3}"#, "", &[], true).unwrap();
    assert_eq!(count(&conn), 2);
    assert_eq!(version::list(&conn, c).unwrap()[0].title, "t");
    let newest = version::list(&conn, c).unwrap()[0].id;
    assert_eq!(version::get(&conn, newest).unwrap().content_json, r#"{"a":2}"#);

    // 间隔超过 10 分钟后再保存:建版本
    conn.execute("UPDATE card_version SET saved_at = 0", []).unwrap();
    conn.execute("UPDATE card SET updated_at = 700000 WHERE id = ?1", [c]).unwrap();
    card::update(&conn, c, "t", r#"{"a":4}"#, "", &[]).unwrap();
    assert_eq!(count(&conn), 3);
    // 标题和正文都没变(只改标签等):不建版本
    card::update_with(&conn, c, "t", r#"{"a":4}"#, "", &[], true).unwrap();
    assert_eq!(count(&conn), 3);

    // 空内容的卡片不建版本
    let empty = mk_card(&conn, k, "e", "", &[]);
    card::update_with(&conn, empty, "e2", r#"{"a":1}"#, "", &[], true).unwrap();
    assert!(version::list(&conn, empty).unwrap().is_empty());

    // 每张卡片最多保留 50 个,保留最新的
    for i in 0..60 {
        card::update_with(&conn, c, "t", &format!(r#"{{"a":{}}}"#, 100 + i), "", &[], true).unwrap();
    }
    let all = version::list(&conn, c).unwrap();
    assert_eq!(all.len(), 50);
    assert!(all[0].id > all[1].id);
    assert!(version::get(&conn, first).is_err());

    // 删除卡片级联删除版本
    card::delete(&conn, c).unwrap();
    assert_eq!(count(&conn), 0);
}

#[test]
fn image_gc_keeps_images_referenced_by_versions() {
    let conn = setup();
    let dir = tmp_dir("gc-version");
    let k = kb::create(&conn, "k", "").unwrap().id;
    let pic = image::save(&dir, b"old-pic", "png").unwrap();
    let old = serde_json::json!({
        "type": "doc",
        "content": [{"type": "image", "attrs": {"src": format!("{}{}", image::REF_PREFIX, pic)}}]
    });
    let c = card::create(&conn, k, "t", &old.to_string(), "", &[]).unwrap().id;
    // 新内容不再引用这张图,但它还在历史版本里
    card::update(&conn, c, "t", r#"{"type":"doc"}"#, "", &[]).unwrap();
    assert_eq!(image::gc(&conn, &dir, std::time::Duration::ZERO).unwrap(), 0);
    assert!(dir.join(&pic).exists());
    // 卡片连同版本永久删除后,图片变成孤儿并被清理
    card::delete(&conn, c).unwrap();
    assert_eq!(image::gc(&conn, &dir, std::time::Duration::ZERO).unwrap(), 1);
    std::fs::remove_dir_all(&dir).ok();
}

fn img_doc(names: &[&str]) -> String {
    let nodes: Vec<serde_json::Value> = names
        .iter()
        .map(|n| serde_json::json!({"type": "image", "attrs": {"src": format!("{}{}", image::REF_PREFIX, n)}}))
        .collect();
    serde_json::json!({"type": "doc", "content": nodes}).to_string()
}

#[test]
fn image_list_reports_refs_and_orphans() {
    let conn = setup();
    let dir = tmp_dir("img-list");
    let k = kb::create(&conn, "图库", "").unwrap().id;
    let used = image::save(&dir, b"used", "png").unwrap();
    let in_trash = image::save(&dir, b"in-trash", "png").unwrap();
    let only_version = image::save(&dir, b"only-version", "png").unwrap();
    let orphan = image::save(&dir, b"orphan", "png").unwrap();

    card::create(&conn, k, "正常卡片", &img_doc(&[&used]), "", &[]).unwrap();
    let t = card::create(&conn, k, "回收站卡片", &img_doc(&[&in_trash]), "", &[]).unwrap().id;
    card::trash(&conn, t).unwrap();
    // 只在历史版本里出现:卡片正文已改成不含图片
    let v = card::create(&conn, k, "有历史", &img_doc(&[&only_version]), "", &[]).unwrap().id;
    card::update(&conn, v, "有历史", r#"{"type":"doc"}"#, "", &[]).unwrap();

    let list = image::list(&conn, &dir).unwrap();
    assert_eq!(list.len(), 4);
    let find = |n: &str| list.iter().find(|i| i.name == n).unwrap();
    assert_eq!(find(&used).cards.len(), 1);
    assert_eq!(find(&used).cards[0].kb_name, "图库");
    assert!(!find(&used).cards[0].trashed);
    assert!(find(&in_trash).cards[0].trashed);
    assert!(find(&only_version).cards.is_empty());
    assert_eq!(find(&only_version).version_count, 1);
    assert!(find(&orphan).cards.is_empty() && find(&orphan).version_count == 0);
    assert_eq!(find(&orphan).size, "orphan".len() as i64);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn image_cleanup_ignores_age_but_keeps_referenced() {
    let conn = setup();
    let dir = tmp_dir("img-cleanup");
    let k = kb::create(&conn, "k", "").unwrap().id;
    let used = image::save(&dir, b"used", "png").unwrap();
    let orphan = image::save(&dir, b"orphan-file", "png").unwrap();
    card::create(&conn, k, "t", &img_doc(&[&used]), "", &[]).unwrap();
    // 刚创建的孤儿图片也能立即清理,并报告释放的空间
    let r = image::cleanup(&conn, &dir).unwrap();
    assert_eq!((r.deleted, r.bytes), (1, "orphan-file".len() as u64));
    assert!(dir.join(&used).exists());
    assert!(!dir.join(&orphan).exists());
    assert_eq!(image::cleanup(&conn, &dir).unwrap().deleted, 0);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn image_delete_requires_remove_refs_and_strips_nodes() {
    let conn = setup();
    let dir = tmp_dir("img-delete");
    let k = kb::create(&conn, "k", "").unwrap().id;
    let pic = image::save(&dir, b"pic", "png").unwrap();
    let other = image::save(&dir, b"other", "png").unwrap();
    // 卡片 A:文字 + 这张图 + 另一张图;卡片 B:只有这张图
    let a_doc = serde_json::json!({
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "保留的文字"}]},
            {"type": "image", "attrs": {"src": format!("{}{}", image::REF_PREFIX, pic)}},
            {"type": "image", "attrs": {"src": format!("{}{}", image::REF_PREFIX, other)}}
        ]
    })
    .to_string();
    let a = card::create(&conn, k, "A", &a_doc, "", &[]).unwrap().id;
    let b = card::create(&conn, k, "B", &img_doc(&[&pic]), "", &[]).unwrap().id;
    // 给 A 制造一个包含这张图的历史版本
    card::update(&conn, a, "A", r#"{"type":"doc"}"#, "", &[]).unwrap();
    card::update_with(&conn, a, "A", &a_doc, "", &[], true).unwrap();

    // 仍被引用且不允许连带移除:拒绝,文件和正文都不变
    assert!(image::delete(&conn, &dir, &pic, false).is_err());
    assert!(dir.join(&pic).exists());

    image::delete(&conn, &dir, &pic, true).unwrap();
    assert!(!dir.join(&pic).exists());
    let content = |id: i64| -> String {
        conn.query_row("SELECT content_json FROM card WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    };
    // A 只剔除这张图,文字和另一张图保留
    let ca = content(a);
    assert!(!ca.contains(&pic) && ca.contains(&other) && ca.contains("保留的文字"));
    // B 原本只有这张图:被补上空段落保持结构合法
    let cb = content(b);
    assert!(!cb.contains(&pic) && cb.contains("paragraph"));
    // 历史版本里的引用也被移除
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM card_version WHERE content_json LIKE ?1", [format!("%{pic}%")], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0);
    // 未引用的图片不需要 remove_refs;非法名称被拒绝
    let lone = image::save(&dir, b"lone", "png").unwrap();
    image::delete(&conn, &dir, &lone, false).unwrap();
    assert!(!dir.join(&lone).exists());
    assert!(image::delete(&conn, &dir, "../x.png", true).is_err());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn draft_save_get_overwrite_and_cleanup() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let k2 = kb::create(&conn, "k2", "").unwrap().id;
    let c = mk_card(&conn, k, "c", "", &[]);

    assert!(draft::get(&conn, k, c).unwrap().is_none());
    draft::save(&conn, k, c, "草稿标题", r#"{"a":1}"#, &[3, 5]).unwrap();
    // 覆盖保存同一份草稿
    draft::save(&conn, k, c, "新标题", r#"{"a":2}"#, &[7]).unwrap();
    let d = draft::get(&conn, k, c).unwrap().unwrap();
    assert_eq!((d.title.as_str(), d.content_json.as_str()), ("新标题", r#"{"a":2}"#));
    assert_eq!(d.tag_ids, vec![7]);
    // 新建卡片的草稿(card_id = 0)与已有卡片、其他知识库互不影响
    draft::save(&conn, k, 0, "新建", "", &[]).unwrap();
    draft::save(&conn, k2, 0, "另一库的新建", "", &[]).unwrap();
    assert_eq!(draft::get(&conn, k, 0).unwrap().unwrap().title, "新建");
    assert_eq!(draft::get(&conn, k2, 0).unwrap().unwrap().title, "另一库的新建");
    // 知识库不存在时保存失败
    assert!(draft::save(&conn, 9999, 0, "x", "", &[]).is_err());

    draft::delete(&conn, k, 0).unwrap();
    assert!(draft::get(&conn, k, 0).unwrap().is_none());
    // 永久删除卡片、知识库时草稿一并清理
    card::delete(&conn, c).unwrap();
    assert!(draft::get(&conn, k, c).unwrap().is_none());
    kb::delete(&conn, k2).unwrap();
    assert!(draft::get(&conn, k2, 0).unwrap().is_none());
    // 过期清理
    draft::save(&conn, k, 0, "旧", "", &[]).unwrap();
    conn.execute("UPDATE card_draft SET updated_at = 1", []).unwrap();
    assert_eq!(draft::purge_older_than(&conn, 1000).unwrap(), 1);
    assert!(draft::get(&conn, k, 0).unwrap().is_none());
}

#[test]
fn image_protected_and_stripped_for_drafts() {
    let conn = setup();
    let dir = tmp_dir("img-draft");
    let k = kb::create(&conn, "k", "").unwrap().id;
    let pic = image::save(&dir, b"draft-pic", "png").unwrap();
    draft::save(&conn, k, 0, "新建", &img_doc(&[&pic]), &[]).unwrap();

    // 只被草稿引用的图片不会被清理,图片管理里能看到草稿引用
    assert_eq!(image::cleanup(&conn, &dir).unwrap().deleted, 0);
    let info = &image::list(&conn, &dir).unwrap()[0];
    assert_eq!((info.cards.len(), info.version_count, info.draft_count), (0, 0, 1));
    // 不允许直接删除;连带移除时草稿里的节点也被剔除
    assert!(image::delete(&conn, &dir, &pic, false).is_err());
    image::delete(&conn, &dir, &pic, true).unwrap();
    let content = draft::get(&conn, k, 0).unwrap().unwrap().content_json;
    assert!(!content.contains(&pic));
    assert!(!dir.join(&pic).exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn pin_and_sort_card_list() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let a = mk_card(&conn, k, "banana", "", &[]);
    let b = mk_card(&conn, k, "Apple", "", &[]);
    let c = mk_card(&conn, k, "cherry", "", &[]);
    // 固定时间戳,避免同一毫秒创建导致排序不确定
    for (id, created, updated) in [(a, 1, 30), (b, 2, 10), (c, 3, 20)] {
        conn.execute(
            "UPDATE card SET created_at = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, created, updated],
        )
        .unwrap();
    }
    let ids = |sort: &str| -> Vec<i64> {
        card::list_page_sorted(&conn, k, &[], "", 0, 50, sort).unwrap().items.iter().map(|i| i.id).collect()
    };
    assert_eq!(ids("updated"), vec![a, c, b]);
    assert_eq!(ids("created"), vec![c, b, a]);
    // 标题排序不区分大小写
    assert_eq!(ids("title"), vec![b, a, c]);
    assert!(card::list_page_sorted(&conn, k, &[], "", 0, 50, "id; DROP TABLE card").is_err());

    // 置顶不算内容修改:不动 updated_at、不生成版本、不刷新知识库时间
    conn.execute("UPDATE kb SET updated_at = 0", []).unwrap();
    card::set_pinned(&conn, c, true).unwrap();
    assert!(card::get(&conn, c).unwrap().pinned);
    assert_eq!(card::get(&conn, c).unwrap().updated_at, 20);
    assert_eq!(kb::get(&conn, k).unwrap().updated_at, 0);
    assert!(version::list(&conn, c).unwrap().is_empty());
    // 置顶卡片在任何排序下都排第一
    assert_eq!(ids("updated"), vec![c, a, b]);
    assert_eq!(ids("created"), vec![c, b, a]);
    assert_eq!(ids("title"), vec![c, b, a]);
    let page = card::list_page(&conn, k, &[], "", 0, 50).unwrap();
    assert!(page.items[0].pinned && !page.items[1].pinned);
    // 多张置顶:置顶组内部仍按所选排序
    card::set_pinned(&conn, a, true).unwrap();
    assert_eq!(ids("created"), vec![c, a, b]);
    assert_eq!(ids("updated"), vec![a, c, b]);

    // 移入回收站再恢复后仍然置顶;回收站中/不存在的卡片不能设置
    card::trash(&conn, c).unwrap();
    assert!(card::set_pinned(&conn, c, false).is_err());
    assert!(card::set_pinned(&conn, 9999, true).is_err());
    card::restore(&conn, c).unwrap();
    assert!(card::get(&conn, c).unwrap().pinned);

    // 取消置顶恢复原顺序
    card::set_pinned(&conn, a, false).unwrap();
    card::set_pinned(&conn, c, false).unwrap();
    assert_eq!(ids("updated"), vec![a, c, b]);
}

#[test]
fn batch_tags_and_trash() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let k2 = kb::create(&conn, "k2", "").unwrap().id;
    let t1 = tag::create(&conn, k, "甲类标签", "#f00").unwrap().id;
    let t2 = tag::create(&conn, k, "批量标签词", "#0f0").unwrap().id;
    let other_tag = tag::create(&conn, k2, "其他库标签", "#00f").unwrap().id;
    let a = mk_card(&conn, k, "A", "独特内容", &[t1]);
    let b = mk_card(&conn, k, "B", "", &[]);
    let c = mk_card(&conn, k, "C", "", &[]);
    let x = mk_card(&conn, k2, "X", "", &[]);
    conn.execute("UPDATE card SET updated_at = 5", []).unwrap();
    let tag_ids = |id: i64| -> Vec<i64> { tag::of_card(&conn, id).unwrap().iter().map(|t| t.id).collect() };
    let hits = || search::search(&conn, "批量标签词", None, &[], 20).unwrap().len();

    // 批量加标签:已有的不重复,全文索引同步
    card::batch_set_tags(&conn, k, &[a, b, a], &[t2], &[]).unwrap();
    card::batch_set_tags(&conn, k, &[a, b], &[t2], &[]).unwrap();
    assert_eq!(tag_ids(a).len(), 2);
    assert_eq!(tag_ids(b), vec![t2]);
    assert!(tag_ids(c).is_empty());
    assert_eq!(hits(), 2);
    // 不算内容修改:不动 updated_at、不生成版本
    assert_eq!(card::get(&conn, a).unwrap().updated_at, 5);
    assert!(version::list(&conn, a).unwrap().is_empty());
    // 批量移标签
    card::batch_set_tags(&conn, k, &[a, b], &[], &[t1, t2]).unwrap();
    assert!(tag_ids(a).is_empty() && tag_ids(b).is_empty());
    assert_eq!(hits(), 0);

    // 整批失败且数据不变:混入其他知识库的卡片、其他库的标签、添加与移除重叠、空选择
    assert!(card::batch_set_tags(&conn, k, &[a, x], &[t2], &[]).is_err());
    assert!(tag_ids(a).is_empty());
    assert!(card::batch_set_tags(&conn, k, &[a], &[other_tag], &[]).is_err());
    assert!(card::batch_set_tags(&conn, k, &[a], &[t2], &[t2]).is_err());
    assert!(card::batch_set_tags(&conn, k, &[], &[t2], &[]).is_err());
    assert!(card::batch_set_tags(&conn, k, &[a], &[], &[]).is_err());
    assert!(tag_ids(a).is_empty());

    // 批量移入回收站:混入其他库卡片时整批失败
    assert!(card::batch_trash(&conn, k, &[a, x]).is_err());
    assert!(card::get(&conn, a).is_ok());
    card::batch_set_tags(&conn, k, &[a, b], &[t2], &[]).unwrap();
    card::batch_trash(&conn, k, &[a, b]).unwrap();
    assert_eq!(card::list_page(&conn, k, &[], "", 0, 50).unwrap().total, 1);
    assert_eq!(hits(), 0);
    assert_eq!(trash::list(&conn).unwrap().cards.len(), 2);
    // 已在回收站的卡片不能再次批量删除/改标签
    card::restore(&conn, a).unwrap();
    assert!(card::batch_trash(&conn, k, &[a, b]).is_err());
    assert!(card::get(&conn, a).is_ok());
    assert!(card::batch_set_tags(&conn, k, &[b], &[t1], &[]).is_err());
    assert_eq!(hits(), 1);

    // 超过上限被拒绝
    let many: Vec<i64> = (1..=(card::BATCH_MAX as i64 + 1)).collect();
    assert!(card::batch_trash(&conn, k, &many).is_err());
}

/// 搜索压测:在大数据量下测量各类查询的耗时,默认忽略,手动运行:
///   cargo test --release bench_search_scale -- --ignored --nocapture
/// 环境变量: ZHISHI_BENCH_N(卡片数,默认 20000)  ZHISHI_BENCH_LEN(每张正文字数,默认 1000)
///           ZHISHI_BENCH_KEEP(设任意值则保留临时数据库文件)
#[test]
#[ignore]
fn bench_search_scale() {
    use rusqlite::params;
    use std::time::Instant;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        fn unit(&mut self) -> f64 {
            (self.next() >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    let env_num = |k: &str, d: usize| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
    let n = env_num("ZHISHI_BENCH_N", 20000);
    let len = env_num("ZHISHI_BENCH_LEN", 1000);
    let dir = tmp_dir("bench");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("bench.db");
    // 用磁盘文件库(与实际应用一致:WAL、默认页缓存),不用内存库
    let conn = db::open(&path).unwrap();

    // ---- 造数据:5 个知识库,每库 4 个标签,卡片轮流分配 ----
    let t0 = Instant::now();
    let kbs: Vec<i64> = (0..5).map(|i| kb::create(&conn, &format!("bench-kb-{i}"), "").unwrap().id).collect();
    let kb_tags: Vec<Vec<i64>> = kbs
        .iter()
        .enumerate()
        .map(|(i, &k)| (0..4).map(|j| tag::create(&conn, k, &format!("bench-tag-{i}-{j}"), "#999").unwrap().id).collect())
        .collect();
    {
        let tx = conn.unchecked_transaction().unwrap();
        {
            let mut ins = tx
                .prepare("INSERT INTO card(kb_id, title, content_json, content_text, created_at, updated_at) VALUES(?1, ?2, '', ?3, ?4, ?4)")
                .unwrap();
            let mut link = tx.prepare("INSERT INTO card_tag(card_id, tag_id) VALUES(?1, ?2)").unwrap();
            let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
            for i in 0..n {
                let ki = i % 5;
                // 正文:从 800 个汉字里按偏斜分布抽字(模拟常用字重复率高),偶尔插入标点
                let mut text = String::with_capacity(len * 3 + 64);
                for _ in 0..len {
                    let u = rng.unit();
                    text.push(char::from_u32(0x4E00 + (u * u * u * 800.0) as u32).unwrap());
                    if rng.next() % 25 == 0 {
                        text.push('。');
                    }
                }
                // 埋入已知频率的词(这些字不在随机字范围内,不会意外命中)
                let mut planted: Vec<&str> = Vec::new();
                if i % 3 == 0 {
                    planted.push("系统"); // 33%
                }
                if i % 10 == 1 {
                    planted.push("数据库"); // 10%
                }
                if i % 20 == 2 {
                    planted.push("架构设计"); // 5%
                }
                if i % 1000 == 7 {
                    planted.push("罕见词汇"); // 0.1%
                }
                if i % 2000 == 11 {
                    planted.push("稀缺"); // 0.05%
                }
                if !planted.is_empty() {
                    text.push('。');
                    text.push_str(&planted.join("。"));
                }
                ins.execute(params![kbs[ki], format!("卡片 {i}"), text, i as i64]).unwrap();
                let id = tx.last_insert_rowid();
                link.execute(params![id, kb_tags[ki][i % 4]]).unwrap();
                card::reindex(&tx, id).unwrap();
            }
        }
        tx.commit().unwrap();
    }
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).unwrap();
    let build = t0.elapsed();
    let mb = |p: &std::path::Path| std::fs::metadata(p).map(|m| m.len() as f64 / 1048576.0).unwrap_or(0.0);
    println!("\n==== 搜索压测: {n} 张卡片 x 约 {len} 字 ====");
    println!("造数据+建索引耗时 {:.1}s,数据库文件 {:.0} MB", build.as_secs_f64(), mb(&path));

    // ---- 计时:首次(偏冷)+ 随后 5 次的最小/中位/最大 ----
    let run = |name: &str, f: &dyn Fn() -> usize| {
        let t = Instant::now();
        let count = f();
        let first = t.elapsed().as_secs_f64() * 1000.0;
        let mut ts: Vec<f64> = (0..5)
            .map(|_| {
                let t = Instant::now();
                f();
                t.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        ts.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("{name:<30} {count:>3} 条 | 首次 {first:>8.1} ms | 最小 {:>8.1} | 中位 {:>8.1} | 最大 {:>8.1}", ts[0], ts[2], ts[4]);
    };
    let find = |q: &str, kb: Option<i64>, tags: &[i64]| search::search(&conn, q, kb, tags, 50).unwrap().len();

    println!("-- 全局搜索 --");
    run("1字词「系」", &|| find("系", None, &[]));
    run("2字常见词「系统」33%", &|| find("系统", None, &[]));
    run("2字稀有词「稀缺」0.05%", &|| find("稀缺", None, &[]));
    run("2字无命中「龘龘」", &|| find("龘龘", None, &[]));
    run("3字词「数据库」10%", &|| find("数据库", None, &[]));
    run("4字词「架构设计」5%", &|| find("架构设计", None, &[]));
    run("4字稀有「罕见词汇」0.1%", &|| find("罕见词汇", None, &[]));
    run("长词+短词「数据库 系统」", &|| find("数据库 系统", None, &[]));
    run("稀有长词+常见短词", &|| find("罕见词汇 系统", None, &[]));
    run("两个短词「系统 稀缺」", &|| find("系统 稀缺", None, &[]));
    run("2字词+限定知识库", &|| find("系统", Some(kbs[0]), &[]));
    run("2字词+限定知识库+标签", &|| find("系统", Some(kbs[0]), &[kb_tags[0][0]]));

    println!("-- 知识库页列表(对照) --");
    run("列表第一页(无关键词)", &|| card::list_page(&conn, kbs[0], &[], "", 0, 24).unwrap().items.len());
    run("列表按标题搜「99」", &|| card::list_page(&conn, kbs[0], &[], "99", 0, 24).unwrap().items.len());
    run("列表按标签筛选", &|| card::list_page(&conn, kbs[0], &[kb_tags[0][0]], "", 0, 24).unwrap().items.len());

    // ---- 列表页查询计划与对照写法:定位第一页的耗时来自哪里 ----
    println!("-- card 表的索引 --");
    {
        let mut st = conn
            .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'card'")
            .unwrap();
        let rows: Vec<(String, Option<String>)> =
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
        for (name, sql) in rows {
            println!("  {name}: {}", sql.unwrap_or_else(|| "(自动索引)".into()));
        }
    }
    let list_sql = |cols: &str, order: &str| {
        format!(
            "SELECT {cols} FROM card c WHERE c.kb_id = ?1 AND (?2 = '' OR c.title LIKE ?3 ESCAPE '\\') AND c.deleted_at IS NULL ORDER BY {order} LIMIT ?4 OFFSET ?5"
        )
    };
    let full_cols = "c.id, c.kb_id, c.title, substr(c.content_text, 1, 120), c.updated_at, c.pinned";
    let cases = [
        ("A 现状: pinned DESC, updated_at DESC, id DESC + 摘要列", list_sql(full_cols, "c.pinned DESC, c.updated_at DESC, c.id DESC")),
        ("B 去掉 pinned 排序 + 摘要列", list_sql(full_cols, "c.updated_at DESC, c.id DESC")),
        ("C 现状排序,只取 id(不读正文)", list_sql("c.id", "c.pinned DESC, c.updated_at DESC, c.id DESC")),
        ("D 去掉 pinned 排序,只取 id", list_sql("c.id", "c.updated_at DESC, c.id DESC")),
    ];
    for (label, sql) in &cases {
        println!("-- 查询计划 {label}");
        let mut st = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        let plan: Vec<String> = st
            .query_map(params![kbs[0], "", "%%", 24, 0], |r| r.get::<_, String>(3))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for p in plan {
            println!("     {p}");
        }
        run(&format!("   耗时 {}", label.chars().next().unwrap()), &|| {
            let mut st = conn.prepare(sql).unwrap();
            st.query_map(params![kbs[0], "", "%%", 24, 0], |_| Ok(())).unwrap().count()
        });
    }
    // 总数查询(列表页每次还要执行一次 COUNT)
    let count_sql = "SELECT COUNT(*) FROM card c WHERE c.kb_id = ?1 AND (?2 = '' OR c.title LIKE ?3 ESCAPE '\\') AND c.deleted_at IS NULL";
    println!("-- 查询计划 E 总数 COUNT(*)");
    {
        let mut st = conn.prepare(&format!("EXPLAIN QUERY PLAN {count_sql}")).unwrap();
        let plan: Vec<String> = st
            .query_map(params![kbs[0], "", "%%"], |r| r.get::<_, String>(3))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for p in plan {
            println!("     {p}");
        }
    }
    run("   耗时 E", &|| {
        conn.query_row(count_sql, params![kbs[0], "", "%%"], |r| r.get::<_, i64>(0)).unwrap() as usize
    });
    println!("==== 完成 ====\n");

    if std::env::var("ZHISHI_BENCH_KEEP").is_err() {
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    } else {
        println!("临时数据库已保留: {}", path.display());
    }
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
fn card_references_return_backlinks_without_partial_id_matches() {
    let conn = setup();
    let k = kb::create(&conn, "k", "").unwrap().id;
    let other_kb = kb::create(&conn, "other", "").unwrap().id;
    let target = mk_card(&conn, k, "目标卡片", "", &[]);
    let ref_tag = tag::create(&conn, k, "引用来源", "#1677ff").unwrap().id;
    let reference_doc = serde_json::json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{
                "type": "text",
                "text": "目标卡片",
                "marks": [{
                    "type": "link",
                    "attrs": { "href": format!("zhishi-card://{target}") }
                }]
            }]
        }]
    });
    let source = card::create(&conn, k, "引用来源卡片", &reference_doc.to_string(), "目标卡片", &[ref_tag]).unwrap().id;
    let partial_id_doc = serde_json::json!({
        "type": "doc",
        "content": [{
            "type": "text",
            "text": "不是目标引用",
            "marks": [{
                "type": "link",
                "attrs": { "href": format!("zhishi-card://{}0", target) }
            }]
        }]
    });
    card::create(&conn, k, "部分 ID", &partial_id_doc.to_string(), "", &[]).unwrap();
    mk_card(&conn, other_kb, "其他知识库", &reference_doc.to_string(), &[]);

    let backlinks = card::backlinks(&conn, k, target).unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].id, source);
    assert_eq!(backlinks[0].tags[0].id, ref_tag);
    assert!(card::backlinks(&conn, other_kb, target).is_err());
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
