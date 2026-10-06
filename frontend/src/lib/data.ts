export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Anomaly {
  id: string;
  type: string;
  severity: Severity;
  array: string;
  module: string;
  deltaT: number;
  confidence: number;
  alignment: number;
  status: '待复核' | '已确认' | '已转工单' | '已排除';
  time: string;
  evidence: {
    registrationErrorPx: number; syncOffsetMs: number; localizationAccuracyM: number;
    persistentFrames: number; persistentSeconds: number; temperatureUncertaintyC: number;
    reflectionRisk: number; occlusionRatio: number; repeatObservations: number; assetCriticality: number;
  };
}

export const anomalies: Anomaly[] = [
  { id: 'EVT-240905-018', type: '组件热斑', severity: 'critical', array: 'A-03', module: '18-07', deltaT: 18.6, confidence: 0.94, alignment: 0.97, status: '已转工单', time: '09:57:24', evidence: { registrationErrorPx: 1.7, syncOffsetMs: 24, localizationAccuracyM: 1.8, persistentFrames: 6, persistentSeconds: 4.2, temperatureUncertaintyC: 1.2, reflectionRisk: .08, occlusionRatio: .04, repeatObservations: 3, assetCriticality: .8 } },
  { id: 'EVT-240905-021', type: '连接器过热', severity: 'high', array: 'B-07', module: '04-12', deltaT: 11.2, confidence: 0.88, alignment: 0.93, status: '已转工单', time: '10:02:11', evidence: { registrationErrorPx: 2.1, syncOffsetMs: 38, localizationAccuracyM: 2.2, persistentFrames: 5, persistentSeconds: 3.4, temperatureUncertaintyC: 1.5, reflectionRisk: .12, occlusionRatio: .06, repeatObservations: 2, assetCriticality: .75 } },
  { id: 'EVT-240905-027', type: '表面污染', severity: 'medium', array: 'B-02', module: '11-03', deltaT: 5.4, confidence: 0.79, alignment: 0.89, status: '待复核', time: '10:08:46', evidence: { registrationErrorPx: 2.8, syncOffsetMs: 61, localizationAccuracyM: 2.5, persistentFrames: 4, persistentSeconds: 2.8, temperatureUncertaintyC: 1.8, reflectionRisk: .18, occlusionRatio: .22, repeatObservations: 1, assetCriticality: .45 } },
  { id: 'EVT-240905-033', type: '疑似二极管异常', severity: 'high', array: 'C-01', module: '08-15', deltaT: 13.8, confidence: 0.84, alignment: 0.95, status: '已确认', time: '10:14:09', evidence: { registrationErrorPx: 1.9, syncOffsetMs: 31, localizationAccuracyM: 1.6, persistentFrames: 7, persistentSeconds: 4.8, temperatureUncertaintyC: 1.3, reflectionRisk: .10, occlusionRatio: .05, repeatObservations: 2, assetCriticality: .70 } },
  { id: 'EVT-240905-041', type: '反光干扰', severity: 'low', array: 'A-06', module: '21-08', deltaT: 2.1, confidence: 0.61, alignment: 0.76, status: '已排除', time: '10:19:31', evidence: { registrationErrorPx: 4.8, syncOffsetMs: 112, localizationAccuracyM: 2.8, persistentFrames: 2, persistentSeconds: 1.1, temperatureUncertaintyC: 2.5, reflectionRisk: .72, occlusionRatio: .08, repeatObservations: 1, assetCriticality: .30 } }
];

export interface AnomalyMapPoint {
  eventId: string;
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  estimatedLossKw: number;
}

// Shared task-map anchors keep map, evidence and work-order views on one event.
export const anomalyMapPoints: AnomalyMapPoint[] = [
  { eventId: 'EVT-240905-018', x: 560, y: 198, latitude: 33.31281, longitude: 120.36892, estimatedLossKw: 3.8 },
  { eventId: 'EVT-240905-021', x: 780, y: 280, latitude: 33.31196, longitude: 120.37184, estimatedLossKw: 2.1 },
  { eventId: 'EVT-240905-027', x: 280, y: 360, latitude: 33.31088, longitude: 120.36567, estimatedLossKw: 0.7 },
  { eventId: 'EVT-240905-033', x: 690, y: 412, latitude: 33.30994, longitude: 120.37026, estimatedLossKw: 2.6 },
  { eventId: 'EVT-240905-041', x: 404, y: 126, latitude: 33.31372, longitude: 120.36722, estimatedLossKw: 0.2 },
];

