import { ArrowLeftOutlined, ClearOutlined, DeleteOutlined } from '@ant-design/icons';
import { App, Card, Checkbox, Col, Image as AntImage, List, Pagination, Popover, Row, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import Confirm from '../components/Confirm';
import Hint, { EmptyHint } from '../components/Hint';
import IconBtn from '../components/IconBtn';
import { imageUrl } from '../images';
import type { ImageInfo } from '../types';

const PAGE_SIZE = 24;

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;

/** 未被任何卡片(含回收站)、历史版本和草稿引用 */
const isOrphan = (i: ImageInfo) => i.cards.length === 0 && i.versionCount === 0 && i.draftCount === 0;

export default function Images() {
  const { message, modal } = App.useApp();
  const nav = useNavigate();
  const [list, setList] = useState<ImageInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [onlyOrphan, setOnlyOrphan] = useState(false);
  const [page, setPage] = useState(1);

  const reload = useCallback(
    () =>
      api
        .imageList()
        .then(setList)
        .catch((e) => message.error(errMsg(e)))
        .finally(() => setLoaded(true)),
    [message],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    setPage(1);
  }, [onlyOrphan]);

  const orphans = list.filter(isOrphan);
  const shown = onlyOrphan ? orphans : list;
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // 删除后当前页可能已经没有内容,退回到最后一页
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    if (page > maxPage) setPage(maxPage);
  }, [shown.length, page]);

  const totalSize = list.reduce((s, i) => s + i.size, 0);
  const orphanSize = orphans.reduce((s, i) => s + i.size, 0);

  const cleanup = async () => {
    try {
      const r = await api.imageCleanup();
      message.success(r.deleted ? `已清理 ${r.deleted} 张,释放 ${fmtSize(r.bytes)}` : '没有可清理的图片');
      await reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const doDelete = (img: ImageInfo, removeRefs: boolean) =>
    api
      .imageDelete(img.name, removeRefs)
      .then(() => {
        message.success('已删除');
        return reload();
      })
      .catch((e) => message.error(errMsg(e)));

  // 正在被使用的图片:列出受影响的卡片,确认后连同引用一起移除
  const confirmUsed = (img: ImageInfo) => {
    const shownCards = img.cards.slice(0, 8);
    modal.confirm({
      title: '删除正在使用的图片?',
      content: (
        <div>
          <p>
            这张图片正在被 {img.cards.length} 张卡片、{img.versionCount} 个历史版本、{img.draftCount} 份草稿使用。
            删除后会从它们的正文里移除这张图,文字不受影响,不可恢复。
          </p>
          {shownCards.map((c) => (
            <div key={c.cardId}>
              · {c.title}
              <Typography.Text type="secondary"> ({c.kbName}{c.trashed ? ',回收站' : ''})</Typography.Text>
            </div>
          ))}
          {img.cards.length > shownCards.length && <div>…等 {img.cards.length} 张卡片</div>}
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => doDelete(img, true),
    });
  };

  const usage = (img: ImageInfo) => (
    <div style={{ maxWidth: 320 }}>
      {img.cards.length === 0 ? (
        <Typography.Text type="secondary">仅被 {img.versionCount} 个历史版本、{img.draftCount} 份草稿引用</Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={img.cards}
          renderItem={(c) => (
            <List.Item style={{ padding: '4px 0' }}>
              {c.trashed ? (
                <Typography.Text type="secondary">{c.title}(回收站)</Typography.Text>
              ) : (
                <a onClick={() => nav(`/kb/${c.kbId}/card/${c.cardId}`)}>{c.title}</a>
              )}
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                {c.kbName}
              </Typography.Text>
            </List.Item>
          )}
        />
      )}
      {img.cards.length > 0 && img.versionCount + img.draftCount > 0 && (
        <Typography.Text type="secondary">
          另有 {img.versionCount} 个历史版本、{img.draftCount} 份草稿引用
        </Typography.Text>
      )}
    </div>
  );

  return (
    <div className="page">
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <IconBtn tip="返回" icon={<ArrowLeftOutlined />} onClick={() => nav('/')} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            图片管理
          </Typography.Title>
          <Hint text="图片按内容保存,同一张图只存一份。未被任何卡片和历史版本引用的图片会在启动应用时自动清理,也可以在这里立即清理" />
        </Space>
        <Space size={12}>
          <Checkbox checked={onlyOrphan} onChange={(e) => setOnlyOrphan(e.target.checked)}>
            仅看未引用
          </Checkbox>
          <Confirm
            title={`立即清理 ${orphans.length} 张未引用的图片?不可恢复`}
            okButtonProps={{ danger: true }}
            onConfirm={cleanup}
            disabled={orphans.length === 0}
          >
            <IconBtn tip="立即清理未引用图片" icon={<ClearOutlined />} disabled={orphans.length === 0} />
          </Confirm>
        </Space>
      </div>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        共 {list.length} 张,占用 {fmtSize(totalSize)};未引用 {orphans.length} 张({fmtSize(orphanSize)})
      </Typography.Text>

      {!loaded ? null : shown.length === 0 ? (
        <EmptyHint text={onlyOrphan ? '没有未引用的图片' : '还没有图片'} />
      ) : (
        <Row gutter={[16, 16]}>
          {pageItems.map((img) => (
            <Col key={img.name} xs={12} sm={8} lg={6} xl={4}>
              <Card
                size="small"
                cover={
                  <div
                    style={{
                      height: 150,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#fafafa',
                      overflow: 'hidden',
                    }}
                  >
                    <AntImage
                      src={imageUrl(img.name)}
                      width="100%"
                      height={150}
                      style={{ objectFit: 'contain' }}
                      preview={{ src: imageUrl(img.name) }}
                    />
                  </div>
                }
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space size={4} wrap>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtSize(img.size)}
                    </Typography.Text>
                    {isOrphan(img) ? (
                      <Tag color="orange" style={{ margin: 0 }}>
                        未引用
                      </Tag>
                    ) : (
                      <Popover trigger="click" title="使用这张图片的卡片" content={usage(img)}>
                        <Tag color="blue" style={{ margin: 0, cursor: 'pointer' }}>
                          {img.cards.length > 0
                            ? `${img.cards.length} 张卡片`
                            : img.versionCount > 0
                              ? `历史版本 ${img.versionCount}`
                              : `草稿 ${img.draftCount}`}
                        </Tag>
                      </Popover>
                    )}
                  </Space>
                  {isOrphan(img) ? (
                    <Confirm title="删除这张图片?不可恢复" okButtonProps={{ danger: true }} onConfirm={() => doDelete(img, false)}>
                      <IconBtn tip="删除" danger type="text" icon={<DeleteOutlined />} />
                    </Confirm>
                  ) : (
                    <IconBtn tip="删除" danger type="text" icon={<DeleteOutlined />} onClick={() => confirmUsed(img)} />
                  )}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(img.modifiedAt).toLocaleString()}
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      {shown.length > PAGE_SIZE && (
        <Pagination
          current={page}
          pageSize={PAGE_SIZE}
          total={shown.length}
          onChange={setPage}
          showSizeChanger={false}
          style={{ marginTop: 20, textAlign: 'right' }}
        />
      )}
    </div>
  );
}
