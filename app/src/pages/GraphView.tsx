import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FullscreenOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { App, Dropdown, Input, InputNumber, Modal, Select, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import dagre from 'dagre';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import Confirm from '../components/Confirm';
import Hint from '../components/Hint';
import IconBtn from '../components/IconBtn';
import CardModal from '../components/CardModal';
import ModalFooter from '../components/ModalFooter';
import RichEditor from '../components/RichEditor';
import TagSelector from '../components/TagSelector';
import { useTheme } from '../theme';
import type { Graph, Tag } from '../types';
import { RELATION_TYPES, relationLabel } from '../types';

const W = 180;
const H = 44;
const GAP_X = 80;
const GAP_Y = 20;

type Pos = { x: number; y: number };

/** 已有保存位置时,给没有位置的节点摆放:贴着已定位的邻居(目标端在右、源端在左),重叠则向下错开;无邻居可参照的按网格排在整体下方 */
function placeUnsaved(g: Graph, pos: Map<number, Pos>) {
  const hit = (x: number, y: number) => {
    for (const p of pos.values()) {
      if (Math.abs(p.x - x) < W + 20 && Math.abs(p.y - y) < H + GAP_Y) return true;
    }
    return false;
  };
  const free = (x: number, y: number): Pos => {
    while (hit(x, y)) y += H + GAP_Y;
    return { x, y };
  };
  let pending = g.nodes.filter((n) => !pos.has(n.id));
  while (pending.length > 0) {
    const rest: typeof pending = [];
    for (const n of pending) {
      let want: Pos | null = null;
      for (const e of g.edges) {
        if (e.dstId === n.id && pos.has(e.srcId)) {
          const p = pos.get(e.srcId)!;
          want = { x: p.x + W + GAP_X, y: p.y };
          break;
        }
        if (e.srcId === n.id && pos.has(e.dstId)) {
          const p = pos.get(e.dstId)!;
          want = { x: p.x - W - GAP_X, y: p.y };
          break;
        }
      }
      if (want) pos.set(n.id, free(want.x, want.y));
      else rest.push(n);
    }
    if (rest.length === pending.length) break;
    pending = rest;
  }
  if (pending.length > 0) {
    const ps = [...pos.values()];
    const minX = Math.min(...ps.map((p) => p.x));
    const startY = Math.max(...ps.map((p) => p.y)) + H + 40;
    const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(pending.length))));
    pending.forEach((n, i) => {
      pos.set(n.id, { x: minX + (i % cols) * (W + 40), y: startY + Math.floor(i / cols) * (H + 30) });
    });
  }
}

/** dagre 分层布局:LR 从左到右 */
function layout(g: Graph, focusId: number | null): { nodes: Node[]; edges: Edge[] } {
  const dg = new dagre.graphlib.Graph();
  dg.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 120 });
  dg.setDefaultEdgeLabel(() => ({}));
  // 有连线的卡片用 dagre 分层布局;孤立卡片(没有任何关联)统一按网格排在下方
  const linked = new Set<number>();
  g.edges.forEach((e) => {
    linked.add(e.srcId);
    linked.add(e.dstId);
  });
  g.nodes.filter((n) => linked.has(n.id)).forEach((n) => dg.setNode(String(n.id), { width: W, height: H }));
  g.edges.forEach((e) => dg.setEdge(String(e.srcId), String(e.dstId)));
  dagre.layout(dg);

  let minX = 0;
  let startY = 0;
  if (linked.size > 0) {
    const ps = [...linked].map((id) => dg.node(String(id)));
    minX = Math.min(...ps.map((p) => p.x - W / 2));
    startY = Math.max(...ps.map((p) => p.y + H / 2)) + 80;
  }
  const isolated = g.nodes.filter((n) => !linked.has(n.id));
  const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(isolated.length))));
  const grid = new Map<number, { x: number; y: number }>();
  isolated.forEach((n, i) => {
    grid.set(n.id, { x: minX + (i % cols) * (W + 40), y: startY + Math.floor(i / cols) * (H + 30) });
  });

  // 最终坐标:已保存位置优先;完全没有保存位置时用 dagre + 孤立网格,否则新节点贴着已有邻居摆放
  const pos = new Map<number, Pos>();
  g.nodes.forEach((n) => {
    if (n.x != null && n.y != null) pos.set(n.id, { x: n.x, y: n.y });
  });
  if (pos.size === 0) {
    g.nodes.forEach((n) => {
      const p = linked.has(n.id) ? dg.node(String(n.id)) : null;
      pos.set(n.id, p ? { x: p.x - W / 2, y: p.y - H / 2 } : grid.get(n.id)!);
    });
  } else {
    placeUnsaved(g, pos);
  }

  const nodes: Node[] = g.nodes.map((n) => {
    const color = n.tags[0]?.color ?? '#999';
    return {
      id: String(n.id),
      // 已保存的位置优先,否则用自动布局
      position: pos.get(n.id)!,
      // 布局是从左到右,连线从右侧出、从左侧入,避免绕到卡片上下侧
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label: n.title, color },
      style: {
        width: W,
        height: H,
        border: `2px solid ${color}`,
        borderRadius: 8,
        fontSize: 13,
        background: n.id === focusId ? 'var(--node-focus-bg)' : 'var(--node-bg)',
        color: 'var(--text)',
        cursor: 'move',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    };
  });
  const edges: Edge[] = g.edges.map((e) => ({
    id: String(e.id),
    source: String(e.srcId),
    target: String(e.dstId),
    label: relationLabel(e.relationType),
    markerEnd: { type: MarkerType.ArrowClosed, color: '#9aa5b1' },
    style: { stroke: '#9aa5b1', strokeWidth: 1.5 },
    labelBgStyle: { fill: 'var(--bg-surface)' },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 6,
  }));
  return { nodes, edges };
}

