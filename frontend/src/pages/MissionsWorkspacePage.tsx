import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Download, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Button, Drawer, Field, Status } from '../components/ui';
import { createMission, getApiErrorMessage } from '../lib/api';
import { getMission, getMissionList } from '../lib/workspace';
import { downloadJson, notify } from '../lib/actions';

export default function MissionsWorkspacePage() {
  const [params, setParams] = useSearchParams();
  const cache = useQueryClient();
  const [draft, setDraft] = useState({ name: '', site: '', aircraft: '', payload: 'RGB + Thermal' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const query = params.get('q') ?? '';
  const [debounced, setDebounced] = useState(query);
  useEffect(() => { const id = window.setTimeout(() => setDebounced(query.trim()), 250); return () => window.clearTimeout(id); }, [query]);
  const pageValue = Number(params.get('page') ?? 1);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const status = params.get('status') ?? '';
  const selected = params.get('mission');
  const createOpen = params.get('create') === '1';
  const list = useQuery({ queryKey: ['mission-library', page, debounced, status], queryFn: ({ signal }) => getMissionList({ page, q: debounced || undefined, status: status || undefined }, signal) });
  const detail = useQuery({ queryKey: ['mission-record', selected], queryFn: () => getMission(selected!), enabled: !!selected });
  const setFilter = (key: string, value: string) => { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); if (key !== 'page') next.delete('page'); setParams(next, { replace: true }); };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError('');
    try {
      const result = await createMission(draft);
      await cache.invalidateQueries({ queryKey: ['mission-library'] });
      await cache.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('workspace') });
      const next = new URLSearchParams(); next.set('mission', result.id); setParams(next);
      setDraft({ name: '', site: '', aircraft: '', payload: 'RGB + Thermal' });
      notify('任务已保存', result.id + ' · 计划中');
    } catch (caught) { setError(getApiErrorMessage(caught, '任务未保存，请检查连接后重试。')); }
    finally { setSaving(false); }
  };
  return <div className="page mission-library-page">
    <header className="workbench-heading"><div><h1>任务与航线</h1><p>任务登记、证据归档与执行状态。</p></div><div className="workbench-actions"><Button loading={list.isFetching} onClick={() => void list.refetch()}><RefreshCw />刷新</Button><Button variant="primary" onClick={() => { setError(''); setFilter('create', '1'); }}><Plus />新建任务</Button></div></header>
    <div className="workspace-scope"><label className="workspace-search-inline"><Search /><input aria-label="搜索任务库" placeholder="任务编号、名称或场站" value={query} maxLength={100} onChange={event => setFilter('q', event.target.value)} /></label><select aria-label="任务库状态" value={status} onChange={event => setFilter('status', event.target.value)}><option value="">全部状态</option>{['计划中', '执行中', '处理中', '待复核', '需复飞', '已完成', '已取消'].map(value => <option key={value}>{value}</option>)}</select><span className="workspace-source">平台数据库 · {list.data?.meta?.total ?? '—'} 项</span></div>
    <section className="workbench-queue"><div className="workspace-table-scroll"><table className="workspace-table mission-library-table"><thead><tr><th>任务 / 场站</th><th>飞行设备 / 载荷</th><th>影像 / 覆盖</th><th>状态</th><th>操作</th></tr></thead><tbody>{list.data?.data.map(mission => <tr key={mission.id}><td><strong>{mission.name}</strong><small>{mission.id} · {mission.site}</small></td><td>{mission.aircraft}<small>{mission.payload}</small></td><td>{mission.frames.toLocaleString()} 帧<small>覆盖 {mission.coverage.toFixed(1)}%</small></td><td><Status tone={mission.status === '待复核' ? 'warn' : mission.status === '已完成' ? 'good' : 'info'}>{mission.status}</Status></td><td><button className="text-action" onClick={() => setFilter('mission', mission.id)}>查看任务<ArrowRight /></button></td></tr>)}</tbody></table></div>
    {list.isError ? <div className="workspace-feedback" role="alert"><p>{getApiErrorMessage(list.error, '无法读取任务库。')}</p><Button onClick={() => void list.refetch()}>重新读取</Button></div> : list.isPending ? <p className="workspace-search-status" role="status">正在读取任务…</p> : !list.data?.data.length ? <div className="workspace-feedback"><Search /><h3>没有匹配任务</h3><p>清除筛选条件，或登记新的巡检任务。</p></div> : null}
    <footer className="workspace-pagination"><span>第 {page} 页</span><Button disabled={page === 1 || list.isFetching} onClick={() => setFilter('page', String(page - 1))}><ChevronLeft />上一页</Button><Button disabled={!list.data || page * 20 >= (list.data.meta?.total ?? 0) || list.isFetching} onClick={() => setFilter('page', String(page + 1))}>下一页<ChevronRight /></Button></footer></section>
    <p className="workspace-boundary"><ShieldCheck />航线规划与飞控须在厂商地面站确认；这里登记任务，不会自动起飞。</p>
    <Drawer open={createOpen} title="登记巡检任务" onClose={() => !saving && setFilter('create', '')}><form className="form-stack" onSubmit={create}>{(['name', 'site', 'aircraft', 'payload'] as const).map(key => <Field key={key} label={{ name: '任务名称', site: '目标场站', aircraft: '飞行设备', payload: '载荷' }[key]}><input aria-label={{ name: '任务名称', site: '目标场站', aircraft: '飞行设备', payload: '载荷' }[key]} required minLength={key === 'name' ? 3 : 2} maxLength={key === 'name' ? 160 : key === 'site' ? 120 : 80} disabled={saving} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></Field>)}<p className="workspace-boundary">保存后任务处于“计划中”，尚未关联实际航线、设备遥测或采集影像。</p>{error ? <p role="alert" className="form-error">{error}</p> : null}<Button type="submit" variant="primary" loading={saving}>保存任务</Button></form></Drawer>
    <Drawer open={!!selected && !createOpen} title="任务记录" onClose={() => setFilter('mission', '')}>{detail.isError ? <div role="alert"><p>{getApiErrorMessage(detail.error)}</p><Button onClick={() => void detail.refetch()}>重新读取</Button></div> : detail.data ? <div className="workflow-detail"><header><Status tone={detail.data.status === '已完成' ? 'good' : 'info'}>{detail.data.status}</Status><h2>{detail.data.name}</h2><p>{detail.data.id}</p></header><dl className="evidence-facts">{[['场站', detail.data.site], ['设备', detail.data.aircraft], ['载荷', detail.data.payload], ['影像', detail.data.frames + ' 帧'], ['覆盖率', detail.data.coverage + '%'], ['质量分', detail.data.quality + ' / 100']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="workspace-boundary">记录来自任务库。没有采集影像时，覆盖率和质量分尚未计算。</p><Link className="button button-primary" to={"/command-center?mission=" + encodeURIComponent(detail.data.id)}>打开视频指挥台<ArrowRight /></Link><Button onClick={() => downloadJson(detail.data!.id + '-mission.json', { ...detail.data, source: 'platform_database' })}><Download />导出任务记录</Button></div> : <p role="status">正在读取任务记录…</p>}</Drawer>
  </div>;
}
