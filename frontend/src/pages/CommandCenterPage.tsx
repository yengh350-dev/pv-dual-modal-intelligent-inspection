import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  BatteryCharging, CheckCircle2, ChevronRight, CircleAlert, ClipboardCheck, Clock3,
  Cpu, Crosshair, Database, Download, FileCheck2, HardDrive, MapPinned, Maximize2, Navigation, Pause,
  Plane, Play, Radio, RefreshCw, Route, Satellite, Server, ShieldCheck, Thermometer, Wifi, Wind
} from 'lucide-react';
import { AnimatedFlightPath } from '../components/AnimatedFlightPath';
import { Button, Drawer, IconButton, Status } from '../components/ui';
import { anomalies, anomalyMapPoints, latencyTrend, missionActivity, missionOperationalSummary, missionProfiles, teamMembers, type Anomaly } from '../lib/data';
import { downloadJson, notify } from '../lib/actions';
import { getAvatar } from '../lib/avatars';
import { getFlightQuality } from '../lib/api';
import { evaluateFlightQuality, flightQualityByMission, projectQualityThresholds, type FlightQualityProfile } from '../lib/flightQuality';
import { evidenceForEvent } from '../lib/evidenceAssets';
import LiveInspectionPage from './LiveInspectionPage';

type CommandCenterProps = { activeSite: string; onSiteChange: (site: string) => void };
type ViewMode = 'map' | 'thermal';

const siteOptions = Array.from(new Set(missionProfiles.map((item) => item.site)));

export default function CommandCenterPage(props: CommandCenterProps) {
  const location = useLocation();
  return new URLSearchParams(location.search).get('mode') === 'map'
    ? <DemoCommandCenterPage {...props} />
    : <LiveInspectionPage activeSite={props.activeSite} />;
}

function payloadSpecification(mission: (typeof missionProfiles)[number]) {
  if (mission.payload.includes('H20T')) return {
    thermal: '640×512 · 30 Hz', netd: 'NETD ≤50 mK', band: '8–14 μm', range: '-40–150°C 高增益', accuracy: '±2°C 或 ±2%', source: 'DJI H20T 官方规格基线'
  };
  if (mission.aircraftModel.includes('EVO')) return {
    thermal: '640×512 · 30 Hz', netd: 'NETD ≤50 mK', band: '8–14 μm · 25 mm', range: '-20–150°C 高增益', accuracy: '±3°C 或读数 ±3%', source: 'Autel EVO Max 4T 官方规格基线'
  };
  return {
    thermal: '640×512 · 30 Hz', netd: 'NETD ≤50 mK', band: '8–14 μm', range: '-20–150°C 高增益', accuracy: '±2°C 或 ±2%', source: 'DJI Mavic 3T 官方规格基线'
  };
}

