import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, BrainCircuit, ClipboardCheck, Database, ImageIcon, Plane, Search, X } from 'lucide-react';
import { Drawer, IconButton } from './ui';
import { searchWorkspace } from '../lib/workspace';
import { getApiErrorMessage } from '../lib/api';

const commands = [
  { id: 'home', title: '打开运维工作台', detail: '证据复核 / 工单 / 验收', path: '/dashboard', icon: ClipboardCheck },
  { id: 'mission', title: '创建巡检任务', detail: '登记范围与飞行设备', path: '/missions?create=1', icon: Plane },
  { id: 'video', title: '打开视频巡检指挥台', detail: '无人机视频 / 录像 / 冻结帧', path: '/command-center', icon: Plane },
  { id: 'evidence', title: '复核双模态证据', detail: 'RGB / Thermal / 检测结果', path: '/evidence', icon: ImageIcon },
  { id: 'order', title: '新建运维工单', detail: '派单 / 维修 / 验收', path: '/work-orders?create=1', icon: ClipboardCheck },
  { id: 'data', title: '导入巡检数据', detail: '图片 / 任务包 / 校验', path: '/data?upload=1', icon: Database },
  { id: 'model', title: '查看模型与精度', detail: '算法 / 权重 / 指标', path: '/models', icon: BrainCircuit },
];

export default function CommandPalette({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setQuery(''); setDebounced(''); setActive(0);
    const id = window.setTimeout(() => input.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);
  const search = useQuery({ queryKey: ['workspace-search', debounced], queryFn: ({ signal }) => searchWorkspace(debounced, signal), enabled: open && debounced.length >= 2, retry: false });
  const filtered = commands.filter(item => (item.title + item.detail).toLowerCase().includes(query.trim().toLowerCase()));
  const records = debounced === query.trim() ? search.data ?? [] : [];
  const choices = [
    ...records.map(item => ({ ...item, detail: item.id + ' · ' + item.status, icon: item.kind === 'order' ? ClipboardCheck : item.kind === 'anomaly' ? Activity : Plane, key: item.kind + item.id })),
    ...filtered.map(item => ({ ...item, key: item.id })),
  ];
  useEffect(() => { setActive(0); }, [query]);
  const selected = Math.min(active, Math.max(0, choices.length - 1));
  useEffect(() => { list.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  return <Drawer open={open} onClose={onClose} title="搜索与快捷操作" width="wide">
    <div className="workspace-search-box"><Search /><input ref={input} role="combobox" aria-label="搜索平台记录或功能" aria-expanded={choices.length > 0} aria-controls="workspace-search-results" aria-autocomplete="list" aria-activedescendant={choices.length ? 'choice-' + choices[selected].key : undefined} placeholder="输入编号、负责人、场站或功能…" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, Math.min(choices.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && choices[selected]) { event.preventDefault(); onNavigate(choices[selected].path); }
    }} />{query ? <IconButton label="清空搜索" onClick={() => { setQuery(''); input.current?.focus(); }}><X /></IconButton> : null}</div>
    {query.trim().length >= 2 ? <p className="workspace-search-status" role="status">{debounced !== query.trim() || search.isFetching ? '正在搜索平台记录…' : search.isError ? getApiErrorMessage(search.error, '平台记录搜索不可用，仍可使用下方功能入口。') : records.length ? '平台记录 · ' + records.length + ' 项' : '没有匹配的平台记录'}</p> : null}
    <div ref={list} id="workspace-search-results" role="listbox" aria-label="搜索结果" className="workspace-search-results">{choices.map((item, index) => <button key={item.key} id={'choice-' + item.key} role="option" aria-selected={selected === index} data-selected={selected === index} onMouseEnter={() => setActive(index)} onClick={() => onNavigate(item.path)}><item.icon /><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight /></button>)}</div>
    {!choices.length && !search.isFetching ? <p className="workspace-search-status">没有匹配结果，请换一个关键词。</p> : null}
  </Drawer>;
}
