-- 知识地图中卡片的位置(用户拖动后保存;没有记录的卡片由自动布局给出)
CREATE TABLE card_position (
  card_id INTEGER PRIMARY KEY REFERENCES card(id) ON DELETE CASCADE,
  x       REAL NOT NULL,
  y       REAL NOT NULL
);
