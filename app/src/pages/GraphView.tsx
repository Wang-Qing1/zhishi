import { ArrowLeftOutlined } from '@ant-design/icons';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { App, Button, InputNumber, Modal, Select, Space, Typography } from 'antd';
import dagre from 'dagre';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import type { Graph } from '../types';
import { RELATION_TYPES, relationLabel } from '../types';

const W = 180;
const H = 44;

/** dagre 分层布局:LR 从左到右 */
function layout(g: Graph, focusId: number | null): { nodes: Node[]; edges: Edge[] } {
  const dg = new dagre.graphlib.Graph();
  dg.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 80 });
  dg.setDefaultEdgeLabel(() => ({}));
  g.nodes.forEach((n) => dg.setNode(String(n.id), { width: W, height: H }));
  g.edges.forEach((e) => dg.setEdge(String(e.srcId), String(e.dstId)));
  dagre.layout(dg);

  const nodes: Node[] = g.nodes.map((n) => {
    const p = dg.node(String(n.id));
    const color = n.tags[0]?.color ?? '#999';
    return {
      id: String(n.id),
      position: { x: p.x - W / 2, y: p.y - H / 2 },
      data: { label: n.title },
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
    markerEnd: { type: MarkerType.ArrowClosed },
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

  const load = useCallback(async () => {
    try {
      const g = await api.graphGet(kbId, focus, depth);
      const l = layout(g, focus);
      setNodes(l.nodes);
      setEdges(l.edges);
      setCount(g.nodes.length);
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

  const delEdge = (_: unknown, edge: Edge) => {
    Modal.confirm({
      title: '删除该关联?',
      onOk: () => api.linkDelete(Number(edge.id)).then(load).catch((e) => message.error(errMsg(e))),
    });
  };

  return (
    <div className="page">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav(`/kb/${kbId}`)}>
          返回
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          知识地图
        </Typography.Title>
        <Typography.Text type="secondary">
          {focus ? `聚焦子图(${count} 个节点)` : `全图(${count} 个节点)`} · 单击打开卡片 · 双击聚焦 · 拖动节点右侧圆点到另一节点建立关联 · 单击连线删除
        </Typography.Text>
        {focus && (
          <>
            <span>深度</span>
            <InputNumber min={1} max={6} value={depth} onChange={(v) => setDepth(v ?? 2)} />
            <Button onClick={() => setSp({})}>显示全图</Button>
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
          onNodeClick={(_, n) => nav(`/kb/${kbId}/card/${n.id}`)}
          onNodeDoubleClick={(_, n) => setSp({ focus: n.id })}
          onEdgeClick={delEdge}
          zoomOnDoubleClick={false}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <Modal open={!!pending} title="选择关系类型" onOk={confirmLink} onCancel={() => setPending(null)}>
        <Select style={{ width: '100%' }} value={relType} onChange={setRelType} options={RELATION_TYPES} />
      </Modal>
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
