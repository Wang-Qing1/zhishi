import { invoke } from '@tauri-apps/api/core';
import type {
  Card,
  CardPage,
  CardSort,
  CardSummary,
  CardVersion,
  CardVersionSummary,
  CleanupResult,
  Draft,
  Graph,
  ImageInfo,
  Kb,
  Link,
  SearchHit,
  Tag,
  TrashList,
} from './types';

// 参数用 camelCase,Tauri 自动映射到 Rust 的 snake_case
export const api = {
  kbList: () => invoke<Kb[]>('kb_list'),
  kbGet: (id: number) => invoke<Kb>('kb_get', { id }),
  kbCreate: (name: string, description: string) => invoke<Kb>('kb_create', { name, description }),
  kbUpdate: (id: number, name: string, description: string) =>
    invoke<Kb>('kb_update', { id, name, description }),
  kbDelete: (id: number) => invoke<void>('kb_delete', { id }),
  kbSearch: (query: string, limit = 10) => invoke<Kb[]>('kb_search', { query, limit }),

  cardListPage: (kbId: number, tagIds: number[], keyword: string, offset: number, limit: number, sort: CardSort) =>
    invoke<CardPage>('card_list_page', { kbId, tagIds, keyword, offset, limit, sort }),
  /** 置顶不算内容修改:不影响更新时间和历史版本 */
  cardSetPinned: (id: number, pinned: boolean) => invoke<void>('card_set_pinned', { id, pinned }),
  cardSearchTitles: (kbId: number, query: string) =>
    invoke<CardSummary[]>('card_search_titles', { kbId, query }),
  cardBacklinks: (kbId: number, cardId: number) =>
    invoke<CardSummary[]>('card_backlinks', { kbId, cardId }),
  cardGet: (id: number) => invoke<Card>('card_get', { id }),
  cardCreate: (kbId: number, title: string, contentJson: string, contentText: string, tagIds: number[]) =>
    invoke<Card>('card_create', { kbId, title, contentJson, contentText, tagIds }),
  /** forceVersion:恢复历史版本后保存时为 true,保证被覆盖的内容一定留下版本 */
  cardUpdate: (id: number, title: string, contentJson: string, contentText: string, tagIds: number[], forceVersion = false) =>
    invoke<Card>('card_update', { id, title, contentJson, contentText, tagIds, forceVersion }),
  versionList: (cardId: number) => invoke<CardVersionSummary[]>('version_list', { cardId }),
  versionGet: (id: number) => invoke<CardVersion>('version_get', { id }),
  cardDelete: (id: number) => invoke<void>('card_delete', { id }),

  /** 草稿:cardId 为 0 表示新建卡片 */
  draftSave: (kbId: number, cardId: number, title: string, contentJson: string, tagIds: number[]) =>
    invoke<void>('draft_save', { kbId, cardId, title, contentJson, tagIds }),
  draftGet: (kbId: number, cardId: number) => invoke<Draft | null>('draft_get', { kbId, cardId }),
  draftDelete: (kbId: number, cardId: number) => invoke<void>('draft_delete', { kbId, cardId }),

  tagList: (kbId: number) => invoke<Tag[]>('tag_list', { kbId }),
  tagCreate: (kbId: number, name: string, color: string) => invoke<Tag>('tag_create', { kbId, name, color }),
  tagUpdate: (id: number, name: string, color: string) => invoke<Tag>('tag_update', { id, name, color }),
  tagDelete: (id: number) => invoke<void>('tag_delete', { id }),

  linkCreate: (srcId: number, dstId: number, relationType: string, note = '') =>
    invoke<Link>('link_create', { srcId, dstId, relationType, note }),
  linkDelete: (id: number) => invoke<void>('link_delete', { id }),
  linkListByCard: (cardId: number) => invoke<Link[]>('link_list_by_card', { cardId }),

  graphGet: (kbId: number, focusCardId: number | null, depth: number) =>
    invoke<Graph>('graph_get', { kbId, focusCardId, depth }),

  graphSavePositions: (items: { cardId: number; x: number; y: number }[]) =>
    invoke<void>('graph_save_positions', { items }),
  graphResetPositions: (kbId: number) => invoke<void>('graph_reset_positions', { kbId }),

  trashList: () => invoke<TrashList>('trash_list'),
  trashRestoreKb: (id: number) => invoke<void>('trash_restore_kb', { id }),
  trashRestoreCard: (id: number) => invoke<void>('trash_restore_card', { id }),
  trashPurgeKb: (id: number) => invoke<void>('trash_purge_kb', { id }),
  trashPurgeCard: (id: number) => invoke<void>('trash_purge_card', { id }),
  trashEmpty: () => invoke<number>('trash_empty'),

  backupExport: (path: string) => invoke<void>('backup_export', { path }),
  backupRestore: (path: string) => invoke<void>('backup_restore', { path }),

  imageSave: (dataBase64: string, ext: string) => invoke<string>('image_save', { dataBase64, ext }),
  imageList: () => invoke<ImageInfo[]>('image_list'),
  imageCleanup: () => invoke<CleanupResult>('image_cleanup'),
  /** removeRefs:图片仍被卡片/历史版本使用时为 true,会把它们正文里的这张图一并移除 */
  imageDelete: (name: string, removeRefs: boolean) => invoke<void>('image_delete', { name, removeRefs }),

  search: (query: string, kbId: number | null = null, tagIds: number[] = [], limit = 50) =>
    invoke<SearchHit[]>('search_global', { query, kbId, tagIds, limit }),
};

/** Tauri 抛出的错误是字符串 */
export const errMsg = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
