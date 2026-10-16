import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  CheckOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  DeleteOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  TagOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import {
  App,
  Card,
  Checkbox,
  Col,
  ColorPicker,
  Form,
  Input,
  Modal,
  Pagination,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import Hint, { EmptyHint } from '../components/Hint';
import Confirm from '../components/Confirm';
import IconBtn from '../components/IconBtn';
import ModalFooter from '../components/ModalFooter';
import TagManager from '../components/TagManager';
import { CARD_SORTS, type CardSort, type CardSummary, type Kb, type Tag as TagT } from '../types';

const PAGE_SIZE = 24;
const SORT_KEY = 'zhishi.cardSort';

// 排序方式全局记住;浏览器存储不可用时用默认值
const loadSort = (): CardSort => {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return CARD_SORTS.some((s) => s.value === v) ? (v as CardSort) : 'updated';
  } catch {
    return 'updated';
  }
};

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
  const [tagMgr, setTagMgr] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<CardSort>(loadSort);
  const [revision, setRevision] = useState(0);
  // 多选模式:选中的卡片 id 跨分页保留;筛选条件改变、切换知识库时清空
  const [multi, setMulti] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // 批量加/移标签弹窗:add 或 remove,为 null 时关闭
  const [tagOp, setTagOp] = useState<'add' | 'remove' | null>(null);
  const [opTagIds, setOpTagIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
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
  }, [keyword, selected, sort]);
  // 搜索关键词或标签筛选变化后,之前选中的卡片可能已不可见,清空以免误操作
  useEffect(() => {
    setPicked(new Set());
  }, [keyword, selected]);
  // Esc 退出多选模式(标签弹窗打开时由弹窗自己处理 Esc)
  useEffect(() => {
    if (!multi || tagOp !== null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitMulti();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [multi, tagOp]);
  useEffect(() => {
    let active = true;
    api.cardListPage(kbId, selected, query, (page - 1) * PAGE_SIZE, PAGE_SIZE, sort)
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
  }, [kbId, selected, query, page, sort, revision, message]);
  useEffect(() => {
    setLoaded(false);
    setSelected([]);
    setKeyword('');
    setQuery('');
    setPage(1);
    setMulti(false);
    setPicked(new Set());
    setTagOp(null);
    setTagMgr(false);
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

  const exitMulti = () => {
    setMulti(false);
    setPicked(new Set());
  };

  const togglePicked = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickPage = () => setPicked((prev) => new Set([...prev, ...cards.map((c) => c.id)]));

  // 批量操作成功后:清空选中、刷新列表和标签计数,保持多选模式
  const afterBatch = () => {
    setPicked(new Set());
    setRevision((n) => n + 1);
    loadMeta();
  };

  const batchTrash = async () => {
    try {
      await api.cardBatchTrash(kbId, [...picked]);
      // 当前页的卡片被全部删完时退回上一页
      if (page > 1 && cards.every((c) => picked.has(c.id))) setPage((p) => p - 1);
      message.success('已移入回收站');
      afterBatch();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const openTagOp = (op: 'add' | 'remove') => {
    setOpTagIds([]);
    setTagOp(op);
  };

  const confirmTagOp = async () => {
    if (tagOp === null || busy) return;
    if (opTagIds.length === 0) {
      message.error('请选择标签');
      return;
    }
    setBusy(true);
    try {
      const add = tagOp === 'add' ? opTagIds : [];
      const remove = tagOp === 'remove' ? opTagIds : [];
      await api.cardBatchSetTags(kbId, [...picked], add, remove);
      message.success(tagOp === 'add' ? '已添加标签' : '已移除标签');
      setTagOp(null);
      afterBatch();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const changeSort = (v: CardSort) => {
    setSort(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* 存储不可用时只是不记住 */
    }
  };

  const togglePin = async (c: CardSummary) => {
    try {
      await api.cardSetPinned(c.id, !c.pinned);
      setRevision((n) => n + 1);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  // 删除标签:同时从筛选条件和多选中的标签里去掉;失败时抛出错误由调用方提示
  const removeTag = async (id: number) => {
    await api.tagDelete(id);
    setSelected((s) => s.filter((x) => x !== id));
    setOpTagIds((s) => s.filter((x) => x !== id));
    loadMeta();
    setRevision((n) => n + 1);
  };

  const delTag = async () => {
    try {
      await removeTag(tagEdit!.id);
      setTagEdit(null);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const createTag = async (name: string, color: string) => {
    await api.tagCreate(kbId, name, color);
    loadMeta();
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
          <Select
            value={sort}
            onChange={changeSort}
            style={{ width: 110 }}
            options={CARD_SORTS.map((s) => ({ value: s.value, label: s.label }))}
          />
        </div>
        <Space>
          <IconBtn tip="标签管理" icon={<TagsOutlined />} onClick={() => setTagMgr(true)} />
          <IconBtn
            tip={multi ? '退出多选 (Esc)' : '多选'}
            type={multi ? 'primary' : 'default'}
            icon={<CheckSquareOutlined />}
            onClick={() => (multi ? exitMulti() : setMulti(true))}
          />
          <IconBtn tip="知识地图" icon={<ApartmentOutlined />} onClick={() => nav(`/kb/${kbId}/graph`)} />
          <IconBtn tip="新建卡片" type="primary" icon={<PlusOutlined />} onClick={() => nav(`/kb/${kbId}/card/new`)} />
        </Space>
      </div>

      {multi && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            padding: '6px 12px',
            background: 'var(--sel-bg)',
            borderRadius: 16,
          }}
        >
          <Typography.Text>已选 {picked.size} 张</Typography.Text>
          <IconBtn tip="全选本页" size="small" icon={<CheckOutlined />} disabled={cards.length === 0} onClick={pickPage} />
          <IconBtn tip="取消选择" size="small" icon={<CloseOutlined />} disabled={picked.size === 0} onClick={() => setPicked(new Set())} />
          <div style={{ flex: 1 }} />
          <IconBtn tip="给选中的卡片加标签" icon={<TagOutlined />} disabled={picked.size === 0} onClick={() => openTagOp('add')} />
          <IconBtn tip="从选中的卡片移除标签" icon={<MinusCircleOutlined />} disabled={picked.size === 0} onClick={() => openTagOp('remove')} />
          <Confirm
            title={`将 ${picked.size} 张卡片移入回收站?30 天内可恢复`}
            okButtonProps={{ danger: true }}
            onConfirm={batchTrash}
            disabled={picked.size === 0}
          >
            <IconBtn tip="移入回收站" danger icon={<DeleteOutlined />} disabled={picked.size === 0} />
          </Confirm>
        </div>
      )}

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
                style={{ height: '100%', borderColor: multi && picked.has(c.id) ? '#1677ff' : undefined }}
                onClick={() => (multi ? togglePicked(c.id) : nav(`/kb/${kbId}/card/${c.id}`))}
              >
                <Typography.Text strong ellipsis style={{ display: 'block' }}>
                  {multi && <Checkbox checked={picked.has(c.id)} style={{ marginRight: 8, pointerEvents: 'none' }} />}
                  {c.pinned && <PushpinFilled style={{ marginRight: 6, color: '#1677ff' }} />}
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
                  {!multi && (
                  <Space size={0}>
                    {/* 已置顶的图钉常显,未置顶的和删除按钮一样悬停时才显示 */}
                    <span className={c.pinned ? undefined : 'card-del'} onClick={(e) => e.stopPropagation()}>
                      <IconBtn
                        tip={c.pinned ? '取消置顶' : '置顶'}
                        type="text"
                        icon={c.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                        onClick={() => togglePin(c)}
                      />
                    </span>
                    <span className="card-del" onClick={(e) => e.stopPropagation()}>
                      <Confirm title="删除该卡片?将移入回收站" okButtonProps={{ danger: true }} onConfirm={() => delCard(c.id)}>
                        <IconBtn tip="删除" danger type="text" icon={<DeleteOutlined />} />
                      </Confirm>
                    </span>
                  </Space>
                  )}
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

      <TagManager
        open={tagMgr}
        tags={tags}
        onClose={() => setTagMgr(false)}
        onCreate={createTag}
        onDelete={(t) => removeTag(t.id)}
        onEdit={(t) => {
          setTagEdit(t);
          form.setFieldsValue({ name: t.name, color: t.color });
        }}
        onFilter={(t) => {
          setSelected([t.id]);
          setTagMgr(false);
        }}
      />

      <Modal
        open={tagOp !== null}
        title={`${tagOp === 'add' ? '添加' : '移除'}标签(${picked.size} 张卡片)`}
        width={460}
        centered
        destroyOnClose
        onCancel={() => setTagOp(null)}
        footer={
          <ModalFooter
            onOk={confirmTagOp}
            onCancel={() => setTagOp(null)}
            okTip={tagOp === 'add' ? '添加' : '移除'}
          />
        }
      >
        <Select
          mode="multiple"
          autoFocus
          style={{ width: '100%' }}
          placeholder={tags.length ? '选择标签' : '该知识库还没有标签'}
          disabled={tags.length === 0}
          value={opTagIds}
          onChange={setOpTagIds}
          optionFilterProp="label"
          options={tags.map((t) => ({ value: t.id, label: t.name }))}
        />
      </Modal>

      <Modal
        open={!!tagEdit}
        title="编辑标签"
        // 可能从“标签管理”弹窗里打开;它因 forceRender 早挂载、默认会被后打开的弹窗盖住,这里抬高层级
        zIndex={1010}
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
