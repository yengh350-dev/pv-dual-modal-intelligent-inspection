import { useEffect, useMemo, useState } from 'react';
import { animate, stagger } from 'animejs';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, BatteryCharging, Camera, CheckCircle2, ChevronRight, Clock3, CloudSun, Database, Download, FileCheck2, Filter, Gauge, HardDrive, Navigation, Pause, Plane, Play, Plus, Radio, RefreshCw, RotateCcw, Search, Settings2, ShieldCheck, Signal, Thermometer, Upload, Users, Wifi, WifiOff, Wind } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { anomalies, latencyTrend, missionActivity, missionProfiles, missions, teamMembers } from '../lib/data';
import { Button, Drawer, Field, PageHeader, Panel, Status } from '../components/ui';
import { AnimatedFlightPath } from '../components/AnimatedFlightPath';
import { downloadJson, notify } from '../lib/actions';
import { createMission, getApiErrorMessage, isApiUnavailable } from '../lib/api';
import { getAvatar } from '../lib/avatars';

const telemetry = Array.from({ length: 20 }, (_, index) => ({ t: index, altitude: 116 + Math.sin(index / 2) * 4, signal: 82 + Math.cos(index / 3) * 8 }));
const workflow = ['计划', '安全检查', '飞行执行', '数据上传', '质量检查', 'AI 分析', '人工复核', '工单生成', '报告发布'];
type Mission = (typeof missions)[number];

type MissionPageProps = { mode: 'missions' | 'live'; activeSite: string; onSiteChange: (site: string) => void };

