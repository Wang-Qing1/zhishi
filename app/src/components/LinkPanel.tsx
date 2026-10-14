import { App, Button, Input, List, Popconfirm, Select, Space, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { api, errMsg } from '../api';
import type { CardSummary, Link } from '../types';
import { RELATION_TYPES, relationLabel } from '../types';

/** 卡片关联:列出出入边,可新增(选目标卡片+关系类型)/删除 */
export default function LinkPanel({ kbId, cardId }: { kbId: number; cardId: number }) {
  const { message } = App.useApp();
  const [links, setLinks] = useState<Link[]>([]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [dst, setDst] = useState<number>();
  const [type, setType] = useState('related');
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    setLinks(await api.linkListByCard(cardId));
  }, [cardId]);

  useEffect(() => {
    reload().catch((e) => message.error(errMsg(e)));
    api.cardList(kbId, [], 0, 1000).then((cs) => setCards(cs.filter((c) => c.id !== cardId)));
  }, [kbId, cardId, reload, message]);

  const add = async () => {
    if (!dst) return;
    try {
      await api.linkCreate(cardId, dst, type, note);
      setDst(undefined);
      setNote('');
      reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div>
      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Select style={{ width: 90 }} value={type} onChange={setType} options={RELATION_TYPES} />
        <Select
          showSearch
          style={{ flex: 1 }}
          placeholder="选择要关联的卡片"
          value={dst}
          onChange={setDst}
          optionFilterProp="label"
          options={cards.map((c) => ({ value: c.id, label: c.title }))}
        />
        <Button type="primary" disabled={!dst} onClick={add}>
          添加
        </Button>
      </Space.Compact>
      <Input placeholder="备注(可选)" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginBottom: 8 }} />
      <List
        size="small"
        locale={{ emptyText: '暂无关联' }}
        dataSource={links}
        renderItem={(l) => {
          const out = l.srcId === cardId;
          const otherId = out ? l.dstId : l.srcId;
          const otherTitle = out ? l.dstTitle : l.srcTitle;
          return (
            <List.Item
              actions={[
                <Popconfirm key="d" title="删除该关联?" onConfirm={() => api.linkDelete(l.id).then(reload)}>
                  <a>删除</a>
                </Popconfirm>,
              ]}
            >
              <Tag>{out ? '→' : '←'} {relationLabel(l.relationType)}</Tag>
              <RouterLink to={`/kb/${kbId}/card/${otherId}`}>{otherTitle}</RouterLink>
              {l.note && <span style={{ color: '#999', marginLeft: 8 }}>{l.note}</span>}
            </List.Item>
          );
        }}
      />
    </div>
  );
}
