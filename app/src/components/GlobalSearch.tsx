import { Input, List, Modal, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { SearchHit } from '../types';
import { EmptyHint } from './Hint';
import Highlight from './Highlight';

export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const seq = useRef(0);

  // 防抖 + 丢弃过期响应
  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setHits([]);
        return;
      }
      try {
        const r = await api.search(q);
        if (my === seq.current) setHits(r);
      } catch {
        if (my === seq.current) setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (h: SearchHit) => {
    onClose();
    nav(`/kb/${h.kbId}/card/${h.cardId}`);
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="全局搜索" width={720} destroyOnClose>
      <Input.Search
        autoFocus
        allowClear
        placeholder="搜索标题、正文、标签(多个词用空格分隔)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onSearch={(v) => v && go(hits[0])}
      />
      <div style={{ maxHeight: 420, overflow: 'auto', marginTop: 12 }}>
        {hits.length === 0 ? (
          <EmptyHint text={q.trim() ? '无结果' : '输入关键词开始搜索'} />
        ) : (
          <List
            dataSource={hits}
            renderItem={(h) => (
              <List.Item style={{ cursor: 'pointer' }} onClick={() => go(h)}>
                <List.Item.Meta
                  title={
                    <>
                      {h.title} <Typography.Text type="secondary">· {h.kbName}</Typography.Text>
                    </>
                  }
                  description={
                    <>
                      <div>
                        <Highlight text={h.snippet} />
                      </div>
                      {h.tags.map((t) => (
                        <Tag key={t.id} color={t.color}>
                          {t.name}
                        </Tag>
                      ))}
                    </>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </Modal>
  );
}
