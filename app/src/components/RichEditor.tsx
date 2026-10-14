import { Button, Space } from 'antd';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

export function parseContent(json: string) {
  if (!json) return '';
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function Toolbar({ editor }: { editor: Editor }) {
  const b = (label: string, active: boolean, run: () => void) => (
    <Button size="small" type={active ? 'primary' : 'default'} onClick={run}>
      {label}
    </Button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="editor-toolbar">
      <Space wrap size={4}>
        {b('B', editor.isActive('bold'), () => c().toggleBold().run())}
        {b('I', editor.isActive('italic'), () => c().toggleItalic().run())}
        {b('S', editor.isActive('strike'), () => c().toggleStrike().run())}
        {b('H1', editor.isActive('heading', { level: 1 }), () => c().toggleHeading({ level: 1 }).run())}
        {b('H2', editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run())}
        {b('H3', editor.isActive('heading', { level: 3 }), () => c().toggleHeading({ level: 3 }).run())}
        {b('• 列表', editor.isActive('bulletList'), () => c().toggleBulletList().run())}
        {b('1. 列表', editor.isActive('orderedList'), () => c().toggleOrderedList().run())}
        {b('引用', editor.isActive('blockquote'), () => c().toggleBlockquote().run())}
        {b('行内代码', editor.isActive('code'), () => c().toggleCode().run())}
        {b('代码块', editor.isActive('codeBlock'), () => c().toggleCodeBlock().run())}
        {b('链接', editor.isActive('link'), () => {
          const prev = editor.getAttributes('link').href as string | undefined;
          const url = window.prompt('链接地址(留空取消链接)', prev ?? 'https://');
          if (url === null) return;
          if (url === '') c().unsetLink().run();
          else c().extendMarkRange('link').setLink({ href: url }).run();
        })}
        {b('分隔线', false, () => c().setHorizontalRule().run())}
        {b('撤销', false, () => c().undo().run())}
        {b('重做', false, () => c().redo().run())}
      </Space>
    </div>
  );
}

interface Props {
  /** 初始内容(Tiptap JSON 字符串);切换卡片时用 key 重建组件 */
  initial: string;
  onChange: (json: string, text: string) => void;
  /** 编辑器创建完成时回调(不算用户修改),用于获取初始纯文本 */
  onReady?: (json: string, text: string) => void;
}

export default function RichEditor({ initial, onChange, onReady }: Props) {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Placeholder.configure({ placeholder: '在此编写知识内容…' })],
    content: parseContent(initial),
    onCreate: ({ editor }) => onReady?.(JSON.stringify(editor.getJSON()), editor.getText({ blockSeparator: '\n' })),
    onUpdate: ({ editor }) => onChange(JSON.stringify(editor.getJSON()), editor.getText({ blockSeparator: '\n' })),
  });

  useEffect(() => () => editor?.destroy(), [editor]);
  if (!editor) return null;
  return (
    <div className="editor-wrap">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
