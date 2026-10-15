-- 回收站(软删除):deleted_at 为空表示正常,否则为移入回收站的时间(毫秒时间戳)
ALTER TABLE kb   ADD COLUMN deleted_at INTEGER;
ALTER TABLE card ADD COLUMN deleted_at INTEGER;
CREATE INDEX idx_kb_deleted   ON kb(deleted_at)   WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_card_deleted ON card(deleted_at) WHERE deleted_at IS NOT NULL;