export const missions = [
  { id: 'MSN-240905-042', name: '盐城一期 A/B 区例行巡检', date: '今天 09:42', aircraft: 'Mavic 3T', coverage: 94.7, quality: 98.2, status: '待复核', frames: 4286 },
  { id: 'MSN-240904-041', name: '盐城一期 C 区复飞', date: '昨天 14:08', aircraft: 'Mavic 3T', coverage: 91.2, quality: 95.8, status: '已完成', frames: 3180 },
  { id: 'MSN-240903-040', name: '东台二期雨后专项', date: '09/03 10:16', aircraft: 'Matrice 350 RTK', coverage: 76.4, quality: 71.4, status: '需复飞', frames: 2954 },
  { id: 'MSN-240901-039', name: '盐城一期周检', date: '09/01 08:55', aircraft: 'Mavic 3T', coverage: 96.1, quality: 97.4, status: '已完成', frames: 4412 }
];

export type WorkOrderState = '待排程' | '已派发' | '处理中' | '待验收' | '已关闭';
export interface WorkOrder {
  id: string; title: string; owner: string; reviewer: string; priority: '紧急' | '高' | '中'; due: string; state: WorkOrderState;
  anomalyId: string; assetId: string; site: string; slaHours: number; elapsedHours: number; progress: number; estimatedCost: number;
  checklist: { id: string; label: string; done: boolean }[];
}

export const workOrders: WorkOrder[] = [
  { id: 'WO-240905-018', title: '复核 A-03 组件热斑', owner: '李工', reviewer: '张工', priority: '紧急', due: '今天 17:00', state: '处理中', anomalyId: 'EVT-240905-018', assetId: 'YC-A03-18-07', site: '盐城一期光伏场', slaHours: 8, elapsedHours: 4.2, progress: 50, estimatedCost: 680, checklist: [{ id: 'isolate', label: '确认组串并执行安全隔离', done: true }, { id: 'electrical', label: '记录开路电压与工作电流', done: true }, { id: 'thermal', label: '复拍热像并核对温差', done: false }, { id: 'close', label: '上传处置前后证据', done: false }] },
  { id: 'WO-240905-014', title: '更换 B-07 连接器', owner: '王强', reviewer: '刘洋', priority: '高', due: '明天 12:00', state: '已派发', anomalyId: 'EVT-240905-021', assetId: 'YC-B07-04-12', site: '盐城一期光伏场', slaHours: 24, elapsedHours: 5.6, progress: 25, estimatedCost: 420, checklist: [{ id: 'permit', label: '领取作业票并确认停电窗口', done: true }, { id: 'inspect', label: '检查压接与端子烧蚀', done: false }, { id: 'replace', label: '更换连接器并做拉力检查', done: false }, { id: 'thermal', label: '恢复送电后复测温升', done: false }] },
  { id: 'WO-240904-009', title: '清洗 B-02 组件表面', owner: '陈晨', reviewer: '张工', priority: '中', due: '09/27', state: '待排程', anomalyId: 'EVT-240905-027', assetId: 'YC-B02-11-03', site: '盐城一期光伏场', slaHours: 72, elapsedHours: 8.1, progress: 0, estimatedCost: 180, checklist: [{ id: 'weather', label: '确认清洗天气与水质', done: false }, { id: 'before', label: '记录清洗前 RGB 证据', done: false }, { id: 'clean', label: '完成表面清洁', done: false }, { id: 'after', label: '复拍并确认无残留遮挡', done: false }] },
  { id: 'WO-240901-002', title: '复测 C-01 电气参数', owner: '刘洋', reviewer: '张工', priority: '高', due: '今天 15:00', state: '待验收', anomalyId: 'EVT-240905-033', assetId: 'YC-C01-08-15', site: '盐城一期光伏场', slaHours: 24, elapsedHours: 21.5, progress: 100, estimatedCost: 260, checklist: [{ id: 'curve', label: '完成组串 I-V 曲线测试', done: true }, { id: 'diode', label: '检查旁路二极管与接线盒', done: true }, { id: 'thermal', label: '上传复测热像', done: true }, { id: 'report', label: '填写现场结论与建议', done: true }] }
];

export const healthTrend = [
  { day: '08/30', health: 93.8, anomalies: 29, temp: 36.1 },
  { day: '08/31', health: 93.5, anomalies: 31, temp: 38.4 },
  { day: '09/01', health: 93.9, anomalies: 26, temp: 34.8 },
  { day: '09/02', health: 93.1, anomalies: 34, temp: 39.2 },
  { day: '09/03', health: 92.8, anomalies: 42, temp: 41.6 },
  { day: '09/04', health: 93.3, anomalies: 36, temp: 37.4 },
  { day: '09/05', health: 92.4, anomalies: 37, temp: 40.8 }
];

