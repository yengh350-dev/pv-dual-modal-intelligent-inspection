import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Inbox, MapPinned, Plane, RefreshCw, ScanSearch, ShieldCheck, Upload } from 'lucide-react';
import { Button, Status } from '../components/ui';
import { getApiErrorMessage } from '../lib/api';
import { getIdentity, getWorkspace, type QueueKind } from '../lib/workspace';

const queues: { key: QueueKind; label: string; icon: typeof Inbox; tone: string }[] = [
  { key: 'review', label: '证据待复核', icon: ScanSearch, tone: 'amber' },
  { key: 'dispatch', label: '已确认待派工', icon: Inbox, tone: 'red' },
  { key: 'orders', label: '在办工单', icon: ClipboardCheck, tone: 'blue' },
  { key: 'acceptance', label: '等待验收', icon: ShieldCheck, tone: 'violet' },
  { key: 'overdue', label: '逾期工单', icon: Clock3, tone: 'red' },
  { key: 'missions', label: '未完成任务', icon: Plane, tone: 'cyan' },
];
const riskText: Record<string, string> = { critical: '严重', high: '高', medium: '中', low: '低', info: '任务' };
const tone = (risk: string) => risk === 'critical' ? 'danger' as const : risk === 'high' ? 'warn' as const : risk === 'medium' ? 'info' as const : 'neutral' as const;
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未设置';
const auditLabels: Record<string, string> = { 'work_order.create': '创建工单', 'work_order.update': '工单更新', 'anomaly.review': '异常复核', 'mission.create': '创建任务', 'auth.login': '登录工作空间', 'live.dispatch': '冻结帧复核派单' };

