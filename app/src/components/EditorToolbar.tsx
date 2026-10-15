import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  ClearOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DownOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FontColorsOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  HighlightOutlined,
  ItalicOutlined,
  LeftOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  OrderedListOutlined,
  PictureOutlined,
  RedoOutlined,
  RightOutlined,
  SearchOutlined,
  SmileOutlined,
  StrikethroughOutlined,
  TableOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { App, Button, Input, Menu, Modal, Popover, Tooltip } from 'antd';
import type { ButtonProps } from 'antd';
import type { Editor } from '@tiptap/react';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api, errMsg } from '../api';
import { readImage } from '../images';
import ModalFooter from './ModalFooter';

const TEXT_COLORS = ['#000000', '#e03131', '#f08c00', '#2f9e44', '#1c7ed6', '#7048e8', '#c2255c', '#868e96'];
const HL_COLORS = ['#fff3bf', '#ffd8a8', '#d3f9d8', '#c5f6fa', '#d0ebff', '#e5dbff', '#ffdeeb', '#e9ecef'];
const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '😘', '😋', '😎',
  '🤔', '😐', '😴', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '🎉', '🔥', '⭐', '❤️', '✅', '❌',
];
const SPECIAL = [
  '©', '®', '™', '°', '±', '×', '÷', '≠', '≤', '≥', '∞', 'π', '→', '←', '↑', '↓',
  '★', '☆', '✓', '✗', '§', '¶', '€', '£', '¥', '‰', '√', '∑', 'Ω', 'μ', 'α', 'β',
];

/** antd 没有的图标用简短字符代替 */
const glyph = (s: string) => <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>{s}</span>;

interface BtnProps extends Omit<ButtonProps, 'type' | 'size' | 'shape' | 'icon' | 'children'> {
  tip: string;
  icon: ReactNode;
  active?: boolean;
  chevron?: boolean;
}

/** 工具栏图标按钮:无外框、无内外边距,悬浮显示文字;转发 ref 以便包在 Popover 里 */
const Btn = forwardRef<HTMLButtonElement, BtnProps>(({ tip, icon, active, chevron, style, ...rest }, ref) => (
  <Tooltip title={tip}>
    <Button
      ref={ref}
      type="text"
      size="small"
      aria-label={tip}
      style={{
        padding: 0,
        margin: 0,
        width: chevron ? 38 : 30,
        height: 30,
        color: active ? '#1677ff' : undefined,
        ...style,
      }}
      {...rest}
    >
      {icon}
      {chevron && <DownOutlined style={{ fontSize: 9, marginLeft: 4 }} />}
    </Button>
  </Tooltip>
));
Btn.displayName = 'Btn';

/** 带下拉箭头的按钮,点击弹出面板;content 收到 close 用于选择后关闭 */
function PopBtn({ content, ...btn }: BtnProps & { content: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open && !btn.disabled}
      onOpenChange={setOpen}
      trigger="click"
      arrow={false}
      placement="bottomLeft"
      content={content(() => setOpen(false))}
    >
      <Btn {...btn} chevron />
    </Popover>
  );
}

const cell: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: '1px solid #d9d9d9',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
};

function Swatches({ colors, onPick, onClear }: { colors: string[]; onPick: (c: string) => void; onClear: () => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 24px)', gap: 8 }}>
      {colors.map((c) => (
        <span key={c} onClick={() => onPick(c)} style={{ ...cell, background: c }} />
      ))}
      <span onClick={onClear} title="清除" style={cell}>
        <CloseOutlined />
      </span>
    </div>
  );
}

function CharGrid({ chars, onPick }: { chars: string[]; onPick: (c: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 30px)', gap: 2 }}>
      {chars.map((ch) => (
        <span key={ch} className="char-cell" onClick={() => onPick(ch)}>
          {ch}
        </span>
      ))}
    </div>
  );
}

const colorIcon = (icon: ReactNode, color: string) => (
  <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, gap: 1 }}>
    {icon}
    <span style={{ width: 14, height: 3, borderRadius: 1, background: color }} />
  </span>
);

interface Props {
  editor: Editor;
  preview: boolean;
  fullscreen: boolean;
  onPreview: () => void;
  onFullscreen: () => void;
}

