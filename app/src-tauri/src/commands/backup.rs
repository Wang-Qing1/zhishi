//! 整库备份与恢复:zip 内含 manifest.json、zhishi.db(一致性快照)和 images/ 目录。

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::backup::Backup;
use rusqlite::Connection;
use tauri::{Manager, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::commands::image;
use crate::db::{self, now_ms, Db};
use crate::error::{AppError, Result};

const DB_ENTRY: &str = "zhishi.db";
const IMG_PREFIX: &str = "images/";
/// 恢复前自动备份最多保留的份数
const KEEP_PRE_RESTORE: usize = 5;
/// 备份包中单张图片的大小上限(防止异常压缩包)
const MAX_IMG_BYTES: u64 = 20 * 1024 * 1024;

fn io_err(e: io::Error) -> AppError {
    AppError::msg(format!("文件操作失败: {e}"))
}

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::msg(format!("备份文件处理失败: {e}"))
}

fn tmp_file(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("zhishi-{tag}-{}-{}.db", std::process::id(), now_ms()))
}

fn backups_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf> {
    let base = app.path().app_data_dir().map_err(|e| AppError::msg(e.to_string()))?;
    Ok(base.join("backups"))
}

/// 用 VACUUM INTO 生成数据库快照(一致性完整副本),返回临时文件路径,调用方负责删除
pub fn snapshot(conn: &Connection) -> Result<PathBuf> {
    let path = tmp_file("snapshot");
    let _ = fs::remove_file(&path);
    let lit = path.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{lit}'"))?;
    Ok(path)
}

/// 把数据库文件和图片目录打成 zip;失败时删除不完整的目标文件
pub fn pack(db_file: &Path, img_dir: &Path, target: &Path) -> Result<()> {
    let result = (|| -> Result<()> {
        let version: i64 = {
            let c = Connection::open(db_file)?;
            c.query_row("PRAGMA user_version", [], |r| r.get(0))?
        };
        let mut zw = ZipWriter::new(File::create(target).map_err(io_err)?);
        let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

        let manifest = serde_json::json!({
            "app": "zhishi",
            "format": 1,
            "schemaVersion": version,
            "createdAt": now_ms(),
        });
        zw.start_file("manifest.json", deflate).map_err(zip_err)?;
        zw.write_all(manifest.to_string().as_bytes()).map_err(io_err)?;

        zw.start_file(DB_ENTRY, deflate).map_err(zip_err)?;
        io::copy(&mut File::open(db_file).map_err(io_err)?, &mut zw).map_err(io_err)?;

        if let Ok(rd) = fs::read_dir(img_dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if !image::valid_name(&name) {
                    continue;
                }
                zw.start_file(format!("{IMG_PREFIX}{name}"), stored).map_err(zip_err)?;
                io::copy(&mut File::open(e.path()).map_err(io_err)?, &mut zw).map_err(io_err)?;
            }
        }
        zw.finish().map_err(zip_err)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(target);
    }
    result
}

/// 导出备份:快照数据库 + 打包
pub fn export(conn: &Connection, img_dir: &Path, target: &Path) -> Result<()> {
    let snap = snapshot(conn)?;
    let r = pack(&snap, img_dir, target);
    let _ = fs::remove_file(&snap);
    r
}

/// 只保留最近 KEEP_PRE_RESTORE 份“恢复前自动备份”
fn prune(dir: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut files: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("pre-restore-") && n.ends_with(".zip"))
        })
        .collect();
    files.sort();
    let extra = files.len().saturating_sub(KEEP_PRE_RESTORE);
    for p in files.into_iter().take(extra) {
        let _ = fs::remove_file(p);
    }
}

/// 从备份包恢复:校验 → 自动备份当前数据 → 用备份接口覆盖当前数据库 → 合并图片
pub fn restore(conn: &mut Connection, backups: &Path, img_dir: &Path, zip_path: &Path) -> Result<()> {
    let file = File::open(zip_path).map_err(io_err)?;
    let mut zip = ZipArchive::new(file).map_err(|_| AppError::msg("不是有效的备份文件"))?;
    let tmp = tmp_file("restore");
    {
        let mut entry = zip
            .by_name(DB_ENTRY)
            .map_err(|_| AppError::msg("备份文件中没有数据库(zhishi.db)"))?;
        let mut out = File::create(&tmp).map_err(io_err)?;
        io::copy(&mut entry, &mut out).map_err(io_err)?;
    }
    let result = restore_from(conn, backups, img_dir, &mut zip, &tmp);
    let _ = fs::remove_file(&tmp);
    result
}

fn restore_from(
    conn: &mut Connection,
    backups: &Path,
    img_dir: &Path,
    zip: &mut ZipArchive<File>,
    tmp_db: &Path,
) -> Result<()> {
    let src = Connection::open(tmp_db)?;
    let invalid = || AppError::msg("备份文件已损坏或不是知识库备份");
    let version: i64 = src.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|_| invalid())?;
    if version as usize > db::schema_version() {
        return Err(AppError::msg("备份来自更新版本的应用,请先升级应用"));
    }
    let check: String = src.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|_| invalid())?;
    let tables: i64 = src
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('kb', 'card')",
            [],
            |r| r.get(0),
        )
        .map_err(|_| invalid())?;
    if check != "ok" || tables != 2 {
        return Err(invalid());
    }

    // 恢复前先备份当前数据,出错可以从 backups 目录找回
    fs::create_dir_all(backups).map_err(io_err)?;
    export(conn, img_dir, &backups.join(format!("pre-restore-{}.zip", now_ms())))?;
    prune(backups);

    {
        let b = Backup::new(&src, conn)?;
        b.run_to_completion(256, Duration::ZERO, None)?;
    }
    // 旧版本备份需要补齐迁移
    db::init(conn)?;
    // 早期备份里的 base64 图片也转成文件引用
    image::migrate_base64(conn, img_dir)?;

    // 图片:只增不删;文件名必须合法以防止 zip 路径穿越
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(zip_err)?;
        let Some(name) = entry.name().strip_prefix(IMG_PREFIX).map(str::to_string) else { continue };
        if !image::valid_name(&name) || entry.size() > MAX_IMG_BYTES {
            continue;
        }
        let ext = name.rsplit('.').next().unwrap_or("").to_string();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(io_err)?;
        image::store(img_dir, &bytes, &ext)?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn backup_export(app: tauri::AppHandle, db: State<Db>, path: String) -> Result<()> {
    let img_dir = image::dir_of(&app)?;
    // 只在生成快照时占用数据库,打包过程不阻塞其他操作
    let snap = {
        let conn = db.conn()?;
        snapshot(&conn)?
    };
    let r = pack(&snap, &img_dir, Path::new(&path));
    let _ = fs::remove_file(&snap);
    r
}

#[tauri::command(async)]
pub fn backup_restore(app: tauri::AppHandle, db: State<Db>, path: String) -> Result<()> {
    let img_dir = image::dir_of(&app)?;
    let backups = backups_dir(&app)?;
    let mut conn = db.conn()?;
    restore(&mut conn, &backups, &img_dir, Path::new(&path))
}
