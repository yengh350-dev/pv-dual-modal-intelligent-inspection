import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowRight, BatteryCharging, CheckCircle2, CircleAlert, ClipboardCheck, CloudSun, Crosshair, FileDown, Focus, Gauge, GripVertical, Layers3, MapPin, Maximize2, Navigation, Pencil, Plane, Radio, RefreshCw, Route, Ruler, ScanSearch, Signal, Thermometer, Upload } from 'lucide-react';
import SpotlightCard from '../components/react-bits/SpotlightCard';
import { AnimatedFlightPath } from '../components/AnimatedFlightPath';
import { anomalies, anomalyMapPoints, environmentSnapshot, healthTrend, missionOperationalSummary, missionProfiles, temperatureTrend, workOrders, type Anomaly } from '../lib/data';
import { Button, Drawer, IconButton, Panel, Status } from '../components/ui';
import { downloadCsv, downloadJson, notify } from '../lib/actions';
import { evaluateFlightQuality, flightQualityByMission } from '../lib/flightQuality';

function Metric({ label, value, unit, change, tone, icon: Icon }: { label: string; value: string; unit?: string; change: string; tone: string; icon: typeof Activity }) {
  return <SpotlightCard className={`metric-card ${tone}`} spotlightColor="rgba(44, 182, 160, 0.11)"><div><span>{label}</span><Icon /></div><strong>{value}<small>{unit}</small></strong><p>{change}</p></SpotlightCard>;
}

type MissionProfile = (typeof missionProfiles)[number];
type TelemetryCard = { id: string; label: string; value: string; detail: string; principle: string; boundary: string; icon: typeof Activity };

const getTelemetryCards = (mission: MissionProfile): TelemetryCard[] => [
  { id: 'aircraft', label: '无人机连接', value: `${mission.aircraft} · 在线`, detail: `${mission.deviceId} · 遥控、图传、载荷三链路已建立`, principle: '在线状态由最近心跳、图传与载荷遥测共同判定，用于确认数据链是否连续。', boundary: '在线不代表适航；电池、桨叶、禁飞区和返航点必须在厂商地面站再次确认。', icon: Plane },
  { id: 'battery', label: '智能电池', value: `${mission.flight.battery}% · ${mission.remaining}`, detail: `任务剩余 ${mission.remaining}，当前高度 ${mission.flight.altitude} m`, principle: '剩余时间由电量、当前功耗、风速和返航储备估算，用于提前给出任务中止余量。', boundary: '估算值会随逆风、温度与载荷变化；实际返航阈值以飞控和现场规程为准。', icon: BatteryCharging },
  { id: 'position', label: '定位系统', value: `RTK ${mission.flight.rtk}`, detail: `${mission.coordinates} · 证据回挂已启用`, principle: 'RTK 差分解有助于稳定航迹定位、组件级证据回挂和复飞定位。', boundary: '接收机解算精度不等于最终缺陷定位误差；还受姿态、时间同步和相机外参影响。', icon: Navigation },
  { id: 'link', label: '通信链路', value: `${mission.flight.signal} dBm · ${mission.flight.signal < -70 ? '注意' : '稳定'}`, detail: `设备 ${mission.deviceId} · 图传 85 Mbps`, principle: '信号强度、吞吐与丢包率共同描述链路质量，用于判断实时预览和遥测是否可信。', boundary: '平台只展示适配器上报值；控制链路安全仍由飞控和遥控器负责。', icon: Signal },
  { id: 'weather', label: '作业环境', value: `${mission.weather.irradiance} W/m² · ${mission.weather.windSpeed} m/s`, detail: `${mission.weather.summary}，${mission.weather.ambientC}°C，能见度 ${mission.weather.visibilityKm} km`, principle: '辐照度、环境温度和风速会改变组件热响应，是解释热斑温差和跨任务可比性的必要上下文。', boundary: '环境指标不直接证明故障；需结合热像标定、反射排查与电气复测。', icon: CloudSun },
  { id: 'latency', label: '端到端延迟', value: '182 ms · 演示', detail: '遥测 42 ms，图传 120 ms，推理 20 ms', principle: '端到端延迟拆分为遥测、图传和推理耗时，用于定位实时工作流瓶颈。', boundary: '该演示值不是飞控认证指标，不能用于无人机控制闭环或安全决策。', icon: Radio }
];

