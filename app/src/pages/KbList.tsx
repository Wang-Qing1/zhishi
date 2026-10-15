import { ApartmentOutlined, DeleteOutlined, EditOutlined, PlusOutlined, RestOutlined } from '@ant-design/icons';
import { App, Card, Col, Form, Input, Modal, Row, Tag, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import DataMenu from '../components/DataMenu';
import { EmptyHint } from '../components/Hint';
import Confirm from '../components/Confirm';
import IconBtn from '../components/IconBtn';
import ModalFooter from '../components/ModalFooter';
import { hideSplash } from '../splash';
import type { Kb } from '../types';

export default function KbList() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const [list, setList] = useState<Kb[]>([]);
  const [editing, setEditing] = useState<Partial<Kb> | null>(null);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm();

  const reload = useCallback(() => api.kbList().then(setList).catch((e) => message.error(errMsg(e))), [message]);
  useEffect(() => {
    // 首次数据加载完成后收起启动画面
    reload().finally(() => {
      setLoading(false);
      hideSplash();
    });
  }, [reload]);

  const openEdit = (kb: Partial<Kb>) => {
    setEditing(kb);
    form.setFieldsValue({ name: kb.name ?? '', description: kb.description ?? '' });
  };

  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing?.id) await api.kbUpdate(editing.id, v.name, v.description ?? '');
      else await api.kbCreate(v.name, v.description ?? '');
      setEditing(null);
      reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const kw = keyword.trim().toLowerCase();
  const shown = kw ? list.filter((kb) => kb.name.toLowerCase().includes(kw)) : list;

  return (
    <div className="page">
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          我的知识库
        </Typography.Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Input
            allowClear
            placeholder="按名称搜索知识库"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 240 }}
          />
          <IconBtn tip="回收站" icon={<RestOutlined />} onClick={() => nav('/trash')} />
          <DataMenu />
          <IconBtn tip="新建知识库" type="primary" icon={<PlusOutlined />} onClick={() => openEdit({})} />
        </div>
      </div>
      {loading ? null : list.length === 0 ? (
        <EmptyHint text="还没有知识库,点击右上角加号新建" />
      ) : shown.length === 0 ? (
        <EmptyHint text="没有匹配的知识库" />
      ) : (
        <Row gutter={[16, 16]}>
          {shown.map((kb) => (
            <Col key={kb.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                hoverable
                title={kb.name}
                extra={
                  <Tag color="blue" style={{ margin: 0, borderRadius: 10 }}>
                    卡片：{kb.cardCount}
                  </Tag>
                }
                onClick={() => nav(`/kb/${kb.id}`)}
                actions={[
                  <Tooltip key="g" title="知识地图">
                    <ApartmentOutlined onClick={(e) => { e.stopPropagation(); nav(`/kb/${kb.id}/graph`); }} />
                  </Tooltip>,
                  <EditOutlined key="e" onClick={(e) => { e.stopPropagation(); openEdit(kb); }} />,
                  <span key="d" onClick={(e) => e.stopPropagation()}>
                    <Confirm
                      title="删除知识库?"
                      description="其下所有卡片、标签、关联将一并移入回收站,30 天内可恢复"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => api.kbDelete(kb.id).then(reload).catch((e) => message.error(errMsg(e)))}
                    >
                      <DeleteOutlined />
                    </Confirm>
                  </span>,
                ]}
              >
                <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ minHeight: 44, margin: 0 }}>
                  {kb.description || '暂无描述'}
                </Typography.Paragraph>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      <Modal open={!!editing} title={editing?.id ? '编辑知识库' : '新建知识库'} onCancel={() => setEditing(null)} footer={<ModalFooter onOk={save} onCancel={() => setEditing(null)} />} destroyOnClose forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: '请输入名称' }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
