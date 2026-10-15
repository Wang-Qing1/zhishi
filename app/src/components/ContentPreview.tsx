import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect } from 'react';
import { contentExtensions, parseContent } from './RichEditor';

/** 只读显示一段 Tiptap JSON 内容;内容变化时用 key 重建 */
export default function ContentPreview({ json }: { json: string }) {
  const editor = useEditor({
    extensions: contentExtensions(),
    content: parseContent(json),
    editable: false,
  });
  useEffect(() => () => editor?.destroy(), [editor]);
  return (
    <div className="is-readonly">
      <EditorContent editor={editor} className="editor-body" />
    </div>
  );
}
