import { ApartmentOutlined, ArrowLeftOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { App, Badge, Card, Col, Input, Row, Space, Tooltip } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import Hint from '../components/Hint';
import Confirm from '../components/Confirm';
import IconBtn from '../components/IconBtn';
import LinkPanel from '../components/LinkPanel';
import RichEditor from '../components/RichEditor';
import TagSelector from '../components/TagSelector';
import type { Tag } from '../types';

export default function CardEditor() {
  const params = useParams();
  const kbId = Number(params.kbId);
  const isNew = params.cardId === 'new';
  const cardId = isNew ? null : Number(params.cardId);
  const { message } = App.useApp();
  const nav = useNavigate();

  const [title, setTitle] = useState('');
  const [initial, setInitial] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // 编辑器内容放 ref,避免每次按键触发整页重渲染
  const content = useRef({ json: '', text: '' });

  const loadTags = useCallback(() => api.tagList(kbId).then(setAllTags), [kbId]);

  useEffect(() => {
    loadTags().catch((e) => message.error(errMsg(e)));
    setDirty(false);
    if (cardId === null) {
      setTitle('');
      setTagIds([]);
      content.current = { json: '', text: '' };
      setInitial('');
      return;
    }
    setInitial(null);
    api
      .cardGet(cardId)
      .then((c) => {
        setTitle(c.title);
        setTagIds(c.tags.map((t) => t.id));
        content.current = { json: c.contentJson, text: '' };
        setInitial(c.contentJson);
      })
      .catch((e) => message.error(errMsg(e)));
  }, [cardId, loadTags, message]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const { json, text } = content.current;
      if (cardId === null) {
        const c = await api.cardCreate(kbId, title, json, text, tagIds);
        message.success('已创建');
        nav(`/kb/${kbId}/card/${c.id}`, { replace: true });
      } else {
        await api.cardUpdate(cardId, title, json, text, tagIds);
        message.success('已保存');
      }
      setDirty(false);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }, [cardId, kbId, title, tagIds, nav, message]);

  // Ctrl+S 保存
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [save]);

  const remove = async () => {
    if (cardId === null) return;
    try {
      await api.cardDelete(cardId);
      nav(`/kb/${kbId}`);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const back = () => {
    if (dirty && !window.confirm('有未保存的修改,确定离开?')) return;
    nav(`/kb/${kbId}`);
  };

  return (
    <div className="page">
      <Space style={{ marginBottom: 12 }}>
        <IconBtn tip="返回" icon={<ArrowLeftOutlined />} onClick={back} />
        <IconBtn tip="保存 (Ctrl+S)" type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} />
        {cardId !== null && (
          <>
            <IconBtn tip="在地图中查看" icon={<ApartmentOutlined />} onClick={() => nav(`/kb/${kbId}/graph?focus=${cardId}`)} />
            <Confirm title="删除该卡片?" okButtonProps={{ danger: true }} onConfirm={remove}>
              <IconBtn tip="删除" danger icon={<DeleteOutlined />} />
            </Confirm>
          </>
        )}
        {dirty && (
          <Tooltip title="有未保存的修改">
            <Badge status="warning" />
          </Tooltip>
        )}
      </Space>

      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <Input
            size="large"
            placeholder="卡片标题"
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            style={{ marginBottom: 12 }}
          />
          {initial !== null && (
            <RichEditor
              key={cardId ?? 'new'}
              initial={initial}
              onReady={(json, text) => {
                content.current = { json, text };
              }}
              onChange={(json, text) => {
                content.current = { json, text };
                setDirty(true);
              }}
            />
          )}
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="标签" style={{ marginBottom: 16 }}>
            <TagSelector
              kbId={kbId}
              allTags={allTags}
              value={tagIds}
              onChange={(ids) => {
                setTagIds(ids);
                setDirty(true);
              }}
              onTagsChanged={loadTags}
            />
          </Card>
          <Card size="small" title="关联卡片">
            {cardId === null ? (
              <Hint text="保存卡片后可添加关联" />
            ) : (
              <LinkPanel kbId={kbId} cardId={cardId} />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
