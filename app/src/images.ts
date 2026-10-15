import { convertFileSrc } from '@tauri-apps/api/core';
import Image from '@tiptap/extension-image';

/** 正文里图片 src 的引用前缀,与后端 image.rs 的 REF_PREFIX 保持一致 */
const REF_PREFIX = 'zhishi-img://';
const NAME_RE = /([0-9a-f]{64}\.[a-z]+)$/;

/** zhishi-img://<hash>.<ext> → 当前平台可直接加载的 URL;其他 src 原样返回 */
function toImgUrl(src: string) {
  return src.startsWith(REF_PREFIX) ? convertFileSrc(src.slice(REF_PREFIX.length), 'zhishi-img') : src;
}

/** 把渲染后的 URL 还原成引用(编辑器内复制粘贴图片时,DOM 中的 src 是真实 URL) */
function fromImgUrl(src: string | null) {
  if (!src || !src.includes('zhishi-img')) return src;
  const m = NAME_RE.exec(src.split(/[?#]/)[0]);
  return m ? REF_PREFIX + m[1] : src;
}

/** 文档 JSON 里存引用,仅在渲染到 DOM 时转成真实 URL */
export const CardImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => fromImgUrl(el.getAttribute('src')),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = typeof HTMLAttributes.src === 'string' ? toImgUrl(HTMLAttributes.src) : HTMLAttributes.src;
    return ['img', { ...this.options.HTMLAttributes, ...HTMLAttributes, src }];
  },
});

/** 文件 → (base64 内容, 扩展名) */
export function readImage(file: File): Promise<{ base64: string; ext: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const url = String(reader.result);
      const base64 = url.slice(url.indexOf(',') + 1);
      const fromName = file.name.includes('.') ? file.name.split('.').pop()! : '';
      const fromType = file.type.startsWith('image/') ? file.type.slice(6).replace('+xml', '') : '';
      resolve({ base64, ext: (fromName || fromType).toLowerCase() });
    };
    reader.readAsDataURL(file);
  });
}
