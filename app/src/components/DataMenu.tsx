import { DatabaseOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { open, save } from '@tauri-apps/plugin-dialog';
import { App, Dropdown } from 'antd';
import { useState } from 'react';
import { api, errMsg } from '../api';
import IconBtn from './IconBtn';

const FILTERS = [{ name: '备份文件', extensions: ['zip'] }];

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 数据备份与恢复菜单(知识库列表页右上角) */
export default function DataMenu() {
  const { message, modal } = App.useApp();
  const [busy, setBusy] = useState(false);

  const backup = async () => {
    const path = await save({ title: '备份数据', defaultPath: `知识库备份-${stamp()}.zip`, filters: FILTERS });
    if (!path) return;
    setBusy(true);
    try {
      await api.backupExport(path);
      message.success('备份完成');
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const path = await open({ title: '选择备份文件', multiple: false, directory: false, filters: FILTERS });
    if (typeof path !== 'string') return;
    modal.confirm({
      title: '恢复数据?',
      content: '当前所有数据将被备份文件覆盖。恢复前会自动备份当前数据到 %APPDATA%\\com.zhishi.app\\backups 目录(仅保留最近 5 份)。',
      okText: '恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          await api.backupRestore(path);
          message.success('恢复完成,正在刷新');
          setTimeout(() => window.location.reload(), 600);
        } catch (e) {
          message.error(errMsg(e));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          { key: 'backup', icon: <DownloadOutlined />, label: '备份数据' },
          { key: 'restore', icon: <UploadOutlined />, label: '恢复数据' },
        ],
        onClick: ({ key }) => (key === 'backup' ? backup() : restore()),
      }}
    >
      <IconBtn tip="数据备份与恢复" icon={<DatabaseOutlined />} loading={busy} />
    </Dropdown>
  );
}
