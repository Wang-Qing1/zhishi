mod commands;
mod db;
mod error;
mod models;
#[cfg(test)]
mod tests;

use std::sync::Mutex;

use tauri::Manager;

use commands::{card, graph, image, kb, link, search, tag};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 卡片图片:zhishi-img://<sha256>.<ext> → 读取 images 目录下的文件
        .register_uri_scheme_protocol("zhishi-img", |ctx, request| {
            let name = request.uri().path().trim_start_matches('/');
            let found = image::dir_of(ctx.app_handle())
                .ok()
                .and_then(|dir| image::read_for_protocol(&dir, name));
            match found {
                Some((bytes, mime)) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Cache-Control", "public, max-age=31536000, immutable")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(bytes)
                    .unwrap(),
                None => tauri::http::Response::builder().status(404).body(Vec::new()).unwrap(),
            }
        })
        .setup(|app| {
            // 数据库位于 %APPDATA%\com.zhishi.app\zhishi.db
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("zhishi.db"))?;
            // 图片目录:旧 base64 图片一次性迁移为文件;清理超过 1 天的孤儿图片(失败不影响启动)
            let img_dir = image::dir_of(app.handle())?;
            std::fs::create_dir_all(&img_dir)?;
            if let Err(e) = image::migrate_base64(&conn, &img_dir) {
                eprintln!("图片迁移失败: {e}");
            }
            if let Err(e) = image::gc(&conn, &img_dir, std::time::Duration::from_secs(86400)) {
                eprintln!("图片清理失败: {e}");
            }
            app.manage(db::Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kb::kb_list,
            kb::kb_get,
            kb::kb_search,
            kb::kb_create,
            kb::kb_update,
            kb::kb_delete,
            card::card_get,
            card::card_create,
            card::card_update,
            card::card_delete,
            card::card_list_page,
            card::card_search_titles,
            tag::tag_list,
            tag::tag_create,
            tag::tag_update,
            tag::tag_delete,
            link::link_create,
            link::link_delete,
            link::link_list_by_card,
            graph::graph_get,
            graph::graph_save_positions,
            graph::graph_reset_positions,
            search::search_global,
            image::image_save,
        ])
        .run(tauri::generate_context!())
        .expect("启动知识库应用失败");
}
