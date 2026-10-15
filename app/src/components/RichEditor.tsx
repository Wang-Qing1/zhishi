import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { App } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { errMsg } from '../api';
import { uploadImageNode } from '../images';
import { CardImage } from './CardImage';
import EditorToolbar from './EditorToolbar';

/** 编辑器与只读预览共用的扩展(不含占位提示) */
export function contentExtensions() {
  return [
    StarterKit,
    Underline,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    CardImage,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({ openOnClick: false, protocols: [{ scheme: 'zhishi-card', optionalSlashes: true }] }),
  ];
}

const imageFiles = (list?: FileList | null) => Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));

export function parseContent(json: string) {
  if (!json) return '';
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

interface Props {
  /** 初始内容(Tiptap JSON 字符串);切换卡片时用 key 重建组件 */
  initial: string;
  kbId: number;
  currentCardId?: number;
  onOpenCard?: (cardId: number) => void;
  onChange: (json: string, text: string) => void;
  /** 编辑器创建完成时回调(不算用户修改),用于获取初始纯文本 */
  onReady?: (json: string, text: string) => void;
}

export default function RichEditor({ initial, kbId, currentCardId, onOpenCard, onChange, onReady }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const [preview, setPreview] = useState(false);
  const { message } = App.useApp();
  // 粘贴/拖拽处理函数在编辑器创建时绑定,通过 ref 访问最新的编辑器实例
  const editorRef = useRef<Editor | null>(null);

  // 图片文件依次落盘并插入;pos 为拖拽落点(首张插在落点,后面的紧随其后),缺省插在当前光标
  const insertImages = async (files: File[], pos?: number) => {
    let first = true;
    for (const file of files) {
      try {
        const img = await uploadImageNode(file);
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        const chain = ed.chain().focus();
        if (first && pos !== undefined) chain.setTextSelection(pos);
        chain.insertContent({ type: 'image', attrs: img }).run();
        first = false;
      } catch (e) {
        message.error(errMsg(e));
      }
    }
  };

  // 处理函数只在编辑器创建时绑定一次,用 ref 始终调用最新的 insertImages,避免拿着旧闭包
  const insertRef = useRef(insertImages);
  insertRef.current = insertImages;

  const editor = useEditor({
    extensions: [...contentExtensions(), Placeholder.configure({ placeholder: '在此编写知识内容…' })],
    editorProps: {
      // 剪贴板里有图片且没有文字(截图、复制的图片)时保存为图片;带文字的内容(如从 Word 复制)走默认粘贴
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!view.editable || files.length === 0 || event.clipboardData?.getData('text/plain')) return false;
        void insertRef.current(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (!view.editable || files.length === 0) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertRef.current(files, pos);
        return true;
      },
    },
    content: parseContent(initial),
    onCreate: ({ editor }) => onReady?.(JSON.stringify(editor.getJSON()), editor.getText({ blockSeparator: '\n' })),
    onUpdate: ({ editor }) => onChange(JSON.stringify(editor.getJSON()), editor.getText({ blockSeparator: '\n' })),
  });

  editorRef.current = editor;
  useEffect(() => () => editor?.destroy(), [editor]);
  // 预览 = 只读模式;第二个参数 false = 不触发 update 事件,否则刚打开卡片就会被误判为已修改
  useEffect(() => {
    editor?.setEditable(!preview, false);
  }, [editor, preview]);
  // Esc 退出全屏
  useEffect(() => {
    if (!fullscreen) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fullscreen]);

  const openReference = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href^="zhishi-card://"]');
    if (!anchor) return;
    event.preventDefault();
    const cardId = Number(anchor.getAttribute('href')?.slice('zhishi-card://'.length));
    if (Number.isSafeInteger(cardId) && cardId > 0) onOpenCard?.(cardId);
  };

  if (!editor) return null;
  return (
    <div className={`editor-wrap${fullscreen ? ' fullscreen' : ''}${preview ? ' is-readonly' : ''}`}>
      <EditorToolbar
        editor={editor}
        kbId={kbId}
        currentCardId={currentCardId}
        preview={preview}
        fullscreen={fullscreen}
        onPreview={() => setPreview((p) => !p)}
        onFullscreen={() => setFullscreen((f) => !f)}
      />
      <EditorContent editor={editor} className="editor-body" onClick={openReference} />
    </div>
  );
}
