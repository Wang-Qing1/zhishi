-- 卡片编辑草稿:编辑页自动保存,崩溃或误关窗口后可恢复;card_id 为 0 表示尚未创建的新卡片
CREATE TABLE card_draft (
  kb_id        INTEGER NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  card_id      INTEGER NOT NULL,
  title        TEXT NOT NULL,
  content_json TEXT NOT NULL,
  tag_ids      TEXT NOT NULL DEFAULT '[]',
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (kb_id, card_id)
);
