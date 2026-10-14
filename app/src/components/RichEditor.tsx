import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
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
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import EditorToolbar from './EditorToolbar';

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
  onChange: (json: string, text: string) => void;
  /** 编辑器创建完成时回调(不算用户修改),用于获取初始纯文本 */
  onReady?: (json: string, text: string) => void;
}

export default function RichEditor({ initial, onChange, onReady }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const [preview, setPreview] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: '在此编写知识内容…' }),
    ],
    content: parseContent(initial),
    onCreate: ({ editor }) => onReady?.(JSON.stringify(editor.getJSON()), editor.getText({ blockSeparator: '\n' })),
    onUpdate: ({ editor }) => onChange(JSON.stringify(editor.getJSON()), editor.getText({ blockSeparator: '\n' })),
  });

  useEffect(() => () => editor?.destroy(), [editor]);
  // 预览 = 只读模式
  useEffect(() => {
    editor?.setEditable(!preview);
  }, [editor, preview]);
  // Esc 退出全屏
  useEffect(() => {
    if (!fullscreen) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fullscreen]);

  if (!editor) return null;
  return (
    <div className={`editor-wrap${fullscreen ? ' fullscreen' : ''}`}>
      <EditorToolbar
        editor={editor}
        preview={preview}
        fullscreen={fullscreen}
        onPreview={() => setPreview((p) => !p)}
        onFullscreen={() => setFullscreen((f) => !f)}
      />
      <EditorContent editor={editor} />
    </div>
  );
}
