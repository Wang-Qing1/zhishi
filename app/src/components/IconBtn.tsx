import { Button, Tooltip } from 'antd';
import type { ButtonProps } from 'antd';
import { forwardRef } from 'react';

interface Props extends Omit<ButtonProps, 'shape' | 'children'> {
  /** 悬浮提示文字(同时作为无障碍 aria-label) */
  tip: string;
}

/** 圆形图标按钮:只显示图标,文字说明在鼠标悬浮时以泡泡提示显示。转发 ref,可直接包在 Popconfirm 里。 */
const IconBtn = forwardRef<HTMLButtonElement, Props>(({ tip, ...rest }, ref) => (
  <Tooltip title={tip}>
    <Button ref={ref} shape="circle" aria-label={tip} {...rest} />
  </Tooltip>
));
IconBtn.displayName = 'IconBtn';

export default IconBtn;
