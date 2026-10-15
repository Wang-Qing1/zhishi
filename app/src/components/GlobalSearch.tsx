import { App, Input, Modal, Select, Tag, theme, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import type { Kb, SearchHit, Tag as TagInfo } from '../types';
import { EmptyHint } from './Hint';
import Highlight from './Highlight';
import { guardNav } from '../unsaved';

type Item = { type: 'kb'; kb: Kb } | { type: 'card'; hit: SearchHit };

export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  // 筛选:选了知识库才能按标签筛(标签属于知识库)
  const [allKbs, setAllKbs] = useState<Kb[]>([]);
  const [kbFilter, setKbFilter] = useState<number | null>(null);
  const [kbTags, setKbTags] = useState<TagInfo[]>([]);
  const [tagFilter, setTagFilter] = useState<number[]>([]);
  const filtered = kbFilter !== null;

  // 打开时加载知识库列表;关闭时重置筛选
  useEffect(() => {
    if (!open) {
      setKbFilter(null);
      setTagFilter([]);
      return;
    }
    api.kbList().then(setAllKbs).catch(() => {});
  }, [open]);
  useEffect(() => {
    setTagFilter([]);
    if (kbFilter === null) {
      setKbTags([]);
      return;
    }
    api.tagList(kbFilter).then(setKbTags).catch(() => setKbTags([]));
  }, [kbFilter]);

  // 防抖 + 丢弃过期响应;知识库与卡片并行查询
  useEffect(() => {
    const my = ++seq.current;
    if (!open) return;
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setKbs([]);
        setHits([]);
        return;
      }
      try {
        // 有筛选时只找卡片,不再列出知识库
        const [k, c] = await Promise.all([
          filtered ? Promise.resolve([] as Kb[]) : api.kbSearch(q),
          api.search(q, kbFilter, tagFilter),
        ]);
        if (my === seq.current) {
          setKbs(k);
          setHits(c);
          setActive(0);
        }
      } catch (e) {
        if (my === seq.current) {
          setKbs([]);
          setHits([]);
          message.error(errMsg(e));
        }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, message, filtered, kbFilter, tagFilter]);

  // 知识库在前、卡片在后,与界面分组顺序一致,键盘选择按这个统一索引
  const items = useMemo<Item[]>(
    () => [
      ...kbs.map((kb): Item => ({ type: 'kb', kb })),
      ...hits.map((hit): Item => ({ type: 'card', hit })),
    ],
    [kbs, hits],
  );

  const go = (it: Item) => {
    onClose();
    if (it.type === 'kb') guardNav(() => nav(`/kb/${it.kb.id}`));
    else guardNav(() => nav(`/kb/${it.hit.kbId}/card/${it.hit.cardId}`));
  };

  const move = (next: number) => {
    setActive(next);
    requestAnimationFrame(() => document.getElementById(`search-item-${next}`)?.scrollIntoView({ block: 'nearest' }));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(Math.min(active + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(Math.max(active - 1, 0));
    }
  };

  const row = (it: Item, i: number) => (
    <div
      key={`${it.type}-${it.type === 'kb' ? it.kb.id : it.hit.cardId}`}
      id={`search-item-${i}`}
      onClick={() => go(it)}
      onMouseEnter={() => setActive(i)}
      style={{
        cursor: 'pointer',
        padding: '8px 12px',
        borderRadius: 12,
        background: i === active ? token.colorPrimaryBg : undefined,
      }}
    >
      {it.type === 'kb' ? (
        <>
          <div>
            <Typography.Text strong>{it.kb.name}</Typography.Text>
            <Tag color="blue" style={{ marginLeft: 8, borderRadius: 10 }}>
              卡片：{it.kb.cardCount}
            </Tag>
          </div>
          <Typography.Text type="secondary" ellipsis style={{ display: 'block' }}>
            {it.kb.description || '暂无描述'}
          </Typography.Text>
        </>
      ) : (
        <>
          <div>
            {it.hit.title} <Typography.Text type="secondary">· {it.hit.kbName}</Typography.Text>
          </div>
          <div style={{ color: token.colorTextSecondary }}>
            <Highlight text={it.hit.snippet} />
          </div>
          {it.hit.tags.map((t) => (
            <Tag key={t.id} color={t.color}>
              {t.name}
            </Tag>
          ))}
        </>
      )}
    </div>
  );

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="全局搜索" width={720} destroyOnClose>
      <Input
        autoFocus
        allowClear
        placeholder="搜索知识库、卡片标题、正文、标签(多个词用空格分隔)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        onPressEnter={() => items[active] && go(items[active])}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 200, flex: 'none' }}
          placeholder="全部知识库"
          value={kbFilter}
          onChange={(v) => setKbFilter(v ?? null)}
          options={allKbs.map((k) => ({ value: k.id, label: k.name }))}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          style={{ flex: 1, minWidth: 0 }}
          placeholder={filtered ? (kbTags.length ? '按标签筛选(含任一所选标签)' : '该知识库没有标签') : '先选择知识库再按标签筛选'}
          disabled={!filtered || kbTags.length === 0}
          value={tagFilter}
          onChange={setTagFilter}
          optionFilterProp="label"
          options={kbTags.map((t) => ({ value: t.id, label: t.name }))}
        />
      </div>
      <div style={{ maxHeight: 420, overflow: 'auto', marginTop: 12 }}>
        {items.length === 0 ? (
          <EmptyHint text={q.trim() ? '无结果' : '输入关键词开始搜索'} />
        ) : (
          <>
            {kbs.length > 0 && (
              <Typography.Text type="secondary" style={{ display: 'block', padding: '4px 12px' }}>
                知识库
              </Typography.Text>
            )}
            {kbs.map((kb, i) => row({ type: 'kb', kb }, i))}
            {hits.length > 0 && (
              <Typography.Text type="secondary" style={{ display: 'block', padding: '4px 12px', marginTop: kbs.length ? 8 : 0 }}>
                卡片
              </Typography.Text>
            )}
            {hits.map((hit, i) => row({ type: 'card', hit }, kbs.length + i))}
          </>
        )}
      </div>
    </Modal>
  );
}
