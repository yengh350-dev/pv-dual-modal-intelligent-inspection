import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, Download, LayoutGrid, List, Plus, RefreshCw, Save, Search, ShieldCheck } from 'lucide-react';
import { Button, Drawer, Field, Status } from '../components/ui';
import { createWorkOrder, getAnomalies, getApiErrorMessage, getWorkOrder, getWorkOrders, updateWorkOrder, type ServerWorkOrder, type WorkOrderStatus } from '../lib/api';
import { downloadCsv, notify } from '../lib/actions';
import { findEvidenceForEvent } from '../lib/evidenceAssets';

const stages: WorkOrderStatus[] = ['待排程', '已派发', '处理中', '待验收', '已关闭', '已取消'];
const nextStages: Partial<Record<WorkOrderStatus, WorkOrderStatus>> = { '待排程': '已派发', '已派发': '处理中', '处理中': '待验收', '待验收': '已关闭' };
const nextLabels: Partial<Record<WorkOrderStatus, string>> = { '待排程': '派发工单', '已派发': '开始处理', '处理中': '提交验收', '待验收': '验收通过并关闭' };
const terminal = (status: WorkOrderStatus) => status === '已关闭' || status === '已取消';
const dateText = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未设置';
const overdue = (order: ServerWorkOrder) => !terminal(order.status) && !!order.dueAt && new Date(order.dueAt).getTime() < Date.now();
const tone = (status: WorkOrderStatus) => status === '已关闭' ? 'good' as const : status === '已取消' ? 'neutral' as const : status === '待验收' ? 'warn' as const : 'info' as const;

