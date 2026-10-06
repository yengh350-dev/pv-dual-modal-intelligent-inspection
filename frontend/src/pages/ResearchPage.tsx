import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Activity, AlertTriangle, AreaChart, BrainCircuit, CheckCircle2, CloudUpload, Database, Download, FileChartColumn, FileDown, FileText, GitCompareArrows, HardDriveDownload, ImagePlus, Info, Microscope, Play, Plus, ScanSearch, ShieldCheck, SunMedium, TableProperties, Waves } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Drawer, Field, PageHeader, Panel, Status } from '../components/ui';
import { downloadJson, downloadText, notify } from '../lib/actions';
import { getApiErrorMessage, getCurrentDetectionModel, getRegisteredModels, predictCellImage, predictGridFault, predictPanelSegmentation, predictPower, predictThermalImage, predictVisibleDefect, type CellPrediction, type DetectionModelManifest, type GridFaultPrediction, type PanelSegmentationPrediction, type PowerPrediction, type RegisteredModel, type ThermalPrediction } from '../lib/api';

const modelData = [
  { name: 'GB', score: 0.3104 },
  { name: 'hotspot', score: 0.1406 },
  { name: 'PID', score: 0.3362 },
  { name: 'diode', score: 0.4228 },
  { name: 'zhedang', score: 0.1364 }
];

const classColors: Record<string, string> = {
  GB: '#4f78c7',
  hotspot: '#d8584d',
  PID: '#7a5bb0',
  diode: '#d98a28',
  zhedang: '#258b78'
};

const registeredModelFallback: RegisteredModel[] = [
  { model_id: 'cell_anomaly_cnn_v1', task: 'classification', artifactReady: true, artifacts: [] },
  { model_id: 'defect_yolo11n_v1', task: 'visible defect detection', artifactReady: true, artifacts: [] },
  { model_id: 'distributed_pv_yolo11n_v1', task: 'aerial location detection', artifactReady: true, artifacts: [] },
  { model_id: 'grid_fault_rf_v1', task: 'grid fault classification', artifactReady: true, artifacts: [] },
  { model_id: 'panel_segmentation_yolo11n_v1', task: 'panel segmentation', artifactReady: true, artifacts: [] },
  { model_id: 'pv_power_hgb_v1', task: 'power regression', artifactReady: true, artifacts: [] },
  { model_id: 'sentinel_rgbt_yolo11n_v1', task: 'thermal defect detection', artifactReady: true, artifacts: [] },
];

function modelTone(model: RegisteredModel) {
  if (model.model_id.includes('thermal') || model.model_id.includes('rgbt')) return 'thermal';
  if (model.model_id.includes('power')) return 'power';
  if (model.model_id.includes('fault')) return 'fault';
  if (model.model_id.includes('segment')) return 'segment';
  if (model.model_id.includes('cell')) return 'cell';
  if (model.model_id.includes('distributed')) return 'location';
  return 'vision';
}

const experimentRows = [
  { id: 'EXP-0013', config: 'YOLO11n-seg · 256 px · AdamW', dataset: 'pv-panel-segmentation-v1', status: '已完成', result: 'mask mAP@50 0.5129', created: '2026/09/22' },
  { id: 'EXP-0012', config: 'YOLO11n · 320 px · AdamW', dataset: 'distributed-pv-detection-v1', status: '已完成', result: 'mAP@50 0.7034', created: '2026/09/22' },
  { id: 'EXP-0011', config: 'YOLO11n · 416 px · AdamW', dataset: 'pv-visible-defect-v1', status: '已完成', result: 'mAP@50 0.8384', created: '2026/09/22' },
  { id: 'EXP-0010', config: 'Compact CNN · 128 px · BCE', dataset: 'cell-anomaly-v1', status: '已完成', result: 'macro F1 0.7425', created: '2026/09/22' },
  { id: 'EXP-0009', config: 'RandomForest · 512-point windows', dataset: 'grid-fault-waveform-v1', status: '已完成', result: 'accuracy 0.8009', created: '2026/09/22' },
  { id: 'EXP-0008', config: 'Histogram Gradient Boosting', dataset: 'pv-power-sample-v1', status: '已完成', result: 'R² 0.9858', created: '2026/09/22' },
  { id: 'EXP-0006', config: 'YOLO11n · 416 px · AdamW', dataset: 'solar-thermal-yolo-v1', status: '已完成', result: 'mAP@50 0.6604', created: '2026/09/21' },
  { id: 'EXP-0005', config: 'quality-aware-v1', dataset: 'RGB-T 配对集（待采集）', status: '待运行', result: '无指标', created: '研究计划' },
  { id: 'EXP-0004', config: 'fixed-weight fusion', dataset: 'RGB-T 配对集（待采集）', status: '待运行', result: '无指标', created: '研究计划' },
  { id: 'EXP-0002', config: 'rgb-only baseline', dataset: 'RGB 标注集（待整理）', status: '待运行', result: '无指标', created: '研究计划' }
];

