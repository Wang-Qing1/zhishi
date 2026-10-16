-- 置顶:pinned = 1 的卡片在知识库列表中始终排在最前
ALTER TABLE card ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
