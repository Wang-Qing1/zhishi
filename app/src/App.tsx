import { Layout } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { hideSplash } from './splash';
import GlobalSearch from './components/GlobalSearch';
import IconBtn from './components/IconBtn';
import ThemeMenu from './components/ThemeMenu';
import CardEditor from './pages/CardEditor';
import GraphView from './pages/GraphView';
import KbDetail from './pages/KbDetail';
import Images from './pages/Images';
import KbList from './pages/KbList';
import Trash from './pages/Trash';

export default function App() {
  const nav = useNavigate();
  const { pathname } = useLocation();

  // 非首页路由(如刷新停留在卡片页)不会触发知识库列表的加载,这里直接收起启动画面
  useEffect(() => {
    if (pathname !== '/') hideSplash();
  }, [pathname]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl+K 打开全局搜索
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Header className="app-header">
        <span className="app-title" onClick={() => nav('/')}>
          知识图谱
        </span>
        <div style={{ flex: 1 }} />
        <ThemeMenu />
        <IconBtn tip="全局搜索 (Ctrl+K)" icon={<SearchOutlined />} onClick={() => setSearchOpen(true)} />
      </Layout.Header>
      <Layout.Content>
        <Routes>
          <Route path="/" element={<KbList />} />
          <Route path="/kb/:kbId" element={<KbDetail />} />
          <Route path="/kb/:kbId/card/:cardId" element={<CardEditor />} />
          <Route path="/kb/:kbId/graph" element={<GraphView />} />
          <Route path="/trash" element={<Trash />} />
          <Route path="/images" element={<Images />} />
        </Routes>
      </Layout.Content>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Layout>
  );
}
