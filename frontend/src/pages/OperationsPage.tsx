import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Boxes, CalendarClock, CheckCircle2, CircleDollarSign, ClipboardCheck, Download, FileCheck2, HardDrive, History, ListFilter, MapPin, Plus, Search, ShieldAlert, SlidersHorizontal, Thermometer, UserRoundCheck, Wrench } from 'lucide-react';
import { anomalies, workOrders, type WorkOrder, type WorkOrderState } from '../lib/data';
import { Button, Drawer, Field, PageHeader, Panel, Status } from '../components/ui';
import { downloadCsv, notify } from '../lib/actions';
import { getAvatar } from '../lib/avatars';
import { evidenceForEvent } from '../lib/evidenceAssets';
import WorkOrdersPage from './WorkOrdersPage';
import AnomaliesPage from './AnomaliesPage';

const initialAssets = [
  { id: 'YC-A03-18-07', array: 'A-03', health: 61, status: '重点关注', last: '今天 09:57', issue: '组件热斑', history: 3 },
  { id: 'YC-B07-04-12', array: 'B-07', health: 68, status: '工单处理中', last: '今天 10:02', issue: '连接器过热', history: 2 },
  { id: 'YC-C01-08-15', array: 'C-01', health: 72, status: '待复测', last: '今天 10:14', issue: '疑似二极管异常', history: 4 },
  { id: 'YC-A06-21-08', array: 'A-06', health: 93, status: '正常', last: '今天 10:19', issue: '无确认异常', history: 1 },
  { id: 'YC-B02-11-03', array: 'B-02', health: 82, status: '观察', last: '今天 10:08', issue: '表面污染', history: 5 }
];
type Anomaly = (typeof anomalies)[number];
type Order = WorkOrder;
type Asset = (typeof initialAssets)[number];
type AssetHistoryItem = { date: string; kind: string; title: string; detail: string; tone: 'danger' | 'warn' | 'info' | 'good'; eventId?: string; workOrderId?: string };

const assetHistory = (asset: Asset): AssetHistoryItem[] => {
  const event = anomalies.find((item) => `YC-${item.array.replace('-', '')}-${item.module}` === asset.id);
  const relatedOrder = event ? workOrders.find((item) => item.id.endsWith(event.id.slice(-3))) : undefined;
  return [
    ...(event ? [{ date: `今天 ${event.time.slice(0, 5)}`, kind: '双模态巡检', title: event.type, detail: `RGB/Thermal 配准质量 ${Math.round(event.alignment * 100)}%，ΔT +${event.deltaT}°C，当前状态：${event.status}`, tone: event.severity === 'critical' ? 'danger' as const : 'warn' as const, eventId: event.id }] : []),
    ...(relatedOrder ? [{ date: '今天 10:20', kind: '运维处置', title: relatedOrder.title, detail: `${relatedOrder.owner}负责，${relatedOrder.state}，计划完成时间 ${relatedOrder.due}`, tone: 'info' as const, workOrderId: relatedOrder.id }] : []),
    { date: '08-26 09:18', kind: '例行巡检', title: 'RGB/Thermal 质量检查通过', detail: '时间配对完整，定位与辐射测温元数据齐全，未发现需处置异常', tone: 'good' },
    { date: '07-15 14:32', kind: '资产基线', title: '组件档案校核', detail: '铭牌、组串归属、安装位置与现场台账一致', tone: 'info' },
  ];
};

export default function OperationsPage({ mode }: { mode: 'anomalies' | 'work-orders' | 'assets' }) {
  if (mode === 'work-orders') return <WorkOrdersPage />;
  if (mode === 'assets') return <Assets />;
  return <AnomaliesPage />;
}


