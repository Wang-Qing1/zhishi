import { ApartmentOutlined, ArrowLeftOutlined, HistoryOutlined, SaveOutlined } from '@ant-design/icons';
import { App, Badge, Card, Col, Input, Modal, Row, Space, Tooltip } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import Hint from '../components/Hint';
import IconBtn from '../components/IconBtn';
import LinkPanel from '../components/LinkPanel';
import ModalFooter from '../components/ModalFooter';
import RichEditor from '../components/RichEditor';
import TagSelector from '../components/TagSelector';
import VersionHistory from '../components/VersionHistory';
import type { CardVersion, Draft, Tag } from '../types';
import { guardNav, registerUnsavedAsk, setUnsaved } from '../unsaved';

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
  const [savedRevision, setSavedRevision] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 恢复历史版本后递增,用于重建编辑器
  const [editorRev, setEditorRev] = useState(0);
  // 刚从历史版本恢复、尚未保存:保存时要求后端一定留下被覆盖内容的版本
  const forceVersion = useRef(false);
  // 待确认的跳转动作;非空时显示“离开?”弹窗
  const [leaveGo, setLeaveGo] = useState<(() => void) | null>(null);
  // 编辑器内容放 ref,避免每次按键触发整页重渲染
  const content = useRef({ json: '', text: '' });
  // 发现的未保存草稿,等用户选择恢复或丢弃
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  // 草稿定时器读取最新的标题/标签
  const latest = useRef({ title: '', tagIds: [] as number[] });
  latest.current = { title, tagIds };
  const draftTimer = useRef<number | undefined>(undefined);

  // 停止输入 2 秒后自动存草稿;新建卡片用 cardId = 0
  const scheduleDraft = useCallback(() => {
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      const { title: t, tagIds: ids } = latest.current;
      api.draftSave(kbId, cardId ?? 0, t, content.current.json, ids).catch(() => {});
    }, 2000);
  }, [kbId, cardId]);
  const dropDraft = useCallback(() => {
    window.clearTimeout(draftTimer.current);
    api.draftDelete(kbId, cardId ?? 0).catch(() => {});
  }, [kbId, cardId]);
  const markDirty = () => {
    setDirty(true);
    scheduleDraft();
  };

  const loadTags = useCallback(() => api.tagList(kbId).then(setAllTags), [kbId]);

  useEffect(() => {
    let cancelled = false;
    loadTags().catch((e) => message.error(errMsg(e)));
    setDirty(false);
    setPendingDraft(null);
    forceVersion.current = false;
    if (cardId === null) {
      setTitle('');
      setTagIds([]);
      content.current = { json: '', text: '' };
      setInitial('');
      api
        .draftGet(kbId, 0)
        .then((d) => {
          if (!cancelled && d) setPendingDraft(d);
        })
        .catch(() => {});
    } else {
      setInitial(null);
      api
        .cardGet(cardId)
        .then((c) => {
          if (cancelled) return;
          setTitle(c.title);
          setTagIds(c.tags.map((t) => t.id));
          content.current = { json: c.contentJson, text: '' };
          setInitial(c.contentJson);
          // 草稿比卡片更新才有意义;否则是已保存后残留的旧草稿,直接清掉
          return api.draftGet(kbId, cardId).then((d) => {
            if (!d || cancelled) return;
            if (d.updatedAt > c.updatedAt) setPendingDraft(d);
            else api.draftDelete(kbId, cardId).catch(() => {});
          });
        })
        .catch((e) => message.error(errMsg(e)));
    }
    return () => {
      cancelled = true;
      window.clearTimeout(draftTimer.current);
    };
  }, [kbId, cardId, loadTags, message]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const { json, text } = content.current;
      if (cardId === null) {
        const c = await api.cardCreate(kbId, title, json, text, tagIds);
        dropDraft();
        message.success('已创建');
        nav(`/kb/${kbId}/card/${c.id}`, { replace: true });
      } else {
        await api.cardUpdate(cardId, title, json, text, tagIds, forceVersion.current);
        forceVersion.current = false;
        dropDraft();
        message.success('已保存');
        setSavedRevision((revision) => revision + 1);
      }
      setDirty(false);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }, [cardId, kbId, title, tagIds, nav, message, dropDraft]);

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

  useEffect(() => {
    setUnsaved(dirty);
  }, [dirty]);
  useEffect(() => {
    const off = registerUnsavedAsk((go) => setLeaveGo(() => go));
    return () => {
      off();
      setUnsaved(false);
    };
  }, []);

  // 把历史版本载入编辑器:标题和正文被替换,标记为未保存,用户点保存后才真正生效
  const restoreVersion = (v: CardVersion) => {
    setTitle(v.title);
    content.current = { json: v.contentJson, text: '' };
    setInitial(v.contentJson);
    setEditorRev((n) => n + 1);
    forceVersion.current = true;
    markDirty();
    setHistoryOpen(false);
    message.info('已载入历史版本,点击保存后生效');
  };

  // 恢复草稿:把草稿载入编辑器,仍然是未保存状态
  const restoreDraft = (d: Draft) => {
    setTitle(d.title);
    setTagIds(d.tagIds.filter((id) => allTags.some((t) => t.id === id)));
    content.current = { json: d.contentJson, text: '' };
    setInitial(d.contentJson);
    setEditorRev((n) => n + 1);
    forceVersion.current = true;
    setPendingDraft(null);
    markDirty();
    message.info('已恢复草稿,点击保存后生效');
  };
  const discardDraft = () => {
    dropDraft();
    setPendingDraft(null);
  };

  const back = () => guardNav(() => nav(`/kb/${kbId}`));

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <IconBtn tip="返回" icon={<ArrowLeftOutlined />} onClick={back} />
        <Space>
          {dirty && (
            <Tooltip title="有未保存的修改">
              <Badge status="warning" />
            </Tooltip>
          )}
          <IconBtn tip="保存 (Ctrl+S)" type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} />
          {cardId !== null && <IconBtn tip="历史版本" icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)} />}
          {cardId !== null && (
            <IconBtn tip="在地图中查看" icon={<ApartmentOutlined />} onClick={() => guardNav(() => nav(`/kb/${kbId}/graph?focus=${cardId}`))} />
          )}
        </Space>
      </div>

      {/* 第一行:标题 : 标签 = 2 : 1,与正文/关联区域对齐 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={16}>
          <Input
            size="large"
            placeholder="卡片标题"
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
          />
        </Col>
        <Col xs={24} lg={8} className="title-row">
          <TagSelector
            kbId={kbId}
            allTags={allTags}
            value={tagIds}
            size="large"
            onChange={(ids) => {
              setTagIds(ids);
              markDirty();
            }}
            onTagsChanged={loadTags}
          />
        </Col>
      </Row>

      {/* 第二行:正文 : 关联卡片 = 2 : 1,为关联列表留出足够宽度 */}
      <Row gutter={16} style={{ flex: 1, minHeight: 360 }}>
        <Col xs={24} lg={16} className="fill" style={{ height: '100%' }}>
          {initial !== null && (
            <RichEditor
              key={`${cardId ?? 'new'}-${editorRev}`}
              initial={initial}
              kbId={kbId}
              currentCardId={cardId ?? undefined}
              onOpenCard={(targetId) => guardNav(() => nav(`/kb/${kbId}/card/${targetId}`))}
              onReady={(json, text) => {
                content.current = { json, text };
              }}
              onChange={(json, text) => {
                content.current = { json, text };
                markDirty();
              }}
            />
          )}
        </Col>
        <Col xs={24} lg={8} style={{ height: '100%', minWidth: 0 }}>
          <Card
            size="small"
            title="关联与引用"
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, minHeight: 0, overflow: 'auto' } }}
          >
            {cardId === null ? (
              <Hint text="保存卡片后可添加关联" />
            ) : (
              <LinkPanel kbId={kbId} cardId={cardId} refreshKey={savedRevision} />
            )}
          </Card>
        </Col>
      </Row>

      {cardId !== null && (
        <VersionHistory
          open={historyOpen}
          cardId={cardId}
          dirty={dirty}
          onClose={() => setHistoryOpen(false)}
          onRestore={restoreVersion}
        />
      )}

      <Modal
        open={pendingDraft !== null}
        title="发现未保存的草稿"
        width={420}
        centered
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={
          <ModalFooter
            onOk={() => pendingDraft && restoreDraft(pendingDraft)}
            onCancel={discardDraft}
            okTip="恢复草稿"
            cancelTip="丢弃草稿"
          />
        }
      >
        {pendingDraft && (
          <div>
            上次编辑未保存就退出了,草稿时间 {new Date(pendingDraft.updatedAt).toLocaleString()}
            {pendingDraft.title ? `,标题“${pendingDraft.title}”` : ''}。是否恢复?
          </div>
        )}
      </Modal>

      <Modal
        open={leaveGo !== null}
        title="有未保存的修改,确定离开?"
        width={420}
        centered
        onCancel={() => setLeaveGo(null)}
        footer={
          <ModalFooter
            onOk={() => {
              const go = leaveGo;
              setLeaveGo(null);
              setUnsaved(false);
              dropDraft();
              go?.();
            }}
            onCancel={() => setLeaveGo(null)}
            okTip="离开"
            cancelTip="继续编辑"
          />
        }
      />
    </div>
  );
}
