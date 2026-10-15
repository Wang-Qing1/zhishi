import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Input, List, Select, Tag } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import Confirm from './Confirm';
import IconBtn from './IconBtn';
import type { CardSummary, Link } from '../types';
import { RELATION_TYPES, relationLabel } from '../types';
import { guardNav } from '../unsaved';

/** 卡片关联:列出出入边,可新增(选目标卡片+关系类型)/删除 */
export default function LinkPanel({ kbId, cardId }: { kbId: number; cardId: number }) {
  const { message } = App.useApp();
  const nav = useNavigate();
  const [links, setLinks] = useState<Link[]>([]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [cardQuery, setCardQuery] = useState('');
  const [dst, setDst] = useState<number>();
  const [type, setType] = useState('related');
  const [note, setNote] = useState('');
  const searchSeq = useRef(0);

  const reload = useCallback(async () => {
    setLinks(await api.linkListByCard(cardId));
  }, [cardId]);

  useEffect(() => {
    setDst(undefined);
    setNote('');
    setCardQuery('');
    reload().catch((e) => message.error(errMsg(e)));
  }, [kbId, cardId, reload, message]);

  useEffect(() => {
    const seq = ++searchSeq.current;
    setCards([]);
    const timer = window.setTimeout(() => {
      api.cardSearchTitles(kbId, cardQuery).then((cs) => {
        if (seq === searchSeq.current) setCards(cs.filter((c) => c.id !== cardId));
      }).catch((e) => {
        if (seq === searchSeq.current) message.error(errMsg(e));
      });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      searchSeq.current += 1;
    };
  }, [kbId, cardId, cardQuery, message]);

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
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Select style={{ width: 90 }} value={type} onChange={setType} options={RELATION_TYPES} />
        <Select
          showSearch
          filterOption={false}
          style={{ flex: 1 }}
          placeholder="搜索并选择关联卡片"
          value={dst}
          searchValue={cardQuery}
          onSearch={setCardQuery}
          onChange={setDst}
          options={cards.map((c) => ({ value: c.id, label: c.title }))}
        />
        <IconBtn tip="添加关联" type="primary" icon={<PlusOutlined />} disabled={!dst} onClick={add} />
      </div>
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
              className="link-panel-item"
              actions={[
                <Confirm key="d" title="删除该关联?" onConfirm={() => api.linkDelete(l.id).then(reload).catch((e) => message.error(errMsg(e)))}>
                  <IconBtn tip="删除关联" size="small" danger icon={<DeleteOutlined />} />
                </Confirm>,
              ]}
            >
              <Tag>{out ? '→' : '←'} {relationLabel(l.relationType)}</Tag>
              <RouterLink
                className="link-panel-title"
                to={`/kb/${kbId}/card/${otherId}`}
                onClick={(e) => {
                  e.preventDefault();
                  guardNav(() => nav(`/kb/${kbId}/card/${otherId}`));
                }}
              >
                {otherTitle}
              </RouterLink>
              {l.note && <span className="link-panel-note">{l.note}</span>}
            </List.Item>
          );
        }}
      />
    </div>
  );
}
