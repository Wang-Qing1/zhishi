-- 卡片版本历史:保存卡片时把旧内容存为一个版本;saved_at 是该内容当时被保存的时间
CREATE TABLE card_version (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id      INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content_json TEXT NOT NULL,
  saved_at     INTEGER NOT NULL
);
CREATE INDEX idx_version_card ON card_version(card_id, id DESC);
