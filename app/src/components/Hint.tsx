import { InfoCircleOutlined } from '@ant-design/icons';
import { Empty, Tooltip } from 'antd';

/** 辅助/提示文字统一用“信息图标 + 悬浮泡泡”展示,不占页面空间 */
export default function Hint({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <InfoCircleOutlined style={{ color: '#999', cursor: 'help' }} />
    </Tooltip>
  );
}

/** 空状态:只显示空图标,说明文字在悬浮时显示 */
export function EmptyHint({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <div>
        <Empty description={false} />
      </div>
    </Tooltip>
  );
}
