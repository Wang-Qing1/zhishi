// 启动画面(index.html 中的 #boot)的收起逻辑

let hidden = false;
const MIN_SHOW_MS = 600; // 至少显示的时长,避免一闪而过
const start = Date.now();

/** 主界面就绪后调用:进度条走满,随后深入淡出并移除 */
export function hideSplash() {
  if (hidden) return;
  hidden = true;
  const el = document.getElementById('boot');
  if (!el) return;
  const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - start));
  setTimeout(() => {
    el.classList.add('done'); // 进度条补满到 100%
    setTimeout(() => {
      el.classList.add('hide'); // 淡出
      setTimeout(() => el.remove(), 350);
    }, 250);
  }, wait);
}

// 兑底:万一主界面没有调用(例如直接打开其他路由或加载异常),8 秒后强制收起,避免一直遮住界面
setTimeout(hideSplash, 8000);