function DemoCommandCenterPage({ activeSite, onSiteChange }: CommandCenterProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const boardRef = useRef<HTMLDivElement>(null);
  const requestedMissionId = new URLSearchParams(location.search).get('mission');
  const requestedMission = missionProfiles.find((item) => item.id === requestedMissionId);
  const initialMission = requestedMission?.site === activeSite ? requestedMission : missionProfiles.find((item) => item.site === activeSite) ?? missionProfiles[0];
  const [missionId, setMissionId] = useState(initialMission.id);
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [routeVisible, setRouteVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(anomalies[0]);
  const [syncRevision, setSyncRevision] = useState(0);
  const [tick, setTick] = useState(0);
  const [qualityOpen, setQualityOpen] = useState(() => new URLSearchParams(location.search).get('quality') === '1');
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityProfile, setQualityProfile] = useState<FlightQualityProfile>(flightQualityByMission[initialMission.id]);
  const [qualitySource, setQualitySource] = useState<'local' | 'api'>('local');
  const mission = missionProfiles.find((item) => item.id === missionId) ?? initialMission;
  const siteMissions = missionProfiles.filter((item) => item.site === activeSite);
  const specification = payloadSpecification(mission);
  const operational = missionOperationalSummary[mission.id];
  const quality = qualityProfile ?? flightQualityByMission[mission.id] ?? flightQualityByMission[missionProfiles[0].id];
  const qualityGate = useMemo(() => evaluateFlightQuality(quality, mission.weather.irradiance), [mission.weather.irradiance, quality]);
  const qualityLabel = qualityGate.state === 'pass' ? '通过' : qualityGate.state === 'attention' ? '需关注' : '阻断分析';
  const qualityTone = qualityGate.state === 'pass' ? 'good' : qualityGate.state === 'attention' ? 'warn' : 'danger';
  const qualityReasonKey = qualityGate.failed.map((check) => check.label).join('|');
  const qualitySeries = quality.crossTrackSeriesM.map((deviation, index) => ({ sample: index + 1, deviation }));

  useEffect(() => {
    if (mission.site === activeSite) return;
    const nextMission = missionProfiles.find((item) => item.site === activeSite);
    if (nextMission) setMissionId(nextMission.id);
  }, [activeSite, mission.site]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextMissionId = params.get('mission');
    const nextMission = missionProfiles.find((item) => item.id === nextMissionId);
    if (nextMission) {
      setMissionId(nextMission.id);
      if (nextMission.site !== activeSite) onSiteChange(nextMission.site);
    }
    if (params.get('quality') === '1') setQualityOpen(true);
  }, [location.search]);

  useEffect(() => {
    if (paused || reduceMotion) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 2500);
    return () => window.clearInterval(timer);
  }, [paused, reduceMotion]);

  useEffect(() => setSelectedAlert(anomalies[0]), [mission.id]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('sentinel:copilot-context', { detail: {
        module: '指挥大屏',
        site: mission.site,
        mission: { id: mission.id, area: mission.area, progress: mission.progress, aircraft: mission.aircraftModel },
        liveState: { paused, viewMode, routeVisible },
        selectedAnomaly: {
          id: selectedAlert.id,
          type: selectedAlert.type,
          severity: selectedAlert.severity,
          location: `${selectedAlert.array} / ${selectedAlert.module}`,
          temperatureDeltaC: selectedAlert.deltaT,
          status: selectedAlert.status,
        },
        qualityGate: { state: qualityGate.state, label: qualityLabel, score: qualityGate.score, failedChecks: qualityGate.failed.map((check) => check.label) },
      } }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mission, paused, qualityGate.state, qualityLabel, qualityReasonKey, routeVisible, selectedAlert, viewMode]);

  useEffect(() => {
    const nextQuality = flightQualityByMission[mission.id];
    if (nextQuality) setQualityProfile(nextQuality);
    setQualitySource('local');
  }, [mission.id]);

  useEffect(() => {
    if (!qualityOpen) return;
    let cancelled = false;
    const loadQuality = async () => {
      setQualityLoading(true);
      const fallback = flightQualityByMission[mission.id];
      if (fallback) setQualityProfile(fallback);
      try {
        const response = await getFlightQuality(mission.id);
        if (!cancelled) {
          setQualityProfile(response);
          setQualitySource('api');
        }
      } catch {
        if (!cancelled) setQualitySource('local');
      } finally {
        if (!cancelled) setQualityLoading(false);
      }
    };
    void loadQuality();
    return () => { cancelled = true; };
  }, [mission.id, qualityOpen]);

  const telemetry = useMemo(() => Array.from({ length: 24 }, (_, index) => ({
    t: index,
    altitude: Number((mission.flight.altitude + Math.sin((index + tick) / 2.7) * 2.8).toFixed(1)),
    signal: Math.round(Math.abs(mission.flight.signal) + Math.cos((index + tick) / 3.2) * 4),
    battery: Number(Math.max(12, mission.flight.battery - index * .18).toFixed(1)),
    motor: Number((42 + Math.sin((index + tick) / 3.4) * 4.2).toFixed(1)),
    satellites: Math.round(30 + Math.sin((index + tick) / 4.1) * 3),
    wind: Number((mission.weather.windSpeed + Math.cos((index + tick) / 2.6) * .7).toFixed(1)),
  })), [mission.flight.altitude, mission.flight.battery, mission.flight.signal, mission.weather.windSpeed, tick]);

  const safetyChecks = [
    ['飞行器系统', '正常'],
    ['智能电池', `正常 ${mission.flight.battery}%`],
    ['GNSS / RTK', mission.flight.rtk],
    ['遥控与图传链路', `${mission.flight.signal} dBm`],
    ['任务区域与围栏', '已校验'],
    ['禁飞区与限高', '无冲突'],
    ['天气与风速', `${mission.weather.windSpeed} m/s`],
    ['双光载荷自检', '已通过'],
  ] as const;

  const visibleAlerts = anomalies.slice(0, 5);
  const selectedMapPoint = anomalyMapPoints.find((point) => point.eventId === selectedAlert.id) ?? anomalyMapPoints[0];
  const selectedEvidence = evidenceForEvent(selectedAlert.id);

  const selectAlert = (item: Anomaly) => {
    setSelectedAlert(item);
  };

  const pipeline = [
    ['RGB 入库', Math.min(100, mission.progress + 8)],
    ['Thermal 入库', Math.min(100, mission.progress + 5)],
    ['时间同步', 98],
    ['质量门控', Math.max(18, mission.progress - 14)],
    ['AI 分析', Math.max(8, mission.progress - 26)],
  ] as const;

  const workflowSteps = [
    ['计划', 'done'],
    ['安全检查', 'done'],
    ['飞行执行', 'active'],
    ['数据上传', 'waiting'],
    ['质量检查', 'waiting'],
    ['AI 分析', 'waiting'],
    ['人工复核', 'waiting'],
    ['工单生成', 'waiting'],
    ['报告发布', 'waiting'],
  ] as const;

  const changeMission = (nextId: string) => {
    const nextMission = missionProfiles.find((item) => item.id === nextId);
    if (!nextMission) return;
    setMissionId(nextId);
    onSiteChange(nextMission.site);
    navigate(`/command-center?mission=${nextMission.id}`, { replace: true });
    notify('指挥大屏任务已切换', `${nextMission.id} · ${nextMission.sceneLabel}`);
  };

  const changeSite = (nextSite: string) => {
    const nextMission = missionProfiles.find((item) => item.site === nextSite);
    if (!nextMission) return;
    setMissionId(nextMission.id);
    onSiteChange(nextSite);
    navigate(`/command-center?mission=${nextMission.id}`, { replace: true });
    notify('场站已切换', `${nextSite} · 地图、航线、无人机与环境数据已同步`);
  };

  const enterFullscreen = async () => {
    try { await boardRef.current?.requestFullscreen(); }
    catch { notify('浏览器未允许全屏', '请在浏览器地址栏中允许全屏显示', 'warning'); }
  };

  const openQuality = () => {
    setQualityOpen(true);
    const params = new URLSearchParams(location.search);
    params.set('mission', mission.id);
    params.set('quality', '1');
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };

  const leaveQualityDrawer = (target: string) => {
    setQualityOpen(false);
    navigate(target);
  };

  const closeQuality = () => {
    setQualityOpen(false);
    const params = new URLSearchParams(location.search);
    params.delete('quality');
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };

  return <div ref={boardRef} className="command-center-page">
    <header className="cc-header">
      <div className="cc-current-task"><span>演示任务 · 非实时遥测</span><p><strong>{mission.id}</strong><small>{mission.site} · {mission.area}</small></p></div>
      <Button onClick={() => navigate('/command-center')}><Play />视频巡检台</Button>
      <div className="cc-context-controls">
        <label><span>场站</span><select value={activeSite} onChange={(event) => changeSite(event.target.value)}>{siteOptions.map((site) => <option key={site}>{site}</option>)}</select></label>
        <label><span>任务</span><select value={mission.id} onChange={(event) => changeMission(event.target.value)}>{siteMissions.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.area}</option>)}</select></label>
      </div>
      <div className="cc-header-status"><Status tone="good">演示适配器在线</Status><span><Clock3 />数据刷新 0.8 s 前</span><IconButton label={paused ? '继续动态回放' : '暂停动态回放'} onClick={() => setPaused((value) => !value)}>{paused ? <Play /> : <Pause />}</IconButton><IconButton label="全屏显示指挥大屏" onClick={enterFullscreen}><Maximize2 /></IconButton></div>
    </header>

    <section className="cc-workflow" aria-label="任务处理流程">
      {workflowSteps.map(([label, state], index) => <button key={label} className={`cc-workflow-step ${state}`} onClick={() => notify(label, state === 'done' ? '该阶段已完成并写入任务记录' : state === 'active' ? '当前任务正在执行此阶段' : '等待前序阶段完成')}><span>{state === 'done' ? <CheckCircle2 /> : index + 1}</span><p><strong>{label}</strong><small>{state === 'done' ? '已完成' : state === 'active' ? '进行中' : '等待中'}</small></p>{index < workflowSteps.length - 1 ? <ChevronRight /> : null}</button>)}
    </section>

    <section className="cc-main-grid">
      <section className="cc-panel cc-map-panel">
        <header><div><h2>航迹与异常分布</h2></div><div className="cc-segmented"><button className={viewMode === 'map' ? 'active' : ''} onClick={() => setViewMode('map')}><MapPinned />底图</button><button className={viewMode === 'thermal' ? 'active' : ''} onClick={() => setViewMode('thermal')}><Thermometer />热态</button></div></header>
        <div className={`cc-map cc-map-${viewMode}`}>
          <AnimatePresence mode="wait"><motion.img key={`${mission.mapImage}-${viewMode}`} src={mission.mapImage} alt={mission.mapAlt} initial={reduceMotion ? false : { opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} /></AnimatePresence>
          <svg viewBox="0 0 1000 560" aria-label={`${mission.site}${mission.area}动态航迹`}><AnimatedFlightPath mission={mission} moving={!paused} showPlanned={routeVisible} revision={syncRevision}/><g className="cc-map-alerts">{anomalyMapPoints.map((point, index) => { const item = anomalies.find((entry) => entry.id === point.eventId); if (!item) return null; return <g key={point.eventId} className={`${item.severity} ${selectedAlert.id === item.id ? 'selected' : ''}`} role="button" tabIndex={0} transform={`translate(${point.x} ${point.y})`} aria-label={`定位异常 ${item.id}`} onClick={() => selectAlert(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAlert(item); } }}><circle className="halo" r="21"/><circle className="core" r={selectedAlert.id === item.id ? 13 : 10}/><text y="4">{index + 1}</text></g>; })}</g></svg>
          {!paused && !reduceMotion ? <span className="cc-map-scan" /> : null}
          <div className="cc-map-tools"><IconButton label={routeVisible ? '隐藏计划航线' : '显示计划航线'} className={routeVisible ? 'active' : ''} onClick={() => setRouteVisible((value) => !value)}><Route /></IconButton><IconButton label="定位当前无人机" onClick={() => notify(`已定位 ${mission.aircraft}`, `${mission.coordinates} · ${mission.flight.altitude} m AGL`)}><Crosshair /></IconButton><IconButton label="刷新地图数据" onClick={() => { setSyncRevision((value) => value + 1); notify('空间态势已刷新', `${mission.id} 航迹和异常点已同步`); }}><RefreshCw /></IconButton></div>
          <div className="cc-map-summary"><strong>{mission.progress}%</strong><span>{mission.sceneLabel}</span><p>{mission.site} · {mission.area}</p><dl><div><dt>已飞</dt><dd>{mission.elapsed}</dd></div><div><dt>覆盖</dt><dd>{mission.inspectedArea}</dd></div><div><dt>航程</dt><dd>{mission.routeLength}</dd></div></dl></div>
          <button className={`cc-route-quality cc-route-${qualityGate.state}`} onClick={() => void openQuality()} aria-label={`打开航迹与证据质量门控，当前${qualityLabel}`}><Crosshair/><span><small>航迹质量门控</small><strong>P95 {quality.crossTrackP95M.toFixed(2)} m · {qualityLabel}</strong></span><ChevronRight/></button>
          <details key={selectedAlert.id} open className={`cc-map-selection severity-${selectedAlert.severity}`} style={{ left: `${selectedMapPoint.x / 10}%`, top: `${selectedMapPoint.y / 5.6}%` }} aria-live="polite"><summary aria-label="展开或收起异常详情" title="展开或收起异常详情"><CircleAlert/><span>{selectedAlert.array}</span><ChevronRight/></summary><div className="cc-selection-content"><img src={selectedEvidence.thermal} alt={`${selectedAlert.id}热红外证据缩略图`} /><div><header><span>{selectedAlert.array} · {selectedAlert.module}</span><Status tone={selectedAlert.severity === 'critical' ? 'danger' : selectedAlert.severity === 'high' ? 'warn' : selectedAlert.severity === 'medium' ? 'info' : 'neutral'}>{selectedAlert.status}</Status></header><strong>{selectedAlert.type}</strong><small>ΔT +{selectedAlert.deltaT}°C · 影响估算 {selectedMapPoint.estimatedLossKw.toFixed(1)} kW</small><footer><button onClick={() => navigate(`/evidence?mission=${mission.id}&event=${selectedAlert.id}`)}>查看证据</button><button onClick={() => navigate(`/work-orders?event=${selectedAlert.id}`)}>发起处置</button></footer></div></div></details>
          <div className="cc-map-legend cc-map-legend-detailed"><strong>图例</strong><span><i className="current"><Plane /></i>当前航点</span><span><i className="planned"/>计划航线</span><span><i className="actual"/>实际轨迹</span><span><i className="completed"/>已完成航段</span><em>异常等级</em><span><i className="critical"/>严重</span><span><i className="high"/>高</span><span><i className="medium"/>中</span><span><i className="low"/>低</span><span><i className="direction"><Navigation /></i>扫描方向</span></div>
          <div className="cc-coordinates"><b>{mission.coordinates}</b><small>{viewMode === 'thermal' ? '热态渲染示意 · 非辐射测温图' : `WGS84 · 比例尺 ${mission.mapScale}`}</small></div>
        </div>
      </section>

      <section className="cc-panel cc-safety-panel">
        <header><div><h2>飞行安全检查</h2></div><button onClick={() => void openQuality()}>详情 <ChevronRight /></button></header>
        <div className="cc-safety-list">{safetyChecks.map(([label, value]) => <button key={label} onClick={() => notify(`${label}检查`, `${value} · 记录已写入任务审计`)}><CheckCircle2 /><span>{label}</span><strong>{value}</strong></button>)}</div>
        <footer><span>检查完成时间</span><strong>08:12:34</strong></footer>
      </section>

      <section className="cc-panel cc-aircraft-panel">
        <header><div><h2>无人机与载荷</h2></div><button onClick={() => navigate('/settings?section=drone')}>刷新 <RefreshCw /></button></header>
        <div className="cc-dock-visual cc-aircraft-visual"><img src="/assets/inspection-drone.png" alt="无人机设备示意图"/><span>{mission.aircraftModel}</span><i className={paused ? 'paused' : ''}><Radio /></i></div>
        <div className="cc-aircraft-id"><span><Plane /></span><p><strong>{mission.deviceId}</strong><small>{mission.payload} · 三链路只读接入</small></p><Status tone="good">在线</Status></div>
        <dl className="cc-facts"><div><dt>飞行模式</dt><dd>自动航线</dd></div><div><dt>电量</dt><dd>{mission.flight.battery}%</dd></div><div><dt>高度</dt><dd>{mission.flight.altitude} m AGL</dd></div><div><dt>速度</dt><dd>{mission.flight.speed} m/s</dd></div><div><dt>链路强度</dt><dd>{mission.flight.signal} dBm</dd></div><div><dt>定位</dt><dd>{mission.flight.rtk}</dd></div></dl>
        <footer><ShieldCheck /><span><strong>{specification.thermal} · {specification.netd}</strong><small>{specification.source}</small></span></footer>
      </section>

      <div className="cc-runtime-stack">
        <section className="cc-panel cc-latency-panel"><header><div><small>NETWORK LATENCY</small><h2>数据延迟</h2></div><button onClick={() => notify('延迟数据已刷新', '最近 6 分钟链路采样已更新')}>刷新</button></header><div className="cc-latency-summary"><div className="cc-latency-value"><strong>1.2</strong><span>s</span><small>端到端</small></div><dl><div><dt>链路</dt><dd>68 ms</dd></div><div><dt>图传</dt><dd>120 ms</dd></div><div><dt>控制</dt><dd>42 ms</dd></div></dl></div><div className="cc-latency-chart" role="img" aria-label="最近六分钟数据延迟趋势"><ResponsiveContainer width="100%" height="100%"><LineChart data={latencyTrend} margin={{ top: 5, right: 8, bottom: 1, left: 0 }}><CartesianGrid stroke="var(--cc-chart-grid)" vertical={false}/><XAxis dataKey="t" tickLine={false} axisLine={false} interval={1}/><YAxis width={20} domain={[0,3]} ticks={[0,1,2,3]} interval={0} tickLine={false} axisLine={false} tickMargin={2}/><Tooltip/><Line type="monotone" dataKey="value" name="延迟 s" stroke="#639df3" strokeWidth={2} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div></section>
        <section className="cc-panel cc-pipeline-panel"><header><div><small>EDGE DATA PIPELINE</small><h2>上传与分析队列</h2></div><button onClick={() => navigate('/data')}>查看全部</button></header><div>{pipeline.map(([label, progress]) => <button key={label} onClick={() => notify(`${label}处理状态`, `${progress}% · ${progress >= 98 ? '已通过' : '按依赖顺序执行中'}`)}><span><b>{label}</b><em>{progress >= 98 ? '已完成' : '进行中'} {progress}%</em></span><i><strong style={{ width: `${progress}%` }}/></i></button>)}</div><footer>队列中任务 3 <b>预计剩余 00:18:42</b></footer></section>
      </div>
    </section>

    <section className="cc-bottom-grid">
      <section className="cc-panel cc-queue-panel"><header><div><small>ANOMALY QUEUE</small><h2>异常队列 ({visibleAlerts.length})</h2></div><button onClick={() => navigate('/anomalies')}>查看全部</button></header><div>{visibleAlerts.map((item) => <button key={item.id} className={selectedAlert.id === item.id ? 'active' : ''} onClick={() => selectAlert(item)}><Status tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warn' : item.severity === 'medium' ? 'info' : 'neutral'}>{item.severity === 'critical' ? '严重' : item.severity === 'high' ? '高' : item.severity === 'medium' ? '中' : '低'}</Status><span><strong>{item.array} · {item.type}</strong><small>{item.time} · ΔT +{item.deltaT}°C</small></span><em>{item.status}</em></button>)}</div><footer><button onClick={() => navigate(`/evidence?mission=${mission.id}&event=${selectedAlert.id}`)}><FileCheck2 />复核 {selectedAlert.id}</button><button onClick={() => navigate(`/work-orders?event=${selectedAlert.id}`)}><ClipboardCheck />创建工单</button></footer></section>

      <section className="cc-panel cc-team-panel"><header><div><small>TEAM & DUTY</small><h2>团队与分工</h2></div><button onClick={() => navigate('/users')}>查看全部</button></header><div>{teamMembers.map((member) => <button key={member.name} onClick={() => notify(`${member.name} · ${member.role}`, `${member.scope} · 当前${member.state}`)}><img className="member-avatar" src={getAvatar(member.name)} alt={`${member.name}头像`} /><p><strong>{member.name}</strong><small>{member.role} · {member.scope}</small></p><em className={member.state === '在线' ? '' : 'offline'}>{member.state}</em></button>)}</div></section>

      <section className="cc-panel cc-activity-panel"><header><div><small>MISSION ACTIVITY</small><h2>活动日志</h2></div><button onClick={() => navigate('/missions')}>查看全部</button></header><div>{missionActivity.map((item) => <button key={`${item.time}-${item.title}`} onClick={() => notify(item.title, `${item.time} · ${item.detail}`)}><i className={item.tone}/><time>{item.time}</time><p><strong>{item.title}</strong><small>{item.detail}</small></p></button>)}</div></section>

      <section className="cc-panel cc-health-panel"><header><div><small>SYSTEM HEALTH</small><h2>系统健康</h2></div><Status tone={paused ? 'neutral' : 'good'}>{paused ? '已暂停' : '2.5 s 更新'}</Status></header><div className="cc-health-grid"><div><span><BatteryCharging/>电池健康度 <b>96%</b></span><div className="cc-health-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={telemetry} margin={{ top: 5, right: 1, bottom: 2, left: 1 }}><Area type="monotone" dataKey="battery" stroke="#34a779" fill="#34a77922" strokeWidth={2} dot={false}/></AreaChart></ResponsiveContainer></div></div><div><span><Cpu/>机体温度 <b>42°C</b></span><div className="cc-health-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={telemetry} margin={{ top: 5, right: 1, bottom: 2, left: 1 }}><Line type="monotone" dataKey="motor" stroke="#d98a28" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></div><div><span><Satellite/>GNSS 卫星数 <b>32</b></span><div className="cc-health-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={telemetry} margin={{ top: 5, right: 1, bottom: 2, left: 1 }}><Line type="monotone" dataKey="satellites" stroke="#4f78c7" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></div><div><span><Wind/>环境风速 <b>{mission.weather.windSpeed} m/s</b></span><div className="cc-health-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={telemetry} margin={{ top: 5, right: 1, bottom: 2, left: 1 }}><Line type="monotone" dataKey="wind" stroke="#4a9da4" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></div></div><footer><span><HardDrive/>存储 1.2 TB 可用</span><span><Wifi/>带宽 85 Mbps</span></footer></section>
    </section>

    <footer className="cc-footer"><span><Wifi />数据源 DEMO-RGBT-2409</span><span><Satellite />{mission.coordinates}</span><span><Thermometer />{specification.range} · {specification.band}</span><span><Server />边缘缓存 1.2 TB 可用</span><span><Database />RGB/Thermal {mission.frames.toLocaleString()} 对</span><Status tone="warn">演示回放 · 非真实飞控</Status></footer>

    <Drawer open={qualityOpen} onClose={closeQuality} title="飞行与证据质量门控" width="wide">
      <div className="quality-gate-drawer">
        <section className={`quality-gate-hero quality-gate-${qualityGate.state}`}>
          <div className="quality-score"><strong>{qualityGate.score}</strong><span>/ 100</span></div>
          <div><Status tone={qualityTone}>{qualityLabel}</Status><h3>{mission.id} · {mission.sceneLabel}</h3><p>{qualityGate.state === 'pass' ? '航迹、定位、双模态配对与热检查环境均达到当前项目门槛。' : `有 ${qualityGate.failed.length} 项未通过，自动分析应暂停并由人员决定复飞或降级处理。`}</p></div>
        </section>

        <section className="quality-metric-grid" aria-label="飞行质量摘要">
          <div><span>P95 横向偏差</span><strong>{quality.crossTrackP95M.toFixed(2)} m</strong><small>项目门槛 ≤ {projectQualityThresholds.crossTrackP95M} m</small></div>
          <div><span>RTK FIX 有效率</span><strong>{quality.rtkFixRatePct.toFixed(1)}%</strong><small>项目门槛 ≥ {projectQualityThresholds.rtkFixRatePct}%</small></div>
          <div><span>RGB-T 配对率</span><strong>{quality.rgbThermalPairRatePct.toFixed(1)}%</strong><small>项目门槛 ≥ {projectQualityThresholds.rgbThermalPairRatePct}%</small></div>
          <div><span>时间差 P95</span><strong>{quality.pairTimeSkewP95Ms} ms</strong><small>项目门槛 ≤ {projectQualityThresholds.pairTimeSkewP95Ms} ms</small></div>
        </section>

        <section className="quality-chart-section">
          <header><div><strong>横向航迹偏差序列</strong><small>{quality.sampleCount.toLocaleString()} 个任务样本的分段摘要</small></div><Status tone={quality.crossTrackP95M <= projectQualityThresholds.crossTrackP95M ? 'good' : 'danger'}>P95 {quality.crossTrackP95M.toFixed(2)} m</Status></header>
          <div role="img" aria-label="实际轨迹相对计划航线的横向偏差趋势">
            <ResponsiveContainer width="100%" height={170}><AreaChart data={qualitySeries} margin={{ left: 0, right: 10, top: 12, bottom: 0 }}><defs><linearGradient id="qualityDeviationFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e49a45" stopOpacity={0.34}/><stop offset="1" stopColor="#e49a45" stopOpacity={0.03}/></linearGradient></defs><CartesianGrid stroke="var(--line)" vertical={false}/><XAxis dataKey="sample" tickLine={false} axisLine={false}/><YAxis unit="m" tickLine={false} axisLine={false}/><Tooltip formatter={(value) => [`${Number(value).toFixed(2)} m`, '横向偏差']}/><ReferenceLine y={projectQualityThresholds.crossTrackP95M} stroke="#d77d32" strokeDasharray="5 4" label={{ value: '项目门槛 0.5 m', position: 'insideTopRight', fill: '#9b641f', fontSize: 10 }}/><Area type="monotone" dataKey="deviation" stroke="#cf762f" strokeWidth={2} fill="url(#qualityDeviationFill)" dot={false}/></AreaChart></ResponsiveContainer>
          </div>
        </section>

        <section className="quality-check-list" aria-label="质量门控检查项">
          <header><strong>九项检查</strong><small>阻断项失败时，不允许自动进入 AI 缺陷分析</small></header>
          {qualityGate.checks.map((check) => <div key={check.id} className={check.passed ? 'quality-check' : 'quality-check failed'}><span aria-hidden="true">{check.passed ? <CheckCircle2/> : <CircleAlert/>}</span><p><span><strong>{check.label}</strong><b>{check.value}</b></span><small>{check.explanation}</small></p><small>{check.threshold}{check.blocking ? ' · 阻断项' : ''}</small></div>)}
        </section>

        <div className="quality-boundary"><ShieldCheck/><p><strong>判定边界</strong><span>RTK 厂商厘米级指标是设备条件下的定位规格，不等于最终缺陷坐标精度；0.5 m 航迹偏差、95% FIX 和 100 ms 时间差均为本项目演示门槛。热检查辐照度采用 FLIR 公开指南的 600 W/m² 基线，正式验收仍须遵循场站规程与 IEC TS 62446-3。</span></p></div>
        <dl className="quality-sources"><div><dt>计算来源</dt><dd>{quality.source}</dd></div><div><dt>计算时间</dt><dd>{quality.computedAt}</dd></div><div><dt>接口状态</dt><dd aria-live="polite">{qualityLoading ? '正在读取…' : qualitySource === 'api' ? '后端质量接口' : '前端演示基线'}</dd></div><div><dt>设备规格</dt><dd>{specification.source}</dd></div></dl>
        <div className="quality-actions"><Button variant="primary" onClick={() => downloadJson(`${mission.id}-quality-gate.json`, { mission: mission.id, gate: qualityGate, profile: quality, thresholds: projectQualityThresholds, boundary: '演示项目门槛，不替代适航、计量校准或现场验收。' })}><Download/>导出质量记录</Button><Button onClick={() => leaveQualityDrawer(`/live?mission=${mission.id}`)}><Plane/>打开实时任务</Button>{qualityGate.state !== 'pass' ? <Button variant="danger" onClick={() => leaveQualityDrawer(`/missions?create=1&source=${mission.id}&reason=quality-gate`)}><RefreshCw/>创建复飞草稿</Button> : null}</div>
      </div>
    </Drawer>
  </div>;
}
