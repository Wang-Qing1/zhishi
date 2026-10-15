//! 卡片图片:按内容哈希落盘到 `<app_data>/images/<sha256>.<ext>`,正文里只存 `zhishi-img://<sha256>.<ext>` 引用。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{Manager, State};

use crate::db::Db;
use crate::error::{AppError, Result};

/// 正文里图片 src 的引用前缀
pub const REF_PREFIX: &str = "zhishi-img://";
/// 单张图片大小上限
const MAX_BYTES: usize = 3 * 1024 * 1024;
const EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

fn io(e: std::io::Error) -> AppError {
    AppError::msg(format!("文件操作失败: {e}"))
}

/// 图片目录:%APPDATA%\com.zhishi.app\images
pub fn dir_of<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf> {
    let base = app.path().app_data_dir().map_err(|e| AppError::msg(e.to_string()))?;
    Ok(base.join("images"))
}

/// 文件名必须是 `<64位小写十六进制>.<白名单扩展名>`,同时防止路径穿越
pub fn valid_name(name: &str) -> bool {
    match name.split_once('.') {
        Some((hash, ext)) => {
            hash.len() == 64
                && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                && EXTS.contains(&ext)
        }
        None => false,
    }
}

fn mime_of(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// 写入文件并返回文件名;同内容已存在则不重复写
pub fn store(dir: &Path, bytes: &[u8], ext: &str) -> Result<String> {
    let hash: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    let name = format!("{hash}.{ext}");
    let path = dir.join(&name);
    if !path.exists() {
        fs::create_dir_all(dir).map_err(io)?;
        let tmp = dir.join(format!("{name}.tmp"));
        fs::write(&tmp, bytes).map_err(io)?;
        fs::rename(&tmp, &path).map_err(io)?;
    }
    Ok(name)
}

/// 保存一张图片,返回文件名
pub fn save(dir: &Path, bytes: &[u8], ext: &str) -> Result<String> {
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if !EXTS.contains(&ext.as_str()) {
        return Err(AppError::msg("不支持的图片格式"));
    }
    if bytes.is_empty() {
        return Err(AppError::msg("图片内容为空"));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::msg("图片不能超过 3MB"));
    }
    store(dir, bytes, &ext)
}

/// 自定义协议读取:文件名不合法或文件不存在返回 None
pub fn read_for_protocol(dir: &Path, name: &str) -> Option<(Vec<u8>, &'static str)> {
    if !valid_name(name) {
        return None;
    }
    let bytes = fs::read(dir.join(name)).ok()?;
    Some((bytes, mime_of(name)))
}

/// 前端上传:参数为 base64 内容与扩展名,返回可写入正文的引用
#[tauri::command(async)]
pub fn image_save(app: tauri::AppHandle, data_base64: String, ext: String) -> Result<String> {
    let bytes = STANDARD
        .decode(data_base64.trim())
        .map_err(|_| AppError::msg("图片数据无效"))?;
    let name = save(&dir_of(&app)?, &bytes, &ext)?;
    Ok(format!("{REF_PREFIX}{name}"))
}

/// `data:image/png;base64,xxxx` → (扩展名, 字节);格式不支持返回 None
fn parse_data_url(s: &str) -> Option<(&'static str, Vec<u8>)> {
    let rest = s.strip_prefix("data:image/")?;
    let (kind, b64) = rest.split_once(";base64,")?;
    let ext = match kind.to_ascii_lowercase().as_str() {
        "png" => "png",
        "jpeg" | "jpg" => "jpg",
        "gif" => "gif",
        "webp" => "webp",
        "bmp" => "bmp",
        "svg+xml" => "svg",
        _ => return None,
    };
    let bytes = STANDARD.decode(b64.trim()).ok()?;
    Some((ext, bytes))
}

/// 递归改写 Tiptap JSON 中的 base64 图片节点,返回是否有改动
fn rewrite(v: &mut Value, dir: &Path) -> Result<bool> {
    let mut changed = false;
    match v {
        Value::Object(m) => {
            if m.get("type").and_then(|t| t.as_str()) == Some("image") {
                if let Some(Value::Object(attrs)) = m.get_mut("attrs") {
                    let src = attrs.get("src").and_then(|s| s.as_str()).map(str::to_string);
                    if let Some((ext, bytes)) = src.as_deref().and_then(parse_data_url) {
                        let name = store(dir, &bytes, ext)?;
                        attrs.insert("src".into(), Value::String(format!("{REF_PREFIX}{name}")));
                        changed = true;
                    }
                }
            }
            for (_, child) in m.iter_mut() {
                changed |= rewrite(child, dir)?;
            }
        }
        Value::Array(a) => {
            for child in a.iter_mut() {
                changed |= rewrite(child, dir)?;
            }
        }
        _ => {}
    }
    Ok(changed)
}

