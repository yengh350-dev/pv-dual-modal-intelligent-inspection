import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, FileCheck2, RefreshCw, Search, Thermometer, Upload, X } from 'lucide-react';
import { Button, Drawer, Field, Status } from '../components/ui';
import { getAnomalies, getApiErrorMessage, getWorkOrders, reviewAnomaly } from '../lib/api';
import { downloadCsv, notify } from '../lib/actions';
import { findEvidenceForEvent } from '../lib/evidenceAssets';

export default function AnomaliesPage() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const events = useQuery({ queryKey: ['workflow-anomalies'], queryFn: getAnomalies });
  const orders = useQuery({ queryKey: ['workflow-orders'], queryFn: getWorkOrders });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const query = params.get('q') ?? '';
  const status = params.get('status') ?? '全部';
  const severity = params.get('severity') ?? '全部';
  const rows = events.data ?? [];
  const filtered = useMemo(() => rows.filter(item => (status === '全部' || item.status === status) && (severity === '全部' || item.severity === severity) && `${item.id} ${item.type} ${item.array} ${item.module}`.toLowerCase().includes(query.trim().toLowerCase())), [events.data, status, severity, query]);
  const detail = rows.find(item => item.id === params.get('event'));
  const evidence = detail ? findEvidenceForEvent(detail.id) : undefined;
  const related = orders.data?.find(item => item.anomalyId === detail?.id && !['已关闭','已取消'].includes(item.status));
  useEffect(() => { const visible = new Set(filtered.map(item => item.id)); setSelected(items => items.filter(id => visible.has(id))); }, [filtered]);
  const setFilter = (key: string, value: string) => { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next, { replace: true }); };
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ['workflow-anomalies'] });
    await cache.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith('workspace') });
  };
  const update = async (next: string) => {
    if (!detail || busy) return;
    setBusy(true); setError('');
    try {
      await reviewAnomaly(detail.id, next, reason.trim() || undefined);
      await refresh(); setReason(''); notify('复核结果已保存', `${detail.id} · ${next}`);
    } catch (caught) { setError(getApiErrorMessage(caught, '复核结果未保存，请重试。')); }
    finally { setBusy(false); }
  };
  const reflight = async () => {
    if (busy || reason.trim().length < 2) return;
    setBusy(true); setError('');
    const results = await Promise.allSettled(selected.map(id => reviewAnomaly(id, '需复飞', reason.trim())));
    const failed = selected.filter((_, index) => results[index].status === 'rejected');
    setSelected(failed); await refresh(); setBusy(false);
    if (failed.length) setError(`已保存 ${selected.length - failed.length} 项；${failed.length} 项未完成，失败项仍被选中，请逐项检查状态。`);
    else { setReason(''); notify('复飞要求已保存', `${selected.length} 项异常等待重新采集证据`); }
  };
  const selectedReady = selected.every(id => rows.some(item => item.id === id && ['待复核','已确认'].includes(item.status)));
  return <div className="page anomalies-page workflow-page">
    <header className="workflow-heading"><div><h1>异常复核</h1><p>模型候选与人工判断</p></div><div><Button onClick={() => void refresh()} loading={events.isFetching}><RefreshCw />刷新</Button><Button onClick={() => downloadCsv('anomalies.csv', [['事件','类型','位置','温差','模型分数','配准质量','状态'], ...filtered.map(item => [item.id,item.type,item.array + '/' + item.module,item.deltaT,item.confidence,item.alignment,item.status])])} disabled={!filtered.length}><Download />导出</Button><Button variant="primary" onClick={() => navigate('/data?upload=1')}><Upload />登记现场证据</Button></div></header>
    <div className="workflow-summary"><span>当前事件 <strong>{rows.length}</strong></span><span>待复核 <strong>{rows.filter(item => item.status === '待复核').length}</strong></span><span className="danger-text">严重 / 高 <strong>{rows.filter(item => ['critical','high'].includes(item.severity) && item.status !== '已排除').length}</strong></span><span>需复飞 <strong>{rows.filter(item => item.status === '需复飞').length}</strong></span><small>平台数据库</small></div>
    <div className="workflow-toolbar"><label className="inline-search"><Search /><input aria-label="搜索异常" value={query} onChange={event => setFilter('q', event.target.value)} placeholder="事件、组件或方阵" /></label><select aria-label="异常状态" value={status} onChange={event => setFilter('status', event.target.value)}>{['全部','待复核','已确认','需复飞','已转工单','已排除'].map(value => <option key={value}>{value}</option>)}</select><select aria-label="异常等级" value={severity} onChange={event => setFilter('severity', event.target.value)}>{[['全部','全部等级'],['critical','严重'],['high','高'],['medium','中'],['low','低']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><span>{filtered.length} 项</span>{query || status !== '全部' || severity !== '全部' ? <Button variant="ghost" onClick={() => { const next = new URLSearchParams(params); ['q','status','severity'].forEach(key => next.delete(key)); setParams(next); }}><X />清除筛选</Button> : null}</div>
    {error ? <div className="workflow-feedback" role="alert">{error}</div> : null}
    {selected.length ? <div className="workflow-bulk"><strong>已选择 {selected.length} 项</strong><Button disabled={busy} onClick={() => setFilter('event', selected[0])}><FileCheck2 />逐项复核</Button><input aria-label="批量复飞原因" placeholder="复飞原因" value={reason} onChange={event => setReason(event.target.value)} /><Button disabled={busy || !selectedReady || reason.trim().length < 2} onClick={() => void reflight()}>标记需复飞</Button><Button variant="ghost" onClick={() => setSelected([])}>取消选择</Button></div> : null}
    {events.isError ? <div className="workflow-feedback" role="alert"><strong>异常服务不可达</strong><p>{getApiErrorMessage(events.error, '请检查后端连接后刷新。')}</p></div> : events.isPending ? <p role="status">正在读取异常…</p> : !filtered.length ? <div className="workflow-empty"><Thermometer /><h2>没有符合条件的异常</h2></div> : <div className="workflow-table-wrap"><table className="workflow-table"><thead><tr><th><input type="checkbox" aria-label="选择当前结果" checked={!!filtered.length && filtered.every(item => selected.includes(item.id))} onChange={event => setSelected(event.target.checked ? filtered.map(item => item.id) : [])} /></th><th>异常 / 事件</th><th>组件位置</th><th>温差 / 模型分数</th><th>配准质量</th><th>状态</th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><input type="checkbox" aria-label={`选择 ${item.id}`} checked={selected.includes(item.id)} onChange={() => setSelected(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids,item.id])} /></td><td><button onClick={() => { setError(''); setReason(''); setFilter('event', item.id); }}>{item.type}<ArrowRight /></button><small>{item.id}</small></td><td>{item.array} / {item.module}<small>{item.missionId}</small></td><td>+{item.deltaT.toFixed(1)}°C<small>模型分数 {item.confidence.toFixed(2)}</small></td><td>{Math.round(item.alignment * 100)}%</td><td><Status tone={item.status === '已排除' ? 'neutral' : item.status === '待复核' || item.status === '需复飞' ? 'warn' : 'info'}>{item.status}</Status></td></tr>)}</tbody></table></div>}
    <Drawer open={!!detail} title="异常复核" onClose={() => !busy && setFilter('event', '')}>
      {detail ? <div className="workflow-detail">{error ? <div className="workflow-feedback" role="alert">{error}</div> : null}<header><Status tone={detail.severity === 'critical' ? 'danger' : detail.severity === 'high' ? 'warn' : 'info'}>{detail.status}</Status><h2>{detail.type}</h2><p>{detail.id} · {detail.array} / {detail.module}</p></header>{evidence ? <><div className="workflow-pair"><figure><img src={evidence.rgb} alt="RGB 对齐演示影像" /><figcaption>RGB</figcaption></figure><figure><img src={evidence.thermal} alt="Thermal 对齐演示影像" /><figcaption>Thermal</figcaption></figure></div><p className="workflow-boundary">{evidence.source}</p></> : <p>此事件暂未关联可展示的配对影像。</p>}<Button onClick={() => navigate('/evidence?mission=' + detail.missionId + '&event=' + detail.id)}>打开完整证据链 <ArrowRight /></Button><p className="workflow-boundary">模型分数不等于故障概率；人工确认应结合原始影像与现场复测。</p><Field label="复核说明"><textarea aria-label="复核说明" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} /></Field>{['待复核','需复飞','已确认'].includes(detail.status) ? <div className="workflow-review-actions">{detail.status === '待复核' ? <Button variant="primary" disabled={busy || reason.trim().length < 2} onClick={() => void update('已确认')}>确认异常有效</Button> : detail.status === '需复飞' ? <Button disabled={busy} onClick={() => void update('待复核')}>进入重新复核</Button> : null}<Button disabled={busy || reason.trim().length < 2} onClick={() => void update('已排除')}>排除误报</Button>{detail.status !== '需复飞' ? <Button disabled={busy || reason.trim().length < 2} onClick={() => void update('需复飞')}>要求复飞</Button> : null}</div> : null}{related ? <Button variant="primary" onClick={() => navigate('/work-orders?order=' + related.id)}>查看已有工单 <ArrowRight /></Button> : detail.status === '已确认' && !orders.isError && !orders.isPending ? <Button variant="primary" onClick={() => navigate('/work-orders?create=1&event=' + detail.id)}>创建关联工单 <ArrowRight /></Button> : detail.status === '已排除' ? <Button disabled={busy} onClick={() => void update('待复核')}>恢复为待复核</Button> : <p className="workflow-boundary">完成有效性复核后，才能创建处置工单。</p>}</div> : null}
    </Drawer>
  </div>;
}
