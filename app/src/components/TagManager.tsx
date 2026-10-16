import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { App, ColorPicker, Input, Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { errMsg } from '../api';
import type { Tag } from '../types';
import Confirm from './Confirm';
import { EmptyHint } from './Hint';
import IconBtn from './IconBtn';
import { PALETTE } from './TagSelector';

interface Props {
  open: boolean;
  tags: Tag[];
  onClose: () => void;
  /** 创建/删除失败时抛出错误,由这里统一提示 */
  onCreate: (name: string, color: string) => Promise<void>;
  onDelete: (tag: Tag) => Promise<void>;
  /** 打开“编辑标签”弹窗(改名/改颜色) */
  onEdit: (tag: Tag) => void;
  /** 把卡片列表筛选成这个标签 */
  onFilter: (tag: Tag) => void;
}

/** 标签管理:集中查看、新建、改名/改色、删除本知识库的所有标签 */
export default function TagManager({ open, tags, onClose, onCreate, onDelete, onEdit, onFilter }: Props) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);

  // 每次打开时重置输入,默认颜色按现有标签数量在调色板里轮换
  useEffect(() => {
    if (!open) return;
    setName('');
    setFilter('');
    setColor(PALETTE[tags.length % PALETTE.length]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const add = async () => {
    const n = name.trim();
    if (!n) {
      message.error('请输入标签名称');
      return;
    }
    if (adding) return;
    setAdding(true);
    try {
      await onCreate(n, color);
      setName('');
      setColor(PALETTE[(tags.length + 1) % PALETTE.length]);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (t: Tag) => {
    try {
      await onDelete(t);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const kw = filter.trim().toLowerCase();
  const shown = kw ? tags.filter((t) => t.name.toLowerCase().includes(kw)) : tags;

  return (
    <Modal open={open} title="标签管理" width={520} centered destroyOnClose footer={null} onCancel={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <ColorPicker value={color} onChange={(c) => setColor(c.toHexString())} disabledAlpha />
        <Input
          placeholder="新建标签,输入名称后回车"
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={add}
        />
        <IconBtn tip="添加标签" type="primary" icon={<PlusOutlined />} loading={adding} onClick={add} />
      </div>

      {tags.length > 0 && (
        <Input
          allowClear
          placeholder="搜索标签"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginBottom: 8 }}
        />
      )}

      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {tags.length === 0 ? (
          <EmptyHint text="这个知识库还没有标签,在上方输入名称即可创建" />
        ) : shown.length === 0 ? (
          <EmptyHint text="没有匹配的标签" />
        ) : (
          shown.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 4px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.color, flex: 'none' }} />
              <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                {t.name}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ flex: 'none', fontSize: 12 }}>
                {t.cardCount} 张卡片
              </Typography.Text>
              <IconBtn tip="查看这个标签的卡片" size="small" type="text" icon={<EyeOutlined />} onClick={() => onFilter(t)} />
              <IconBtn tip="编辑" size="small" type="text" icon={<EditOutlined />} onClick={() => onEdit(t)} />
              <Confirm
                title={`删除标签「${t.name}」?卡片不会被删除${t.cardCount ? `,${t.cardCount} 张卡片将失去该标签` : ''}`}
                okButtonProps={{ danger: true }}
                onConfirm={() => remove(t)}
              >
                <IconBtn tip="删除" size="small" type="text" danger icon={<DeleteOutlined />} />
              </Confirm>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
