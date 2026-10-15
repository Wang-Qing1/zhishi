import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from './api';

/** 单张图片大小上限,与后端 image.rs 的 MAX_BYTES 保持一致 */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** 正文里图片 src 的引用前缀,与后端 image.rs 的 REF_PREFIX 保持一致 */
const REF_PREFIX = 'zhishi-img://';
const NAME_RE = /([0-9a-f]{64}\.[a-z]+)$/;

/** zhishi-img://<hash>.<ext> → 当前平台可直接加载的 URL;其他 src 原样返回 */
export function toImgUrl(src: string) {
  return src.startsWith(REF_PREFIX) ? convertFileSrc(src.slice(REF_PREFIX.length), 'zhishi-img') : src;
}

/** 图片文件名(不含 zhishi-img:// 前缀) → 可直接加载的 URL */
export const imageUrl = (name: string) => convertFileSrc(name, 'zhishi-img');

/** 把渲染后的 URL 还原成引用(编辑器内复制粘贴图片时,DOM 中的 src 是真实 URL) */
export function fromImgUrl(src: string | null) {
  if (!src || !src.includes('zhishi-img')) return src;
  const m = NAME_RE.exec(src.split(/[?#]/)[0]);
  return m ? REF_PREFIX + m[1] : src;
}

/** 校验大小后交给后端落盘,返回可直接写入正文的 zhishi-img:// 引用;失败时抛出带提示文字的错误 */
export async function uploadImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片不能超过 3MB');
  const { base64, ext } = await readImage(file);
  return api.imageSave(base64, ext);
}

/** 新插入图片的默认显示宽度上限(像素) */
const DEFAULT_MAX_WIDTH = 480;

/** 默认显示宽度:原始宽度与上限取较小者,小图不放大;读取失败时不设置宽度 */
function defaultWidth(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(Math.min(img.naturalWidth || DEFAULT_MAX_WIDTH, DEFAULT_MAX_WIDTH));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** 落盘并计算默认显示宽度,返回可直接作为图片节点属性使用的 { src, width } */
export async function uploadImageNode(file: File): Promise<{ src: string; width: number | null }> {
  const [src, width] = await Promise.all([uploadImage(file), defaultWidth(file)]);
  return { src, width };
}

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