/// 启动时一次性迁移:把旧卡片里的 base64 图片转成文件引用,返回被改写的卡片数
pub fn migrate_base64(conn: &Connection, dir: &Path) -> Result<usize> {
    let rows: Vec<(i64, String)> = {
        let mut stmt = conn.prepare("SELECT id, content_json FROM card WHERE content_json LIKE '%data:image/%'")?;
        let it = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default())))?;
        it.collect::<std::result::Result<_, _>>()?
    };
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    for (id, json) in rows {
        let Ok(mut doc) = serde_json::from_str::<Value>(&json) else { continue };
        if rewrite(&mut doc, dir)? {
            tx.execute(
                "UPDATE card SET content_json = ?1 WHERE id = ?2",
                rusqlite::params![doc.to_string(), id],
            )?;
            n += 1;
        }
    }
    tx.commit()?;
    Ok(n)
}

/// 所有卡片正文中引用到的图片文件名
fn collect_refs(conn: &Connection) -> Result<HashSet<String>> {
    let mut set = HashSet::new();
    // 卡片正文和历史版本里的图片都算引用
    collect_from(conn, "SELECT content_json FROM card WHERE content_json LIKE '%zhishi-img://%'", &mut set)?;
    collect_from(conn, "SELECT content_json FROM card_version WHERE content_json LIKE '%zhishi-img://%'", &mut set)?;
    collect_from(conn, "SELECT content_json FROM card_draft WHERE content_json LIKE '%zhishi-img://%'", &mut set)?;
    Ok(set)
}

fn collect_from(conn: &Connection, sql: &str, set: &mut HashSet<String>) -> Result<()> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| r.get::<_, Option<String>>(0))?;
    for row in rows {
        let Some(s) = row? else { continue };
        set.extend(ref_names(&s));
    }
    Ok(())
}

/// 从一段正文 JSON 文本里提取引用的图片文件名(去重,只保留合法文件名)
fn ref_names(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = s;
    while let Some(i) = rest.find(REF_PREFIX) {
        rest = &rest[i + REF_PREFIX.len()..];
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '.'))
            .unwrap_or(rest.len());
        let name = &rest[..end];
        if valid_name(name) && !out.iter().any(|n| n == name) {
            out.push(name.to_string());
        }
    }
    out
}

/// 清理孤儿图片:未被任何卡片/历史版本引用、且修改时间早于 min_age 的文件;返回 (删除数, 释放的字节数)
fn sweep(conn: &Connection, dir: &Path, min_age: Duration) -> Result<(usize, u64)> {
    let Ok(rd) = fs::read_dir(dir) else { return Ok((0, 0)) };
    let refs = collect_refs(conn)?;
    let (mut n, mut bytes) = (0usize, 0u64);
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !valid_name(&name) || refs.contains(&name) {
            continue;
        }
        let meta = e.metadata().ok();
        let old = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .map(|d| d >= min_age)
            .unwrap_or(min_age.is_zero());
        let size = meta.map(|m| m.len()).unwrap_or(0);
        if old && fs::remove_file(e.path()).is_ok() {
            n += 1;
            bytes += size;
        }
    }
    Ok((n, bytes))
}

/// 启动时的自动清理(有保护期):返回删除数
pub fn gc(conn: &Connection, dir: &Path, min_age: Duration) -> Result<usize> {
    Ok(sweep(conn, dir, min_age)?.0)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub deleted: usize,
    pub bytes: u64,
}

/// 立即清理所有未被引用的图片(不受保护期限制)
pub fn cleanup(conn: &Connection, dir: &Path) -> Result<CleanupResult> {
    let (deleted, bytes) = sweep(conn, dir, Duration::ZERO)?;
    Ok(CleanupResult { deleted, bytes })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageRefCard {
    pub card_id: i64,
    pub kb_id: i64,
    pub kb_name: String,
    pub title: String,
    /// 卡片或其所属知识库在回收站中
    pub trashed: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub name: String,
    pub size: i64,
    pub modified_at: i64,
    /// 引用它的卡片(含回收站中的)
    pub cards: Vec<ImageRefCard>,
    /// 引用它的历史版本个数
    pub version_count: i64,
    /// 引用它的编辑草稿个数
    pub draft_count: i64,
}

/// 列出图片目录下的所有图片及其引用情况,最新的在前
pub fn list(conn: &Connection, dir: &Path) -> Result<Vec<ImageInfo>> {
    let mut map: HashMap<String, ImageInfo> = HashMap::new();
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !valid_name(&name) {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            let modified_at = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            map.insert(
                name.clone(),
                ImageInfo { name, size: meta.len() as i64, modified_at, cards: vec![], version_count: 0, draft_count: 0 },
            );
        }
    }
    {
        let mut st = conn.prepare(
            "SELECT c.id, c.kb_id, k.name, c.title, c.content_json, (c.deleted_at IS NOT NULL OR k.deleted_at IS NOT NULL)
             FROM card c JOIN kb k ON k.id = c.kb_id WHERE c.content_json LIKE '%zhishi-img://%'",
        )?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)? != 0,
            ))
        })?;
        for row in rows {
            let (card_id, kb_id, kb_name, title, json, trashed) = row?;
            for name in ref_names(&json) {
                if let Some(info) = map.get_mut(&name) {
                    info.cards.push(ImageRefCard { card_id, kb_id, kb_name: kb_name.clone(), title: title.clone(), trashed });
                }
            }
        }
    }
    {
        let mut st = conn.prepare("SELECT content_json FROM card_version WHERE content_json LIKE '%zhishi-img://%'")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        for row in rows {
            for name in ref_names(&row?) {
                if let Some(info) = map.get_mut(&name) {
                    info.version_count += 1;
                }
            }
        }
    }
    {
        let mut st = conn.prepare("SELECT content_json FROM card_draft WHERE content_json LIKE '%zhishi-img://%'")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        for row in rows {
            for name in ref_names(&row?) {
                if let Some(info) = map.get_mut(&name) {
                    info.draft_count += 1;
                }
            }
        }
    }
    let mut v: Vec<ImageInfo> = map.into_values().collect();
    v.sort_by(|a, b| b.modified_at.cmp(&a.modified_at).then_with(|| a.name.cmp(&b.name)));
    Ok(v)
}

