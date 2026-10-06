import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, ClipboardCheck, Columns2, Download, FilePlus2, Focus, Gauge, Grid3X3, HardDrive, ImageIcon, Layers3, MapPin, Maximize2, Pause, Play, RotateCcw, ScanSearch, ShieldCheck, SkipBack, Thermometer, ZoomIn, ZoomOut } from 'lucide-react';
import { anomalies, missionProfiles } from '../lib/data';
import { Button, Drawer, IconButton, PageHeader, Panel, Status } from '../components/ui';
import { createWorkOrder, evaluateEvidence, getApiErrorMessage, isApiUnavailable, reviewAnomaly, type EvidenceEvaluation } from '../lib/api';
import { downloadJson, notify } from '../lib/actions';
import { evidenceForEvent } from '../lib/evidenceAssets';

type ViewerMode = 'compare' | 'rgb' | 'thermal';

export default function EvidencePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedEvent = new URLSearchParams(location.search).get('event');
  const requestedMission = new URLSearchParams(location.search).get('mission');
  const mission = missionProfiles.find((item) => item.id === requestedMission) ?? missionProfiles[0];
  const [compare, setCompare] = useState(52);
  const [index, setIndex] = useState(() => Math.max(0, anomalies.findIndex((item) => item.id === requestedEvent)));
  const [overlay, setOverlay] = useState(true);
  const [grid, setGrid] = useState(false);
  const [mode, setMode] = useState<ViewerMode>('compare');
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [framePosition, setFramePosition] = useState(142);
  const [workOrder, setWorkOrder] = useState(false);
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const [reflight, setReflight] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [evaluation, setEvaluation] = useState<EvidenceEvaluation | null>(null);
  const [evaluationState, setEvaluationState] = useState<'loading' | 'live' | 'fallback'>('loading');
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('李工');
  const [dueAt, setDueAt] = useState('');
  const viewerRef = useRef<HTMLDivElement>(null);
  const selected = anomalies[index % anomalies.length];
  const evidenceAsset = evidenceForEvent(selected.id);
  const detection = evidenceAsset.detection;
  const frames = useMemo(() => anomalies.concat(anomalies.slice(0, 3)), []);
  const currentStatus = reviewed[selected.id] ?? selected.status;
  const split = mode === 'rgb' ? 0 : mode === 'thermal' ? 100 : compare;
  const gateStatus = evaluation?.gateStatus ?? 'loading';
  const canReview = evaluation?.actionEligibility.canReview ?? false;
  const reliabilityScore = evaluation?.reliabilityScore ?? evaluation?.qualityScore ?? '--';

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('sentinel:copilot-context', { detail: {
        module: '双模态证据复核',
        mission: { id: mission.id, site: mission.site, area: mission.area },
        evidence: {
          eventId: selected.id,
          defectCandidate: selected.type,
          severity: selected.severity,
          array: selected.array,
          module: selected.module,
          temperatureDeltaC: selected.deltaT,
          modelConfidence: selected.confidence,
          alignmentQuality: selected.alignment,
          registrationErrorPx: selected.evidence.registrationErrorPx,
          timeOffsetMs: selected.evidence.syncOffsetMs,
          crossFramePersistence: { frames: selected.evidence.persistentFrames, seconds: selected.evidence.persistentSeconds },
          reviewStatus: currentStatus,
        },
      } }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentStatus, mission.area, mission.id, mission.site, selected]);

  useEffect(() => {
    let active = true;
    setEvaluationState('loading');
    evaluateEvidence({
      alignmentQuality: selected.alignment,
      registrationErrorPx: selected.evidence.registrationErrorPx,
      syncOffsetMs: selected.evidence.syncOffsetMs,
      localizationAccuracyM: selected.evidence.localizationAccuracyM,
      persistentFrames: selected.evidence.persistentFrames,
      persistentSeconds: selected.evidence.persistentSeconds,
      radiometricCalibrated: true,
      environmentComplete: true,
      temperatureDeltaC: selected.deltaT,
      modelConfidence: selected.confidence,
      irradianceWM2: mission.weather.irradiance,
      temperatureUncertaintyC: selected.evidence.temperatureUncertaintyC,
      reflectionRisk: selected.evidence.reflectionRisk,
      occlusionRatio: selected.evidence.occlusionRatio,
      repeatObservations: selected.evidence.repeatObservations,
      assetCriticality: selected.evidence.assetCriticality,
    }).then((result) => {
      if (!active) return;
      setEvaluation(result);
      setEvaluationState('live');
    }).catch(() => {
      if (!active) return;
      setEvaluation({
        algorithmVersion: 'evidence-gate-offline', qualityScore: Math.round(selected.alignment * 100), reliabilityScore: 0, reviewPriorityScore: 0, gateStatus: 'blocked',
        priority: 'unrated',
        components: { alignment: Math.round(selected.alignment * 100), registration: 0, synchronization: 0, localization: 0, persistence: 0, calibration: 0, environment: 0 }, priorityComponents: {}, temperatureDeltaIntervalC: [selected.deltaT - 2, selected.deltaT + 2], actionEligibility: { canReview: false, canCreateWorkOrder: false, requiresReflight: false, requiresHumanReview: true },
        findings: [`温差 ΔT ${selected.deltaT.toFixed(1)}°C，模型置信度 ${selected.confidence.toFixed(2)}`],
        warnings: [], blockers: ['证据判定服务不可用，无法验证标定、配准、同步与环境条件'], nextAction: '恢复后端服务后重新计算；当前页面不允许确认或创建工单', automaticFaultConclusion: false,
        decisionBoundary: '离线回退只保证界面可浏览，不产生证据可用性结论或工程动作许可。'
      });
      setEvaluationState('fallback');
    });
    return () => { active = false; };
  }, [selected]);

  useEffect(() => {
    if (!requestedEvent) return;
    const next = anomalies.findIndex((item) => item.id === requestedEvent);
    if (next >= 0) setIndex(next);
  }, [requestedEvent]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setFramePosition((value) => value >= 384 ? 1 : value + 1), 160);
    return () => window.clearInterval(timer);
  }, [playing]);

  const selectEvent = (nextIndex: number) => {
    const normalized = (nextIndex + anomalies.length) % anomalies.length;
    setIndex(normalized);
    setTitle(`复核 ${anomalies[normalized].array} 组件 ${anomalies[normalized].module} ${anomalies[normalized].type}`);
  };

  const confirm = async () => {
    setReviewed((items) => ({ ...items, [selected.id]: '已确认' }));
    try {
      await reviewAnomaly(selected.id, '已确认');
      notify('异常已确认并写入审计日志', selected.id);
    } catch (caught) {
      if (isApiUnavailable(caught)) {
        notify('异常已在演示会话中确认', '后端未连接，本次状态只保留在当前浏览器', 'warning');
      } else {
        setReviewed((items) => { const next = { ...items }; delete next[selected.id]; return next; });
        notify('异常确认失败', getApiErrorMessage(caught), 'error');
      }
    }
  };

  const openWorkOrder = () => {
    setTitle(`复核 ${selected.array} 组件 ${selected.module} ${selected.type}`);
    setWorkOrder(true);
  };

  const submitWorkOrder = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    let created = false;
    try {
      const result = await createWorkOrder({ anomalyId: selected.id, title, owner, priority: selected.severity === 'critical' ? '紧急' : '高', dueAt: dueAt || undefined });
      setReviewed((items) => ({ ...items, [selected.id]: '已转工单' }));
      notify('工单已创建并派发', `${result.id} · ${owner}`);
      created = true;
    } catch (caught) {
      if (isApiUnavailable(caught)) {
        setReviewed((items) => ({ ...items, [selected.id]: '已转工单' }));
        notify('演示工单已创建', `DEMO-WO-${selected.id.slice(-3)} · ${owner}`, 'warning');
        created = true;
      } else {
        notify('工单创建失败', getApiErrorMessage(caught), 'error');
      }
    } finally {
      setSubmitting(false);
      if (created) setWorkOrder(false);
    }
  };

  const enterFullscreen = async () => {
    try {
      await viewerRef.current?.requestFullscreen();
    } catch {
      notify('浏览器未允许全屏', '请在地址栏允许全屏权限', 'warning');
    }
  };

  return <div className="page evidence-page">
    <PageHeader eyebrow="EVIDENCE STUDIO / RGB + THERMAL" title="双模态证据复核" description="同屏检查 RGB、Thermal、配准质量、温差、模型解释和人工操作记录。" actions={<div className="segmented evidence-mode"><button className={mode === 'compare' ? 'active' : ''} onClick={() => setMode('compare')}><Columns2 />对照</button><button className={mode === 'rgb' ? 'active' : ''} onClick={() => setMode('rgb')}><ImageIcon />RGB</button><button className={mode === 'thermal' ? 'active thermal' : ''} onClick={() => setMode('thermal')}><Thermometer />Thermal</button></div>} />
    <section className="review-mission-strip" aria-label="审核任务摘要"><div><span>任务名称</span><strong>{mission.site} {mission.area}双模态巡检</strong></div><div><span>任务编号</span><strong>{mission.id}</strong></div><div><span>机型 / 载荷</span><strong>{mission.aircraftModel} · {mission.payload}</strong></div><div><span>飞行窗口</span><strong>09:42 - 10:28 · 45 min</strong></div><div><span>数据状态</span><Status tone="good">RGB-T 已同步</Status></div><button onClick={() => downloadJson(`${mission.id}-review-package.json`, { mission, selectedEvent: selected, model: 'FusionNet v2.3.1', exportedAt: new Date().toISOString() })}><Download/>导出审核包</button></section>
    <div className="evidence-overview"><div className="evidence-context"><div><span>航线进度</span><strong>{mission.progress}%</strong></div><div><span>已检面板</span><strong>12,842 / 16,402</strong></div><div><span>发现缺陷</span><strong>38</strong></div><div><span>严重缺陷</span><strong className="danger-text">7</strong></div><div><span>平均温度</span><strong>32.6°C</strong></div><Status tone={currentStatus === '已确认' || currentStatus === '已转工单' ? 'good' : 'warn'}>{currentStatus}</Status></div><button className="evidence-location" onClick={() => navigate(`/live?mission=${mission.id}`)}><img src="/assets/field-map.png" alt="任务位置缩略地图"/><span><MapPin/><strong>{mission.site} {mission.area}</strong><small>31.262512°N · 121.487586°E · 海拔 48.7 m</small></span><ArrowRight/></button></div>
    <div className="evidence-grid">
      <Panel className="viewer-panel">
        <div className="viewer-toolbar"><div><Button variant="ghost" onClick={() => selectEvent(index - 1)}><ArrowLeft />上一事件</Button><Button variant="ghost" onClick={() => selectEvent(index + 1)}>下一事件<ArrowRight /></Button></div><div><button className={overlay ? 'tool-toggle active' : 'tool-toggle'} onClick={() => setOverlay(!overlay)}><Layers3 />检测叠加</button><button className={grid ? 'tool-toggle active' : 'tool-toggle'} onClick={() => setGrid(!grid)}><Grid3X3 />组件网格</button><IconButton label="缩小" disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}><ZoomOut /></IconButton><span>{Math.round(zoom * 100)}%</span><IconButton label="放大" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))}><ZoomIn /></IconButton><IconButton label="适应窗口" onClick={() => setZoom(1)}><Focus /></IconButton><IconButton label="全屏" onClick={enterFullscreen}><Maximize2 /></IconButton><IconButton label="下载当前证据清单" onClick={() => downloadJson(`${selected.id}-evidence.json`, { missionId: mission.id, event: selected, framePosition, mode, overlay, reviewedAs: currentStatus })}><Download/></IconButton></div></div>
        <div ref={viewerRef} className={`comparison-viewer viewer-${mode}`} style={{ '--split': `${split}%`, '--zoom': zoom } as CSSProperties}>
          <div className="evidence-visual-layer rgb-layer">
            <img className="rgb-image" src={evidenceAsset.rgb} alt={`${selected.id} RGB 外观证据`} />
            {grid ? <div className="module-grid-overlay" aria-hidden="true"/> : null}
            {overlay ? <svg className="image-annotation rgb-annotation" viewBox={`0 0 ${evidenceAsset.imageSize.width} ${evidenceAsset.imageSize.height}`} preserveAspectRatio="xMidYMid slice" aria-label="RGB 组件定位框">
              <rect className="rgb-module-box" x={detection.x} y={detection.y} width={detection.width} height={detection.height} />
              <g className="annotation-label" transform={`translate(${detection.x} ${detection.y - 42})`}><rect width="274" height="36" rx="3"/><text x="12" y="24">PNL_{selected.module.replace('-', '')} · RGB 定位</text></g>
            </svg> : null}
          </div>
          <div className="thermal-viewport" aria-hidden={mode === 'rgb'}>
            <div className="evidence-visual-layer thermal-layer">
              <img className="thermal-image" src={evidenceAsset.thermal} alt={`${selected.id} 热红外模型预测证据`} />
              {grid ? <div className="module-grid-overlay" aria-hidden="true"/> : null}
              {overlay ? <svg className="image-annotation thermal-annotation" viewBox={`0 0 ${evidenceAsset.imageSize.width} ${evidenceAsset.imageSize.height}`} preserveAspectRatio="xMidYMid slice" aria-label="热异常组件与热点标注">
                <rect className="thermal-module-box" x={detection.x} y={detection.y} width={detection.width} height={detection.height} />
                <g className="annotation-label thermal-label" transform={`translate(${detection.x} ${detection.y - 42})`}><rect width="326" height="36" rx="3"/><text x="12" y="24">PNL_{selected.module.replace('-', '')} · 热异常区域</text></g>
                <g className="thermal-hotspot" transform={`translate(${detection.hotspotX} ${detection.hotspotY})`}>
                  <circle r="76"/><circle r="52"/><circle r="28"/><circle className="hotspot-core" r="10"/>
                </g>
                <g className="delta-label" transform={`translate(${detection.hotspotX - 104} ${detection.hotspotY - 102}) rotate(-6)`}><rect width="184" height="42" rx="3"/><text x="14" y="28">ΔT +{selected.deltaT}°C</text></g>
                <text className="hotspot-temperature" x={detection.hotspotX + 94} y={detection.hotspotY + 9}>{evidenceAsset.temperatureC.toFixed(1)}°C</text>
              </svg> : null}
            </div>
          </div>
          {mode !== 'thermal' ? <div className="modality-label rgb">RGB</div> : null}{mode !== 'rgb' ? <div className="modality-label thermal">THERMAL</div> : null}
          {mode === 'compare' ? <><input type="range" min="0" max="100" value={compare} onChange={(event) => setCompare(Number(event.target.value))} aria-label="调整 RGB 和 Thermal 对照位置" /><div className="compare-handle" aria-hidden="true"><ArrowLeft /><ArrowRight /></div></> : null}
          {mode !== 'rgb' ? <div className="thermal-scale"><span>80°C</span><i /><span>20°C</span></div> : null}
          {mode !== 'thermal' ? <dl className="capture-overlay rgb-capture"><div><dt>拍摄时间</dt><dd>2026-09-15 {evidenceAsset.capturedAt}</dd></div><div><dt>经纬度</dt><dd>31.262512°N 121.487586°E</dd></div><div><dt>海拔高度</dt><dd>48.7 m</dd></div><div><dt>相机俯仰</dt><dd>-38.6°</dd></div><div><dt>相机朝向</dt><dd>162.3°</dd></div><div><dt>分辨率</dt><dd>1586 × 992</dd></div></dl> : null}
          {mode !== 'rgb' ? <dl className="capture-overlay thermal-capture"><div><dt>发射率</dt><dd>0.92</dd></div><div><dt>反射温度</dt><dd>26.0°C</dd></div><div><dt>测温范围</dt><dd>20–80°C</dd></div><div><dt>热像参数</dt><dd>640 × 512 · Iron</dd></div></dl> : null}
          <div className="evidence-meta"><span><MapPin />31.262512°N, 121.487586°E</span><span>{evidenceAsset.frame}</span><span>配准误差 {selected.evidence.registrationErrorPx.toFixed(1)} px</span><span>时间同步偏差 {selected.evidence.syncOffsetMs} ms</span><span className="evidence-provenance">{evidenceAsset.source}</span></div>
        </div>
        <div className="playback-bar"><IconButton label="回到异常起始帧" onClick={() => setFramePosition(138)}><SkipBack/></IconButton><IconButton label={playing ? '暂停播放' : '播放帧序列'} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause/> : <Play/>}</IconButton><time>{evidenceAsset.capturedAt}</time><input aria-label="证据帧位置" type="range" min="1" max="384" value={framePosition} onChange={(event) => setFramePosition(Number(event.target.value))}/><span>第 <strong>{framePosition}</strong> / 384 帧</span><select aria-label="播放速度" defaultValue="1"><option value="0.5">0.5x</option><option value="1">1.0x</option><option value="2">2.0x</option></select></div>
        <div className="filmstrip filmstrip-paired" aria-label="RGB 与热红外同帧序列">{frames.map((frame, frameIndex) => { const asset = evidenceForEvent(frame.id); return <button key={`${frame.id}-${frameIndex}`} className={frameIndex % anomalies.length === index ? 'active' : ''} onClick={() => selectEvent(frameIndex % anomalies.length)}><span className="filmstrip-pair"><img src={asset.rgb} alt={`${frame.id} RGB 同帧`} /><img src={asset.thermal} alt={`${frame.id} Thermal 同帧`} /></span><span><b>RGB</b><b>Thermal</b></span><time>{asset.capturedAt}</time><i className={frame.severity} /></button>; })}</div>
      </Panel>
      <aside className="evidence-inspector">
        <Panel>
          <div className="verdict-head"><Status tone={selected.severity === 'critical' ? 'danger' : 'warn'}>{selected.severity === 'critical' ? '严重' : '需要关注'}</Status><h2>{selected.type}</h2><p>面板 {selected.array} / {selected.module} · 检测时间 {selected.time}</p></div>
          <div className="confidence-block"><span>模型置信度 <strong>{selected.confidence}</strong></span><i><b style={{ width: `${selected.confidence * 100}%` }} /></i><small>模型版本 FusionNet v2.3.1-thermal</small></div>
          <section className={`decision-summary decision-${evaluation?.gateStatus ?? 'loading'}`} aria-live="polite">
            <header><span><ShieldCheck/><b>证据质量门控</b></span><Status tone={evaluation?.gateStatus === 'pass' ? 'good' : evaluation?.gateStatus === 'blocked' ? 'danger' : 'warn'}>{evaluationState === 'loading' ? '计算中' : evaluation?.gateStatus === 'pass' ? '可复核' : evaluation?.gateStatus === 'blocked' ? '已阻断' : '需注意'}</Status></header>
            <div className="decision-score"><strong>{evaluation?.reliabilityScore ?? evaluation?.qualityScore ?? '--'}<small>可靠度</small></strong><span><Gauge/><b>{evaluation?.priority === 'critical_review' ? '优先复核' : evaluation?.priority === 'high_review' ? '当班复核' : evaluation?.priority === 'unrated' ? '暂不分级' : '常规复核'} · {evaluation?.reviewPriorityScore ?? '--'}/100</b><small>{evaluation?.nextAction ?? '正在检查证据完整性'}</small></span></div>
            {evaluation ? <ul>{[...evaluation.blockers, ...evaluation.warnings, ...evaluation.findings.slice(0, 1)].slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : null}
            <footer><span>{evaluationState === 'live' ? '服务端规则' : evaluationState === 'fallback' ? '本地回退' : '等待响应'}</span><code>{evaluation?.algorithmVersion ?? 'evidence-gate'}</code></footer>
          </section>
          <div className="class-probabilities" aria-label="缺陷类别置信度"><strong>类别概率分布</strong>{[['热斑', selected.confidence], ['隐裂', .18], ['二极管异常', .09], ['污染遮挡', .05]].map(([label, value]) => <div key={label as string}><span>{label}<b>{Number(value).toFixed(2)}</b></span><i><em style={{ width: `${Number(value) * 100}%` }}/></i></div>)}</div>
          <div className="review-section"><header><strong>对齐质量</strong><b>{selected.alignment.toFixed(2)}</b></header><i><em style={{ width: `${selected.alignment * 100}%` }}/></i><small>RGB 与热像特征重投影误差 {selected.evidence.registrationErrorPx.toFixed(1)} px。</small></div>
          <dl className="evidence-facts"><div><dt>热点温度</dt><dd>{evidenceAsset.temperatureC.toFixed(1)}°C</dd></div><div><dt>现场辐照度</dt><dd>{mission.weather.irradiance} W/m²</dd></div><div><dt>温度差区间</dt><dd className="danger">{evaluation ? `${evaluation.temperatureDeltaIntervalC[0]}–${evaluation.temperatureDeltaIntervalC[1]}°C` : `+${selected.deltaT}°C`}</dd></div><div><dt>跨帧持续</dt><dd>{selected.evidence.persistentFrames} 帧 / {selected.evidence.persistentSeconds} 秒</dd></div><div><dt>反射 / 遮挡</dt><dd>{Math.round(selected.evidence.reflectionRisk * 100)}% / {Math.round(selected.evidence.occlusionRatio * 100)}%</dd></div><div><dt>定位精度</dt><dd>±{selected.evidence.localizationAccuracyM} m</dd></div></dl>
          <div className="explanation"><ScanSearch /><div><strong>模型解释与边界</strong><p>{evaluation?.decisionBoundary ?? '热异常在连续帧中稳定存在，并与 RGB 面板区域匹配；仍需现场电参数复测。'}</p></div></div>
          <div className="review-decision"><Button variant="danger" onClick={() => { setReflight((items) => ({ ...items, [selected.id]: true })); notify('证据未通过，已生成复飞草稿', `${selected.array} / ${selected.module}`, 'warning'); }}>不通过 / 重新飞行</Button><div><Button onClick={() => navigate(`/assets?component=YC-${selected.array.replace('-', '')}-${selected.module}`)}><HardDrive />组件档案</Button><Button disabled={currentStatus !== '已转工单' && (currentStatus !== '已确认' || !evaluation?.actionEligibility.canCreateWorkOrder)} onClick={() => currentStatus === '已转工单' ? navigate(`/work-orders?event=${selected.id}`) : openWorkOrder()}>{currentStatus === '已转工单' ? <><ClipboardCheck />查看关联工单</> : <><FilePlus2 />创建工单</>}</Button><Button variant="primary" disabled={currentStatus === '已确认' || currentStatus === '已转工单' || !evaluation?.actionEligibility.canReview} onClick={confirm}><CheckCircle2 />{currentStatus === '已确认' ? '已通过' : currentStatus === '已转工单' ? '已进入处置' : '通过'}</Button></div>{reflight[selected.id] ? <Button variant="ghost" onClick={() => navigate(`/missions?create=1&source=${selected.id}`)}><RotateCcw/>打开复飞任务草稿</Button> : null}</div>
        </Panel>
        <Panel title="审核记录" description="模型、系统和人工操作均可追溯"><div className="audit-timeline"><div><span>AI</span><p><strong>AI 完成初检</strong><small>FusionNet v2.3.1 · {selected.time} · 置信度 {selected.confidence}</small></p></div><div><span>系</span><p><strong>{gateStatus === 'blocked' ? '证据质检未通过' : gateStatus === 'review' ? '证据质检需人工核查' : gateStatus === 'pass' ? '证据质检通过' : '正在计算证据质量'}</strong><small>配准 {selected.evidence.registrationErrorPx.toFixed(1)} px · 同步 {selected.evidence.syncOffsetMs} ms · 可靠度 {reliabilityScore}/100</small></p></div><div><span>张</span><p><strong>{canReview ? '张工开始复核' : gateStatus === 'loading' ? '等待质量门控结果' : '等待补采证据'}</strong><small>{canReview ? 'Web 控制台 · 人工结论待记录' : gateStatus === 'loading' ? '服务端正在计算证据可用性' : '质量门控阻断 · 当前结果不可用于故障分级'}</small></p></div><div><span>{currentStatus === '待复核' ? <CircleAlert /> : <CheckCircle2 />}</span><p><strong>{reflight[selected.id] ? '已退回复飞' : currentStatus === '待复核' ? '等待最终结论' : currentStatus}</strong><small>{currentStatus === '待复核' && !reflight[selected.id] ? '系统不会自动生成维修结论' : '本次操作已写入审核链'}</small></p></div></div></Panel>
      </aside>
    </div>
    <Drawer open={workOrder} title="从证据创建工单" onClose={() => setWorkOrder(false)}><div className="workorder-draft"><div className="evidence-reference"><img src={evidenceAsset.thermal} alt={`${selected.id}关联热成像证据缩略图`} /><span><strong>{selected.id}</strong><small>{selected.array} · 组件 {selected.module}</small></span></div><label className="field"><span>工单标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span>负责人</span><select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="李工">李工 · 电气运维</option><option value="王强">王强 · 现场运维</option></select></label><label className="field"><span>要求完成时间</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label><label className="field"><span>处置要求</span><textarea defaultValue="现场复测组件电气参数，检查接线与表面状态，并上传复测热成像。" /></label><Button variant="primary" loading={submitting} disabled={!title.trim()} onClick={submitWorkOrder}>创建并派发</Button><Button variant="ghost" onClick={() => { setWorkOrder(false); navigate('/work-orders'); }}>查看工单中心</Button></div></Drawer>
  </div>;
}