export default function EditorToolbar({ editor, preview, fullscreen, onPreview, onFullscreen }: Props) {
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  // 单行显示:放不下时两端出现箭头按钮,点击左右滚动(不显示滚动条)
  const [st, setSt] = useState({ overflow: false, left: false, right: false });
  const update = useCallback(() => {
    const bar = barRef.current;
    const sc = scrollRef.current;
    const items = itemsRef.current;
    if (!bar || !sc || !items) return;
    const overflow = items.scrollWidth > bar.clientWidth - 16;
    setSt({
      overflow,
      left: overflow && sc.scrollLeft > 1,
      right: overflow && sc.scrollLeft + sc.clientWidth < items.scrollWidth - 1,
    });
  }, []);
  useEffect(() => {
    update();
    const ro = new ResizeObserver(update);
    if (barRef.current) ro.observe(barRef.current);
    return () => ro.disconnect();
  }, [update]);
  const slide = (d: number) => scrollRef.current?.scrollBy({ left: d, behavior: 'smooth' });
  const arrowStyle = (visible: boolean) => ({
    flex: 'none' as const,
    display: st.overflow ? undefined : 'none',
    visibility: visible ? ('visible' as const) : ('hidden' as const),
  });
  const c = () => editor.chain().focus();
  const ro = preview; // 预览模式下除预览/全屏外都不可用
  const textColor = (editor.getAttributes('textStyle').color as string | undefined) ?? '#000000';
  const hlColor = (editor.getAttributes('highlight').color as string | undefined) ?? '#fff3bf';

  const pickImage = (file?: File) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      message.warning('图片不能超过 3MB');
      return;
    }
    // 图片由后端落盘,正文里只存 zhishi-img:// 引用
    readImage(file)
      .then(({ base64, ext }) => api.imageSave(base64, ext))
      .then((src) => c().setImage({ src }).run())
      .catch((e) => message.error(errMsg(e)));
  };

  // 查找/链接的输入弹窗(替代系统 prompt)
  const [dlg, setDlg] = useState<{ kind: 'find' | 'link'; value: string } | null>(null);

  const find = () => setDlg({ kind: 'find', value: '' });

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    setDlg({ kind: 'link', value: prev ?? 'https://' });
  };

  const confirmDlg = () => {
    if (!dlg) return;
    const { kind, value } = dlg;
    setDlg(null);
    if (kind === 'find') {
      if (!value) return;
      const w = window as unknown as { find?: (s: string, cs?: boolean, bw?: boolean, wrap?: boolean) => boolean };
      if (!w.find?.(value, false, false, true)) message.info('未找到');
    } else if (value.trim() === '') {
      c().unsetLink().run();
    } else {
      c().extendMarkRange('link').setLink({ href: value.trim() }).run();
    }
  };

  return (
    <div className="editor-toolbar" ref={barRef}>
      <Btn tip="向左" icon={<LeftOutlined />} onClick={() => slide(-240)} style={arrowStyle(st.left)} />
      <div className="editor-toolbar-scroll" ref={scrollRef} onScroll={update}>
      <div className="editor-toolbar-items" ref={itemsRef}>
      <PopBtn
        tip="标题"
        icon={glyph('H')}
        disabled={ro}
        active={editor.isActive('heading')}
        content={(close) => (
          <Menu
            selectable={false}
            style={{ border: 'none', minWidth: 110 }}
            items={[
              { key: 'p', label: '正文' },
              { key: '1', label: '一级标题' },
              { key: '2', label: '二级标题' },
              { key: '3', label: '三级标题' },
            ]}
            onClick={({ key }) => {
              if (key === 'p') c().setParagraph().run();
              else c().toggleHeading({ level: Number(key) as 1 | 2 | 3 }).run();
              close();
            }}
          />
        )}
      />
      <PopBtn
        tip="字体颜色"
        icon={colorIcon(<FontColorsOutlined />, textColor)}
        disabled={ro}
        content={(close) => (
          <Swatches
            colors={TEXT_COLORS}
            onPick={(col) => { c().setColor(col).run(); close(); }}
            onClear={() => { c().unsetColor().run(); close(); }}
          />
        )}
      />
      <PopBtn
        tip="背景高亮"
        icon={colorIcon(<HighlightOutlined />, hlColor)}
        disabled={ro}
        content={(close) => (
          <Swatches
            colors={HL_COLORS}
            onPick={(col) => { c().setHighlight({ color: col }).run(); close(); }}
            onClear={() => { c().unsetHighlight().run(); close(); }}
          />
        )}
      />
      <Btn tip="加粗" icon={<BoldOutlined />} disabled={ro} active={editor.isActive('bold')} onClick={() => c().toggleBold().run()} />
      <Btn tip="斜体" icon={<ItalicOutlined />} disabled={ro} active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()} />
      <Btn tip="下划线" icon={<UnderlineOutlined />} disabled={ro} active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()} />
      <Btn tip="删除线" icon={<StrikethroughOutlined />} disabled={ro} active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()} />
      <Btn tip="左对齐" icon={<AlignLeftOutlined />} disabled={ro} active={editor.isActive({ textAlign: 'left' })} onClick={() => c().setTextAlign('left').run()} />
      <Btn tip="居中" icon={<AlignCenterOutlined />} disabled={ro} active={editor.isActive({ textAlign: 'center' })} onClick={() => c().setTextAlign('center').run()} />
      <Btn tip="右对齐" icon={<AlignRightOutlined />} disabled={ro} active={editor.isActive({ textAlign: 'right' })} onClick={() => c().setTextAlign('right').run()} />
      <Btn tip="两端对齐" icon={<MenuOutlined />} disabled={ro} active={editor.isActive({ textAlign: 'justify' })} onClick={() => c().setTextAlign('justify').run()} />
      <Btn tip="减少缩进" icon={<MenuFoldOutlined />} disabled={ro || !editor.can().liftListItem('listItem')} onClick={() => c().liftListItem('listItem').run()} />
      <Btn tip="增加缩进" icon={<MenuUnfoldOutlined />} disabled={ro || !editor.can().sinkListItem('listItem')} onClick={() => c().sinkListItem('listItem').run()} />
      <Btn tip="引用" icon={glyph('“')} disabled={ro} active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()} />
      <Btn tip="代码块" icon={glyph('{;}')} disabled={ro} active={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()} />
      <Btn tip="行内代码" icon={glyph('<>')} disabled={ro} active={editor.isActive('code')} onClick={() => c().toggleCode().run()} />
      <Btn tip="无序列表" icon={<UnorderedListOutlined />} disabled={ro} active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()} />
      <Btn tip="有序列表" icon={<OrderedListOutlined />} disabled={ro} active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()} />
      <Btn tip="链接" icon={<LinkOutlined />} disabled={ro} active={editor.isActive('link')} onClick={setLink} />
      <Btn tip="图片" icon={<PictureOutlined />} disabled={ro} onClick={() => fileRef.current?.click()} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          pickImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <PopBtn
        tip="表格"
        icon={<TableOutlined />}
        disabled={ro}
        active={editor.isActive('table')}
        content={(close) => (
          <Menu
            selectable={false}
            style={{ border: 'none', minWidth: 140 }}
            items={[
              { key: 'insert', label: '插入表格(3×3)' },
              { key: 'addRow', label: '在下方插入行', disabled: !editor.can().addRowAfter() },
              { key: 'addCol', label: '在右侧插入列', disabled: !editor.can().addColumnAfter() },
              { key: 'delRow', label: '删除行', disabled: !editor.can().deleteRow() },
              { key: 'delCol', label: '删除列', disabled: !editor.can().deleteColumn() },
              { key: 'delTable', label: '删除表格', danger: true, disabled: !editor.can().deleteTable() },
            ]}
            onClick={({ key }) => {
              const ch = c();
              if (key === 'insert') ch.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
              else if (key === 'addRow') ch.addRowAfter().run();
              else if (key === 'addCol') ch.addColumnAfter().run();
              else if (key === 'delRow') ch.deleteRow().run();
              else if (key === 'delCol') ch.deleteColumn().run();
              else if (key === 'delTable') ch.deleteTable().run();
              close();
            }}
          />
        )}
      />
      <PopBtn
        tip="表情"
        icon={<SmileOutlined />}
        disabled={ro}
        content={(close) => <CharGrid chars={EMOJIS} onPick={(ch) => { c().insertContent(ch).run(); close(); }} />}
      />
      <PopBtn
        tip="特殊字符"
        icon={glyph('Ω')}
        disabled={ro}
        content={(close) => <CharGrid chars={SPECIAL} onPick={(ch) => { c().insertContent(ch).run(); close(); }} />}
      />
      <Btn tip="查找" icon={<SearchOutlined />} onClick={find} />
      <Btn tip="插入当前时间" icon={<ClockCircleOutlined />} disabled={ro} onClick={() => c().insertContent(new Date().toLocaleString('zh-CN')).run()} />
      <Btn tip={preview ? '退出预览' : '预览'} icon={preview ? <EyeInvisibleOutlined /> : <EyeOutlined />} active={preview} onClick={onPreview} />
      <Btn tip={fullscreen ? '退出全屏' : '全屏'} icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={onFullscreen} />
      <Btn tip="清除格式" icon={<ClearOutlined />} disabled={ro} onClick={() => c().clearNodes().unsetAllMarks().run()} />
      <Btn tip="撤销" icon={<UndoOutlined />} disabled={ro || !editor.can().undo()} onClick={() => c().undo().run()} />
      <Btn tip="重做" icon={<RedoOutlined />} disabled={ro || !editor.can().redo()} onClick={() => c().redo().run()} />
      </div>
      </div>
      <Btn tip="向右" icon={<RightOutlined />} onClick={() => slide(240)} style={arrowStyle(st.right)} />
      <Modal
        open={dlg !== null}
        title={dlg?.kind === 'find' ? '查找内容' : '链接地址'}
        width={420}
        centered
        destroyOnClose
        onCancel={() => setDlg(null)}
        footer={<ModalFooter onOk={confirmDlg} onCancel={() => setDlg(null)} />}
      >
        <Input
          autoFocus
          allowClear
          value={dlg?.value ?? ''}
          placeholder={dlg?.kind === 'find' ? '输入要查找的文字' : '留空则取消链接'}
          onChange={(e) => setDlg((d) => (d ? { ...d, value: e.target.value } : d))}
          onPressEnter={confirmDlg}
        />
      </Modal>
    </div>
  );
}
