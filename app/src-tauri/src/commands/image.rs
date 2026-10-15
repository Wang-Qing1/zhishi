//! 卡片图片:按内容哈希落盘到 `<app_data>/images/<sha256>.<ext>`,正文里只存 `zhishi-img://<sha256>.<ext>` 引用。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::Manager;

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
    let mut stmt = conn.prepare("SELECT content_json FROM card WHERE content_json LIKE '%zhishi-img://%'")?;
    let rows = stmt.query_map([], |r| r.get::<_, Option<String>>(0))?;
    for row in rows {
        let Some(s) = row? else { continue };
        let mut rest = s.as_str();
        while let Some(i) = rest.find(REF_PREFIX) {
            rest = &rest[i + REF_PREFIX.len()..];
            let end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '.'))
                .unwrap_or(rest.len());
            let name = &rest[..end];
            if valid_name(name) {
                set.insert(name.to_string());
            }
        }
    }
    Ok(set)
}

/// 清理孤儿图片:未被任何卡片引用、且修改时间早于 min_age 的文件;返回删除数
pub fn gc(conn: &Connection, dir: &Path, min_age: Duration) -> Result<usize> {
    let Ok(rd) = fs::read_dir(dir) else { return Ok(0) };
    let refs = collect_refs(conn)?;
    let mut n = 0;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !valid_name(&name) || refs.contains(&name) {
            continue;
        }
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|d| d >= min_age)
            .unwrap_or(min_age.is_zero());
        if old && fs::remove_file(e.path()).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}
