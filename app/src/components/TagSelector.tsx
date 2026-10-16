import { App, Select, Tag as AntTag } from 'antd';
import { useState } from 'react';
import { api, errMsg } from '../api';
import type { Tag } from '../types';

export const PALETTE = ['#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2', '#f5222d', '#faad14'];

interface Props {
  kbId: number;
  allTags: Tag[];
  value: number[];
  size?: 'large' | 'middle' | 'small';
  onChange: (ids: number[]) => void;
  /** 新建标签后通知父组件刷新标签列表 */
  onTagsChanged: () => void;
}

/** 多选标签,输入不存在的名称并回车即可新建 */
export default function TagSelector({ kbId, allTags, value, size, onChange, onTagsChanged }: Props) {
  const { message } = App.useApp();
  const [search, setSearch] = useState('');

  const handle = async (vals: (number | string)[]) => {
    const ids: number[] = [];
    for (const v of vals) {
      if (typeof v === 'number') {
        ids.push(v);
        continue;
      }
      const name = v.trim();
      const exist = allTags.find((t) => t.name === name);
      if (exist) {
        ids.push(exist.id);
        continue;
      }
      try {
        const t = await api.tagCreate(kbId, name, PALETTE[allTags.length % PALETTE.length]);
        ids.push(t.id);
        onTagsChanged();
      } catch (e) {
        message.error(errMsg(e));
      }
    }
    onChange(ids);
    setSearch('');
  };

  return (
    <Select
      mode="tags"
      size={size}
      style={{ width: '100%' }}
      placeholder="选择或输入新标签后回车"
      value={value}
      searchValue={search}
      onSearch={setSearch}
      onChange={handle}
      options={allTags.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
      optionFilterProp="label"
      tagRender={({ value: v, label, closable, onClose }) => {
        const t = allTags.find((x) => x.id === v);
        return (
          <AntTag color={t?.color} closable={closable} onClose={onClose} style={{ marginRight: 4, borderRadius: 14, height: 28, display: 'inline-flex', alignItems: 'center', padding: '0 10px', fontSize: 13 }}>
            {label}
          </AntTag>
        );
      }}
    />
  );
}