export default function DashboardPage({ activeSite, onSiteChange }: { activeSite: string; onSiteChange: (site: string) => void }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapToolDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [missionIndex, setMissionIndex] = useState(() => {
    const activeIndex = missionProfiles.findIndex((item) => item.site === activeSite);
    return activeIndex < 0 ? 0 : activeIndex;
  });
  const [selected, setSelected] = useState(() => anomalies.find((item) => item.status === '待复核') ?? anomalies[0]);
  const [mapLayer, setMapLayer] = useState<'rgb' | 'thermal'>('rgb');
  const [mapTool, setMapTool] = useState<'route' | 'measure' | 'annotate'>('route');
  const [routeVisible, setRouteVisible] = useState(true);
  const [annotations, setAnnotations] = useState(0);
  const [priority, setPriority] = useState<'pending' | 'high' | 'all'>('pending');
  const [mapFocused, setMapFocused] = useState(false);
  const [mapRevision, setMapRevision] = useState(0);
  const [mapToolPosition, setMapToolPosition] = useState({ x: 12, y: 42 });
  const [analytics, setAnalytics] = useState<'health' | 'temperature'>('temperature');
  const [telemetry, setTelemetry] = useState<TelemetryCard | null>(null);
  const mission = missionProfiles[missionIndex];
  const operational = missionOperationalSummary[mission.id];
  const flightQuality = flightQualityByMission[mission.id];
  const qualityGate = evaluateFlightQuality(flightQuality, mission.weather.irradiance);
  const qualityReasonKey = qualityGate.failed.map((check) => check.label).join('|');
  const qualityPassed = qualityGate.state === 'pass';
  const telemetryCards = getTelemetryCards(mission);
  const siteOptions = Array.from(new Set(missionProfiles.map((item) => item.site)));
  const siteMissions = missionProfiles.map((item, index) => ({ item, index })).filter(({ item }) => item.site === mission.site);
  const TelemetryIcon = telemetry?.icon ?? Plane;
  const priorityItems = anomalies.filter((item) => priority === 'all' || (priority === 'high' ? ['critical', 'high'].includes(item.severity) : item.status === '待复核'));
  const selectedMapPoint = anomalyMapPoints.find((point) => point.eventId === selected.id) ?? anomalyMapPoints[0];

  useEffect(() => setTelemetry(null), [missionIndex]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('sentinel:copilot-context', { detail: {
        module: '作业总览',
        site: mission.site,
        mission: { id: mission.id, area: mission.area, progress: mission.progress, aircraft: mission.aircraftModel },
        selectedAnomaly: {
          id: selected.id,
          type: selected.type,
          severity: selected.severity,
          location: `${selected.array} / ${selected.module}`,
          temperatureDeltaC: selected.deltaT,
          alignmentQuality: selected.alignment,
          estimatedLossKw: selectedMapPoint.estimatedLossKw,
          status: selected.status,
        },
        qualityGate: { state: qualityGate.state, score: qualityGate.score, failedChecks: qualityGate.failed.map((check) => check.label) },
      } }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mission, qualityGate.state, qualityReasonKey, selected, selectedMapPoint.estimatedLossKw]);

  useEffect(() => {
    if (missionProfiles[missionIndex]?.site === activeSite) return;
    const next = missionProfiles.findIndex((item) => item.site === activeSite);
    if (next >= 0) setMissionIndex(next);
  }, [activeSite, missionIndex]);

  const selectMapEvent = (index: number) => {
    setSelected(anomalies[index]);
    notify('已定位异常事件', `${anomalies[index].id} · ${anomalies[index].array} 方阵`);
  };

  const selectAnomaly = (item: Anomaly, announce = false) => {
    setSelected(item);
    if (announce) notify('地图与证据已联动', `${item.id} · ${item.array} / ${item.module}`);
  };

  const activateMapTool = (tool: 'route' | 'measure' | 'annotate') => {
    setMapTool(tool);
    if (tool === 'route') setRouteVisible((value) => !value);
    if (tool === 'annotate') {
      setAnnotations((value) => Math.min(value + 1, 3));
      notify('地图标注已添加', '标注保存在当前任务草稿中');
    }
    if (tool === 'measure') notify('测距工具已启用', '演示线段长度 286 m');
  };

  const enterMapFullscreen = async () => {
    try { await mapRef.current?.requestFullscreen(); }
    catch { notify('浏览器未允许全屏', '可在地址栏中开启全屏权限', 'warning'); }
  };

  const startMapToolDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const toolbar = event.currentTarget.parentElement;
    if (!toolbar) return;
    const rect = toolbar.getBoundingClientRect();
    mapToolDragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveMapToolDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = mapToolDragRef.current;
    const map = mapRef.current;
    const toolbar = event.currentTarget.parentElement;
    if (!drag || drag.pointerId !== event.pointerId || !map || !toolbar) return;
    const mapRect = map.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const x = event.clientX - mapRect.left - drag.offsetX;
    const y = event.clientY - mapRect.top - drag.offsetY;
    setMapToolPosition({
      x: Math.max(8, Math.min(x, mapRect.width - toolbarRect.width - 8)),
      y: Math.max(8, Math.min(y, mapRect.height - toolbarRect.height - 50))
    });
  };

  const endMapToolDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (mapToolDragRef.current?.pointerId === event.pointerId) mapToolDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div className="page dashboard-page">
    <section className="mission-context" aria-label="当前任务上下文">
      <label><span>电站</span><select value={mission.site} onChange={(event) => { const nextSite = event.target.value; const next = missionProfiles.findIndex((item) => item.site === nextSite); if (next >= 0) setMissionIndex(next); onSiteChange(nextSite); }}>{siteOptions.map((site) => <option key={site}>{site}</option>)}</select></label>
      <label><span>当前任务</span><select value={missionIndex} onChange={(event) => { const next = Number(event.target.value); setMissionIndex(next); notify('当前任务已切换', `${missionProfiles[next].id} · ${missionProfiles[next].sceneLabel}`); }}>{siteMissions.map(({ item, index }) => <option key={item.id} value={index}>{item.id} · {item.area}</option>)}</select></label>
      <div className="mission-progress"><span>航线进度 <strong>{mission.progress}%</strong></span><i><b style={{ width: `${mission.progress}%` }} /></i></div>
      <dl><div><dt>已飞</dt><dd>{mission.elapsed}</dd></div><div><dt>预计剩余</dt><dd>{mission.remaining}</dd></div><div><dt>覆盖面积</dt><dd>{mission.inspectedArea}</dd></div></dl>
      <div className="mission-context-actions" aria-label="任务快捷操作"><Button onClick={() => navigate('/data?upload=1')}><Upload />导入数据</Button><Button onClick={() => navigate('/missions?create=1')}><Plane />新建任务</Button><Button variant="primary" onClick={() => navigate(`/live?mission=${mission.id}`)}><Gauge />实时任务</Button></div>
    </section>

    <div className="environment-ribbon"><span><CloudSun /></span><p><strong>{mission.weather.ambientC}°C · {mission.weather.summary}</strong><small>风速 {mission.weather.windSpeed} m/s {mission.weather.windDirection}风</small></p><p><strong>{mission.weather.visibilityKm} km</strong><small>能见度</small></p><p><strong>{mission.flight.rtk}</strong><small>定位状态</small></p><p><strong>{mission.weather.irradiance} W/m²</strong><small>辐照度</small></p><button onClick={() => setTelemetry(telemetryCards[4])}>查看作业环境 <ArrowRight /></button></div>

    <div className={`quality-banner ${qualityPassed ? '' : 'quality-banner-blocked'}`}><span className="quality-icon" aria-hidden="true">{qualityPassed ? <CheckCircle2 /> : <CircleAlert />}</span><div><strong>{qualityPassed ? '本架次飞行与证据质量门控通过' : '本架次存在阻断项，建议复飞或降级处理'}</strong><p>航迹 P95 {flightQuality.crossTrackP95M.toFixed(2)} m · RTK FIX {flightQuality.rtkFixRatePct.toFixed(1)}% · RGB-T 配对 {flightQuality.rgbThermalPairRatePct.toFixed(1)}% · 辐照度 {mission.weather.irradiance} W/m²</p></div><Status tone={qualityPassed ? 'good' : 'danger'}>{qualityGate.score} / 100 · {qualityPassed ? '通过' : '阻断'}</Status><button aria-label={`查看 ${mission.id} 九项飞行与证据质量门控`} onClick={() => navigate(`/command-center?mission=${mission.id}&quality=1`)}>查看九项门控 <ArrowRight /></button></div>

    <div className="dashboard-primary-grid">
      <Panel className="map-panel" title="异常事件与航线地图" description={`${mission.id} · ${mission.site} ${mission.area}`} action={<div className="segmented"><button className={mapLayer === 'rgb' ? 'active' : ''} onClick={() => setMapLayer('rgb')}>RGB</button><button className={mapLayer === 'thermal' ? 'active thermal' : ''} onClick={() => setMapLayer('thermal')}>热态</button></div>}>
        <div ref={mapRef} className={`field-map ${mapLayer} ${mapFocused ? 'map-focused' : ''}`}>
          <AnimatePresence mode="wait"><motion.img key={mission.mapImage} src={mission.mapImage} alt={mission.mapAlt} initial={reduceMotion ? false : { opacity: 0, scale: 1.015 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: 0.34 }} /></AnimatePresence>
          <svg viewBox="0 0 1000 560" aria-label={`${mission.site}${mission.area}计划航线、实际轨迹与异常点覆盖层`}>{routeVisible ? <AnimatedFlightPath mission={mission} moving={mission.progress < 100} revision={mapRevision} /> : null}{mapTool === 'measure' ? <><line x1="310" y1="420" x2="690" y2="270" className="measurement-line" /><text x="505" y="335" className="measurement-label">286 m</text></> : null}{Array.from({ length: annotations }).map((_, index) => <g key={index} transform={`translate(${420 + index * 75} ${150 + index * 42})`} className="map-note"><circle r="15"/><text y="4">{index + 1}</text></g>)}{anomalyMapPoints.map((point, index) => { const item = anomalies.find((entry) => entry.id === point.eventId); if (!item) return null; const active = selected.id === item.id; return <g key={point.eventId} className={`map-event-marker ${item.severity} ${active ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`定位 ${item.id} ${item.type}`} transform={`translate(${point.x} ${point.y})`} onClick={() => selectMapEvent(index)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectMapEvent(index); } }}><circle className="map-event-halo" r="20"/><circle className="map-event-core" r={active ? 13 : 10}/><text y="4">{index + 1}</text></g>; })}</svg>
          <div className={`map-selection-card severity-${selected.severity}`} style={{ left: `${selectedMapPoint.x / 10}%`, top: `${selectedMapPoint.y / 5.6}%` }} aria-live="polite"><header><span>{selected.array} · {selected.module}</span><Status tone={selected.severity === 'critical' ? 'danger' : selected.severity === 'high' ? 'warn' : selected.severity === 'medium' ? 'info' : 'neutral'}>{selected.status}</Status></header><strong>{selected.type}</strong><p>ΔT +{selected.deltaT}°C · 预计影响 {selectedMapPoint.estimatedLossKw.toFixed(1)} kW</p><footer><button onClick={() => navigate(`/evidence?mission=${mission.id}&event=${selected.id}`)}>查看证据</button><button onClick={() => navigate(`/work-orders?event=${selected.id}`)}>处置</button></footer></div>
          <div className="map-coordinates">{mission.coordinates.split(' · ').map((coordinate) => <span key={coordinate}>{coordinate}</span>)}</div>
          <div className="scene-identity"><Status tone="info">概念演示底图</Status><strong>{mission.sceneLabel}</strong><small>{mission.sceneNote}</small></div>
          <div className="map-legend map-legend-detailed"><strong>图例</strong><span><i className="current"><Plane /></i>当前航点</span><span><i className="planned" />计划航线</span><span><i className="actual" />实际轨迹</span><span><i className="completed" />已完成航段</span><em>异常点</em><span><i className="critical" />严重</span><span><i className="high" />高</span><span><i className="medium" />中</span><span><i className="low" />低</span><span><i className="direction"><Navigation /></i>扫描方向</span></div>
          <div className="map-mode-tools" style={{ left: mapToolPosition.x, top: mapToolPosition.y }}><button type="button" className="map-tool-drag-handle" aria-label="拖动地图工具栏" title="按住拖动工具栏，双击恢复位置" onPointerDown={startMapToolDrag} onPointerMove={moveMapToolDrag} onPointerUp={endMapToolDrag} onPointerCancel={endMapToolDrag} onDoubleClick={() => setMapToolPosition({ x: 12, y: 42 })}><GripVertical /></button><IconButton label={routeVisible ? '隐藏航线' : '显示航线'} className={mapTool === 'route' ? 'active' : ''} onClick={() => activateMapTool('route')}><Route /></IconButton><IconButton label="图层" onClick={() => setMapLayer((value) => value === 'rgb' ? 'thermal' : 'rgb')}><Layers3 /></IconButton><IconButton label="测距" className={mapTool === 'measure' ? 'active' : ''} onClick={() => activateMapTool('measure')}><Ruler /></IconButton><IconButton label="添加标注" className={mapTool === 'annotate' ? 'active' : ''} onClick={() => activateMapTool('annotate')}><Pencil /></IconButton><IconButton label="地图全屏" onClick={enterMapFullscreen}><Maximize2 /></IconButton></div>
          <div className="map-tools"><IconButton label="定位当前无人机" onClick={() => { setMapFocused(true); window.setTimeout(() => setMapFocused(false), 1600); notify(`已定位 ${mission.aircraft}`, `当前高度 ${mission.flight.altitude} m，链路 ${mission.flight.signal} dBm`); }}><Navigation /></IconButton><IconButton label="切换图层" onClick={() => setMapLayer((value) => value === 'rgb' ? 'thermal' : 'rgb')}><Focus /></IconButton><IconButton label="刷新地图" onClick={() => { setMapRevision((value) => value + 1); notify('地图数据已刷新', `航迹与异常点更新时间 ${environmentSnapshot.updatedAt}`); }}><RefreshCw /></IconButton></div>
          <div className="map-scale"><i />{mission.mapScale}</div><div className="map-status"><button onClick={() => navigate(`/live?mission=${mission.id}`)}><Status tone="good">任务完成 {mission.progress}%</Status></button><span><Plane />{mission.aircraft} · {mission.deviceId}</span><span><Route />已飞 {mission.routeLength}</span><span><MapPin />{operational.componentsLocated.toLocaleString()} 个组件已定位</span></div>
        </div>
      </Panel>

      <Panel className="priority-panel" title="异常优先级" description="按证据强度与资产影响排序" action={<button className="text-action" onClick={() => navigate('/anomalies')}>全部 {operational.totalAnomalies} <ArrowRight /></button>}><div className="priority-tabs"><button className={priority === 'pending' ? 'active' : ''} onClick={() => setPriority('pending')}>待复核 {operational.pendingAnomalies}</button><button className={priority === 'high' ? 'active' : ''} onClick={() => setPriority('high')}>高风险 {operational.highRiskAnomalies}</button><button className={priority === 'all' ? 'active' : ''} onClick={() => setPriority('all')}>全部 {operational.totalAnomalies}</button></div><div className="anomaly-list">{priorityItems.slice(0, 4).map((item) => <button key={item.id} className={selected.id === item.id ? 'anomaly-row active' : 'anomaly-row'} onClick={() => selectAnomaly(item, true)}><span className={`severity-bar ${item.severity}`} /><div className="paired-thumbs"><figure><img src="/assets/evidence-rgb.png" alt="RGB 缩略图"/><figcaption>RGB</figcaption></figure><figure><img src="/assets/evidence-thermal.png" alt="热成像缩略图"/><figcaption>Thermal</figcaption></figure></div><div><span><Status tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warn' : 'info'}>{item.severity === 'critical' ? '严重' : item.severity === 'high' ? '高' : '中'}</Status><strong>#{item.id.slice(-3)} · {item.type}</strong></span><p>{item.array} · 组件 {item.module}</p><small>ΔT +{item.deltaT}°C · 置信度 {item.confidence}</small><time>{item.time}</time></div><ArrowRight /></button>)}</div><div className="selected-summary"><header><span><Crosshair /></span><div><strong>{selected.id}</strong><small>地图、证据与处置已同步 · {selected.time}</small></div></header><dl><div><dt>配准质量</dt><dd>{Math.round(selected.alignment * 100)}%</dd></div><div><dt>估算影响</dt><dd>{selectedMapPoint.estimatedLossKw.toFixed(1)} kW</dd></div><div><dt>建议动作</dt><dd>24 小时内复核</dd></div></dl><Button variant="primary" onClick={() => navigate(`/evidence?mission=${mission.id}&event=${selected.id}`)}>打开双模态证据</Button></div></Panel>
    </div>

    <div className="metric-grid"><Metric label="健康组件" value={operational.healthyModules.toLocaleString()} change={`本任务已定位 ${operational.componentsLocated.toLocaleString()} 块`} tone="metric-teal" icon={CheckCircle2} /><Metric label="待复核异常" value={String(operational.pendingAnomalies)} change={`总计 ${operational.totalAnomalies} · 高风险 ${operational.highRiskAnomalies}`} tone="metric-coral" icon={Activity} /><Metric label="闭环工单" value={String(operational.closedLoopRatePct)} unit="%" change="按已关闭 / 已确认工单统计" tone="metric-cobalt" icon={ClipboardCheck} /><Metric label="有效覆盖" value={operational.effectiveCoveragePct.toFixed(1)} unit="%" change={operational.effectiveCoveragePct >= 95 ? '达到项目目标值 ≥ 95%' : '低于项目目标值 95%'} tone="metric-amber" icon={ScanSearch} /></div>

    <div className="readiness-strip">{telemetryCards.map(({ id, label, value, icon: Icon, ...card }) => <button key={id} onClick={() => setTelemetry({ id, label, value, icon: Icon, ...card })}><span><Icon /></span><p><small>{label}</small><strong>{value}</strong></p><ArrowRight /></button>)}</div>

    <div className="dashboard-lower-grid"><Panel title="运行趋势" description="演示曲线用于验证分析流程" action={<div className="segmented"><button className={analytics === 'temperature' ? 'active' : ''} onClick={() => setAnalytics('temperature')}>温度</button><button className={analytics === 'health' ? 'active' : ''} onClick={() => setAnalytics('health')}>健康</button></div>}>{analytics === 'temperature' ? <div className="chart-wrap" role="img" aria-label="组件最高温度、逆变器平均温度和环境温度趋势"><ResponsiveContainer width="100%" height={230}><LineChart data={temperatureTrend} margin={{ left: 0, right: 10, top: 12 }}><CartesianGrid stroke="#e3e9e6" vertical={false}/><XAxis dataKey="time" tickLine={false} axisLine={false}/><YAxis domain={[20,100]} tickLine={false} axisLine={false}/><Tooltip/><Legend/><Line type="monotone" dataKey="module" name="组件最高温度" stroke="#e56b5d" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="inverter" name="逆变器平均温度" stroke="#f2a33f" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="ambient" name="环境温度" stroke="#5d83d6" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div> : <div className="chart-wrap" role="img" aria-label="最近七日资产健康分趋势"><ResponsiveContainer width="100%" height={230}><AreaChart data={healthTrend} margin={{ left: 0, right: 10, top: 12 }}><defs><linearGradient id="healthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2cb6a0" stopOpacity={0.28}/><stop offset="1" stopColor="#2cb6a0" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#e3e9e6" vertical={false}/><XAxis dataKey="day" tickLine={false} axisLine={false}/><YAxis domain={[88,100]} tickLine={false} axisLine={false}/><Tooltip/><Area type="monotone" dataKey="health" stroke="#168c7b" strokeWidth={2.5} fill="url(#healthFill)" name="健康分"/></AreaChart></ResponsiveContainer></div>}<div className="chart-summary"><span><i className="teal" />当前组件最高温 <strong>76.8°C</strong></span><span>逆变器平均 <strong>48.3°C</strong></span><span>环境温度 <strong>28.0°C</strong></span><button onClick={() => downloadCsv('sentinel-operation-trend.csv', [['时间','组件最高温度','逆变器平均温度','环境温度'], ...temperatureTrend.map((item) => [item.time,item.module,item.inverter,item.ambient])])}><FileDown />导出</button></div></Panel><Panel title="当前工单" description="风险确认后的处置闭环" action={<button className="text-action" onClick={() => navigate('/work-orders')}>全部工单 <ArrowRight /></button>}><div className="compact-table"><div className="table-head"><span>工单</span><span>负责人</span><span>优先级</span><span>状态</span></div>{workOrders.map((order) => <button className="table-row" key={order.id} onClick={() => navigate(`/work-orders?order=${order.id}`)}><span><strong>{order.id}</strong><small>{order.title}</small></span><span>{order.owner}</span><span><Status tone={order.priority === '紧急' ? 'danger' : order.priority === '高' ? 'warn' : 'info'}>{order.priority}</Status></span><span>{order.state}</span></button>)}</div></Panel></div>

    <footer className="mission-totals"><span>任务 {mission.id}</span><span>飞行总时长 01:42:38</span><span>总里程 18.7 km</span><span>累计巡检面积 2.31 km²</span><span>RGB {mission.frames.toLocaleString()} 张</span><span>Thermal {mission.frames.toLocaleString()} 张</span><Status tone="good">数据已同步</Status></footer>

    <Drawer open={Boolean(telemetry)} title={telemetry?.label ?? '运行状态'} onClose={() => setTelemetry(null)}>{telemetry ? <div className="telemetry-drawer"><div className="telemetry-hero"><span><TelemetryIcon /></span><div><Status tone="good">实时演示状态</Status><h3>{telemetry.value}</h3><p>{telemetry.detail}</p></div></div><div className="connection-path"><span><Plane />UAV-07</span><i /><span><Radio />边缘遥控站</span><i /><span><Signal />Sentinel API</span></div><div className="engineering-note"><strong>工程含义</strong><p>{telemetry.principle}</p></div><div className="engineering-note boundary"><strong>判读边界</strong><p>{telemetry.boundary}</p></div><dl className="evidence-facts"><div><dt>最后心跳</dt><dd>10:32:18.182</dd></div><div><dt>连续在线</dt><dd>01:42:38</dd></div><div><dt>数据来源</dt><dd>演示适配器</dd></div><div><dt>控制权限</dt><dd>只读，不下发飞控</dd></div></dl><Button variant="primary" onClick={() => { notify('连接状态已刷新', `${telemetry.label} · 正常`); }}>刷新诊断</Button><Button onClick={() => downloadJson(`${telemetry.id}-diagnostic.json`, { ...telemetry, missionId: mission.id, checkedAt: new Date().toISOString(), controlEnabled: false })}>下载诊断记录</Button></div> : null}</Drawer>
  </div>;
}