export default function WorkOrdersPage() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ['workflow-orders'], queryFn: getWorkOrders });
  const events = useQuery({ queryKey: ['workflow-anomalies'], queryFn: getAnomalies });
  const linkedEvent = params.get('event');
  const requested = params.get('order') ?? (linkedEvent ? list.data?.find(order => order.anomalyId === linkedEvent)?.id : undefined);
  const detailQuery = useQuery({ queryKey: ['workflow-order', requested], queryFn: () => getWorkOrder(requested!), enabled: !!requested });
  const [draft, setDraft] = useState<ServerWorkOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'return' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({ title: '', owner: '', reviewer: '', anomalyId: '', priority: '高', dueAt: '', requirements: '', initialStatus: '待排程' as '待排程' | '已派发' });
  const orders = list.data ?? [];
  const layout = params.get('view') === 'board' ? 'board' : 'list';
  const query = params.get('q') ?? '';
  const filter = params.get('state') ?? '在办';
  const onlyOverdue = params.get('overdue') === '1';
  const filtered = orders.filter(order => (filter === '全部' || (filter === '在办' ? !terminal(order.status) : order.status === filter)) && (!onlyOverdue || overdue(order)) && `${order.id} ${order.title} ${order.owner} ${order.anomalyId ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const createOpen = params.get('create') === '1';
  const setFilter = (key: string, value: string) => { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next, { replace: true }); };
  const closeDetail = () => {
    const next = new URLSearchParams(params); next.delete('order'); next.delete('event'); setParams(next, { replace: true });
    setDraft(null); setDirty(false); setError(''); setReviewAction(null); setLeaveOpen(false);
  };
  useEffect(() => { setDraft(null); setDirty(false); setError(''); setReviewAction(null); }, [requested]);
  useEffect(() => { if (detailQuery.data && !dirty) setDraft(detailQuery.data); }, [detailQuery.data, dirty, requested]);
  useEffect(() => {
    if (!createOpen) return;
    const event = events.data?.find(item => item.id === params.get('event'));
    setForm(value => ({ ...value, anomalyId: event?.id ?? '', title: event ? `处置 ${event.array} / ${event.module} ${event.type}` : value.title }));
  }, [createOpen, events.data, params.get('event')]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const edit = (patch: Partial<ServerWorkOrder>) => { setDraft(value => value ? { ...value, ...patch } : value); setDirty(true); };
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ['workflow-orders'] });
    await cache.invalidateQueries({ queryKey: ['workflow-anomalies'] });
    await cache.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('workspace') });
  };
  const save = async (status?: WorkOrderStatus) => {
    if (!draft || saving) return;
    setSaving(true); setError('');
    try {
      const updated = await updateWorkOrder(draft, status);
      setDirty(false); setDraft(updated); setReviewAction(null);
      await refresh();
      await cache.invalidateQueries({ queryKey: ['workflow-order', draft.id] });
      notify(status ? '工单阶段已更新' : '处置记录已保存', `${updated.id} · ${updated.status}`);
    } catch (caught) { setError(getApiErrorMessage(caught, '保存失败，输入内容仍然保留，请检查连接后重试。')); }
    finally { setSaving(false); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError('');
    try {
      const result = await createWorkOrder({ ...form, anomalyId: form.anomalyId || undefined, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined });
      await refresh();
      const next = new URLSearchParams(params); next.delete('create'); next.delete('event'); next.set('order', result.id); setParams(next, { replace: true });
      setForm({ title: '', owner: '', reviewer: '', anomalyId: '', priority: '高', dueAt: '', requirements: '', initialStatus: '待排程' });
      notify('工单已保存到平台', result.id);
    } catch (caught) { setError(getApiErrorMessage(caught, '工单未创建，请检查连接后重试。')); }
    finally { setSaving(false); }
  };
  const ready = draft && draft.checklist.every(item => item.done) && draft.resolution.trim().length >= 2 && draft.reviewer.trim().length >= 2 && draft.owner !== draft.reviewer;
  const evidence = draft?.anomalyId ? findEvidenceForEvent(draft.anomalyId) : undefined;
  const duplicate = orders.find(order => order.anomalyId === form.anomalyId && !terminal(order.status));

  return <div className="page workorder-page workflow-page">
    <header className="workflow-heading"><div><h1>运维工单</h1><p>异常处置与验收</p></div><div><Button onClick={() => void refresh()} loading={list.isFetching}><RefreshCw />刷新</Button><Button variant="primary" disabled={list.isError} onClick={() => { setError(''); setFilter('create', '1'); }}><Plus />新建工单</Button></div></header>
    <div className="workflow-summary"><span>在办 <strong>{orders.filter(order => !terminal(order.status)).length}</strong></span><span className="danger-text">已逾期 <strong>{orders.filter(overdue).length}</strong></span><span>待验收 <strong>{orders.filter(order => order.status === '待验收').length}</strong></span><span>已关闭 <strong>{orders.filter(order => order.status === '已关闭').length}</strong></span><small>平台数据库{list.isFetching ? ' · 更新中' : ''}</small></div>
    <div className="workflow-toolbar"><label className="inline-search"><Search /><input aria-label="搜索工单" value={query} onChange={event => setFilter('q', event.target.value)} placeholder="工单、异常或负责人" /></label><select aria-label="工单状态" value={filter} onChange={event => setFilter('state', event.target.value)}>{['在办', '全部', ...stages].map(value => <option key={value}>{value}</option>)}</select><label className="workflow-checkbox"><input type="checkbox" checked={onlyOverdue} onChange={event => setFilter('overdue', event.target.checked ? '1' : '')} />仅逾期</label><div className="segmented" aria-label="工单视图"><button aria-label="列表视图" aria-pressed={layout === 'list'} className={layout === 'list' ? 'active' : ''} onClick={() => setFilter('view', 'list')}><List /></button><button aria-label="看板视图" aria-pressed={layout === 'board'} className={layout === 'board' ? 'active' : ''} onClick={() => setFilter('view', 'board')}><LayoutGrid /></button></div><Button disabled={!filtered.length} onClick={() => downloadCsv('work-orders.csv', [['工单号','标题','异常','负责人','验收人','状态','截止时间','结论'], ...filtered.map(order => [order.id,order.title,order.anomalyId ?? '',order.owner,order.reviewer,order.status,order.dueAt ?? '',order.resolution])])}><Download />导出</Button></div>
    {list.isError ? <div className="workflow-feedback" role="alert"><strong>工单服务不可达</strong><p>{getApiErrorMessage(list.error, '请检查平台 API 后刷新。未显示本地样例作为已保存工单。')}</p></div> : list.isPending ? <div className="workflow-feedback" role="status">正在读取工单…</div> : !filtered.length ? <div className="workflow-empty"><ClipboardCheck /><h2>{orders.length ? '没有符合条件的工单' : '暂无工单'}</h2><Button onClick={() => { const next = new URLSearchParams(params); ['q','state','overdue'].forEach(key => next.delete(key)); setParams(next); }}>清除筛选</Button></div> : layout === 'list' ? <div className="workflow-table-wrap"><table className="workflow-table"><thead><tr><th>工单 / 关联异常</th><th>负责人</th><th>优先级</th><th>状态</th><th>作业清单</th><th>要求完成</th></tr></thead><tbody>{filtered.map(order => <tr key={order.id}><td><button onClick={() => { setDirty(false); setFilter('order', order.id); }}>{order.title}<ArrowRight /></button><small>{order.id} · {order.anomalyId ?? '独立工单'}</small></td><td>{order.owner}<small>验收：{order.reviewer || '未指定'}</small></td><td><Status tone={order.priority === '紧急' ? 'danger' : order.priority === '高' ? 'warn' : 'info'}>{order.priority}</Status></td><td><Status tone={tone(order.status)}>{order.status}</Status></td><td>{order.checklist.filter(item => item.done).length} / {order.checklist.length}</td><td className={overdue(order) ? 'danger-text' : ''}>{dateText(order.dueAt)}{overdue(order) ? <small>已逾期</small> : null}</td></tr>)}</tbody></table></div> : <div className="workflow-board">{stages.filter(stage => filter !== '在办' || !terminal(stage)).map(stage => <section key={stage} className={`workflow-column phase-${stages.indexOf(stage)}`}><header><h2>{stage}</h2><span>{filtered.filter(order => order.status === stage).length}</span></header>{filtered.filter(order => order.status === stage).map(order => <button className="workflow-order-card" key={order.id} onClick={() => setFilter('order', order.id)}><span><Status tone={order.priority === '紧急' ? 'danger' : order.priority === '高' ? 'warn' : 'info'}>{order.priority}</Status><small>{order.id}</small></span><strong>{order.title}</strong><p>{order.anomalyId ?? '独立工单'}</p><footer><span>{order.owner}</span><time className={overdue(order) ? 'danger-text' : ''}>{dateText(order.dueAt)}</time></footer></button>)}{!filtered.some(order => order.status === stage) ? <p className="workflow-column-empty">暂无工单</p> : null}</section>)}</div>}
    <Drawer open={!!requested && !createOpen} title="工单处置与验收" width="wide" onClose={() => !saving && (dirty ? setLeaveOpen(true) : closeDetail())}>
      {detailQuery.isError ? <div className="workflow-feedback" role="alert">{getApiErrorMessage(detailQuery.error, '无法读取此工单')}<Button onClick={() => void detailQuery.refetch()}>重新读取</Button></div> : !draft ? <p role="status">正在读取工单详情…</p> : <div className="workflow-detail"><header><Status tone={tone(draft.status)}>{draft.status}</Status><h2>{draft.title}</h2><p>{draft.id} · 修订 {draft.revision}</p></header>
      {draft.anomalyId ? <div className="workflow-evidence">{evidence ? <img src={evidence.thermal} alt="关联事件的对齐演示热像" /> : null}<div><strong>{draft.anomalyId}</strong><small>{evidence?.source ?? '尚无可展示的配对影像'}</small><Button disabled={dirty || saving} onClick={() => navigate('/evidence?event=' + draft.anomalyId)}>查看关联证据 <ArrowRight /></Button></div></div> : null}
      <dl className="workflow-facts"><div><dt>执行负责人</dt><dd>{draft.owner}</dd></div><div><dt>要求完成</dt><dd>{dateText(draft.dueAt)}</dd></div><div><dt>创建时间</dt><dd>{dateText(draft.createdAt)}</dd></div></dl>
      {draft.liveObservationId ? <Button disabled={dirty || saving} onClick={() => navigate('/command-center?observation=' + draft.liveObservationId)}>查看工单冻结帧 <ArrowRight /></Button> : null}
      {draft.requirements ? <section><h3>处置要求</h3><p className="workflow-text">{draft.requirements}</p></section> : null}
      <fieldset disabled={saving || terminal(draft.status)}><legend>现场处置</legend><div className="workflow-checklist">{draft.checklist.map(item => <label key={item.id}><input type="checkbox" checked={item.done} onChange={() => edit({ checklist: draft.checklist.map(entry => entry.id === item.id ? { ...entry, done: !entry.done } : entry) })} />{item.label}</label>)}</div><Field label="现场处置记录"><textarea aria-label="现场处置记录" value={draft.notes} maxLength={8000} onChange={event => edit({ notes: event.target.value })} /></Field><Field label="处置结论"><textarea aria-label="处置结论" value={draft.resolution} maxLength={4000} onChange={event => edit({ resolution: event.target.value })} /></Field><Field label="验收负责人"><input aria-label="验收负责人" value={draft.reviewer} onChange={event => edit({ reviewer: event.target.value })} maxLength={80} /></Field></fieldset>
      {!terminal(draft.status) ? <p className="workflow-boundary"><ShieldCheck />提交验收须完成清单、填写结论，并由不同人员验收。</p> : null}
      {error ? <div className="workflow-feedback" role="alert"><p>{error}</p><Button disabled={saving} onClick={() => { if (!dirty || window.confirm('重新读取会放弃当前未保存内容，是否继续？')) { setDirty(false); void detailQuery.refetch(); } }}>重新读取平台版本</Button></div> : null}
      <section className="workflow-history"><h3>平台流转记录</h3>{detailQuery.data?.history?.length ? detailQuery.data.history.map((item, index) => <article key={index}><time>{dateText(item.createdAt)}</time><strong>{item.action === 'work_order.create' ? '创建工单' : item.action === 'live.dispatch' ? '视频冻结帧复核派单' : '保存或流转'}</strong></article>) : <p>历史工单尚无可追溯的流转日志。</p>}</section>
      {leaveOpen ? <div className="workflow-feedback"><strong>尚有未保存内容</strong><div><Button onClick={() => setLeaveOpen(false)}>继续编辑</Button><Button variant="danger" onClick={closeDetail}>放弃本次修改</Button></div></div> : null}
      {reviewAction ? <div className="workflow-feedback"><Field label={reviewAction === 'return' ? '退回原因' : '取消原因'}><textarea value={reason} onChange={event => setReason(event.target.value)} /></Field><Button disabled={saving || reason.trim().length < 2} onClick={async () => { const updated = { ...draft, resolution: reviewAction === 'return' ? draft.resolution : reason.trim(), notes: `${draft.notes}\n${reviewAction === 'return' ? '退回' : '取消'}：${reason.trim()}` }; setSaving(true); try { const saved = await updateWorkOrder(updated, reviewAction === 'return' ? '处理中' : '已取消'); setDirty(false); setDraft(saved); setReviewAction(null); await refresh(); await detailQuery.refetch(); } catch (caught) { setError(getApiErrorMessage(caught)); } finally { setSaving(false); } }}>确认{reviewAction === 'return' ? '退回' : '取消'}</Button><Button onClick={() => setReviewAction(null)}>返回</Button></div> : null}
      <footer className="workflow-detail-actions"><span role="status">{dirty ? '有未保存修改' : '已读取平台记录'}</span>{!terminal(draft.status) ? <><Button onClick={() => void save()} loading={saving} disabled={!dirty}><Save />保存记录</Button>{draft.status === '待验收' ? <Button disabled={saving} onClick={() => { setReason(''); setReviewAction('return'); }}>退回处理</Button> : null}<Button variant="primary" disabled={saving || ((draft.status === '处理中' || draft.status === '待验收') && !ready)} onClick={() => void save(nextStages[draft.status])}>{nextLabels[draft.status]}</Button><Button variant="ghost" disabled={saving} onClick={() => { setReason(''); setReviewAction('cancel'); }}>取消工单</Button></> : null}</footer>
      </div>}
    </Drawer>
    <Drawer open={createOpen} title="新建运维工单" onClose={() => !saving && setFilter('create', '')}><form className="form-stack workflow-create" onSubmit={create}>
      <Field label="关联异常"><select aria-label="关联异常" value={form.anomalyId} onChange={event => { const item = events.data?.find(entry => entry.id === event.target.value); setForm(value => ({ ...value, anomalyId: item?.id ?? '', title: item ? `处置 ${item.array} / ${item.module} ${item.type}` : value.title })); }}><option value="">独立现场运维工单</option>{events.data?.map(item => <option key={item.id} value={item.id} disabled={!['已确认','已转工单'].includes(item.status)}>{item.id} · {item.type} · {item.status}</option>)}</select></Field>
      {duplicate ? <div className="workflow-feedback">该异常已有在办工单 {duplicate.id}<Button type="button" onClick={() => { const next = new URLSearchParams(params); next.delete('create'); next.delete('event'); next.set('order', duplicate.id); setParams(next); }}>查看已有工单</Button></div> : null}
      <Field label="工单标题"><input aria-label="工单标题" required minLength={3} maxLength={180} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></Field><Field label="执行负责人"><input aria-label="执行负责人" required minLength={2} value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })} /></Field><Field label="验收负责人"><input aria-label="新工单验收负责人" required minLength={2} value={form.reviewer} onChange={event => setForm({ ...form, reviewer: event.target.value })} /></Field><Field label="要求完成"><input aria-label="要求完成" type="datetime-local" required value={form.dueAt} onChange={event => setForm({ ...form, dueAt: event.target.value })} /></Field><Field label="优先级"><select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{['紧急','高','中','低'].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="初始阶段"><select value={form.initialStatus} onChange={event => setForm({ ...form, initialStatus: event.target.value as '待排程' | '已派发' })}><option>待排程</option><option>已派发</option></select></Field><Field label="处置要求"><textarea aria-label="处置要求" value={form.requirements} onChange={event => setForm({ ...form, requirements: event.target.value })} /></Field>
      {error ? <p className="form-error" role="alert">{error}</p> : null}<Button type="submit" variant="primary" loading={saving} disabled={!!duplicate || !list.data || form.owner.trim() === form.reviewer.trim() || (!!form.anomalyId && !events.data?.some(item => item.id === form.anomalyId && ['已确认','已转工单'].includes(item.status)))}>保存{form.initialStatus === '已派发' ? '并派发' : '待排程工单'}</Button>
    </form></Drawer>
  </div>;
}
