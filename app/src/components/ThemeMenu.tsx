import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Dropdown } from 'antd';
import { setThemeMode, useTheme, type ThemeMode } from '../theme';
import IconBtn from './IconBtn';

const ICONS = {
  system: <DesktopOutlined />,
  light: <SunOutlined />,
  dark: <MoonOutlined />,
};

/** 主题切换:跟随系统 / 浅色 / 深色(顶部栏) */
export default function ThemeMenu() {
  const { mode } = useTheme();
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectable: true,
        selectedKeys: [mode],
        items: [
          { key: 'system', icon: ICONS.system, label: '跟随系统' },
          { key: 'light', icon: ICONS.light, label: '浅色' },
          { key: 'dark', icon: ICONS.dark, label: '深色' },
        ],
        onClick: ({ key }) => setThemeMode(key as ThemeMode),
      }}
    >
      <IconBtn tip="主题" icon={ICONS[mode]} />
    </Dropdown>
  );
}
