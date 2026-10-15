export interface Kb {
  id: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  cardCount: number;
}

export interface Tag {
  id: number;
  kbId: number;
  name: string;
  color: string;
  cardCount: number;
}

export interface Card {
  id: number;
  kbId: number;
  title: string;
  contentJson: string;
  createdAt: number;
  updatedAt: number;
  tags: Tag[];
}

export interface CardSummary {
  id: number;
  kbId: number;
  title: string;
  excerpt: string;
  updatedAt: number;
  tags: Tag[];
}

export interface CardPage {
  items: CardSummary[];
  total: number;
}

export interface Link {
  id: number;
  kbId: number;
  srcId: number;
  dstId: number;
  srcTitle: string;
  dstTitle: string;
  relationType: string;
  note: string;
}

export interface GraphNode {
  id: number;
  title: string;
  /** 已保存的画布位置,null 表示尚未布局 */
  x: number | null;
  y: number | null;
  tags: Tag[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: Link[];
  truncated: boolean;
}

export interface SearchHit {
  cardId: number;
  kbId: number;
  kbName: string;
  title: string;
  snippet: string;
  tags: Tag[];
}

export interface CardVersionSummary {
  id: number;
  cardId: number;
  title: string;
  /** 该版本内容当时被保存的时间 */
  savedAt: number;
}

export interface CardVersion extends CardVersionSummary {
  contentJson: string;
}

export interface TrashedKb {
  id: number;
  name: string;
  description: string;
  deletedAt: number;
  cardCount: number;
}

export interface TrashedCard {
  id: number;
  kbId: number;
  kbName: string;
  title: string;
  excerpt: string;
  deletedAt: number;
  /** 所属知识库也在回收站里,需先恢复知识库 */
  kbTrashed: boolean;
}

export interface TrashList {
  kbs: TrashedKb[];
  cards: TrashedCard[];
}

export const RELATION_TYPES = [
  { value: 'related', label: '相关' },
  { value: 'prerequisite', label: '前置' },
  { value: 'contains', label: '包含' },
  { value: 'cites', label: '引用' },
  { value: 'contradicts', label: '对立' },
];

export const relationLabel = (v: string) => RELATION_TYPES.find((r) => r.value === v)?.label ?? v;
