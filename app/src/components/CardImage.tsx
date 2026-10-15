import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { fromImgUrl, toImgUrl } from '../images';
import ImageView from './ImageView';

/**
 * 文档 JSON 里存 zhishi-img:// 引用,渲染到 DOM 时才转成真实 URL;
 * width(像素,空表示原始大小)由用户缩放得到,高度按比例自动;编辑器内用 ImageView 提供操作条和缩放
 */
export const CardImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => fromImgUrl(el.getAttribute('src')),
      },
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const w = Number(el.getAttribute('width'));
          return Number.isFinite(w) && w > 0 ? Math.round(w) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => (attrs.width ? { width: attrs.width } : {}),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = typeof HTMLAttributes.src === 'string' ? toImgUrl(HTMLAttributes.src) : HTMLAttributes.src;
    return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes, src }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
