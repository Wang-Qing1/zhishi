import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import IconBtn from './IconBtn';

interface Props {
  onOk: () => void;
  onCancel: () => void;
  okTip?: string;
  cancelTip?: string;
  /** 靠左显示的额外操作(如删除) */
  extra?: ReactNode;
}

/** 弹窗底部:圆形图标的“取消/确定”按钮,文字在悬浮提示中 */
export default function ModalFooter({ onOk, onCancel, okTip = '确定', cancelTip = '取消', extra }: Props) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
      {extra && <div style={{ marginRight: 'auto' }}>{extra}</div>}
      <IconBtn tip={cancelTip} icon={<CloseOutlined />} onClick={onCancel} />
      <IconBtn tip={okTip} type="primary" icon={<CheckOutlined />} onClick={onOk} />
    </div>
  );
}
