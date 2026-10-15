// 未保存守卫:编辑页有未保存修改时,所有站内跳转先询问,确认后才执行
type Ask = (go: () => void) => void;

let dirty = false;
let ask: Ask | null = null;

export const setUnsaved = (v: boolean) => {
  dirty = v;
};

/** 注册询问函数(由持有确认弹窗的编辑页调用),返回注销函数 */
export const registerUnsavedAsk = (fn: Ask) => {
  ask = fn;
  return () => {
    if (ask === fn) ask = null;
  };
};

/** 跳转前调用:无未保存修改直接执行 go,否则交给编辑页弹窗确认 */
export const guardNav = (go: () => void) => {
  if (dirty && ask) ask(go);
  else go();
};