export const activity = [
  { time: '10:31', label: '张工将 EVT-240905-021 转为工单', detail: '模型 v2.3.1 · 连接器过热' },
  { time: '10:24', label: '系统完成双模态质量检查', detail: '配对率 98.2% · 配准中位误差 1.7 px' },
  { time: '10:21', label: '任务 MSN-240905-042 完成分析', detail: '4,208 有效帧 · 37 个待复核事件' },
  { time: '10:18', label: '无人机安全返航', detail: '剩余电量 31% · 数据链路正常' }
];

export const missionProfiles = [
  {
    id: 'MSN-240905-042', site: '盐城一期光伏场', area: 'A/B 区', aircraft: 'UAV-07', deviceId: 'UAV-SR9-0421', aircraftModel: 'DJI Mavic 3T', payload: '集成 RGB + Thermal', progress: 68, elapsed: '23:41', remaining: '11:08', inspectedArea: '1.26 km²', routeLength: '6.4 km', waypoint: '24 / 64', frames: 4286,
    mapImage: '/assets/site-yancheng-coastal.jpg', mapAlt: '概念演示：盐城沿海平原大型光伏方阵俯视图', sceneLabel: '沿海平原方阵', sceneNote: '排水渠密集，航线沿长排组件往返扫描', coordinates: "33°18'42\"N · 120°22'08\"E", mapScale: '120 m',
    plannedRoute: 'M82 112 H886 V190 H146 V278 H904 V366 H118 V458 H792', actualRoute: 'M82 112 H886 V190 H146 V278 H650', droneX: 650, droneY: 278,
    weather: { summary: '多云', ambientC: 28, windSpeed: 3.2, windDirection: '东南', irradiance: 784, visibilityKm: 12 }, flight: { battery: 76, altitude: 118.7, speed: 8.6, signal: -65, rtk: '固定解 · 32 星' }
  },
  {
    id: 'MSN-240904-041', site: '盐城一期光伏场', area: 'C 区', aircraft: 'UAV-02', deviceId: 'UAV-M35-0186', aircraftModel: 'Matrice 350 RTK', payload: 'Zenmuse H20T', progress: 100, elapsed: '36:18', remaining: '00:00', inspectedArea: '0.84 km²', routeLength: '5.1 km', waypoint: '52 / 52', frames: 3180,
    mapImage: '/assets/field-map.png', mapAlt: '概念演示：盐城一期 C 区光伏方阵俯视图', sceneLabel: '沿海复飞区', sceneNote: '针对历史热异常采用短航段交叉复核', coordinates: "33°18'55\"N · 120°21'41\"E", mapScale: '90 m',
    plannedRoute: 'M120 100 H800 V178 H214 V256 H842 V334 H260 V420 H720', actualRoute: 'M120 100 H800 V178 H214 V256 H842 V334 H260 V420 H720', droneX: 720, droneY: 420,
    weather: { summary: '晴间多云', ambientC: 30, windSpeed: 2.1, windDirection: '南', irradiance: 862, visibilityKm: 16 }, flight: { battery: 58, altitude: 82.4, speed: 6.2, signal: -59, rtk: '固定解 · 35 星' }
  },
  {
    id: 'MSN-240903-040', site: '东台二期光伏场', area: '全场', aircraft: 'UAV-02', deviceId: 'UAV-M35-0186', aircraftModel: 'Matrice 350 RTK', payload: 'Zenmuse H20T', progress: 76, elapsed: '28:06', remaining: '09:42', inspectedArea: '1.08 km²', routeLength: '7.8 km', waypoint: '41 / 58', frames: 2954,
    mapImage: '/assets/site-dongtai-agri.jpg', mapAlt: '概念演示：东台农光互补场站俯视图', sceneLabel: '农光互补田块', sceneNote: '绕开作物区和沟渠，分区连接四块组件阵列', coordinates: "32°51'16\"N · 120°31'24\"E", mapScale: '150 m',
    plannedRoute: 'M92 128 H420 V238 H178 V472 H448 V350 H610 V116 H902 V292 H672 V486 H910', actualRoute: 'M92 128 H420 V238 H178 V472 H448 V350 H610', droneX: 610, droneY: 350,
    weather: { summary: '雨后薄云', ambientC: 25, windSpeed: 4.6, windDirection: '东北', irradiance: 615, visibilityKm: 9 }, flight: { battery: 64, altitude: 96.2, speed: 7.1, signal: -72, rtk: '浮点解 · 24 星' }
  },
  {
    id: 'MSN-240902-038', site: '山地研究验证场', area: '阶梯阵列', aircraft: 'UAV-11', deviceId: 'UAV-EV4-1103', aircraftModel: 'EVO Max 4T', payload: '广角 RGB + Radiometric Thermal', progress: 43, elapsed: '18:22', remaining: '24:10', inspectedArea: '0.62 km²', routeLength: '5.9 km', waypoint: '18 / 46', frames: 1864,
    mapImage: '/assets/site-mountain-research.jpg', mapAlt: '概念演示：山地阶梯式光伏场站俯视图', sceneLabel: '山地阶梯阵列', sceneNote: '沿等高线飞行，转弯半径和地形跟随约束更高', coordinates: "27°41'09\"N · 106°55'34\"E", mapScale: '110 m',
    plannedRoute: 'M86 142 C210 62 324 180 430 112 S650 82 760 166 S882 286 730 338 S490 276 384 390 S204 520 104 432', actualRoute: 'M86 142 C210 62 324 180 430 112 S650 82 688 130', droneX: 688, droneY: 130,
    weather: { summary: '晴', ambientC: 23, windSpeed: 5.4, windDirection: '西南', irradiance: 906, visibilityKm: 20 }, flight: { battery: 81, altitude: 134.5, speed: 5.4, signal: -69, rtk: '固定解 · 28 星' }
  }
];

