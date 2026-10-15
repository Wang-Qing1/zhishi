import { ColumnWidthOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Dropdown, Image as AntImage } from 'antd';
import { useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { toImgUrl } from '../images';
import IconBtn from './IconBtn';

const MIN_WIDTH = 40;

const PRESETS = [
  { key: '240', label: '小(240px)' },
  { key: '480', label: '中(480px)' },
  { key: '720', label: '大(720px)' },
  { key: 'fit', label: '适应宽度' },
  { key: 'orig', label: '原始大小' },
];

/**
 * 编辑器里的图片:选中或悬停时右上角显示操作条(查看大图/大小预设/删除),
 * 选中时右下角有拖拽手柄等比缩放。只读模式下由样式隐藏所有编辑操作。
 */
export default function ImageView({ node, selected, deleteNode, updateAttributes }: NodeViewProps) {
  const [preview, setPreview] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // 拖拽过程中的实时宽度,松开鼠标后才写入文档
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const src = toImgUrl(String(node.attrs.src ?? ''));
  const width = dragWidth ?? (node.attrs.width as number | null);

  /** 编辑区内容可用宽度 */
  const maxWidth = () => {
    const box = imgRef.current?.closest('.tiptap') as HTMLElement | null;
    return Math.max(80, (box?.clientWidth ?? 800) - 32);
  };

  const startResize = (e: ReactMouseEvent) => {
    // 阻止浏览器把这次按下当成拖动图片或选中文字
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    const max = maxWidth();
    let last = startW;
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      moved = true;
      last = Math.round(Math.min(max, Math.max(MIN_WIDTH, startW + ev.clientX - startX)));
      setDragWidth(last);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragWidth(null);
      if (moved) updateAttributes({ width: last });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const applyPreset = (key: string) => {
    if (key === 'orig') updateAttributes({ width: null });
    else if (key === 'fit') updateAttributes({ width: Math.round(maxWidth()) });
    else updateAttributes({ width: Number(key) });
  };

  return (
    <NodeViewWrapper className={`img-node${selected ? ' selected' : ''}${menuOpen ? ' menu-open' : ''}`}>
      <img
        ref={imgRef}
        src={src}
        alt={node.attrs.alt ?? ''}
        title={node.attrs.title ?? undefined}
        style={width ? { width } : undefined}
        draggable={false}
      />
      <span className="img-bar" contentEditable={false} onMouseDown={(e) => e.preventDefault()}>
        <IconBtn tip="查看大图" type="text" size="small" icon={<EyeOutlined />} onClick={() => setPreview(true)} />
        <span className="img-edit">
          <Dropdown
            trigger={['click']}
            onOpenChange={setMenuOpen}
            menu={{ items: PRESETS, onClick: ({ key }) => applyPreset(key) }}
          >
            <IconBtn tip="调整大小" type="text" size="small" icon={<ColumnWidthOutlined />} />
          </Dropdown>
          <IconBtn tip="删除图片" type="text" size="small" icon={<DeleteOutlined />} onClick={() => deleteNode()} />
        </span>
      </span>
      <span
        className="img-handle img-edit"
        contentEditable={false}
        onMouseDown={startResize}
        onDragStart={(e) => e.preventDefault()}
      />
      <AntImage
        style={{ display: 'none' }}
        src={src}
        preview={{ visible: preview, src, onVisibleChange: setPreview }}
      />
    </NodeViewWrapper>
  );
}
