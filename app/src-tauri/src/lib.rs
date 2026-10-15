mod commands;
mod db;
mod error;
mod models;
#[cfg(test)]
mod tests;

use std::sync::Mutex;

use tauri::Manager;

use commands::{card, graph, kb, link, search, tag};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 数据库位于 %APPDATA%\com.zhishi.app\zhishi.db
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("zhishi.db"))?;
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
        ])
        .run(tauri::generate_context!())
        .expect("启动知识库应用失败");
}