const datasets = [
  ['pv-visible-defect-v1','光伏板可见光裂纹、栅线与斑点标注','2,400 张 / 2,628 框','已划分','本地研究数据'],
  ['pv-panel-segmentation-v1','航拍组件多边形分割，已按原始图组去泄漏','9,614 张 / 76,897 实例','已清洗','本地研究数据'],
  ['distributed-pv-detection-v1','分布式光伏航拍组件定位','4,007 张 / 8,794 实例','已清洗','本地研究数据'],
  ['cell-anomaly-v1','电致发光电池片多标签异常','2,000 张','已训练','本地研究数据'],
  ['pv-power-sample-v1','环境、辐照与组件功率时序','10,000 行','已训练','本地研究数据'],
  ['grid-fault-waveform-v1','16 类并网光伏仿真工况波形','2,226,510 行','已训练','本地研究数据'],
  ['solar-thermal-yolo-v1','光伏热红外缺陷检测数据，按连续航拍帧组划分','1,428 张 / 4,287 框','已验证','本地研究数据'],
  ['dataset-2026-09-05','盐城一期双模态演示结构','4,286 对','标注中','本地私有'],
  ['pvf10-metadata','PVF-10 来源登记','5,579 张','仅登记','公开页面'],
  ['thermal-panel-demo','Thermal Panel 演示清单','353 张','未下载','Zenodo'],
  ['field-calibration','相机标定与配准样本','48 对','待采集','本地私有']
];

export default function ResearchPage({ mode }: { mode: 'models' | 'reports' | 'data' }) {
  if (mode === 'reports') return <Reports />;
  if (mode === 'data') return <DataAdmin />;
  return <Models />;
}

