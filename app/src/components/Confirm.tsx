import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { Popconfirm } from 'antd';
import type { PopconfirmProps } from 'antd';

/** 确认气泡:“确定/取消”统一为圆形图标按钮(✓ / ✕),其余属性与 antd Popconfirm 相同 */
export default function Confirm({ okButtonProps, cancelButtonProps, ...rest }: PopconfirmProps) {
  return (
    <Popconfirm
      okText={<CheckOutlined />}
      cancelText={<CloseOutlined />}
      okButtonProps={{ shape: 'circle', size: 'small', ...okButtonProps }}
      cancelButtonProps={{ shape: 'circle', size: 'small', ...cancelButtonProps }}
      {...rest}
    />
  );
}
