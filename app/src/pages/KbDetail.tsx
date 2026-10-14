import { ApartmentOutlined, ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, ColorPicker, Empty, Form, Input, Modal, Popconfirm, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errMsg } from '../api';
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
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/')}>
          返回
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {kb?.name}
        </Typography.Title>
      </Space>
      <Typography.Paragraph type="secondary">{kb?.description}</Typography.Paragraph>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
        <div>
          <span style={{ marginRight: 8 }}>标签筛选(同时满足):</span>
          {tags.length === 0 && <Typography.Text type="secondary">暂无标签,编辑卡片时可创建</Typography.Text>}
          {tags.map((t) => (
            <Tag.CheckableTag key={t.id} checked={selected.includes(t.id)} onChange={() => toggle(t.id)}
              onContextMenu={(e) => { e.preventDefault(); setTagEdit(t); form.setFieldsValue({ name: t.name, color: t.color }); }}
              style={{ borderLeft: `4px solid ${t.color}` }}>
              {t.name} ({t.cardCount})
            </Tag.CheckableTag>
          ))}
          {tags.length > 0 && <Typography.Text type="secondary" style={{ marginLeft: 8 }}>右键标签可改名/改色/删除</Typography.Text>}
        </div>
        <Space>
          <Button icon={<ApartmentOutlined />} onClick={() => nav(`/kb/${kbId}/graph`)}>
            知识地图
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/kb/${kbId}/card/new`)}>
            新建卡片
          </Button>
        </Space>
      </div>

      {cards.length === 0 ? (
        <Empty description="没有卡片" />
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
        footer={(_, { OkBtn, CancelBtn }) => (
          <>
            <Popconfirm title="删除该标签?卡片不会被删除" onConfirm={delTag}>
              <Button danger style={{ float: 'left' }}>
                删除
              </Button>
            </Popconfirm>
            <CancelBtn />
            <OkBtn />
          </>
        )}
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
