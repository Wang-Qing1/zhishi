import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'zhishi.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

// 主题选择只是每个使用者的偏好;浏览器存储不可用时跟随系统
const read = (): ThemeMode => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
};

let mode = read();

const resolve = (): 'light' | 'dark' => (mode === 'system' ? (media.matches ? 'dark' : 'light') : mode);

/** 把实际生效的主题写到 <html data-theme>,并通知订阅者 */
function render() {
  document.documentElement.dataset.theme = resolve();
  listeners.forEach((l) => l());
}

/** 原生窗口(标题栏)跟随:跟随系统时传 null;非 Tauri 环境或失败时忽略 */
function syncWindow() {
  try {
    getCurrentWindow()
      .setTheme(mode === 'system' ? null : mode)
      .catch(() => {});
  } catch {
    /* 不在 Tauri 中运行 */
  }
}

/** 应用启动时调用一次,在渲染前设置主题 */
export function initTheme() {
  render();
  syncWindow();
  media.addEventListener('change', () => {
    if (mode === 'system') render();
  });
}

export function setThemeMode(next: ThemeMode) {
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* 存储不可用时只是不记住 */
  }
  render();
  syncWindow();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => mode);
  const resolved = useSyncExternalStore(subscribe, resolve);
  return { mode: current, dark: resolved === 'dark' };
}
