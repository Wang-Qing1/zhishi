# zhishi 知识库桌面应用

基于 **Tauri 2 + Rust + React + Vite + SQLite** 的 Windows 桌面知识库应用。数据全部保存在本地 SQLite 文件中,无需联网。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2(WebView2,打包为 msi/nsis) |
| 后端 | Rust,`rusqlite`(bundled SQLite)、`thiserror`、`serde` |
| 数据库 | SQLite,WAL 模式、外键约束;`PRAGMA user_version` 管理迁移;FTS5 `trigram` 分词实现中文子串搜索 |
| 前端 | React 18 + TypeScript + Vite + React Router |
| UI 组件 | Ant Design 5(中文语言包,圆角 16px 主题) |
| 富文本 | Tiptap(内容存 JSON,同时保存纯文本用于搜索) |
| 知识地图 | React Flow(@xyflow/react)+ dagre 自动布局 |

## 基础功能

- **知识库管理**:知识库的增删改查,列表显示描述与卡片数量。
- **知识卡片**:富文本卡片的增删改查。编辑器支持标题、字体颜色与高亮、加粗/斜体/下划线/删除线、对齐、缩进、引用、代码块、列表、链接、本地图片、表格、表情与特殊字符、查找、预览、全屏、撤销/重做等。
- **多标签**:标签按知识库管理,一张卡片可绑定多个标签,列表可按标签筛选。
- **卡片关联**:卡片之间可建立带关系类型(相关、前置、包含、引用、对立)的有向关联。
- **卡片引用与反向引用**:在正文中插入可跳转的卡片引用,并查看哪些卡片正文引用了当前卡片;关联面板同时区分出向与入向关联。
- **知识地图**:
  - 以图的形式展示卡片和关联,节点按标签着色,带小地图。
  - 单击节点弹窗编辑卡片;右键节点可编辑、聚焦子图、添加或删除关联。
  - 拖动节点右侧圆点到另一节点即可连线;单击连线可删除。
  - 节点位置拖动后会保存,可一键重新自动排列;无关联的孤立卡片排在图下方。
  - 支持以某张卡片为中心、按深度展开的子图,避免大图卡顿。
- **全局搜索**:`Ctrl+K` 打开,按相关度排序并高亮命中片段,可按知识库和标签过滤。

## 目录结构

```
zhishi/
├─ 设计方案.md        架构、数据模型、接口与前端设计
├─ 实施步骤.md        环境准备与分步操作
├─ README.md
└─ app/
   ├─ package.json、vite.config.ts、index.html
   ├─ scripts/gen-icon.mjs   生成应用图标
   ├─ src/                   前端(pages、components、api.ts、types.ts)
   └─ src-tauri/             Rust 后端
      ├─ migrations/         SQL 迁移脚本
      └─ src/                db、error、models、commands(kb/card/tag/link/graph/search)、tests
```

## 快速开始

前置:Node.js 18+、Rust(stable)、Windows 已安装 WebView2。详见 `实施步骤.md`。

```powershell
cd app
npm install
npm run icon              # 首次:生成并展开应用图标
cd src-tauri; cargo test  # 后端单元测试(内存库)
cd ..
npm run tauri dev         # 开发运行
npm run tauri build       # 打包安装程序
```

新增数据库迁移后,需要重启 `tauri dev` 才会生效。

## 更多文档

- [设计方案.md](./设计方案.md)
- [实施步骤.md](./实施步骤.md)
