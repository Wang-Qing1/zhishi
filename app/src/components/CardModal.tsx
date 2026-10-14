import { ExpandAltOutlined } from '@ant-design/icons';
import { App, Input, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api, errMsg } from '../api';
import type { Card } from '../types';
import IconBtn from './IconBtn';
import ModalFooter from './ModalFooter';
import RichEditor from './RichEditor';

interface Props {
  /** 为 null 时弹窗关闭 */
  cardId: number | null;
  onClose: () => void;
  /** 保存成功后回调(用于刷新调用方数据) */
  onSaved: () => void;
  /** 跳转到完整的卡片编辑页 */
  onOpenPage: (cardId: number) => void;
}

/** 弹窗查看/编辑卡片:标题 + 富文本内容(标签保持不变) */
export default function CardModal({ cardId, onClose, onSaved, onOpenPage }: Props) {
  const { message } = App.useApp();
  const [card, setCard] = useState<Card | null>(null);
  const [title, setTitle] = useState('');
  const content = useRef({ json: '', text: '' });

  useEffect(() => {
    setCard(null);
    if (cardId === null) return;
    api
      .cardGet(cardId)
      .then((c) => {
        content.current = { json: c.contentJson, text: '' };
        setTitle(c.title);
        setCard(c);
      })
      .catch((e) => message.error(errMsg(e)));
  }, [cardId, message]);

  const save = async () => {
    if (!card) return;
    try {
      await api.cardUpdate(card.id, title, content.current.json, content.current.text, card.tags.map((t) => t.id));
      message.success('已保存');
      onSaved();
      onClose();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={cardId !== null}
      title="编辑卡片"
      width={880}
      centered
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      footer={
        <ModalFooter
          onOk={save}
          onCancel={onClose}
          extra={
            <IconBtn
              tip="打开完整编辑页"
              icon={<ExpandAltOutlined />}
              onClick={() => cardId !== null && onOpenPage(cardId)}
            />
          }
        />
      }
    >
      {card && (
        <>
          <Input
            size="large"
            placeholder="卡片标题"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <RichEditor
            key={card.id}
            initial={card.contentJson}
            onReady={(json, text) => {
              content.current = { json, text };
            }}
            onChange={(json, text) => {
              content.current = { json, text };
            }}
          />
        </>
      )}
    </Modal>
  );
}