function Assets() {
  const location = useLocation();
  const navigate = useNavigate();
  const [assets, setAssets] = useState(initialAssets);
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('全部');
  const [riskOnly, setRiskOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const filtered = assets.filter((asset) => `${asset.id}${asset.issue}${asset.array}`.toLowerCase().includes(query.toLowerCase()) && (area === '全部' || asset.array.startsWith(area)) && (!riskOnly || asset.health < 80));
  const treeItems = [['全部', '盐城一期光伏场', '12.6 MW'], ['A', 'A 区', '3,120'], ['A-03', 'A-03 方阵', '624'], ['A-04', 'A-04 方阵', '624'], ['B', 'B 区', '4,368'], ['C', 'C 区', '5,035']];
  const detailHistory = detail ? assetHistory(detail) : [];

  useEffect(() => {
    const component = new URLSearchParams(location.search).get('component');
    if (!component) return;
    const matched = assets.find((asset) => asset.id === component);
    if (matched) {
      setQuery(component);
      setArea('全部');
      setDetail(matched);
    }
  }, [assets, location.search]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('sentinel:copilot-context', { detail: {
        module: '资产档案',
        selectedAsset: detail ? { id: detail.id, array: detail.array, health: detail.health, status: detail.status, latestEvidence: detail.issue, historyEvents: detail.history } : null,
        filters: { area, riskOnly, query },
      } }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [area, detail, query, riskOnly]);

  return <div className="page"><PageHeader eyebrow="ASSET DIGITAL THREAD" title="资产档案" description="以场站、方阵、组串、组件和逆变器为层级保存巡检历史与处置记录。" actions={<><Button onClick={() => downloadCsv('asset-register-demo.csv', [['资产编号', '方阵', '健康分', '状态', '最近巡检', '最新证据', '历史事件'], ...filtered.map((asset) => [asset.id, asset.array, asset.health, asset.status, asset.last, asset.issue, asset.history])])}><Download />导出资产台账</Button><Button variant="primary" onClick={() => setRegisterOpen(true)}><Plus />登记设备</Button></>} /><div className="asset-layout"><Panel className="asset-tree" title="资产结构" description="盐城一期 · 12,523 个组件"><div className="tree">{treeItems.map(([value, label, count], index) => <button key={value} className={`${index === 2 || index === 3 ? 'indent ' : ''}${area === value ? 'active' : ''}`} onClick={() => setArea(value)}>{index === 0 ? <HardDrive /> : index === 1 || index > 3 ? <Boxes /> : null}<span>{label}</span><b>{count}</b></button>)}</div></Panel><Panel className="table-panel"><div className="table-toolbar"><label className="inline-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索组件、方阵或异常" /></label><Button variant="ghost" className={filterOpen ? 'is-active' : ''} onClick={() => setFilterOpen((value) => !value)}><ListFilter />筛选</Button></div>{filterOpen ? <div className="advanced-filters"><label className="check-control"><input type="checkbox" checked={riskOnly} onChange={(event) => setRiskOnly(event.target.checked)} />仅显示健康分低于 80</label><Button variant="ghost" onClick={() => { setRiskOnly(false); setQuery(''); setArea('全部'); }}>重置筛选</Button></div> : null}<div className="data-table asset-table"><div className="data-row data-head"><span>资产编号</span><span>健康分</span><span>当前状态</span><span>最近巡检</span><span>最新证据</span><span>历史事件</span><span /></div>{filtered.map((asset) => <button className="data-row" key={asset.id} onClick={() => setDetail(asset)}><span><strong>{asset.id}</strong><small>{asset.array} 方阵</small></span><span><strong>{asset.health}</strong><i className="progress"><b style={{ width: `${asset.health}%` }} /></i></span><span><Status tone={asset.health < 70 ? 'danger' : asset.health < 85 ? 'warn' : 'good'}>{asset.status}</Status></span><span>{asset.last}</span><span>{asset.issue}</span><span>{asset.history} 次</span><ArrowRight /></button>)}</div></Panel></div>
    <Drawer open={Boolean(detail)} title="资产数字档案" onClose={() => setDetail(null)}>{detail ? <div className="detail-drawer asset-thread"><div className="asset-thread-heading"><div><Status tone={detail.health < 70 ? 'danger' : detail.health < 85 ? 'warn' : 'good'}>健康分 {detail.health}</Status><h3>{detail.id}</h3><p>盐城一期 · {detail.array} 方阵 · 光伏组件</p></div><span><small>生命周期事件</small><strong>{detailHistory.length}</strong></span></div><div className="asset-evidence-history"><figure><img src="/assets/evidence-rgb.png" alt="最近一次 RGB 巡检证据"/><figcaption><b>本次 RGB</b><span>外观与组件边界</span></figcaption></figure><figure><img src="/assets/evidence-thermal.png" alt="最近一次热红外巡检证据"/><figcaption><b>本次 Thermal</b><span>辐射测温证据</span></figcaption></figure><figure><img src="/model-results/visible-defect/test-predictions.jpg" alt="可见光缺陷模型测试预测样例"/><figcaption><b>模型参考</b><span>独立测试样例</span></figcaption></figure></div><dl className="evidence-facts"><div><dt>当前状态</dt><dd>{detail.status}</dd></div><div><dt>最新证据</dt><dd>{detail.issue}</dd></div><div><dt>最近巡检</dt><dd>{detail.last}</dd></div><div><dt>历史事件</dt><dd>{detail.history} 次</dd></div></dl><section className="asset-lifecycle"><header><div><strong>设备履历</strong><small>巡检、模型、人工与工单记录按时间合并</small></div><Status tone="info">数字线程</Status></header>{detailHistory.map((item) => <article className={`asset-lifecycle-item ${item.tone}`} key={`${item.date}-${item.title}`}><time>{item.date}</time><i aria-hidden="true"/><div><span>{item.kind}</span><strong>{item.title}</strong><p>{item.detail}</p>{item.eventId ? <button onClick={() => navigate(`/evidence?mission=MSN-240905-042&event=${item.eventId}`)}>打开证据链 <ArrowRight/></button> : null}{item.workOrderId ? <button onClick={() => navigate(`/work-orders?order=${item.workOrderId}`)}>查看工单 <ArrowRight/></button> : null}</div></article>)}</section><div className="asset-thread-actions"><Button variant="primary" onClick={() => detailHistory[0]?.eventId ? navigate(`/evidence?mission=MSN-240905-042&event=${detailHistory[0].eventId}`) : notify('当前资产无待复核证据', detail.id)}>复核最新证据</Button><Button onClick={() => downloadCsv(`${detail.id}-history.csv`, [['时间', '类型', '事件', '说明'], ...detailHistory.map((item) => [item.date, item.kind, item.title, item.detail])])}><Download />导出资产履历</Button></div></div> : null}</Drawer>
    <Drawer open={registerOpen} title="登记设备" onClose={() => setRegisterOpen(false)}><div className="form-stack"><Field label="资产编号"><input id="asset-id" defaultValue="YC-A04-01-01" /></Field><Field label="所属方阵"><select><option>A-04</option><option>B-02</option><option>C-01</option></select></Field><Field label="设备类型"><select><option>光伏组件</option><option>组串逆变器</option><option>汇流箱</option></select></Field><Field label="制造商 / 型号"><input placeholder="输入铭牌信息" /></Field><Button variant="primary" onClick={() => { const item = { id: `YC-A04-NEW-${assets.length + 1}`, array: 'A-04', health: 100, status: '新登记', last: '尚未巡检', issue: '无', history: 0 }; setAssets((items) => [...items, item]); setRegisterOpen(false); notify('设备已登记', item.id); }}>保存设备档案</Button></div></Drawer>
  </div>;
}
