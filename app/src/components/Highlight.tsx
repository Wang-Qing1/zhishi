/** 渲染 Rust 返回的 snippet:\u0001..\u0002 包裹的部分高亮,其余按纯文本输出(不使用 innerHTML) */
export default function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? (
          <mark className="hl" key={i}>
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
