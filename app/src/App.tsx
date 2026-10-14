import { Layout } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import GlobalSearch from './components/GlobalSearch';
import IconBtn from './components/IconBtn';
import CardEditor from './pages/CardEditor';
import GraphView from './pages/GraphView';
import KbDetail from './pages/KbDetail';
import KbList from './pages/KbList';

export default function App() {
  const nav = useNavigate();
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
        <IconBtn tip="全局搜索 (Ctrl+K)" icon={<SearchOutlined />} onClick={() => setSearchOpen(true)} />
      </Layout.Header>
      <Layout.Content>
        <Routes>
          <Route path="/" element={<KbList />} />
          <Route path="/kb/:kbId" element={<KbDetail />} />
          <Route path="/kb/:kbId/card/:cardId" element={<CardEditor />} />
          <Route path="/kb/:kbId/graph" element={<GraphView />} />
        </Routes>
      </Layout.Content>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Layout>
  );
}
