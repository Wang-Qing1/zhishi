-- 知识库
CREATE TABLE kb (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 知识卡片(content_json 为 Tiptap JSON,content_text 为纯文本,用于搜索/摘要)
CREATE TABLE card (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id        INTEGER NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_card_kb ON card(kb_id, updated_at DESC);

-- 标签(知识库内唯一)
CREATE TABLE tag (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id INTEGER NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
  name  TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1677ff',
  UNIQUE (kb_id, name)
);

CREATE TABLE card_tag (
  card_id INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tag(id)  ON DELETE CASCADE,
  PRIMARY KEY (card_id, tag_id)
);
CREATE INDEX idx_card_tag_tag ON card_tag(tag_id);

-- 卡片关联(有向,带关系类型)
CREATE TABLE card_link (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id         INTEGER NOT NULL REFERENCES kb(id)   ON DELETE CASCADE,
  src_id        INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  dst_id        INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'related',
  note          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  CHECK (src_id <> dst_id),
  UNIQUE (src_id, dst_id, relation_type)
);
CREATE INDEX idx_link_src ON card_link(src_id);
CREATE INDEX idx_link_dst ON card_link(dst_id);
CREATE INDEX idx_link_kb  ON card_link(kb_id);

-- 全文索引:rowid = card.id;trigram 分词支持中文子串匹配(查询词需 >=3 字符,更短由 LIKE 兜底)
-- 由应用层在卡片/标签变更时维护(tags 列为聚合结果,不适合触发器)
CREATE VIRTUAL TABLE card_fts USING fts5(
  title, content_text, tags,
  tokenize = 'trigram'
);
