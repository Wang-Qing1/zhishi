# zhishi 知识库桌面应用

基于 **Tauri 2 + Rust + React + Vite + SQLite** 的 Windows 桌面知识库应用。数据全部保存在本地,无需联网。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2(WebView2,打包为 nsis 安装包) |
| 后端 | Rust,`rusqlite`(bundled SQLite,含在线备份)、`zip`、`thiserror`、`serde` |
| 数据库 | SQLite,WAL 模式、外键约束;`PRAGMA user_version` 管理迁移(当前版本 7);FTS5 `trigram` 分词实现中文子串搜索 |
| 前端 | React 18 + TypeScript + Vite + React Router |
| UI 组件 | Ant Design 5(中文语言包,圆角 16px 主题,浅色/深色) |
| 富文本 | Tiptap(内容存 JSON,同时保存纯文本用于搜索) |
| 知识地图 | React Flow(@xyflow/react)+ dagre 自动布局 |

## 功能

- **知识库管理**:增删改查,列表显示描述与卡片数量;删除进入回收站。
- **知识卡片**:富文本卡片的增删改查。编辑器支持标题、字体颜色与高亮、加粗/斜体/下划线/删除线、对齐、缩进、引用、代码块、列表、链接、图片、表格、表情与特殊字符、查找、预览、全屏、撤销/重做等。
- **多标签**:标签按知识库管理,一张卡片可绑定多个标签,列表可按标签筛选(OR);有独立的**标签管理**界面(新建、搜索、编辑、删除、查看某标签下的卡片)。
- **卡片列表**:每页 24 条;可按更新时间/创建时间/标题排序;卡片可**置顶**(始终排在最前,不改更新时间);支持**多选批量操作**(批量加标签、移除标签、移入回收站)。
- **卡片关联**:卡片之间可建立带关系类型(相关、前置、包含、引用、对立)的有向关联。
- **卡片引用与反向引用**:正文中插入可跳转的卡片引用,并查看哪些卡片引用了当前卡片;关联面板区分出向与入向。
- **知识地图**:
  - 以图的形式展示卡片和关联,节点按标签着色,带小地图。
  - 单击节点弹窗编辑卡片;右键节点可编辑、聚焦子图、添加或删除关联。
  - 拖动节点右侧圆点到另一节点即可连线;单击连线可删除。
  - 节点位置拖动后会保存,可一键重新自动排列;无关联的孤立卡片排在图下方。
  - 支持以某张卡片为中心、按深度展开的子图,避免大图卡顿。
- **全局搜索**:`Ctrl+K` 打开,按相关度排序并高亮命中片段,可按知识库和标签筛选。
- **图片**:粘贴、拖拽或选择文件插入,可缩放;图片保存为本地文件(按内容去重),卡片里只存引用;**图片管理页**可查看每张图片被哪些卡片引用、清理孤儿图片、删除图片。
- **回收站**:知识库和卡片删除后保留 30 天,可恢复、永久删除或清空。
- **历史版本**:保存卡片时自动保留旧版本(间隔 10 分钟,每卡最多 50 个),可查看与恢复。
- **草稿自动保存**:编辑页自动保存草稿,崩溃或误关窗口后可恢复。
- **备份与恢复**:一键导出整库(数据库 + 图片)为 zip;恢复前会自动备份当前数据,并拒绝来自更新版本的备份。
- **深色主题**:跟随系统 / 浅色 / 深色三档,窗口标题栏同步;已知限制:正文里手动设成黑色的文字在深色下看不清。

## 目录结构

```
zhishi/
├─ 设计方案.md        架构、数据模型、接口、各功能设计与性能压测
├─ 实施步骤.md        环境准备、打包与验证、迭代记录、验收清单
├─ README.md
└─ app/
   ├─ package.json、vite.config.ts、index.html
   ├─ scripts/gen-icon.mjs   生成应用图标
   ├─ src/                   前端
   │  ├─ pages/              KbList、KbDetail、CardEditor、GraphView、Images、Trash
   │  ├─ components/         RichEditor、EditorToolbar、TagSelector、TagManager、GlobalSearch、VersionHistory、DataMenu、ThemeMenu 等
   │  └─ api.ts、types.ts、theme.ts、images.ts
   └─ src-tauri/             Rust 后端
      ├─ migrations/         SQL 迁移脚本(001~007)
      ├─ capabilities/       Tauri 权限配置
      └─ src/                db、error、models、commands(kb/card/tag/link/graph/search/image/backup/trash/version/draft)、tests
```

数据目录:`%APPDATA%\com.zhishi.app\`,包含 `zhishi.db`、`images\`(图片文件)、`backups\`(恢复前自动备份)。

## 快速开始

前置:Node.js 18+、Rust(stable)、Windows 已安装 WebView2。详见 `实施步骤.md`。

```powershell
cd app
npm install
npm run icon              # 首次:生成并展开应用图标
cd src-tauri; cargo test  # 后端单元测试
cd ..
npm run tauri dev         # 开发运行(debug 构建,较慢)
npm run tauri build       # 打包 nsis 安装程序
```

- 新增数据库迁移后,需要重启 `tauri dev` 才会生效。
- 安装包产物:`app\src-tauri\target\release\bundle\nsis\`。只打 nsis:msi 依赖的 WiX 在本机因中文产品名失败。
- 安装版与 `tauri dev` 共用同一数据目录,验证前请先备份。
- 搜索与列表性能压测(默认忽略):`cd app\src-tauri; cargo test --release bench_search_scale -- --ignored --nocapture`。

## 性能

2 万张卡片(约 372MB)的实测(release):3 字及以上关键词搜索约 1~30ms;1~2 字关键词为全表扫描,约 190~330ms;知识库列表第一页和总数查询在默认排序下为亚毫秒级(迁移 007 的专用索引)。详见设计方案 §9。

## 更多文档

- [设计方案.md](./设计方案.md)
- [实施步骤.md](./实施步骤.md)