export const missionOperationalSummary: Record<string, {
  healthyModules: number;
  totalAnomalies: number;
  pendingAnomalies: number;
  highRiskAnomalies: number;
  closedLoopRatePct: number;
  effectiveCoveragePct: number;
  componentsLocated: number;
}> = {
  'MSN-240905-042': { healthyModules: 12486, totalAnomalies: 37, pendingAnomalies: 12, highRiskAnomalies: 7, closedLoopRatePct: 86, effectiveCoveragePct: 94.7, componentsLocated: 12523 },
  'MSN-240904-041': { healthyModules: 5368, totalAnomalies: 12, pendingAnomalies: 3, highRiskAnomalies: 2, closedLoopRatePct: 91, effectiveCoveragePct: 96.1, componentsLocated: 5380 },
  'MSN-240903-040': { healthyModules: 9674, totalAnomalies: 24, pendingAnomalies: 8, highRiskAnomalies: 6, closedLoopRatePct: 72, effectiveCoveragePct: 76.4, componentsLocated: 9698 },
  'MSN-240902-038': { healthyModules: 7411, totalAnomalies: 9, pendingAnomalies: 4, highRiskAnomalies: 2, closedLoopRatePct: 80, effectiveCoveragePct: 42.1, componentsLocated: 7420 },
};

export const environmentSnapshot = {
  weather: '多云', ambientC: 28.0, windSpeed: 3.2, windDirection: '东南', visibilityKm: 12, rainMm: 0,
  irradiance: 784, humidity: 58, updatedAt: '10:32:18'
};

export const temperatureTrend = [
  { time: '07:00', module: 60.4, inverter: 41.8, ambient: 27.3 },
  { time: '07:30', module: 72.1, inverter: 46.5, ambient: 31.2 },
  { time: '08:00', module: 84.7, inverter: 50.6, ambient: 34.6 },
  { time: '08:30', module: 73.2, inverter: 53.1, ambient: 34.8 },
  { time: '09:00', module: 76.4, inverter: 56.8, ambient: 31.9 },
  { time: '09:30', module: 88.2, inverter: 57.4, ambient: 36.1 },
  { time: '10:00', module: 82.6, inverter: 54.8, ambient: 32.6 },
  { time: '10:30', module: 76.8, inverter: 48.3, ambient: 28.0 }
];

export const latencyTrend = [0.92, 1.18, 1.04, 1.36, 1.12, 1.48, 1.21, 1.08, 1.32, 0.98, 1.2, 0.86].map((value, index) => ({ t: index, value }));

export const teamMembers = [
  { name: '张伟', role: '指挥员', scope: '全局协调', state: '在线' },
  { name: '李娜', role: '飞手', scope: '任务执行', state: '在线' },
  { name: '王强', role: '数据专员', scope: '质量检查', state: '在线' },
  { name: '陈晨', role: 'AI 分析师', scope: '模型分析', state: '在线' },
  { name: '刘洋', role: '复核员', scope: '人工复核', state: '离线' }
];

export const missionActivity = [
  { time: '08:12:34', title: '安全检查完成', detail: '系统自动化检查通过', tone: 'info' },
  { time: '08:13:02', title: '任务开始执行', detail: '飞行任务已启动', tone: 'good' },
  { time: '08:14:18', title: 'UAV 起飞', detail: 'UAV-07 起飞成功', tone: 'good' },
  { time: '08:15:42', title: '到达航点 1', detail: '自动航点 1 已到达', tone: 'good' },
  { time: '08:21:07', title: '发现异常（疑似遮挡）', detail: 'AI 检测到可疑区域', tone: 'warn' },
  { time: '08:34:12', title: '发现严重异常（热斑）', detail: 'AI 检测到严重热斑异常', tone: 'danger' }
];