function Inner() {
  const kbId = Number(useParams().kbId);
  const [sp, setSp] = useSearchParams();
  const focus = sp.get('focus') ? Number(sp.get('focus')) : null;
  const { message } = App.useApp();
  const nav = useNavigate();
  const { dark } = useTheme();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [depth, setDepth] = useState(2);
  const [pending, setPending] = useState<Connection | null>(null);
  const [relType, setRelType] = useState('related');
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  // 右键菜单(屏幕坐标 + 画布坐标 + 可选节点 id)与“添加关联”弹窗
  const [ctx, setCtx] = useState<{ x: number; y: number; position: Pos; id?: number } | null>(null);
  const [createPosition, setCreatePosition] = useState<Pos | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newTagIds, setNewTagIds] = useState<number[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [creating, setCreating] = useState(false);
  const newContent = useRef({ json: '', text: '' });
  const [addFrom, setAddFrom] = useState<number | null>(null);
  const [addTo, setAddTo] = useState<number>();
  const [cardOpts, setCardOpts] = useState<{ value: number; label: string }[]>([]);
  const [cardQuery, setCardQuery] = useState('');
  const searchSeq = useRef(0);

  const contextPosition = (x: number, y: number): Pos => {
    const p = screenToFlowPosition({ x, y });
    return { x: p.x - W / 2, y: p.y - H / 2 };
  };

  const loadTags = useCallback(async () => {
    try {
      setAllTags(await api.tagList(kbId));
    } catch (e) {
      message.error(errMsg(e));
    }
  }, [kbId, message]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const load = useCallback(async () => {
    try {
      const g = await api.graphGet(kbId, focus, depth);
      const l = layout(g, focus);
      setNodes(l.nodes);
      setEdges(l.edges);
      setCount(g.nodes.length);
      setTruncated(g.truncated);
      setGraph(g);
      // 全图模式下把自动布局的位置也保存,之后不再因为新增卡片/关联而跳动
      if (focus === null) {
        const missing = l.nodes
          .filter((_, i) => g.nodes[i].x == null)
          .map((n) => ({ cardId: Number(n.id), x: n.position.x, y: n.position.y }));
        if (missing.length) api.graphSavePositions(missing).catch((e) => message.error(errMsg(e)));
      }
    } catch (e) {
      message.error(errMsg(e));
    }
  }, [kbId, focus, depth, setNodes, setEdges, message]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmLink = async () => {
    if (!pending?.source || !pending.target) return;
    try {
      await api.linkCreate(Number(pending.source), Number(pending.target), relType);
      setPending(null);
      load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const menuItems = (id?: number): MenuProps['items'] => {
    if (id === undefined) {
      return [{ key: 'create', icon: <PlusOutlined />, label: '新建卡片' }];
    }
    const mine = (graph?.edges ?? []).filter((l) => l.srcId === id || l.dstId === id);
    return [
      { key: 'create', icon: <PlusOutlined />, label: '新建卡片' },
      { type: 'divider' },
      { key: 'edit', icon: <EditOutlined />, label: '编辑卡片' },
      { key: 'focus', icon: <ApartmentOutlined />, label: '聚焦子图' },
      { key: 'link', icon: <LinkOutlined />, label: '添加关联…' },
      ...(mine.length > 0
        ? [
            {
              key: 'unlink',
              icon: <DeleteOutlined />,
              label: '删除关联',
              danger: true,
              children: mine.map((l) => ({
                key: `del:${l.id}`,
                label: `${l.srcId === id ? '→' : '←'} ${relationLabel(l.relationType)} ${l.srcId === id ? l.dstTitle : l.srcTitle}`,
              })),
            },
          ]
        : []),
    ];
  };

  const openAddLink = (id: number) => {
    setAddFrom(id);
    setAddTo(undefined);
    setRelType('related');
    setCardQuery('');
  };

  useEffect(() => {
    if (addFrom === null) return;
    const seq = ++searchSeq.current;
    setCardOpts([]);
    const timer = window.setTimeout(() => {
      api.cardSearchTitles(kbId, cardQuery).then((cs) => {
        if (seq === searchSeq.current) {
          setCardOpts(cs.filter((c) => c.id !== addFrom).map((c) => ({ value: c.id, label: c.title })));
        }
      }).catch((e) => {
        if (seq === searchSeq.current) message.error(errMsg(e));
      });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      searchSeq.current += 1;
    };
  }, [kbId, addFrom, cardQuery, message]);

  const confirmAdd = async () => {
    if (addFrom === null || !addTo) return;
    try {
      await api.linkCreate(addFrom, addTo, relType);
      setAddFrom(null);
      load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const onMenu: MenuProps['onClick'] = ({ key }) => {
    const context = ctx;
    setCtx(null);
    if (key === 'create' && context) {
      setNewTitle('');
      setNewTagIds([]);
      newContent.current = { json: '', text: '' };
      setCreatePosition(context.position);
      return;
    }
    const id = context?.id;
    if (id === undefined) return;
    if (key === 'edit') setOpenId(id);
    else if (key === 'focus') setSp({ focus: String(id) });
    else if (key === 'link') openAddLink(id);
    else if (key.startsWith('del:')) askDelLink(Number(key.slice(4)));
  };

  const createCard = async () => {
    if (!createPosition || creating) return;
    if (!newTitle.trim()) {
      message.error('请输入卡片标题');
      return;
    }
    setCreating(true);
    try {
      const card = await api.cardCreate(kbId, newTitle, newContent.current.json, newContent.current.text, newTagIds);
      try {
        await api.graphSavePositions([{ cardId: card.id, ...createPosition }]);
      } catch (e) {
        message.error(`卡片已创建，但保存地图位置失败：${errMsg(e)}`);
      }
      setCreatePosition(null);
      message.success('已创建');
      if (focus !== null) setSp({});
      else await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setCreating(false);
    }
  };

  const savePositions = (ns: Node[]) =>
    api
      .graphSavePositions(ns.map((n) => ({ cardId: Number(n.id), x: n.position.x, y: n.position.y })))
      .catch((e) => message.error(errMsg(e)));

  const resetLayout = async () => {
    try {
      await api.graphResetPositions(kbId);
      load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const delEdge = (_: unknown, edge: Edge) => askDelLink(Number(edge.id));

  const askDelLink = (linkId: number) => {
    Modal.confirm({
      title: '删除该关联?',
      okText: <CheckOutlined />,
      cancelText: <CloseOutlined />,
      okButtonProps: { shape: 'circle' },
      cancelButtonProps: { shape: 'circle' },
      onOk: () => api.linkDelete(linkId).then(load).catch((e) => message.error(errMsg(e))),
    });
  };

  return (
    <div className="page">
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <IconBtn tip="返回" icon={<ArrowLeftOutlined />} onClick={() => nav(`/kb/${kbId}`)} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            知识地图
          </Typography.Title>
          {truncated && (
            <Typography.Text type="warning">
              全图已达 1500 节点上限，仅显示最近更新的卡片
            </Typography.Text>
          )}
          <Hint text={`${focus ? '聚焦子图' : '全图'}(${count} 个节点${truncated ? '，已达 1500 节点上限，仅显示最近更新的卡片' : ''}) · 单击节点打开卡片 · 右键地图或节点新建卡片，右键节点还可编辑、聚焦子图、添加/删除关联 · 拖动节点右侧圆点到另一节点建立关联 · 单击连线删除`} />
        </Space>
        <Space wrap>
          <Confirm title="重新自动排列?已保存的手动位置将被清除" onConfirm={resetLayout}>
            <IconBtn tip="重新自动排列" icon={<ReloadOutlined />} />
          </Confirm>
          {focus && (
            <>
              <span>深度</span>
              <InputNumber min={1} max={6} value={depth} onChange={(v) => setDepth(v ?? 2)} />
              <IconBtn tip="显示全图" icon={<FullscreenOutlined />} onClick={() => setSp({})} />
            </>
          )}
        </Space>
      </div>
      <div className="graph-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(c) => setPending(c)}
          onNodeClick={(_, n) => setOpenId(Number(n.id))}
          onNodeContextMenu={(e, n) => {
            e.preventDefault();
            setCtx({
              x: e.clientX,
              y: e.clientY,
              position: contextPosition(e.clientX, e.clientY),
              id: Number(n.id),
            });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            setCtx({
              x: e.clientX,
              y: e.clientY,
              position: contextPosition(e.clientX, e.clientY),
            });
          }}
          onEdgeClick={delEdge}
          onNodeDragStop={(_, __, ns) => savePositions(ns)}
          onSelectionDragStop={(_, ns) => savePositions(ns)}
          colorMode={dark ? 'dark' : 'light'}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          minZoom={0.1}
        >
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => (n.data as { color?: string }).color ?? '#999'}
            nodeStrokeWidth={0}
            maskColor="var(--minimap-mask)"
            style={{ borderRadius: 12, overflow: 'hidden' }}
          />
        </ReactFlow>
      </div>
      <Modal open={!!pending} title="选择关系类型" onCancel={() => setPending(null)} footer={<ModalFooter onOk={confirmLink} onCancel={() => setPending(null)} />}>
        <Select style={{ width: '100%' }} value={relType} onChange={setRelType} options={RELATION_TYPES} />
      </Modal>
      <Dropdown
        open={ctx !== null}
        onOpenChange={(o) => !o && setCtx(null)}
        trigger={['click']}
        menu={{ items: ctx ? menuItems(ctx.id) : [], onClick: onMenu }}
      >
        <span style={{ position: 'fixed', left: ctx?.x ?? 0, top: ctx?.y ?? 0, width: 1, height: 1 }} />
      </Dropdown>
      <Modal
        open={addFrom !== null}
        title="添加关联"
        destroyOnClose
        onCancel={() => setAddFrom(null)}
        footer={<ModalFooter onOk={confirmAdd} onCancel={() => setAddFrom(null)} />}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select style={{ width: '100%' }} value={relType} onChange={setRelType} options={RELATION_TYPES} />
          <Select
            showSearch
            filterOption={false}
            style={{ width: '100%' }}
            placeholder="搜索并选择要关联的卡片"
            value={addTo}
            searchValue={cardQuery}
            onSearch={setCardQuery}
            onChange={setAddTo}
            options={cardOpts}
          />
        </Space>
      </Modal>
      <Modal
        open={createPosition !== null}
        title="新建卡片"
        width={880}
        centered
        destroyOnClose
        maskClosable={false}
        onCancel={() => setCreatePosition(null)}
        footer={<ModalFooter onOk={createCard} onCancel={() => setCreatePosition(null)} okTip={creating ? '正在创建' : '创建'} />}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Input
            size="large"
            placeholder="卡片标题"
            value={newTitle}
            maxLength={200}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <TagSelector
            kbId={kbId}
            allTags={allTags}
            value={newTagIds}
            onChange={setNewTagIds}
            onTagsChanged={loadTags}
          />
          <RichEditor
            key={createPosition ? `${createPosition.x},${createPosition.y}` : 'new'}
            initial=""
            kbId={kbId}
            onOpenCard={setOpenId}
            onReady={(json, text) => {
              newContent.current = { json, text };
            }}
            onChange={(json, text) => {
              newContent.current = { json, text };
            }}
          />
        </Space>
      </Modal>
      <CardModal
        kbId={kbId}
        cardId={openId}
        onClose={() => setOpenId(null)}
        onSaved={load}
        onOpenPage={(id) => nav(`/kb/${kbId}/card/${id}`)}
      />
    </div>
  );
}

export default function GraphView() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}
