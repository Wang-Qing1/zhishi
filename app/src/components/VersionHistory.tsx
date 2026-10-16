import { App, Col, List, Modal, Row, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import type { CardVersion, CardVersionSummary } from '../types';
import ContentPreview from './ContentPreview';
import { EmptyHint } from './Hint';
import ModalFooter from './ModalFooter';

interface Props {
  open: boolean;
  cardId: number;
  /** 编辑器里是否有未保存的修改(恢复会覆盖它们) */
  dirty: boolean;
  onClose: () => void;
  /** 把选中的版本载入编辑器(仍需要用户点保存才生效) */
  onRestore: (version: CardVersion) => void;
}

/** 历史版本:左侧时间列表,右侧只读预览 */
export default function VersionHistory({ open, cardId, dirty, onClose, onRestore }: Props) {
  const { message, modal } = App.useApp();
  const [list, setList] = useState<CardVersionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState<CardVersion | null>(null);

  const pick = useCallback(
    (id: number) =>
      api
        .versionGet(id)
        .then(setCurrent)
        .catch((e) => message.error(errMsg(e))),
    [message],
  );

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setCurrent(null);
    api
      .versionList(cardId)
      .then((l) => {
        setList(l);
        if (l.length > 0) pick(l[0].id);
      })
      .catch((e) => message.error(errMsg(e)))
      .finally(() => setLoaded(true));
  }, [open, cardId, pick, message]);

  const restore = () => {
    if (!current) return;
    const go = () => onRestore(current);
    if (!dirty) return go();
    modal.confirm({
      title: '恢复到编辑器?',
      content: '编辑器中未保存的修改将被覆盖。',
      okText: '恢复',
      cancelText: '取消',
      onOk: go,
    });
  };

  return (
    <Modal
      open={open}
      title="历史版本"
      width={960}
      centered
      destroyOnClose
      onCancel={onClose}
      footer={<ModalFooter onOk={restore} onCancel={onClose} okTip="恢复到编辑器" cancelTip="关闭" />}
    >
      {loaded && list.length === 0 ? (
        <EmptyHint text="还没有历史版本(修改并保存后会自动生成,距上一个版本不足 10 分钟的保存不会重复记录)" />
      ) : (
        <Row gutter={16}>
          <Col span={8}>
            <List
              size="small"
              bordered
              style={{ height: 460, overflow: 'auto' }}
              dataSource={list}
              renderItem={(v) => (
                <List.Item
                  onClick={() => pick(v.id)}
                  style={{ cursor: 'pointer', background: current?.id === v.id ? 'var(--sel-bg)' : undefined }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div>{new Date(v.savedAt).toLocaleString()}</div>
                    <Typography.Text type="secondary" ellipsis style={{ display: 'block' }}>
                      {v.title}
                    </Typography.Text>
                  </div>
                </List.Item>
              )}
            />
          </Col>
          <Col span={16}>
            <div style={{ height: 460, overflow: 'auto', border: '1px solid var(--border-ctrl)', borderRadius: 8, padding: '8px 4px' }}>
              {current && (
                <>
                  <Typography.Title level={5} style={{ margin: '4px 16px 0' }}>
                    {current.title}
                  </Typography.Title>
                  <ContentPreview key={current.id} json={current.contentJson} />
                </>
              )}
            </div>
          </Col>
        </Row>
      )}
    </Modal>
  );
}
