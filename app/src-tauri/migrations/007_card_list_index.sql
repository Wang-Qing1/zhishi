-- 知识库列表默认排序(置顶 + 更新时间)专用的部分索引:
-- 排序不再需要临时 B-tree,COUNT 也只扫索引、不回表
CREATE INDEX idx_card_list ON card(kb_id, pinned DESC, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;