export default function MissionPage({ mode, activeSite, onSiteChange }: MissionPageProps) {
  const [drawer, setDrawer] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detail, setDetail] = useState<Mission | null>(null);
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aircraft, setAircraft] = useState('全部机型');
  const [qualityOnly, setQualityOnly] = useState(false);
  const [running, setRunning] = useState(true);
  const [importFiles, setImportFiles] = useState<string[]>([]);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('create') === '1') setDrawer(true);
    if (params.get('import') === '1') setImportOpen(true);
  }, [location.search]);

  const filtered = useMemo(() => missions.filter((item) => {
    const matchesStatus = filter === '全部' || item.status === filter;
    const matchesQuery = `${item.id} ${item.name} ${item.aircraft}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesAircraft = aircraft === '全部机型' || item.aircraft === aircraft;
    return matchesStatus && matchesQuery && matchesAircraft && (!qualityOnly || item.quality < 80);
  }), [aircraft, filter, qualityOnly, query]);

  useEffect(() => {
    if (mode !== 'live' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate('.mission-step.current', { scale: [0.96, 1], opacity: [0.65, 1], duration: 520, delay: stagger(80), ease: 'out(3)' });
  }, [mode]);

  const createPlannedMission = async () => {
    try {
      const result = await createMission({ name: '盐城一期 A 区例行巡检', site: '盐城一期光伏场', aircraft: 'UAV-07 · DJI Mavic 3T', payload: '集成 RGB + Thermal' });
      setDrawer(false);
      notify('任务已创建', `${result.id} 已进入待执行队列`);
    } catch (caught) {
      if (isApiUnavailable(caught)) {
        setDrawer(false);
        notify('演示任务已创建', 'DEMO-MSN-043 已进入本地待执行队列', 'warning');
      } else {
        notify('任务创建失败', getApiErrorMessage(caught), 'error');
      }
    }
  };

  if (mode === 'live') return <LiveMission running={running} setRunning={setRunning} activeSite={activeSite} onSiteChange={onSiteChange} />;

  return <div className="page">
    <PageHeader eyebrow="MISSION OPERATIONS" title="任务与航线" description="规划航线、绑定载荷、校验安全条件并跟踪每次巡检的完整状态。" actions={<><Button onClick={() => setImportOpen(true)}><Upload />导入已有任务</Button><Button variant="primary" onClick={() => setDrawer(true)}><Plus />新建任务</Button></>} />
    <section className="scene-switcher" aria-label="场站巡检场景">
      {missionProfiles.map((profile) => <button key={profile.id} onClick={() => { onSiteChange(profile.site); navigate(`/live?mission=${profile.id}`); }}><span className="scene-thumb"><img src={profile.mapImage} alt={profile.mapAlt} loading="lazy" width="112" height="72"/><i>{profile.progress}%</i></span><span><small>{profile.site}</small><strong>{profile.sceneLabel}</strong><em>{profile.area} · {profile.routeLength}</em></span><ChevronRight /></button>)}
    </section>
    <div className="summary-strip"><div><strong>12</strong><span>近 30 天任务</span></div><div><strong>94.1%</strong><span>平均覆盖率</span></div><div><strong>96.3</strong><span>平均质量分</span></div><div><strong>1</strong><span>需要复飞</span></div><div><strong>128.6 km</strong><span>累计航程</span></div></div>
    <Panel className="table-panel">
      <div className="table-toolbar"><div className="filter-tabs">{['全部', '待复核', '已完成', '需复飞'].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="toolbar-actions"><label className="inline-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务编号或场站" /></label><Button variant="ghost" className={advancedOpen ? 'is-active' : ''} onClick={() => setAdvancedOpen((value) => !value)}><Filter />筛选</Button></div></div>
      {advancedOpen ? <div className="advanced-filters"><Field label="飞行器"><select value={aircraft} onChange={(event) => setAircraft(event.target.value)}><option>全部机型</option><option>Mavic 3T</option><option>Matrice 350 RTK</option></select></Field><label className="check-control"><input type="checkbox" checked={qualityOnly} onChange={(event) => setQualityOnly(event.target.checked)} /><span>仅看质量分低于 80 的任务</span></label><Button variant="ghost" onClick={() => { setAircraft('全部机型'); setQualityOnly(false); setQuery(''); }}>重置筛选</Button></div> : null}
      <div className="data-table mission-data-table"><div className="data-row data-head"><span>任务 / 时间</span><span>飞行器与载荷</span><span>覆盖率</span><span>数据质量</span><span>影像</span><span>状态</span><span /></div>{filtered.map((mission) => <button key={mission.id} className="data-row" onClick={() => setDetail(mission)}><span><strong>{mission.id}</strong><small>{mission.name} · {mission.date}</small></span><span><strong>{mission.aircraft}</strong><small>RGB + Thermal</small></span><span><strong>{mission.coverage}%</strong><i className="progress"><b style={{ width: `${mission.coverage}%` }} /></i></span><span><strong>{mission.quality} / 100</strong><small>{mission.quality < 80 ? '质量不足，建议复飞' : '通过质量门控'}</small></span><span>{mission.frames.toLocaleString()} 帧</span><span><Status tone={mission.status === '需复飞' ? 'danger' : mission.status === '待复核' ? 'warn' : 'good'}>{mission.status}</Status></span><ArrowRight /></button>)}{filtered.length === 0 ? <div className="table-empty"><Search /><strong>没有匹配任务</strong><p>调整关键词或筛选条件后重试。</p></div> : null}</div>
    </Panel>

    <Drawer open={drawer} onClose={() => setDrawer(false)} title="新建飞行任务" width="wide"><MissionForm onDone={() => void createPlannedMission()} /></Drawer>
    <Drawer open={importOpen} onClose={() => setImportOpen(false)} title="导入无人机任务包"><div className="import-flow"><div className="upload-zone"><Upload /><strong>选择任务包或任务目录</strong><p>支持 ZIP、JSON、KML、SRT、CSV 与厂商导出清单</p><input type="file" multiple onChange={(event) => setImportFiles(Array.from(event.target.files ?? []).map((file) => file.name))} /></div>{importFiles.length ? <div className="file-selection"><strong>已选择 {importFiles.length} 个文件</strong>{importFiles.slice(0, 5).map((name) => <span key={name}>{name}</span>)}</div> : null}<div className="form-callout"><FileCheck2 /><p>导入仅解析任务与证据元数据，不向无人机发送飞行控制指令。</p></div><Button variant="primary" disabled={!importFiles.length} onClick={() => { setImportOpen(false); notify('任务包解析完成', `已登记 ${importFiles.length} 个文件，等待完整性检查`); navigate('/data'); }}>解析并进入数据检查</Button></div></Drawer>
    <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title="任务详情">{detail ? <div className="detail-drawer"><Status tone={detail.status === '需复飞' ? 'danger' : detail.status === '待复核' ? 'warn' : 'good'}>{detail.status}</Status><h3>{detail.name}</h3><p>{detail.id} · {detail.date}</p><dl className="evidence-facts"><div><dt>飞行器</dt><dd>{detail.aircraft}</dd></div><div><dt>有效覆盖</dt><dd>{detail.coverage}%</dd></div><div><dt>数据质量</dt><dd>{detail.quality} / 100</dd></div><div><dt>影像总数</dt><dd>{detail.frames.toLocaleString()} 帧</dd></div></dl><Button variant="primary" onClick={() => navigate(detail.status === '待复核' ? `/evidence?mission=${detail.id}` : `/live?mission=${detail.id}`)}>{detail.status === '待复核' ? '打开证据复核' : '查看任务轨迹'}</Button><Button onClick={() => { downloadJson(`${detail.id}-manifest.json`, { ...detail, payload: 'RGB+Thermal', source: 'Sentinel RGBT demo' }); notify('任务清单已下载', `${detail.id}-manifest.json`); }}><Download />下载任务清单</Button>{detail.status === '需复飞' ? <Button variant="danger" onClick={() => { setDetail(null); setDrawer(true); notify('已从原任务创建复飞草稿', detail.id); }}><RotateCcw />创建复飞任务</Button> : null}</div> : null}</Drawer>
  </div>;
}

function MissionForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [checks, setChecks] = useState(() => Array(6).fill(true) as boolean[]);
  const safetyItems = ['禁飞区与电子围栏检查', '天气与风速评估', 'GNSS/RTK 可用性', '飞行器与载荷电量', '存储空间与时间同步', '返航高度与失联策略'];
  const checksPassed = checks.every(Boolean);

  return <div className="mission-form"><div className="form-stepper">{['任务范围', '飞行与载荷', '安全校验', '确认创建'].map((label, index) => <div className={index + 1 <= step ? 'active' : ''} key={label}><span>{index + 1}</span><p>{label}</p></div>)}</div>{step === 1 ? <div className="form-grid"><Field label="任务名称"><input defaultValue="盐城一期 A 区例行巡检" /></Field><Field label="目标场站"><select defaultValue="yc"><option value="yc">盐城一期光伏场</option><option value="dt">东台二期光伏场</option></select></Field><Field label="巡检区域"><select><option>A-01 至 A-08 方阵</option><option>全场站</option></select></Field><Field label="计划日期"><input type="datetime-local" /></Field><Field label="任务类型"><select><option>例行双模态巡检</option><option>热异常专项复检</option><option>清洗后验收</option></select></Field><Field label="优先级"><select><option>标准</option><option>高</option></select></Field></div> : null}{step === 2 ? <div className="form-grid"><Field label="飞行器"><select><option>UAV-07 · DJI Mavic 3T</option><option>UAV-02 · Matrice 350 RTK</option></select></Field><Field label="载荷"><select><option>集成 RGB + Thermal</option><option>Zenmuse H20T</option></select></Field><Field label="相对高度"><input type="number" defaultValue="80" /></Field><Field label="航向重叠率"><input type="number" defaultValue="80" /></Field><Field label="旁向重叠率"><input type="number" defaultValue="70" /></Field><Field label="期望 GSD"><input defaultValue="2.4 cm/px" /></Field></div> : null}{step === 3 ? <div className="safety-checks">{safetyItems.map((item, index) => <label key={item}><input type="checkbox" checked={checks[index]} onChange={() => setChecks((values) => values.map((value, itemIndex) => itemIndex === index ? !value : value))} /><span><CheckCircle2 />{item}</span><Status tone={checks[index] ? 'good' : 'danger'}>{checks[index] ? '通过' : '未通过'}</Status></label>)}</div> : null}{step === 4 ? <div className="confirmation-sheet"><FileCheck2 /><h3>任务已准备创建</h3><p>系统将生成任务编号、航线版本与现场检查清单。真实飞行控制必须由持证人员在厂商地面站中确认。</p><dl><div><dt>预计航程</dt><dd>6.4 km</dd></div><div><dt>预计用时</dt><dd>36 分钟</dd></div><div><dt>预计数据量</dt><dd>18.7 GB</dd></div></dl></div> : null}<div className="drawer-footer"><Button disabled={step === 1} onClick={() => setStep((value) => value - 1)}>上一步</Button>{step < 4 ? <Button variant="primary" disabled={step === 3 && !checksPassed} onClick={() => setStep((value) => value + 1)}>继续 <ArrowRight /></Button> : <Button variant="primary" onClick={onDone}><CheckCircle2 />创建任务</Button>}</div></div>;
}

function LiveMission({ running, setRunning, activeSite, onSiteChange }: { running: boolean; setRunning: (value: boolean) => void; activeSite: string; onSiteChange: (site: string) => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const missionId = new URLSearchParams(location.search).get('mission');
  const [missionIndex, setMissionIndex] = useState(() => {
    const queryIndex = missionProfiles.findIndex((item) => item.id === missionId);
    if (queryIndex >= 0) return queryIndex;
    const siteIndex = missionProfiles.findIndex((item) => item.site === activeSite);
    return siteIndex < 0 ? 0 : siteIndex;
  });
  const [connection, setConnection] = useState<'online' | 'degraded' | 'offline'>('online');
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [eventRecorded, setEventRecorded] = useState(false);
  const [syncRevision, setSyncRevision] = useState(0);
  const [pairingState, setPairingState] = useState<'scanning' | 'linked'>('linked');
  const [pairSuccess, setPairSuccess] = useState(false);
  const mission = missionProfiles[missionIndex];
  const isLive = running && connection !== 'offline';
  const queue = [
    ['RGB 数据上传', connection === 'offline' ? 68 : 72],
    ['Thermal 数据上传', connection === 'offline' ? 66 : 70],
    ['时间同步校验', 93],
    ['质量门控', connection === 'offline' ? 24 : 31],
    ['AI 分析', connection === 'offline' ? 12 : 18]
  ] as const;

  const setOffline = () => {
    setConnection('offline');
    setRunning(false);
    notify('平台已进入离线记录模式', '本地缓存 3 项，恢复网络后自动续传', 'warning');
  };

  const restoreConnection = () => {
    setConnection('online');
    setRunning(true);
    setSyncRevision((value) => value + 1);
    notify('数据链路已恢复', '3 项离线记录已进入续传队列');
  };

  const pairAircraft = () => {
    setPairSuccess(false);
    setPairingState('scanning');
    window.setTimeout(() => {
      setConnection('online');
      setPairingState('linked');
      setPairSuccess(true);
      notify('无人机匹配成功', `${mission.deviceId} · 遥测、图传和双光载荷已建立只读链路`);
      window.setTimeout(() => setPairSuccess(false), 1200);
    }, reduceMotion ? 240 : 1700);
  };

  useEffect(() => {
    setPairSuccess(false);
    setPairingState('scanning');
    const timer = window.setTimeout(() => setPairingState('linked'), reduceMotion ? 80 : 720);
    return () => window.clearTimeout(timer);
  }, [missionIndex, reduceMotion]);

  useEffect(() => {
    if (missionProfiles[missionIndex]?.site === activeSite) return;
    const next = missionProfiles.findIndex((item) => item.site === activeSite);
    if (next < 0) return;
    setMissionIndex(next);
    navigate(`/live?mission=${missionProfiles[next].id}`, { replace: true });
  }, [activeSite, missionIndex, navigate]);

  return <div className="page live-page">
    <PageHeader eyebrow="LIVE MISSION / DEMO ADAPTER" title="实时任务控制台" description="监看无人机、双光载荷、航迹和数据流水线；飞行控制仍由厂商地面站与持证飞手负责。" actions={<><Button onClick={() => { setRunning(!running); notify(running ? '平台可视化已暂停' : '平台可视化已继续', '不影响真实飞行器状态'); }}>{running ? <Pause /> : <Play />}{running ? '暂停监看' : '继续监看'}</Button><Button variant="danger" onClick={() => { setRunning(false); setEmergencyOpen(true); }}><Radio />应急处置</Button></>} />

    <section className="live-command-bar" aria-label="实时任务连接状态">
      <label><span>当前任务</span><select value={missionIndex} onChange={(event) => { const next = Number(event.target.value); setMissionIndex(next); onSiteChange(missionProfiles[next].site); navigate(`/live?mission=${missionProfiles[next].id}`, { replace: true }); }}>{missionProfiles.map((item, index) => <option value={index} key={item.id}>{item.id} · {item.area}</option>)}</select></label>
      <div className={`connection-state ${connection}`}><span>{connection === 'offline' ? <WifiOff /> : <Wifi />}</span><p><strong>{connection === 'online' ? '链路在线' : connection === 'degraded' ? '链路降级' : '离线记录'}</strong><small>{connection === 'offline' ? '缓存待续传 · 3 项' : '最后心跳 0.8 s 前'}</small></p></div>
      <div><CloudSun /><p><strong>{mission.weather.ambientC}°C · {mission.weather.summary}</strong><small>{mission.weather.windDirection}风 {mission.weather.windSpeed} m/s</small></p></div>
      <div><Clock3 /><p><strong>{mission.elapsed}</strong><small>已飞 / 剩余 {mission.remaining}</small></p></div>
      <button onClick={() => setDeviceOpen(true)}><Settings2 />设备诊断 <ChevronRight /></button>
      {connection === 'offline' ? <Button variant="primary" onClick={restoreConnection}><RefreshCw />恢复连接</Button> : <Button variant="ghost" onClick={setOffline}><WifiOff />离线模式</Button>}
    </section>

    {connection === 'offline' ? <div className="offline-banner"><WifiOff /><div><strong>平台与边缘站连接中断</strong><p>当前地图与遥测停留在最后同步时刻；审计记录和人工标注保存在本机，恢复后自动续传。</p></div><Status tone="warn">只读快照</Status></div> : null}

    <div className="workflow-rail">{workflow.map((item, index) => <div key={item} className={`mission-step ${index < 2 ? 'done' : index === 2 ? 'current' : ''}`}><span>{index < 2 ? <CheckCircle2 /> : index + 1}</span><p>{item}<small>{index < 2 ? '已完成' : index === 2 ? (isLive ? '进行中' : '监看暂停') : '等待中'}</small></p>{index < workflow.length - 1 ? <ArrowRight /> : null}</div>)}</div>

    <div className="live-grid">
      <Panel className="live-map-panel" title="当前任务地图" description={`${mission.site} ${mission.area} · ${mission.sceneNote}`} action={<button className="text-action" onClick={() => { setSyncRevision((value) => value + 1); notify('地图已刷新', `同步批次 ${syncRevision + 2}`); }}><RefreshCw />刷新</button>}><div className="live-map"><AnimatePresence mode="wait"><motion.img className="scene-map-image" key={mission.mapImage} src={mission.mapImage} alt={mission.mapAlt} initial={reduceMotion ? false : { opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: 0.38 }} /></AnimatePresence><svg viewBox="0 0 1000 600" aria-label={`${mission.site}${mission.area}计划航线、已飞轨迹与无人机实时位置`}><AnimatedFlightPath mission={mission} moving={isLive} revision={syncRevision}/></svg><div className="flight-stat"><strong>{mission.progress}%</strong><span>{mission.sceneLabel}</span><dl><div><dt>已飞</dt><dd>{mission.elapsed}</dd></div><div><dt>覆盖</dt><dd>{mission.inspectedArea}</dd></div><div><dt>航点</dt><dd>{mission.waypoint}</dd></div><div><dt>链路</dt><dd>{connection === 'offline' ? '中断' : `${mission.flight.signal} dBm`}</dd></div></dl></div><div className="live-map-coordinate">{mission.coordinates}<small>比例尺 {mission.mapScale}</small></div><div className="map-readonly"><ShieldCheck />概念底图 · 平台只读监看</div></div></Panel>

      <div className="live-side">
        <Panel title="安全检查清单" description="起飞前 08:12 完成" action={<button className="text-action" onClick={() => setSafetyOpen(true)}>查看详情</button>}><div className="check-list">{['飞行器系统', '电池状态 94%', 'GNSS / RTK 32+', '遥控与图传链路', '任务区域与禁飞区', '天气与返航条件'].map((item) => <button key={item} onClick={() => setSafetyOpen(true)}><CheckCircle2 /><span>{item}</span><Status tone="good">正常</Status></button>)}</div></Panel>
        <Panel title="已连接无人机" description={`${mission.aircraftModel} · 厂商 SDK 演示适配器`} action={<button className="text-action" disabled={pairingState === 'scanning'} onClick={pairAircraft}>{pairingState === 'scanning' ? '匹配中…' : '重新匹配'}</button>}><div className={`aircraft-visual pairing-${pairingState} ${pairSuccess ? 'pair-success' : ''}`}><img src="/assets/inspection-drone.png" alt={`${mission.aircraftModel} 双光巡检无人机概念图`}/><div className="pairing-visual" aria-live="polite"><i className="pair-ring ring-one"/><i className="pair-ring ring-two"/><i className="pair-scan"/><span><Radio />{pairingState === 'scanning' ? '正在发现设备' : '三链路匹配成功'}</span></div><span><Status tone={connection === 'offline' ? 'danger' : pairingState === 'scanning' ? 'warn' : 'good'}>{connection === 'offline' ? '离线' : pairingState === 'scanning' ? '匹配中' : '在线'}</Status><small>{mission.deviceId}</small></span></div><div className="device-metrics"><span><BatteryCharging />电量 <b>{mission.flight.battery}%</b></span><span><Navigation />高度 <b>{mission.flight.altitude} m</b></span><span><Signal />链路 <b>{mission.flight.signal} dBm</b></span><span><Gauge />速度 <b>{mission.flight.speed} m/s</b></span></div></Panel>
        <Panel title="双光载荷" description="RGB-Thermal 同步采集"><div className="payload-list"><button onClick={() => setDeviceOpen(true)}><Camera /><span><strong>RGB 相机</strong><small>1/1000 s · ISO 200</small></span><Status tone="good">采集中</Status></button><button onClick={() => setDeviceOpen(true)}><Thermometer /><span><strong>热成像相机</strong><small>辐射测温 · NETD ≤ 40 mK</small></span><Status tone="good">已校准</Status></button><button onClick={() => setDeviceOpen(true)}><Navigation /><span><strong>云台与时间同步</strong><small>-12.3° · 误差 4 ms</small></span><Status tone="good">锁定</Status></button></div></Panel>
      </div>
    </div>

    <div className="live-telemetry-grid">
      <Panel title="飞行遥测" description="最后 20 秒 · 高度与链路质量"><div className="chart-wrap"><ResponsiveContainer width="100%" height={180}><AreaChart data={telemetry}><CartesianGrid stroke="var(--live-chart-grid)" vertical={false}/><XAxis dataKey="t" hide/><YAxis domain={[70,130]} hide/><Tooltip/><Area type="monotone" dataKey="altitude" stroke="#168c7b" fill="#2cb6a033" name="高度"/><Area type="monotone" dataKey="signal" stroke="#5d83d6" fill="#5d83d622" name="链路质量"/></AreaChart></ResponsiveContainer></div></Panel>
      <Panel title="网络延迟" description="端到端链路 · 最近 12 分钟" action={<Status tone={connection === 'offline' ? 'danger' : 'good'}>{connection === 'offline' ? '无数据' : '1.2 s'}</Status>}><div className="latency-chart"><ResponsiveContainer width="100%" height={116}><LineChart data={latencyTrend}><CartesianGrid stroke="var(--live-chart-grid)" vertical={false}/><XAxis dataKey="t" hide/><YAxis domain={[0,2]} hide/><Tooltip/><Line type="monotone" dataKey="value" stroke="#2f78c4" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div><dl className="latency-breakdown"><div><dt>遥测</dt><dd>42 ms</dd></div><div><dt>图传</dt><dd>120 ms</dd></div><div><dt>控制链路观测</dt><dd>68 ms</dd></div></dl></Panel>
      <Panel title="上传与分析队列" description={connection === 'offline' ? '连接恢复后自动续传' : '边飞边传，按依赖顺序执行'}><div className="queue-list">{queue.map(([label, progress]) => <button key={label} onClick={() => notify(`${label}队列`, `${progress}% · ${connection === 'offline' ? '等待连接' : '正在处理'}`)}><span>{label}<b>{progress}%</b></span><i><em style={{ width: `${progress}%` }} /></i></button>)}</div></Panel>
    </div>

    <div className="operations-grid">
      <Panel title={`异常队列（${anomalies.length}）`} description="地图发现与证据审核共用同一事件编号" action={<button className="text-action" onClick={() => navigate('/anomalies')}>查看全部</button>}><div className="ops-anomaly-list">{anomalies.map((item) => <button key={item.id} onClick={() => navigate(`/evidence?mission=${mission.id}&event=${item.id}`)}><Status tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warn' : 'info'}>{item.severity === 'critical' ? '严重' : item.severity === 'high' ? '高' : '中'}</Status><span><strong>{item.array} / {item.module}</strong><small>{item.type} · {item.time}</small></span><b>{item.status}</b><ChevronRight /></button>)}</div></Panel>
      <Panel title="团队与分工" description="任务角色和责任边界" action={<button className="text-action" onClick={() => setAssignmentOpen(true)}>调整分工</button>}><div className="team-list">{teamMembers.map((member, index) => <button key={member.name} onClick={() => setAssignmentOpen(true)}><img className="member-avatar" src={getAvatar(member.name)} alt={`${member.name}头像`} /><p><strong>{member.name} · {member.role}</strong><small>{member.scope}</small></p><Status tone={member.state === '在线' ? 'good' : 'neutral'}>{member.state}</Status><i style={{ '--member': index } as React.CSSProperties}/></button>)}</div></Panel>
      <Panel title="活动日志" description="设备、系统与人工动作统一留痕" action={<button className="text-action" onClick={() => downloadJson(`${mission.id}-activity.json`, missionActivity)}><Download />导出</button>}><div className="mission-activity">{missionActivity.map((item) => <div key={`${item.time}-${item.title}`} className={item.tone}><time>{item.time}</time><i/><p><strong>{item.title}</strong><small>{item.detail}</small></p></div>)}</div></Panel>
      <Panel title="系统健康" description="关键运行资源与数据新鲜度" action={<Status tone="good">全部正常</Status>}><div className="system-health"><button onClick={() => setDeviceOpen(true)}><BatteryCharging /><span>电池健康度<small>循环 83 次</small></span><b>96%</b><i><em style={{ width: '96%' }}/></i></button><button onClick={() => setDeviceOpen(true)}><Thermometer /><span>机体温度<small>阈值 60°C</small></span><b>32°C</b><i><em style={{ width: '53%' }}/></i></button><button onClick={() => setDeviceOpen(true)}><HardDrive /><span>存储空间<small>1.2 TB 可用</small></span><b>38%</b><i><em style={{ width: '38%' }}/></i></button><button onClick={() => setDeviceOpen(true)}><Signal /><span>网络带宽<small>丢包率 0.3%</small></span><b>85 Mbps</b><i><em style={{ width: '85%' }}/></i></button></div></Panel>
    </div>

    <footer className="live-footer"><span>任务 {mission.id}</span><span>区域 {mission.site} {mission.area}</span><span>航线 {mission.routeLength}</span><span>帧数 {mission.frames.toLocaleString()}</span><span>同步批次 {syncRevision + 1}</span><Status tone={connection === 'offline' ? 'warn' : 'good'}>{connection === 'offline' ? '等待续传' : '数据已同步'}</Status></footer>

    <Drawer open={deviceOpen} onClose={() => setDeviceOpen(false)} title="无人机与载荷诊断" width="wide"><div className="device-diagnostics"><div className="device-diagnostic-hero"><img src="/assets/inspection-drone.png" alt={`${mission.aircraftModel} 双光巡检无人机概念图`}/><div><Status tone={connection === 'offline' ? 'danger' : 'good'}>{connection === 'offline' ? '连接中断' : '三链路在线'}</Status><h3>{mission.deviceId}</h3><p>{mission.aircraftModel} · {mission.payload}</p></div></div><div className="connection-path"><span><Plane />{mission.aircraft}</span><i/><span><Radio />厂商地面站</span><i/><span><Database />Sentinel 适配器</span><i/><span><Gauge />平台</span></div><dl className="evidence-facts"><div><dt>遥控链路</dt><dd>{mission.flight.signal} dBm · 仅观测</dd></div><div><dt>图传链路</dt><dd>85 Mbps · 0.3% 丢包</dd></div><div><dt>载荷链路</dt><dd>{mission.payload} 已同步</dd></div><div><dt>定位状态</dt><dd>{mission.flight.rtk}</dd></div><div><dt>设备心跳</dt><dd>0.8 s 前</dd></div><div><dt>平台控制权</dt><dd>无 · 不下发飞控命令</dd></div></dl><Button variant="primary" onClick={() => { setSyncRevision((value) => value + 1); notify('设备诊断已刷新', `${mission.deviceId} 遥控、图传和载荷链路正常`); }}><RefreshCw />刷新诊断</Button><Button onClick={() => downloadJson(`${mission.aircraft}-diagnostic.json`, { mission, connection, links: { telemetryMs: 42, videoMs: 120, observedControlLinkMs: 68 }, controlEnabled: false, checkedAt: new Date().toISOString() })}><Download />下载诊断记录</Button></div></Drawer>
    <Drawer open={safetyOpen} onClose={() => setSafetyOpen(false)} title="起飞安全检查详情"><div className="safety-detail"><div className="form-callout"><ShieldCheck/><p>检查清单在起飞前冻结，任何重新放飞都必须生成新的清单版本。</p></div>{['电子围栏与禁飞区无冲突','天气、阵风与能见度满足任务阈值','GNSS 32 星且 RTK 固定解','主备电池状态正常','返航高度 82 m 且航路无障碍','RGB-Thermal 时钟同步误差小于 10 ms'].map((item, index) => <div key={item}><CheckCircle2/><span><strong>{item}</strong><small>检查人 {index < 3 ? '张伟' : '李娜'} · 08:{String(6 + index).padStart(2,'0')}</small></span><Status tone="good">通过</Status></div>)}<Button onClick={() => downloadJson(`${mission.id}-safety-checklist.json`, { missionId: mission.id, frozenAt: '2026-09-07T08:12:34+08:00', result: 'passed' })}><Download/>下载冻结版本</Button></div></Drawer>
    <Drawer open={assignmentOpen} onClose={() => setAssignmentOpen(false)} title="任务分工"><div className="assignment-editor">{teamMembers.map((member) => <label key={member.name}><span><Users/><b>{member.name}</b><small>{member.role}</small></span><select defaultValue={member.scope}><option>全局协调</option><option>任务执行</option><option>质量检查</option><option>模型分析</option><option>人工复核</option><option>工单处理</option></select></label>)}<Button variant="primary" onClick={() => { setAssignmentOpen(false); notify('任务分工已保存', '变更已写入活动日志'); }}><CheckCircle2/>保存分工</Button></div></Drawer>
    <Drawer open={emergencyOpen} onClose={() => setEmergencyOpen(false)} title="应急处置视图"><div className="emergency-view"><div className="emergency-state"><Radio /><span><strong>平台可视化已暂停</strong><small>真实飞行器状态必须在厂商遥控器或地面站中确认。</small></span></div><dl className="evidence-facts"><div><dt>遥控链路</dt><dd>-65 dBm · 正常</dd></div><div><dt>剩余电量</dt><dd>76%</dd></div><div><dt>返航点距离</dt><dd>428 m</dd></div><div><dt>当前风速</dt><dd>3.2 m/s</dd></div></dl><div className="emergency-steps"><strong>现场操作顺序</strong><span>1. 保持目视接触，确认遥控器告警。</span><span>2. 由持证飞手判断悬停、返航或降落。</span><span>3. 平台仅记录事件，不远程下发飞控命令。</span></div><Button variant="danger" disabled={eventRecorded} onClick={() => { setEventRecorded(true); notify('应急事件已记录', '编号 SAF-240907-001，等待现场补充'); }}><Activity />{eventRecorded ? '事件已记录' : '记录应急事件'}</Button><Button onClick={() => { downloadJson('UAV-07-emergency-checklist.json', { aircraft: 'UAV-07', recordedAt: new Date().toISOString(), checklist: ['保持目视接触', '检查遥控器告警', '持证飞手决定处置', '补充事件记录'] }); notify('应急清单已下载'); }}><Download />下载现场清单</Button></div></Drawer>
  </div>;
}
