import { ArrowLeftOutlined, ClearOutlined, DeleteOutlined, UndoOutlined } from '@ant-design/icons';
import { App, List, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import Confirm from '../components/Confirm';
import Hint, { EmptyHint } from '../components/Hint';
import IconBtn from '../components/IconBtn';
import type { TrashList } from '../types';

/** 与后端 trash::RETENTION_DAYS 保持一致 */
const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

const leftDays = (deletedAt: number) =>
  Math.max(0, Math.ceil((deletedAt + RETENTION_DAYS * DAY_MS - Date.now()) / DAY_MS));

export default function Trash() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const [data, setData] = useState<TrashList>({ kbs: [], cards: [] });
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(
    () =>
      api
        .trashList()
        .then(setData)
        .catch((e) => message.error(errMsg(e)))
        .finally(() => setLoaded(true)),
    [message],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const run = (task: Promise<unknown>, ok: string) =>
    task
      .then(() => {
        message.success(ok);
        return reload();
      })
      .catch((e) => message.error(errMsg(e)));

  const purge = (onConfirm: () => void) => (
    <Confirm title="永久删除?不可恢复" okButtonProps={{ danger: true }} onConfirm={onConfirm}>
      <IconBtn tip="永久删除" danger type="text" icon={<DeleteOutlined />} />
    </Confirm>
  );

  const empty = data.kbs.length === 0 && data.cards.length === 0;

  return (
    <div className="page">
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <IconBtn tip="返回" icon={<ArrowLeftOutlined />} onClick={() => nav('/')} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            回收站
          </Typography.Title>
          <Hint text={`删除的知识库和卡片会在这里保留 ${RETENTION_DAYS} 天,超期后在下次启动应用时自动永久删除`} />
        </Space>
        {!empty && (
          <Confirm
            title="清空回收站?所有内容将永久删除,不可恢复"
            okButtonProps={{ danger: true }}
            onConfirm={() => run(api.trashEmpty(), '已清空回收站')}
          >
            <IconBtn tip="清空回收站" danger icon={<ClearOutlined />} />
          </Confirm>
        )}
      </div>

      {!loaded ? null : empty ? (
        <EmptyHint text="回收站是空的" />
      ) : (
        <>
          {data.kbs.length > 0 && (
            <>
              <Typography.Title level={5}>知识库</Typography.Title>
              <List
                bordered
                style={{ marginBottom: 24 }}
                dataSource={data.kbs}
                renderItem={(kb) => (
                  <List.Item
                    actions={[
                      <IconBtn
                        key="r"
                        tip="恢复"
                        type="text"
                        icon={<UndoOutlined />}
                        onClick={() => run(api.trashRestoreKb(kb.id), '已恢复')}
                      />,
                      <span key="d">{purge(() => run(api.trashPurgeKb(kb.id), '已永久删除'))}</span>,
                    ]}
                  >
                    <List.Item.Meta
                      title={kb.name}
                      description={
                        <Space size={12} wrap>
                          <span>卡片:{kb.cardCount}</span>
                          <span>剩余 {leftDays(kb.deletedAt)} 天</span>
                          {kb.description && <span>{kb.description}</span>}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </>
          )}
          {data.cards.length > 0 && (
            <>
              <Typography.Title level={5}>卡片</Typography.Title>
              <List
                bordered
                dataSource={data.cards}
                renderItem={(c) => (
                  <List.Item
                    actions={[
                      <IconBtn
                        key="r"
                        tip={c.kbTrashed ? '请先恢复所属知识库' : '恢复'}
                        type="text"
                        disabled={c.kbTrashed}
                        icon={<UndoOutlined />}
                        onClick={() => run(api.trashRestoreCard(c.id), '已恢复')}
                      />,
                      <span key="d">{purge(() => run(api.trashPurgeCard(c.id), '已永久删除'))}</span>,
                    ]}
                  >
                    <List.Item.Meta
                      title={c.title}
                      description={
                        <Space size={12} wrap>
                          <Tag style={{ margin: 0 }}>{c.kbName}</Tag>
                          {c.kbTrashed && <Tag color="orange" style={{ margin: 0 }}>所属知识库在回收站</Tag>}
                          <span>剩余 {leftDays(c.deletedAt)} 天</span>
                          {c.excerpt && <span>{c.excerpt}</span>}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