export default function WorkbenchPage() {
  const [params, setParams] = useSearchParams();
  const queue = queues.some(item => item.key === params.get('queue')) ? params.get('queue') as QueueKind : 'review';
  const site = params.get('site') ?? '';
  const mine = params.get('mine') === '1';
  const parsedPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const [expanded, setExpanded] = useState<string | null>(null);
  const identity = useQuery({ queryKey: ['identity'], queryFn: getIdentity, retry: false });
  const snapshot = useQuery({ queryKey: ['workspace', site, queue, mine, page], queryFn: ({ signal }) => getWorkspace({ site: site || undefined, queue, mine, page }, signal), refetchInterval: 60_000 });
  const data = snapshot.data;
  const active = queues.find(item => item.key === queue)!;
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
    setExpanded(null);
  };
  useEffect(() => {
    if (!data) return;
    window.dispatchEvent(new CustomEvent('sentinel:copilot-context', { detail: {
      module: '运维工作台', site: site || '全部场站', source: '平台数据库',
      checkedAt: data.checkedAt, queue, counts: data.counts,
      selectedItem: data.items.find(item => item.id === expanded) ?? null,
    } }));
  }, [data, expanded, queue, site]);

  return <div className="page workbench-page">
    <header className="workbench-heading">
      <div><h1>运维工作台</h1><p>{identity.data ? identity.data.name + '，' : ''}复核证据、推进处置、完成验收。</p></div>
      <div className="workbench-actions"><Button loading={snapshot.isFetching} onClick={() => void snapshot.refetch()}><RefreshCw />刷新待办</Button><Link className="button button-primary" to="/work-orders?create=1"><ClipboardCheck />新建工单</Link></div>
    </header>
    <div className="workspace-scope">
      <label><MapPinned /><span>场站</span><select aria-label="待办场站" value={site} onChange={event => setFilter('site', event.target.value)}><option value="">全部场站</option>{data?.sites.map(name => <option key={name}>{name}</option>)}{site && !data?.sites.includes(site) ? <option>{site}</option> : null}</select></label>
      <label className="workspace-mine"><input type="checkbox" checked={mine} onChange={event => setFilter('mine', event.target.checked ? '1' : '')} />仅我的执行工单</label>
      <span className="workspace-source">{snapshot.isError ? <Status tone="danger">读取失败</Status> : data ? <><Status tone={data.environment === 'production' || data.environment === 'prod' ? 'good' : 'neutral'}>{data.environment === 'production' || data.environment === 'prod' ? '生产环境' : '本地 / 演示环境'}</Status><time>快照 {formatDate(data.checkedAt)}</time></> : <span role="status">正在读取平台数据库</span>}</span>
    </div>
    <nav className="workbench-counters" aria-label="待办分类">
      {queues.map(({ key, label, icon: Icon, tone: color }) => <button key={key} className={queue === key ? 'selected' : ''} aria-pressed={queue === key} data-tone={color} onClick={() => setFilter('queue', key)}><span><Icon />{label}</span><strong>{snapshot.isError ? '—' : data?.counts[key] ?? '…'}</strong><small>{key === 'dispatch' ? '有效异常 · 等待处置' : key === 'review' ? '风险优先 · 人工确认' : key === 'overdue' ? '截止时间已过' : key === 'acceptance' ? '独立人员复核' : key === 'orders' ? mine ? '当前账号执行' : '排程到验收' : '计划 / 执行 / 复核'}</small></button>)}
    </nav>
    <div className="workbench-body">
      <section className="workbench-queue" aria-labelledby="queue-title">
        <header><div><h2 id="queue-title">{active.label}</h2><p>{queue === 'review' || queue === 'dispatch' ? '按风险等级、发现时间排序' : queue === 'missions' ? '较早任务优先' : '逾期优先，其次按优先级与截止时间'}</p></div><span>{data ? data.total + ' 项' : '—'}</span></header>
        {snapshot.isError ? <div className="workspace-feedback" role="alert"><Inbox /><h3>待办暂时无法读取</h3><p>{getApiErrorMessage(snapshot.error, '请检查后端连接后重试，未使用演示数字替代。')}</p><Button onClick={() => void snapshot.refetch()}><RefreshCw />重新读取</Button></div> : snapshot.isPending ? <div className="workspace-skeleton" role="status" aria-label="正在载入待办">{[0, 1, 2, 3].map(row => <div key={row}><i /><i /><i /></div>)}</div> : !data?.items.length ? <div className="workspace-feedback"><ShieldCheck /><h3>{page > 1 ? '这一页没有待办' : '当前范围没有此类待办'}</h3><p>{site ? '独立工单未关联场站，需在全部场站中查看。' : mine && queue !== 'review' && queue !== 'dispatch' && queue !== 'missions' ? '当前账号名下没有匹配的执行工单。' : '新任务与处置状态更新后，会出现在这里。'}</p><Button onClick={() => { const next = new URLSearchParams(); next.set('queue', queue); setParams(next, { replace: true }); }}>查看全部场站</Button></div> : <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th scope="col">事项 / 位置</th><th scope="col">等级</th><th scope="col">{queue === 'review' || queue === 'dispatch' ? '发现时间' : queue === 'missions' ? '创建时间' : '负责人 / 截止'}</th><th scope="col">状态 / 操作</th></tr></thead><tbody>{data.items.map(item => <Fragment key={item.id}>
          <tr><td><button className="workspace-row-title" aria-expanded={expanded === item.id} aria-controls={'detail-' + item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}><ChevronDown /><span><strong>{item.title}</strong><small>{item.id} · {item.location}</small></span></button></td><td><Status tone={tone(item.severity)}>{riskText[item.severity] ?? item.severity}</Status></td><td>{item.owner ? <strong className="workspace-owner">{item.owner}</strong> : null}<time className={item.overdue ? 'workspace-overdue' : ''}>{formatDate(item.kind === 'order' ? item.dueAt : item.createdAt)}{item.overdue ? ' · 已逾期' : ''}</time></td><td><span className="workspace-stage">{item.status}</span><Link to={item.path}>{item.action}<ArrowRight /></Link></td></tr>
          <tr id={'detail-' + item.id} hidden={expanded !== item.id} className="workspace-expanded"><td colSpan={4}><dl><div><dt>场站</dt><dd>{item.site ?? '尚未关联场站'}</dd></div><div><dt>记录来源</dt><dd>平台数据库</dd></div><div><dt>登记时间</dt><dd>{formatDate(item.createdAt)}</dd></div></dl><p>{item.kind === 'anomaly' ? '异常等级来自记录，不代表模型已完成工程诊断；请结合原始影像和现场复测确认。' : item.kind === 'order' ? '所有阶段变更均在工单详情中执行，保留修订与审计记录。' : '任务状态来自任务库，不代表无人机已连接或处于可飞状态。'}</p><Link to={item.path}>{item.action}<ArrowRight /></Link></td></tr>
        </Fragment>)}</tbody></table></div>}
        <footer className="workspace-pagination"><span>第 {page} 页{data ? ' / ' + Math.max(1, Math.ceil(data.total / data.pageSize)) + ' 页' : ''}</span><Button aria-label="上一页待办" disabled={page === 1 || snapshot.isFetching} onClick={() => setFilter('page', String(page - 1))}><ChevronLeft />上一页</Button><Button aria-label="下一页待办" disabled={!data || page * data.pageSize >= data.total || snapshot.isFetching} onClick={() => setFilter('page', String(page + 1))}>下一页<ChevronRight /></Button></footer>
      </section>
      <aside className="workbench-aside">
        <section className="workspace-entries"><h2>巡检与处置</h2><Link to="/command-center"><Plane /><span><strong>视频巡检指挥台</strong><small>接入视频、冻结帧与复核派单</small></span><ArrowRight /></Link><Link to="/data?upload=1"><Upload /><span><strong>导入巡检证据</strong><small>任务包与影像校验</small></span><ArrowRight /></Link><Link to="/models"><ScanSearch /><span><strong>算法与模型版本</strong><small>真实权重、测试表现与使用边界</small></span><ArrowRight /></Link></section>
        <section className="workspace-activity"><h2>最近流转</h2>{snapshot.isError ? <p>待连接平台后读取。</p> : !data?.activity.length ? <p>当前范围尚无流转记录。</p> : <ol>{data.activity.map(log => <li key={log.id}><time>{formatDate(log.createdAt)}</time><strong>{auditLabels[log.action] ?? log.action}</strong><small>{log.resourceId ?? '平台记录'}</small></li>)}</ol>}</section>
        <div className="workspace-boundary"><ShieldCheck /><p>模型辅助识别，人员确认结论。当前状态来自数据库快照，不代表设备实时遥测。</p></div>
      </aside>
    </div>
  </div>;
}
