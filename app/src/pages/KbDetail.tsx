import { ApartmentOutlined, ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Card, ColorPicker, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import Hint, { EmptyHint } from '../components/Hint';
import Confirm from '../components/Confirm';
import IconBtn from '../components/IconBtn';
import ModalFooter from '../components/ModalFooter';
import type { CardSummary, Kb, Tag as TagT } from '../types';

export default function KbDetail() {
  const kbId = Number(useParams().kbId);
  const { message } = App.useApp();
  const nav = useNavigate();
  const [kb, setKb] = useState<Kb>();
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [tags, setTags] = useState<TagT[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [tagEdit, setTagEdit] = useState<TagT | null>(null);
  const [form] = Form.useForm();

  const loadMeta = useCallback(async () => {
    try {
      const [k, t] = await Promise.all([api.kbGet(kbId), api.tagList(kbId)]);
      setKb(k);
      setTags(t);
    } catch (e) {
      message.error(errMsg(e));
    }
  }, [kbId, message]);

  const loadCards = useCallback(
    () => api.cardList(kbId, selected).then(setCards).catch((e) => message.error(errMsg(e))),
    [kbId, selected, message],
  );

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);
  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const saveTag = async () => {
    const v = await form.validateFields();
    const color = typeof v.color === 'string' ? v.color : v.color.toHexString();
    try {
      await api.tagUpdate(tagEdit!.id, v.name, color);
      setTagEdit(null);
      loadMeta();
      loadCards();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const delTag = async () => {
    try {
      await api.tagDelete(tagEdit!.id);
      setSelected((s) => s.filter((x) => x !== tagEdit!.id));
      setTagEdit(null);
      loadMeta();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div className="page">
      <Space style={{ marginBottom: 12 }}>
        <IconBtn tip="返回" icon={<ArrowLeftOutlined />} onClick={() => nav('/')} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          {kb?.name}
        </Typography.Title>
        {kb?.description && <Hint text={kb.description} />}
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
        <div>
          <span style={{ marginRight: 8 }}>
            <Hint text={tags.length === 0 ? '暂无标签,编辑卡片时可创建' : '标签筛选(同时满足):勾选多个标签只显示同时具备的卡片;右键标签可改名/改色/删除'} />
          </span>
          {tags.map((t) => (
            <Tag.CheckableTag key={t.id} checked={selected.includes(t.id)} onChange={() => toggle(t.id)}
              onContextMenu={(e) => { e.preventDefault(); setTagEdit(t); form.setFieldsValue({ name: t.name, color: t.color }); }}
              style={{ borderLeft: `4px solid ${t.color}` }}>
              {t.name} ({t.cardCount})
            </Tag.CheckableTag>
          ))}
        </div>
        <Space>
          <IconBtn tip="知识地图" icon={<ApartmentOutlined />} onClick={() => nav(`/kb/${kbId}/graph`)} />
          <IconBtn tip="新建卡片" type="primary" icon={<PlusOutlined />} onClick={() => nav(`/kb/${kbId}/card/new`)} />
        </Space>
      </div>

      {cards.length === 0 ? (
        <EmptyHint text="没有卡片,点击右上角加号新建" />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          {cards.map((c) => (
            <Card key={c.id} size="small" className="card-item" onClick={() => nav(`/kb/${kbId}/card/${c.id}`)}>
              <Typography.Text strong>{c.title}</Typography.Text>
              <div className="excerpt">{c.excerpt || '(空内容)'}</div>
              <Space size={4} wrap>
                {c.tags.map((t) => (
                  <Tag key={t.id} color={t.color}>
                    {t.name}
                  </Tag>
                ))}
                <Typography.Text type="secondary">{new Date(c.updatedAt).toLocaleString()}</Typography.Text>
              </Space>
            </Card>
          ))}
        </Space>
      )}

      <Modal
        open={!!tagEdit}
        title="编辑标签"
        onOk={saveTag}
        onCancel={() => setTagEdit(null)}
        destroyOnClose
        forceRender
        footer={
          <ModalFooter
            onOk={saveTag}
            onCancel={() => setTagEdit(null)}
            extra={
              <Confirm title="删除该标签?卡片不会被删除" onConfirm={delTag}>
                <IconBtn tip="删除标签" danger icon={<DeleteOutlined />} />
              </Confirm>
            }
          />
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={30} />
          </Form.Item>
          <Form.Item name="color" label="颜色">
            <ColorPicker />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
