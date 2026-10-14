import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Card, Col, Form, Input, Modal, Row, Tag, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { EmptyHint } from '../components/Hint';
import Confirm from '../components/Confirm';
import IconBtn from '../components/IconBtn';
import ModalFooter from '../components/ModalFooter';
import type { Kb } from '../types';

export default function KbList() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const [list, setList] = useState<Kb[]>([]);
  const [editing, setEditing] = useState<Partial<Kb> | null>(null);
  const [form] = Form.useForm();

  const reload = useCallback(() => api.kbList().then(setList).catch((e) => message.error(errMsg(e))), [message]);
  useEffect(() => {
    reload();
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

  return (
    <div className="page">
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          我的知识库
        </Typography.Title>
        <IconBtn tip="新建知识库" type="primary" icon={<PlusOutlined />} onClick={() => openEdit({})} />
      </div>
      {list.length === 0 ? (
        <EmptyHint text="还没有知识库,点击右上角加号新建" />
      ) : (
        <Row gutter={[16, 16]}>
          {list.map((kb) => (
            <Col key={kb.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                hoverable
                title={kb.name}
                extra={
                  <Tooltip title="卡片数量">
                    <Tag color="blue" style={{ margin: 0, borderRadius: 10 }}>
                      {kb.cardCount}
                    </Tag>
                  </Tooltip>
                }
                onClick={() => nav(`/kb/${kb.id}`)}
                actions={[
                  <EditOutlined key="e" onClick={(e) => { e.stopPropagation(); openEdit(kb); }} />,
                  <span key="d" onClick={(e) => e.stopPropagation()}>
                    <Confirm
                      title="删除知识库?"
                      description="其下所有卡片、标签、关联将一并删除,不可恢复"
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