fn is_image_with(n: &Value, src: &str) -> bool {
    n.get("type").and_then(Value::as_str) == Some("image")
        && n.pointer("/attrs/src").and_then(Value::as_str) == Some(src)
}

/// 递归移除 Tiptap JSON 中 src 为指定引用的图片节点,返回是否有改动;
/// 容器被删空时(如只含这张图的文档/单元格)补一个空段落,保证结构仍然合法
fn strip(v: &mut Value, src: &str) -> bool {
    match v {
        Value::Object(m) => {
            let mut changed = false;
            for (_, child) in m.iter_mut() {
                changed |= strip(child, src);
            }
            changed
        }
        Value::Array(a) => {
            let before = a.len();
            a.retain(|n| !is_image_with(n, src));
            let mut changed = a.len() != before;
            if a.is_empty() && before > 0 {
                a.push(serde_json::json!({ "type": "paragraph" }));
            }
            for child in a.iter_mut() {
                changed |= strip(child, src);
            }
            changed
        }
        _ => false,
    }
}

fn rows_with(conn: &Connection, table: &str, like: &str) -> Result<Vec<(i64, String)>> {
    let mut st = conn.prepare(&format!("SELECT rowid, content_json FROM {table} WHERE content_json LIKE ?1"))?;
    let v = st
        .query_map([like], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// 删除一张图片。图片仍被卡片/历史版本引用时,remove_refs 为真才允许删除,
/// 并在同一个事务里把它们正文中的这张图的节点移除(文字不受影响)
pub fn delete(conn: &Connection, dir: &Path, name: &str, remove_refs: bool) -> Result<()> {
    if !valid_name(name) {
        return Err(AppError::msg("图片名称无效"));
    }
    let src = format!("{REF_PREFIX}{name}");
    let like = format!("%{src}%");
    let tx = conn.unchecked_transaction()?;
    let cards = rows_with(&tx, "card", &like)?;
    let versions = rows_with(&tx, "card_version", &like)?;
    let drafts = rows_with(&tx, "card_draft", &like)?;
    if !remove_refs && (!cards.is_empty() || !versions.is_empty() || !drafts.is_empty()) {
        return Err(AppError::msg("图片正在被卡片、历史版本或草稿使用"));
    }
    for (table, rows) in [("card", cards), ("card_version", versions), ("card_draft", drafts)] {
        for (id, json) in rows {
            let Ok(mut doc) = serde_json::from_str::<Value>(&json) else { continue };
            if strip(&mut doc, &src) {
                tx.execute(
                    &format!("UPDATE {table} SET content_json = ?1 WHERE rowid = ?2"),
                    params![doc.to_string(), id],
                )?;
            }
        }
    }
    tx.commit()?;
    match fs::remove_file(dir.join(name)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io(e)),
    }
}

#[tauri::command(async)]
pub fn image_list(app: tauri::AppHandle, db: State<Db>) -> Result<Vec<ImageInfo>> {
    let dir = dir_of(&app)?;
    let conn = db.conn()?;
    list(&conn, &dir)
}

#[tauri::command(async)]
pub fn image_cleanup(app: tauri::AppHandle, db: State<Db>) -> Result<CleanupResult> {
    let dir = dir_of(&app)?;
    let conn = db.conn()?;
    cleanup(&conn, &dir)
}

#[tauri::command(async)]
pub fn image_delete(app: tauri::AppHandle, db: State<Db>, name: String, remove_refs: bool) -> Result<()> {
    let dir = dir_of(&app)?;
    let conn = db.conn()?;
    delete(&conn, &dir, &name, remove_refs)
}
