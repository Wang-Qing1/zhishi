import { ApartmentOutlined, ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Card, Col, ColorPicker, Form, Input, Modal, Pagination, Row, Select, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import Hint, { EmptyHint } from '../components/Hint';
import Confirm from '../components/Confirm';
import IconBtn from '../components/IconBtn';
import ModalFooter from '../components/ModalFooter';
import type { CardSummary, Kb, Tag as TagT } from '../types';

const PAGE_SIZE = 24;

export default function KbDetail() {
  const kbId = Number(useParams().kbId);
  const { message } = App.useApp();
  const nav = useNavigate();
  const [kb, setKb] = useState<Kb>();
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<TagT[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [tagEdit, setTagEdit] = useState<TagT | null>(null);
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  // 首次列表请求完成前不显示空状态提示
  const [loaded, setLoaded] = useState(false);
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

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(keyword.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);
  useEffect(() => {
    setPage(1);
  }, [keyword, selected]);
  useEffect(() => {
    let active = true;
    api.cardListPage(kbId, selected, query, (page - 1) * PAGE_SIZE, PAGE_SIZE)
      .then((result) => {
        if (!active) return;
        setCards(result.items);
        setTotal(result.total);
        setLoaded(true);
      })
      .catch((e) => {
        if (active) {
          setCards([]);
          setTotal(0);
          setLoaded(true);
          message.error(errMsg(e));
        }
      });
    return () => {
      active = false;
    };
  }, [kbId, selected, query, page, revision, message]);
  useEffect(() => {
    setLoaded(false);
    setSelected([]);
    setKeyword('');
    setQuery('');
    setPage(1);
  }, [kbId]);

  const saveTag = async () => {
    try {
      const v = await form.validateFields();
      const color = typeof v.color === 'string' ? v.color : v.color.toHexString();
      await api.tagUpdate(tagEdit!.id, v.name, color);
      setTagEdit(null);
      loadMeta();
      setRevision((n) => n + 1);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const delCard = async (id: number) => {
    try {
      await api.cardDelete(id);
      if (cards.length === 1 && page > 1) setPage((current) => current - 1);
      setRevision((n) => n + 1);
      loadMeta();
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
      setRevision((n) => n + 1);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <Input
            allowClear
            placeholder="按名称搜索卡片"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 220 }}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="按标签筛选"
            style={{ width: 280 }}
            value={selected}
            onChange={setSelected}
            optionFilterProp="label"
            options={tags.map((t) => ({ value: t.id, label: t.name, tag: t }))}
            optionRender={(o) => {
              const t = (o.data as { tag: TagT }).tag;
              return (
                <span
                  style={{ display: 'block', borderLeft: `4px solid ${t.color}`, paddingLeft: 8 }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTagEdit(t);
                    form.setFieldsValue({ name: t.name, color: t.color });
                  }}
                >
                  {t.name} ({t.cardCount})
                </span>
              );
            }}
          />
        </div>
        <Space>
          <IconBtn tip="知识地图" icon={<ApartmentOutlined />} onClick={() => nav(`/kb/${kbId}/graph`)} />
          <IconBtn tip="新建卡片" type="primary" icon={<PlusOutlined />} onClick={() => nav(`/kb/${kbId}/card/new`)} />
        </Space>
      </div>

      {!loaded ? null : total === 0 ? (
        <EmptyHint text={query || selected.length ? '当前筛选没有匹配的卡片' : '没有卡片,点击右上角加号新建'} />
      ) : (
        <Row gutter={[16, 16]}>
          {cards.map((c) => (
            <Col key={c.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                hoverable
                size="small"
                className="card-item"
                style={{ height: '100%' }}
                onClick={() => nav(`/kb/${kbId}/card/${c.id}`)}
              >
                <Typography.Text strong ellipsis style={{ display: 'block' }}>
                  {c.title}
                </Typography.Text>
                <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ minHeight: 44, margin: '8px 0' }}>
                  {c.excerpt || '(空内容)'}
                </Typography.Paragraph>
                <Space size={4} wrap>
                  {c.tags.map((t) => (
                    <Tag key={t.id} color={t.color} style={{ margin: 0 }}>
                      {t.name}
                    </Tag>
                  ))}
                </Space>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(c.updatedAt).toLocaleString()}
                  </Typography.Text>
                  <span className="card-del" onClick={(e) => e.stopPropagation()}>
                    <Confirm title="删除该卡片?" okButtonProps={{ danger: true }} onConfirm={() => delCard(c.id)}>
                      <IconBtn tip="删除" danger type="text" icon={<DeleteOutlined />} />
                    </Confirm>
                  </span>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      {total > PAGE_SIZE && (
        <Pagination
          current={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={setPage}
          showSizeChanger={false}
          style={{ marginTop: 20, textAlign: 'right' }}
        />
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