function Models() {
  const [runOpen, setRunOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [inferenceOpen, setInferenceOpen] = useState(false);
  const [card, setCard] = useState<(typeof experimentRows)[number] | null>(null);
  const [plans, setPlans] = useState(experimentRows);
  const [manifest, setManifest] = useState<DetectionModelManifest | null>(null);
  const [manifestError, setManifestError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [prediction, setPrediction] = useState<ThermalPrediction | null>(null);
  const [confidence, setConfidence] = useState(0.25);
  const [predicting, setPredicting] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [labMode, setLabMode] = useState<'visible' | 'segment' | 'cell' | 'power' | 'fault'>('visible');
  const [catalog, setCatalog] = useState<RegisteredModel[]>([]);
  const [cellFile, setCellFile] = useState<File | null>(null);
  const [cellPrediction, setCellPrediction] = useState<CellPrediction | null>(null);
  const [visibleFile, setVisibleFile] = useState<File | null>(null);
  const [visiblePreview, setVisiblePreview] = useState('');
  const [visiblePrediction, setVisiblePrediction] = useState<ThermalPrediction | null>(null);
  const [segmentFile, setSegmentFile] = useState<File | null>(null);
  const [segmentPreview, setSegmentPreview] = useState('');
  const [segmentPrediction, setSegmentPrediction] = useState<PanelSegmentationPrediction | null>(null);
  const [powerPrediction, setPowerPrediction] = useState<PowerPrediction | null>(null);
  const [faultFile, setFaultFile] = useState<File | null>(null);
  const [faultPrediction, setFaultPrediction] = useState<GridFaultPrediction | null>(null);
  const [labRunning, setLabRunning] = useState(false);
  const [powerInput, setPowerInput] = useState({ ambientTemperature: 25, irradiance: 800, moduleTemperature: 46, inclinationAngle: 30, humidity: 55, hour: 12 });

  useEffect(() => {
    getCurrentDetectionModel().then(setManifest).catch((error) => setManifestError(getApiErrorMessage(error, '模型清单暂时不可用')));
    getRegisteredModels().then((result) => setCatalog(result.models)).catch(() => setCatalog([]));
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { if (visiblePreview) URL.revokeObjectURL(visiblePreview); }, [visiblePreview]);
  useEffect(() => () => { if (segmentPreview) URL.revokeObjectURL(segmentPreview); }, [segmentPreview]);

  const metrics = manifest?.model.metrics;
  const displayedCatalog = catalog.length ? catalog : registeredModelFallback;
  const classData = manifest
    ? Object.entries(manifest.model.metrics.per_class_map50_95).map(([name, score]) => ({ name, score }))
    : modelData;
  const chooseFile = (nextFile: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPrediction(null);
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : '');
  };
  const runPrediction = async () => {
    if (!file) return;
    setPredicting(true);
    try {
      setPrediction(await predictThermalImage(file, confidence));
      notify('推理完成', '检测框已按原图归一化坐标绘制，可随页面同比缩放');
    } catch (error) {
      notify('推理未完成', getApiErrorMessage(error));
    } finally {
      setPredicting(false);
    }
  };

  const runLab = async () => {
    setLabRunning(true);
    try {
      if (labMode === 'visible' && visibleFile) setVisiblePrediction(await predictVisibleDefect(visibleFile));
      if (labMode === 'segment' && segmentFile) setSegmentPrediction(await predictPanelSegmentation(segmentFile));
      if (labMode === 'cell' && cellFile) setCellPrediction(await predictCellImage(cellFile));
      if (labMode === 'power') setPowerPrediction(await predictPower(powerInput));
      if (labMode === 'fault' && faultFile) setFaultPrediction(await predictGridFault(faultFile));
      notify('模型运行完成', '结果已连同模型版本和适用边界返回');
    } catch (error) {
      notify('模型未完成', getApiErrorMessage(error));
    } finally {
      setLabRunning(false);
    }
  };

  const modelMetric = (model: RegisteredModel) => {
    if (model.model_id === 'sentinel_thermal_yolo11n_precision_v2' && typeof model.metrics?.map50 === 'number') return `test mAP@50 ${model.metrics.map50.toFixed(4)}`;
    if (model.model_id === 'cell_anomaly_cnn_v1') return 'macro F1 0.7425';
    if (model.model_id === 'pv_power_hgb_v1') return 'test R² 0.9858';
    if (model.model_id === 'grid_fault_rf_v1') return 'test accuracy 0.8009';
    if (model.model_id === 'defect_yolo11n_v1') return 'test mAP@50 0.8384';
    if (model.model_id === 'distributed_pv_yolo11n_v1') return 'test mAP@50 0.7034';
    if (model.model_id === 'panel_segmentation_yolo11n_v1') return 'mask mAP@50 0.5129';
    if (model.model_id === 'sentinel_rgbt_yolo11n_v1') return 'v1 历史 mAP@50 0.6604';
    return '训练中';
  };
  const openModelTool = (model: RegisteredModel) => {
    if (model.model_id === 'defect_yolo11n_v1') { setLabMode('visible'); setLabOpen(true); return; }
    if (model.model_id === 'panel_segmentation_yolo11n_v1') { setLabMode('segment'); setLabOpen(true); return; }
    if (model.model_id === 'cell_anomaly_cnn_v1') { setLabMode('cell'); setLabOpen(true); return; }
    if (model.model_id === 'pv_power_hgb_v1') { setLabMode('power'); setLabOpen(true); return; }
    if (model.model_id === 'grid_fault_rf_v1') { setLabMode('fault'); setLabOpen(true); return; }
    if (model.model_id === manifest?.model.model_id || model.model_id === 'sentinel_thermal_yolo11n_precision_v2') { setInferenceOpen(true); return; }
    if (model.model_id === 'sentinel_rgbt_yolo11n_v1') { setCompareOpen(true); return; }
    const experiment = plans.find((item) => item.dataset === 'distributed-pv-detection-v1' && model.model_id.includes('distributed'));
    if (experiment) setCard(experiment);
    else notify('模型已登记', '当前版本提供指标、模型卡和权重，交互推理将在完成现场输入约束后开放');
  };

  return <div className="page research-page"><PageHeader eyebrow="MODEL & EXPERIMENT REGISTRY" title="模型实验" description="真实训练指标、权重、数据划分和在线推理统一登记。" actions={<><Button onClick={() => setCompareOpen(true)}><GitCompareArrows />版本与边界</Button><Button onClick={() => setLabOpen(true)}><Microscope />多模型工具</Button><Button variant="primary" onClick={() => setInferenceOpen(true)}><ScanSearch />热红外推理</Button></>} />
    <div className="integrity-banner model-ready-banner"><ShieldCheck /><div><strong>热红外模型已完成帧组测试</strong><p>{manifest?.artifact.activationWarning ?? '训练与测试按帧组划分，邻组仍可能相关。当前为热红外单模态，现场使用须复核。'}</p></div><Status tone={manifest?.artifact.runtimeReady ? 'good' : 'warn'}>{manifest?.artifact.runtimeReady ? '可推理' : manifestError ? '模型服务待连接' : '正在检查服务'}</Status></div>
    <div className="model-fleet" aria-label="已注册模型">{displayedCatalog.map((model) => <button className={`model-tone-${modelTone(model)}`} key={model.model_id} onClick={() => openModelTool(model)}><span>{model.task.includes('power') ? <SunMedium /> : model.task.includes('fault') ? <Waves /> : model.task.includes('classification') ? <Activity /> : <ScanSearch />}</span><div><strong>{model.model_id}</strong><small>{modelMetric(model)}</small></div><Status tone={model.artifactReady ? 'good' : 'warn'}>{model.artifactReady ? '产物就绪' : '待产物'}</Status></button>)}</div>
    <div className="model-metrics">
      <div><span>mAP@50</span><strong>{metrics ? metrics.map50.toFixed(4) : '--'}</strong><small>帧组测试集</small></div>
      <div><span>mAP@50–95</span><strong>{metrics ? metrics.map50_95.toFixed(4) : '--'}</strong><small>严格 IoU 区间</small></div>
      <div><span>Precision</span><strong>{metrics ? metrics.precision.toFixed(4) : '--'}</strong><small>最大 F1 工作点</small></div>
      <div><span>Recall</span><strong>{metrics ? metrics.recall.toFixed(4) : '--'}</strong><small>最大 F1 工作点</small></div>
      <div><span>推理耗时</span><strong>{manifest ? manifest.model.speed_ms_per_image.inference.toFixed(1) : '--'} ms</strong><small>评估环境 CPU 批均值</small></div>
    </div>
    <div className="model-grid">
      <Panel title="各类别测试表现" description="独立测试集 mAP@50–95，低分项决定下一轮数据补强顺序"><div className="model-chart"><ResponsiveContainer width="100%" height={270}><BarChart data={classData} margin={{ left: 0, right: 12, top: 18, bottom: 6 }}><CartesianGrid stroke="#e5ebe8" vertical={false}/><XAxis dataKey="name"/><YAxis domain={[0, 0.5]}/><Tooltip formatter={(value) => Number(value).toFixed(4)}/><Legend/><Bar dataKey="score" name="mAP@50–95" radius={[2,2,0,0]}>{classData.map((item) => <Cell key={item.name} fill={classColors[item.name] ?? '#4f78c7'} />)}</Bar></BarChart></ResponsiveContainer></div></Panel>
      <Panel title="当前可运行模型" description={manifest?.model.model_id === 'sentinel_thermal_yolo11n_precision_v2' ? 'Sentinel Thermal YOLO11n Precision v2' : 'Sentinel Thermal YOLO11n v1'}><div className="model-card"><div className="model-mark"><BrainCircuit /></div><div><strong>光伏热红外缺陷检测模型</strong><Status tone={manifest?.artifact.runtimeReady ? 'good' : 'warn'}>{manifest?.artifact.runtimeReady ? '已验证' : '服务待连接'}</Status><p>GB / hotspot / PID / diode / zhedang 五类候选框</p></div></div><dl className="model-facts"><div><dt>有效图像</dt><dd>{manifest?.dataset.usableImages ?? 1428} 张</dd></div><div><dt>划分</dt><dd>1148 / 140 / 140</dd></div><div><dt>随机种子</dt><dd>{manifest?.model.seed ?? '--'}</dd></div><div><dt>最佳权重</dt><dd>{manifest?.artifact.weightsPresent ? `best.pt · ${(manifest.artifact.weightsBytes / 1024 / 1024).toFixed(1)} MB` : '待检查'}</dd></div></dl><div className="model-actions"><Button variant="primary" onClick={() => setInferenceOpen(true)}><ImagePlus />上传热图检测</Button><Button onClick={() => setCompareOpen(true)}><FileText />查看版本</Button></div></Panel>
    </div>
    <div className="model-evidence-grid"><Panel title="v1 基线训练过程" description="历史基线记录，不代表当前 v2 的训练曲线"><img src="/model-results/training-curves.png" alt="v1 基线训练过程曲线" /></Panel><Panel title="v1 基线混淆矩阵" description="历史测试结果，保留用于追溯"><img src="/model-results/test-confusion-matrix.png" alt="v1 基线测试混淆矩阵" /></Panel><Panel title="v1 基线检测样例" description="历史模型输出；当前结果以在线推理为准"><img src="/model-results/test-predictions.jpg" alt="v1 热红外测试集检测样例" /></Panel></div>
    <Panel title="可见光缺陷检测证据" description="Crack、Grid、Spot 三类独立测试：mAP@50 0.8384；结果不包含温度信息"><div className="model-evidence-grid embedded"><figure><img src="/model-results/visible-defect/training-curves.png" alt="可见光缺陷模型训练曲线"/><figcaption>训练与验证曲线</figcaption></figure><figure><img src="/model-results/visible-defect/test-confusion-matrix.png" alt="可见光缺陷独立测试混淆矩阵"/><figcaption>独立测试混淆矩阵</figcaption></figure><figure><img src="/model-results/visible-defect/test-predictions.jpg" alt="可见光缺陷独立测试检测样例"/><figcaption>真实测试集候选框</figcaption></figure></div></Panel>
    <Panel title="航拍组件定位证据" description="独立测试 mAP@50 0.7034；用于从场景中定位组件，不负责缺陷定性"><div className="model-evidence-grid embedded"><figure><img src="/model-results/distributed-pv/training-curves.png" alt="航拍组件定位模型训练曲线"/><figcaption>训练与验证曲线</figcaption></figure><figure><img src="/model-results/distributed-pv/test-confusion-matrix.png" alt="航拍组件定位独立测试混淆矩阵"/><figcaption>独立测试混淆矩阵</figcaption></figure><figure><img src="/model-results/distributed-pv/test-predictions.jpg" alt="航拍组件定位独立测试样例"/><figcaption>真实测试集定位样例</figcaption></figure></div></Panel>
    <Panel title="组件轮廓分割证据" description="独立测试 mask mAP@50 0.5129、mask mAP@50–95 0.2763；8 轮 CPU 训练研究基线"><div className="model-evidence-grid embedded"><figure><img src="/model-results/panel-segmentation/training-curves.png" alt="组件分割模型训练曲线"/><figcaption>框与掩膜训练曲线</figcaption></figure><figure><img src="/model-results/panel-segmentation/test-confusion-matrix.png" alt="组件分割独立测试混淆矩阵"/><figcaption>独立测试混淆矩阵</figcaption></figure><figure><img src="/model-results/panel-segmentation/test-predictions.jpg" alt="组件分割独立测试预测样例"/><figcaption>真实测试集轮廓预测</figcaption></figure></div></Panel>
    <div className="model-boundary"><AlertTriangle /><div><strong>工程边界</strong><p>{manifest?.decisionBoundary.statement ?? '该模型仅由热红外图像训练，不是 RGB-Thermal 双模态融合模型。'} {manifest?.decisionBoundary.temperatureWarning ?? '检测结果必须经过辐射测温数据核验和人工复核。'}</p></div></div>
    <Panel title="实验注册表" description="配置、数据划分、日志、指标与权重一一对应"><div className="data-table experiment-table"><div className="data-row data-head"><span>实验</span><span>配置</span><span>数据集</span><span>状态</span><span>结果</span><span>记录时间</span></div>{plans.map((row) => <button className="data-row" key={row.id} onClick={() => setCard(row)}><span><strong>{row.id}</strong><small>{row.created}</small></span><span>{row.config}</span><span>{row.dataset}</span><span><Status tone={row.status === '已完成' ? 'good' : 'warn'}>{row.status}</Status></span><span>{row.result}</span><span>研究者</span></button>)}</div></Panel>
    <Drawer open={labOpen} title="多模型验证工具" onClose={() => setLabOpen(false)} width="wide"><div className="model-lab"><div className="lab-tabs" role="tablist"><button className={labMode === 'visible' ? 'active' : ''} onClick={() => setLabMode('visible')}><ScanSearch />可见光缺陷</button><button className={labMode === 'segment' ? 'active' : ''} onClick={() => setLabMode('segment')}><AreaChart />组件分割</button><button className={labMode === 'cell' ? 'active' : ''} onClick={() => setLabMode('cell')}><Activity />电池片异常</button><button className={labMode === 'power' ? 'active' : ''} onClick={() => setLabMode('power')}><SunMedium />功率估计</button><button className={labMode === 'fault' ? 'active' : ''} onClick={() => setLabMode('fault')}><Waves />并网故障</button></div>
      {labMode === 'visible' ? <section><div className="lab-intro"><strong>可见光裂纹、栅线与斑点候选检测</strong><p>检测框使用原图归一化坐标，页面缩放时与图像保持一致；结果仍需人工复核。</p></div><label className="inference-upload"><ImagePlus /><strong>{visibleFile?.name ?? '选择可见光组件图像'}</strong><span>JPEG / PNG · 最大 15 MB</span><input type="file" accept="image/jpeg,image/png" onChange={(event) => { const selected = event.target.files?.[0] ?? null; if (visiblePreview) URL.revokeObjectURL(visiblePreview); setVisibleFile(selected); setVisiblePreview(selected ? URL.createObjectURL(selected) : ''); setVisiblePrediction(null); }}/></label>{visiblePreview ? <div className="inference-canvas"><img src={visiblePreview} alt="待检测可见光组件图像"/>{visiblePrediction?.detections.map((detection, index) => <div className={`inference-box class-${detection.classId}`} key={`${detection.className}-${index}`} style={{ left: `${detection.boxNormalized.x * 100}%`, top: `${detection.boxNormalized.y * 100}%`, width: `${detection.boxNormalized.width * 100}%`, height: `${detection.boxNormalized.height * 100}%` }}><span>{detection.className} {(detection.confidence * 100).toFixed(1)}%</span></div>)}</div> : null}{visiblePrediction ? <div className="prediction-summary"><strong>{visiblePrediction.count} 个候选 · {visiblePrediction.elapsedMs} ms</strong><p>仅用于可见光异常筛查，不提供温度信息。</p></div> : null}<Button variant="primary" disabled={!visibleFile} loading={labRunning} onClick={runLab}><Play />运行可见光模型</Button></section> : null}
      {labMode === 'segment' ? <section><div className="lab-intro"><strong>航拍光伏组件轮廓分割</strong><p>多边形坐标与原图归一化绑定，可随窗口缩放；用途是组件定位与面积统计，不负责缺陷定性。</p></div><label className="inference-upload"><ImagePlus /><strong>{segmentFile?.name ?? '选择航拍场站图像'}</strong><span>JPEG / PNG · 最大 15 MB</span><input type="file" accept="image/jpeg,image/png" onChange={(event) => { const selected = event.target.files?.[0] ?? null; if (segmentPreview) URL.revokeObjectURL(segmentPreview); setSegmentFile(selected); setSegmentPreview(selected ? URL.createObjectURL(selected) : ''); setSegmentPrediction(null); }}/></label>{segmentPreview ? <div className="inference-canvas segmentation-canvas"><img src={segmentPreview} alt="待分割航拍场站图像"/>{segmentPrediction ? <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="组件分割轮廓">{segmentPrediction.instances.map((instance, index) => <polygon key={index} points={instance.polygonNormalized.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')}><title>{`solar-panel ${instance.confidence ? `${(instance.confidence * 100).toFixed(1)}%` : ''}`}</title></polygon>)}</svg> : null}</div> : null}{segmentPrediction ? <div className="prediction-summary"><strong>{segmentPrediction.count} 个组件轮廓 · {segmentPrediction.elapsedMs} ms</strong><p>{segmentPrediction.boundary}</p></div> : null}<Button variant="primary" disabled={!segmentFile} loading={labRunning} onClick={runLab}><Play />运行分割模型</Button></section> : null}
      {labMode === 'cell' ? <section><div className="lab-intro"><strong>电致发光电池片多标签识别</strong><p>判断多晶硅片、裂纹和失活候选，三个标签可同时出现。</p></div><label className="inference-upload"><ImagePlus /><strong>{cellFile?.name ?? '选择单片 EL 灰度图'}</strong><span>JPEG / PNG · 最大 10 MB</span><input type="file" accept="image/jpeg,image/png" onChange={(event) => { setCellFile(event.target.files?.[0] ?? null); setCellPrediction(null); }}/></label>{cellPrediction ? <div className="lab-result"><header><strong>候选概率</strong><span>{cellPrediction.elapsedMs} ms</span></header>{cellPrediction.predictions.map((item) => <div className="probability-row" key={item.className}><span>{item.className}</span><i><b style={{ width: `${item.probability * 100}%` }}/></i><strong>{(item.probability * 100).toFixed(1)}%</strong></div>)}<p>{cellPrediction.boundary}</p></div> : null}<Button variant="primary" disabled={!cellFile} loading={labRunning} onClick={runLab}><Play />运行电池片模型</Button></section> : null}
      {labMode === 'power' ? <section><div className="lab-intro"><strong>环境条件下的功率样本域估计</strong><p>输入辐照、环境和组件温度，只用于验证数据回归链路。</p></div><div className="lab-form">{[
        ['ambientTemperature','环境温度 °C',-40,70],['irradiance','辐照度 W/m²',0,1400],['moduleTemperature','组件温度 °C',-20,110],['inclinationAngle','倾角 °',0,90],['humidity','湿度 %',0,100],['hour','小时',0,23]
      ].map(([key,label,min,max]) => <Field key={String(key)} label={String(label)}><input type="number" min={Number(min)} max={Number(max)} value={powerInput[key as keyof typeof powerInput]} onChange={(event) => setPowerInput((current) => ({ ...current, [key]: Number(event.target.value) }))}/></Field>)}</div>{powerPrediction ? <div className="power-result"><SunMedium /><span><small>预测功率</small><strong>{powerPrediction.predictedPower.toFixed(2)}</strong><em>{powerPrediction.unit}</em></span><p>{powerPrediction.boundary}</p></div> : null}<Button variant="primary" loading={labRunning} onClick={runLab}><Play />运行功率模型</Button></section> : null}
      {labMode === 'fault' ? <section><div className="lab-intro"><strong>并网光伏波形工况分类</strong><p>按 512 点窗口提取电流、电压与直流侧统计特征，输出仿真类别排名。</p></div><label className="inference-upload"><Waves /><strong>{faultFile?.name ?? '选择连续波形 CSV'}</strong><span>至少 512 行 · 最大 30 MB</span><input type="file" accept=".csv,text/csv" onChange={(event) => { setFaultFile(event.target.files?.[0] ?? null); setFaultPrediction(null); }}/></label>{faultPrediction ? <div className="lab-result"><header><strong>主导类别 {faultPrediction.dominantClass}</strong><span>{faultPrediction.windows} 个窗口 · {faultPrediction.elapsedMs} ms</span></header>{faultPrediction.classProbabilities.map((item) => <div className="probability-row" key={item.className}><span>{item.className}</span><i><b style={{ width: `${item.probability * 100}%` }}/></i><strong>{(item.probability * 100).toFixed(1)}%</strong></div>)}<p>{faultPrediction.boundary}</p></div> : null}<Button variant="primary" disabled={!faultFile} loading={labRunning} onClick={runLab}><Play />运行波形模型</Button></section> : null}
    </div></Drawer>
    <Drawer open={inferenceOpen} title="热红外图像推理" onClose={() => setInferenceOpen(false)} width="wide"><div className="inference-workbench"><div className="model-boundary compact"><Info /><p>仅上传 JPEG/PNG 热红外图像。框是模型候选区域，不是温度测量或最终故障结论。</p></div><Field label="置信度阈值" hint="阈值越高，候选框越少；工程阈值应在独立场站数据上校准。"><input type="range" min="0.05" max="0.8" step="0.05" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))}/><b>{confidence.toFixed(2)}</b></Field><label className="inference-upload"><ImagePlus /><strong>{file ? file.name : '选择一张热红外图像'}</strong><span>JPEG / PNG · 最大 15 MB</span><input type="file" accept="image/jpeg,image/png" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}/></label>{previewUrl ? <div className="inference-canvas"><img src={previewUrl} alt="待检测热红外图像"/>{prediction?.detections.map((detection, index) => <div className={`inference-box class-${detection.classId}`} key={`${detection.className}-${index}`} style={{ left: `${detection.boxNormalized.x * 100}%`, top: `${detection.boxNormalized.y * 100}%`, width: `${detection.boxNormalized.width * 100}%`, height: `${detection.boxNormalized.height * 100}%` }}><span>{detection.className} {(detection.confidence * 100).toFixed(1)}%</span></div>)}</div> : null}{prediction ? <div className="prediction-summary"><strong>{prediction.count} 个候选 · {prediction.elapsedMs} ms</strong>{prediction.detections.map((item, index) => <span key={index}><i className={`class-dot class-${item.classId}`}/>{item.className}<b>{(item.confidence * 100).toFixed(1)}%</b></span>)}</div> : null}<Button variant="primary" disabled={!file} loading={predicting} onClick={runPrediction}><ScanSearch />运行真实模型</Button></div></Drawer>
    <Drawer open={runOpen} title="创建后续实验计划" onClose={() => setRunOpen(false)} width="wide"><div className="form-grid"><Field label="实验名称"><input defaultValue="RGB-T quality-aware fusion" /></Field><Field label="方法配置"><select><option>quality-aware-v1.yaml</option><option>fixed-weight.yaml</option></select></Field><Field label="数据版本"><select><option>RGB-T 配对集（待采集）</option></select></Field><Field label="随机种子"><input defaultValue="20260921" /></Field></div><div className="form-callout"><Info /><p>双模态实验必须先取得逐帧配对的 RGB、热红外和标注数据；当前热红外权重只能作为单模态基线。</p></div><Button variant="primary" onClick={() => { const id = `EXP-${String(plans.length + 3).padStart(4, '0')}`; setPlans((items) => [{ id, config: 'quality-aware-v1', dataset: 'RGB-T 配对集（待采集）', status: '待运行', result: '无指标', created: '刚刚' }, ...items]); setRunOpen(false); notify('实验计划已保存', `${id} · 等待真实配对数据`); }}>保存实验计划</Button></Drawer>
    <Drawer open={compareOpen} title="版本、指标与适用边界" onClose={() => setCompareOpen(false)} width="wide"><div className="comparison-table"><div><strong>版本</strong><strong>数据集</strong><strong>mAP@50</strong><strong>状态</strong></div><div><span>当前 {manifest?.model.model_id === 'sentinel_thermal_yolo11n_precision_v2' ? 'Precision v2' : 'Thermal v1'}</span><span>solar-thermal-yolo-v1</span><span>{metrics?.map50.toFixed(4) ?? '--'}</span><Status tone={manifest?.artifact.runtimeReady ? 'good' : 'warn'}>{manifest?.artifact.runtimeReady ? '可推理' : '待连接'}</Status></div><div><span>Thermal v1 历史口径</span><span>solar-thermal-yolo-v1</span><span>{manifest?.baselineModel?.metrics.map50.toFixed(4) ?? '--'}</span><Status tone="info">归档</Status></div><div><span>RGB-T FusionNet</span><span>真实配对集待补</span><span>无指标</span><Status tone="warn">不可宣称</Status></div></div><div className="form-callout"><ShieldCheck /><p>版本对照需统一评估设置。GB 类定位指标和 PID 类 AP@50 尚有回退；新模型不是双模态融合，跨场站测试与温度标定仍待完成。</p></div><Button onClick={() => downloadJson('model-comparison.json', { model: manifest, plannedExperiments: plans })}>下载模型与边界清单</Button></Drawer>
    <Drawer open={Boolean(card)} title="实验卡" onClose={() => setCard(null)}>{card ? <div className="detail-drawer"><Status tone={card.status === '已完成' ? 'good' : 'warn'}>{card.status}</Status><h3>{card.id}</h3><p>{card.config}</p><dl className="evidence-facts"><div><dt>数据集</dt><dd>{card.dataset}</dd></div><div><dt>随机种子</dt><dd>{card.status === '已完成' ? '20260921' : '待登记'}</dd></div><div><dt>结果</dt><dd>{card.result}</dd></div><div><dt>复现状态</dt><dd>{card.status === '已完成' ? '权重与日志齐全' : '仅计划'}</dd></div></dl><Button onClick={() => downloadJson(`${card.id}-experiment-card.json`, { ...card, manifest: card.status === '已完成' ? manifest : null })}>下载实验卡</Button></div> : null}</Drawer>
  </div>;
}

function Reports() {
  const [template, setTemplate] = useState('巡检任务报告');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [detail, setDetail] = useState<{ title: string; type: string; state: string; time: string } | null>(null);
  const reports = [
    { title: 'MSN-240905-042 巡检复核报告', type: '任务报告', state: '等待 12 项人工复核', time: '今天 10:28' },
    { title: '盐城一期 2026 年 8 月资产健康报告', type: '月度报告', state: '已发布', time: '09/01 09:00' },
    { title: 'RGB-Thermal 双模态实验报告', type: '研究报告', state: '真实实验待运行', time: '今天 11:06' },
    { title: '高风险组件处置闭环审计', type: '审计报告', state: '已归档', time: '08/31 17:20' }
  ];
  const templates = [['巡检任务报告', FileChartColumn, '异常地图、双模态证据、复核结论'], ['资产健康报告', AreaChart, '趋势、风险分布、闭环率与建议'], ['科研实验报告', TableProperties, '配置、结果、消融、统计与图表'], ['审计合规报告', ShieldCheck, '账号、操作、模型版本与修改记录']] as const;

  return <div className="page"><PageHeader eyebrow="REPORTING & AUDIT" title="报告中心" description="从任务证据、人工结论和工单状态生成可追溯报告。" actions={<><Button onClick={() => setManageOpen(true)}><FileDown />模板管理</Button><Button variant="primary" onClick={() => setGenerateOpen(true)}><Plus />生成报告</Button></>} /><div className="report-templates">{templates.map(([name, Icon, description]) => <button key={name} className={template === name ? 'active' : ''} onClick={() => { setTemplate(name); setGenerateOpen(true); }}><span><Icon /></span><strong>{name}</strong><p>{description}</p></button>)}</div><Panel className="table-panel" title="最近报告" description="报告发布前会检查未复核事件与数据完整性"><div className="data-table report-table"><div className="data-row data-head"><span>报告名称</span><span>类型</span><span>状态</span><span>更新时间</span><span /></div>{reports.map((report) => <button className="data-row" key={report.title} onClick={() => setDetail(report)}><span><strong>{report.title}</strong><small>盐城一期光伏场</small></span><span>{report.type}</span><span><Status tone={report.state.includes('等待') || report.state.includes('待') ? 'warn' : 'good'}>{report.state}</Status></span><span>{report.time}</span><Download /></button>)}</div></Panel>
    <Drawer open={generateOpen} title="生成可追溯报告" onClose={() => setGenerateOpen(false)}><div className="form-stack"><Field label="报告模板"><select value={template} onChange={(event) => setTemplate(event.target.value)}>{templates.map(([name]) => <option key={name}>{name}</option>)}</select></Field><Field label="数据范围"><select><option>MSN-240905-042</option><option>盐城一期 · 2026 年 8 月</option></select></Field><Field label="发布状态"><select><option>仅生成草稿</option><option>提交审核</option></select></Field><div className="form-callout"><Info /><p>未复核事件和缺失真实指标会在报告中明确标记，不会自动补造结论。</p></div><Button variant="primary" onClick={() => { setGenerateOpen(false); downloadText(`Sentinel-${template}-草稿.md`, `# ${template}\n\n状态：草稿\n\n数据边界：演示数据，真实实验待运行。\n`); }}>生成并下载草稿</Button></div></Drawer>
    <Drawer open={manageOpen} title="报告模板管理" onClose={() => setManageOpen(false)}><div className="template-list">{templates.map(([name, Icon, description]) => <button key={name} onClick={() => { setTemplate(name); setManageOpen(false); setGenerateOpen(true); }}><Icon /><span><strong>{name}</strong><small>{description}</small></span></button>)}</div></Drawer>
    <Drawer open={Boolean(detail)} title="报告详情" onClose={() => setDetail(null)}>{detail ? <div className="detail-drawer"><Status tone={detail.state.includes('待') || detail.state.includes('等待') ? 'warn' : 'good'}>{detail.state}</Status><h3>{detail.title}</h3><p>{detail.type} · {detail.time}</p><dl className="evidence-facts"><div><dt>数据来源</dt><dd>任务、证据、工单、审计</dd></div><div><dt>完整性</dt><dd>{detail.state.includes('待') || detail.state.includes('等待') ? '存在阻断项' : '已通过'}</dd></div></dl><Button variant="primary" onClick={() => downloadText(`${detail.title}.md`, `# ${detail.title}\n\n类型：${detail.type}\n状态：${detail.state}\n更新时间：${detail.time}\n`)}><Download />下载报告文件</Button></div> : null}</Drawer>
  </div>;
}

function DataAdmin() {
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState<(typeof datasets)[number] | null>(null);
  const location = useLocation();
  useEffect(() => { if (new URLSearchParams(location.search).get('upload') === '1') setUploading(true); }, [location.search]);
  const beginCheck = () => {
    setChecking(true);
    window.setTimeout(() => { setChecking(false); setUploading(false); notify('完整性预检完成', `${files.length} 个文件已登记，发现 2 项需人工确认`); }, 900);
  };

  return <div className="page"><PageHeader eyebrow="DATASET & STORAGE" title="数据管理" description="管理原始影像、配对关系、标注、温度矩阵、数据许可与数据版本。" actions={<Button variant="primary" onClick={() => setUploading(true)}><CloudUpload />导入数据</Button>} /><div className="storage-strip"><HardDriveDownload /><div><strong>存储空间 1.24 TB / 4 TB</strong><i><b style={{ width: '31%' }} /></i><p>原始影像 684 GB · 派生数据 318 GB · 模型产物 97 GB · 报告 12 GB</p></div><Status tone="good">校验正常</Status></div><div className="dataset-grid">{datasets.map((item) => <button key={item[0]} onClick={() => setSelected(item)}><header><span className="dataset-icon"><Database /></span><Status tone={item[3] === '标注中' ? 'info' : 'warn'}>{item[3]}</Status></header><strong>{item[0]}</strong><p>{item[1]}</p><dl><div><dt>规模</dt><dd>{item[2]}</dd></div><div><dt>许可</dt><dd>{item[4]}</dd></div></dl></button>)}</div><Panel title="数据完整性检查" description="导入后自动执行，不修改原始文件"><div className="integrity-checks">{[['文件哈希与重复项','通过','good'],['RGB/Thermal 配对关系','98.2%','good'],['时间戳与时区','4 项待确认','warn'],['GPS/姿态字段','通过','good'],['温度矩阵可读性','待真实数据','warn'],['数据许可与来源','2 项待补充','warn']].map(([name,state,tone]) => <div key={name}><span>{tone === 'good' ? <CheckCircle2 /> : <Info />}{name}</span><Status tone={tone as 'good' | 'warn'}>{state}</Status></div>)}</div></Panel>
    <Drawer open={uploading} title="导入巡检数据" onClose={() => setUploading(false)}><div className="upload-zone"><CloudUpload /><strong>拖入任务目录或选择文件</strong><p>支持 RGB、Thermal、R-JPEG、CSV、SRT、JSON 与 ZIP</p><input type="file" multiple aria-label="选择巡检数据" onChange={(event) => setFiles(Array.from(event.target.files ?? []).map((file) => file.name))} /></div>{files.length ? <div className="file-selection"><strong>待检查文件：{files.length}</strong>{files.slice(0, 6).map((name) => <span key={name}>{name}</span>)}</div> : null}<div className="form-callout"><Info /><p>导入前不会改变原始文件。系统将先生成清单、哈希、配对报告和异常字段列表。</p></div><Button variant="primary" loading={checking} disabled={!files.length} onClick={beginCheck}>开始完整性检查</Button></Drawer>
    <Drawer open={Boolean(selected)} title="数据集详情" onClose={() => setSelected(null)}>{selected ? <div className="detail-drawer"><Status tone={selected[3] === '标注中' ? 'info' : 'warn'}>{selected[3]}</Status><h3>{selected[0]}</h3><p>{selected[1]}</p><dl className="evidence-facts"><div><dt>规模</dt><dd>{selected[2]}</dd></div><div><dt>许可</dt><dd>{selected[4]}</dd></div><div><dt>哈希清单</dt><dd>已登记</dd></div><div><dt>数据卡</dt><dd>v1.0</dd></div></dl><Button onClick={() => downloadJson(`${selected[0]}-dataset-card.json`, { id: selected[0], description: selected[1], size: selected[2], status: selected[3], license: selected[4], demo: true })}><Download />下载数据卡</Button></div> : null}</Drawer>
  </div>;
}
