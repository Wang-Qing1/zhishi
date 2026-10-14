import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FullscreenOutlined,
  LinkOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { App, Dropdown, InputNumber, Modal, Select, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import dagre from 'dagre';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import Confirm from '../components/Confirm';
import Hint from '../components/Hint';
import IconBtn from '../components/IconBtn';
import CardModal from '../components/CardModal';
import ModalFooter from '../components/ModalFooter';
import type { Graph } from '../types';
import { RELATION_TYPES, relationLabel } from '../types';

const W = 180;
const H = 44;

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

  const nodes: Node[] = g.nodes.map((n) => {
    const p = linked.has(n.id) ? dg.node(String(n.id)) : null;
    const auto = p ? { x: p.x - W / 2, y: p.y - H / 2 } : grid.get(n.id)!;
    const color = n.tags[0]?.color ?? '#999';
    return {
      id: String(n.id),
      // 已保存的位置优先,否则用自动布局
      position: n.x != null && n.y != null ? { x: n.x, y: n.y } : auto,
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
        background: n.id === focusId ? '#fffbe6' : '#fff',
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
    labelBgStyle: { fill: '#fff' },
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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [depth, setDepth] = useState(2);
  const [pending, setPending] = useState<Connection | null>(null);
  const [relType, setRelType] = useState('related');
  const [count, setCount] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  // 右键菜单(屏幕坐标 + 节点 id)与“添加关联”弹窗
  const [ctx, setCtx] = useState<{ x: number; y: number; id: number } | null>(null);
  const [addFrom, setAddFrom] = useState<number | null>(null);
  const [addTo, setAddTo] = useState<number>();
  const [cardOpts, setCardOpts] = useState<{ value: number; label: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const g = await api.graphGet(kbId, focus, depth);
      const l = layout(g, focus);
      setNodes(l.nodes);
      setEdges(l.edges);
      setCount(g.nodes.length);
      setGraph(g);
      // 全图模式下把自动布局的位置也保存,之后不再因为新增卡片/关联而跳动
      if (focus === null) {
        const missing = l.nodes
          .filter((_, i) => g.nodes[i].x == null)
          .map((n) => ({ cardId: Number(n.id), x: n.position.x, y: n.position.y }));
        if (missing.length) api.graphSavePositions(missing).catch(() => {});
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

  const menuItems = (id: number): MenuProps['items'] => {
    const mine = (graph?.edges ?? []).filter((l) => l.srcId === id || l.dstId === id);
    return [
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
    api
      .cardList(kbId, [], 0, 1000)
      .then((cs) => setCardOpts(cs.filter((c) => c.id !== id).map((c) => ({ value: c.id, label: c.title }))))
      .catch((e) => message.error(errMsg(e)));
  };

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
    const id = ctx?.id;
    setCtx(null);
    if (id === undefined) return;
    if (key === 'edit') setOpenId(id);
    else if (key === 'focus') setSp({ focus: String(id) });
    else if (key === 'link') openAddLink(id);
    else if (key.startsWith('del:')) askDelLink(Number(key.slice(4)));
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
      <Space style={{ marginBottom: 12 }} wrap>
        <IconBtn tip="返回" icon={<ArrowLeftOutlined />} onClick={() => nav(`/kb/${kbId}`)} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          知识地图
        </Typography.Title>
        <Hint text={`${focus ? '聚焦子图' : '全图'}(${count} 个节点) · 单击节点打开卡片 · 右键节点打开菜单(编辑、聚焦子图、添加/删除关联) · 拖动节点右侧圆点到另一节点建立关联 · 单击连线删除`} />
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
            setCtx({ x: e.clientX, y: e.clientY, id: Number(n.id) });
          }}
          onPaneContextMenu={(e) => e.preventDefault()}
          onEdgeClick={delEdge}
          onNodeDragStop={(_, __, ns) => savePositions(ns)}
          onSelectionDragStop={(_, ns) => savePositions(ns)}
          zoomOnDoubleClick={false}
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
            maskColor="rgba(240, 240, 240, 0.6)"
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
            style={{ width: '100%' }}
            placeholder="选择要关联的卡片"
            value={addTo}
            onChange={setAddTo}
            optionFilterProp="label"
            options={cardOpts}
          />
        </Space>
      </Modal>
      <CardModal
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
