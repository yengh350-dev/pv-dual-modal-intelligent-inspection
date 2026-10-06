export type GateState = 'pass' | 'attention' | 'fail';

export interface FlightQualityProfile {
  missionId: string;
  crossTrackP95M: number;
  crossTrackMaxM: number;
  crossTrackSeriesM: number[];
  rtkFixRatePct: number;
  altitudeP95M: number;
  geotagP95M: number;
  rgbThermalPairRatePct: number;
  pairTimeSkewP95Ms: number;
  minimumViewAngleDeg: number;
  sampleCount: number;
  source: string;
  computedAt: string;
}

export interface QualityCheck {
  id: string;
  label: string;
  value: string;
  threshold: string;
  passed: boolean;
  blocking: boolean;
  explanation: string;
}

export const projectQualityThresholds = {
  crossTrackP95M: 0.5,
  crossTrackMaxM: 1.5,
  rtkFixRatePct: 95,
  altitudeP95M: 2,
  geotagP95M: 0.5,
  rgbThermalPairRatePct: 97,
  pairTimeSkewP95Ms: 100,
  minimumIrradianceWm2: 600,
  minimumViewAngleDeg: 30,
} as const;

export const flightQualityByMission: Record<string, FlightQualityProfile> = {
  'MSN-240905-042': {
    missionId: 'MSN-240905-042', crossTrackP95M: 0.32, crossTrackMaxM: 0.84,
    crossTrackSeriesM: [0.18, 0.22, 0.28, 0.31, 0.26, 0.19, 0.24, 0.37, 0.29, 0.32, 0.21, 0.27, 0.34, 0.25, 0.2, 0.23],
    rtkFixRatePct: 99.4, altitudeP95M: 0.9, geotagP95M: 0.11, rgbThermalPairRatePct: 98.2,
    pairTimeSkewP95Ms: 42, minimumViewAngleDeg: 72, sampleCount: 4286,
    source: '演示任务日志重放', computedAt: '2024-09-05T10:24:18+08:00',
  },
  'MSN-240904-041': {
    missionId: 'MSN-240904-041', crossTrackP95M: 0.18, crossTrackMaxM: 0.49,
    crossTrackSeriesM: [0.11, 0.14, 0.16, 0.12, 0.18, 0.15, 0.13, 0.17, 0.2, 0.16, 0.12, 0.14, 0.19, 0.15, 0.13, 0.12],
    rtkFixRatePct: 99.8, altitudeP95M: 0.7, geotagP95M: 0.09, rgbThermalPairRatePct: 99.1,
    pairTimeSkewP95Ms: 28, minimumViewAngleDeg: 69, sampleCount: 3180,
    source: '演示复飞任务日志重放', computedAt: '2024-09-04T15:02:31+08:00',
  },
  'MSN-240903-040': {
    missionId: 'MSN-240903-040', crossTrackP95M: 1.82, crossTrackMaxM: 4.6,
    crossTrackSeriesM: [0.42, 0.55, 0.72, 1.18, 1.64, 2.08, 1.72, 2.35, 1.88, 2.74, 1.92, 1.46, 2.12, 1.7, 1.28, 0.96],
    rtkFixRatePct: 63.4, altitudeP95M: 1.9, geotagP95M: 1.6, rgbThermalPairRatePct: 92.8,
    pairTimeSkewP95Ms: 86, minimumViewAngleDeg: 56, sampleCount: 2954,
    source: '演示雨后专项任务日志重放', computedAt: '2024-09-03T11:06:42+08:00',
  },
  'MSN-240902-038': {
    missionId: 'MSN-240902-038', crossTrackP95M: 0.46, crossTrackMaxM: 1.34,
    crossTrackSeriesM: [0.22, 0.31, 0.38, 0.42, 0.35, 0.48, 0.44, 0.39, 0.51, 0.46, 0.41, 0.36, 0.45, 0.43, 0.34, 0.29],
    rtkFixRatePct: 96.8, altitudeP95M: 1.5, geotagP95M: 0.15, rgbThermalPairRatePct: 97.6,
    pairTimeSkewP95Ms: 51, minimumViewAngleDeg: 64, sampleCount: 1864,
    source: '演示山地任务日志重放', computedAt: '2024-09-02T10:41:09+08:00',
  },
};

export function evaluateFlightQuality(profile: FlightQualityProfile, irradianceWm2: number) {
  const threshold = projectQualityThresholds;
  const checks: QualityCheck[] = [
    {
      id: 'cross-track-p95', label: 'P95 横向航迹偏差', value: `${profile.crossTrackP95M.toFixed(2)} m`, threshold: `≤ ${threshold.crossTrackP95M} m`,
      passed: profile.crossTrackP95M <= threshold.crossTrackP95M, blocking: true,
      explanation: '把实际轨迹逐点投影到计划航线，统计 95% 采样点以内的横向距离。',
    },
    {
      id: 'cross-track-max', label: '最大横向航迹偏差', value: `${profile.crossTrackMaxM.toFixed(2)} m`, threshold: `≤ ${threshold.crossTrackMaxM} m`,
      passed: profile.crossTrackMaxM <= threshold.crossTrackMaxM, blocking: false,
      explanation: '用于发现转弯、避障或链路波动造成的局部大偏离，不能只看平均值。',
    },
    {
      id: 'rtk-fix', label: 'RTK 固定解有效率', value: `${profile.rtkFixRatePct.toFixed(1)}%`, threshold: `≥ ${threshold.rtkFixRatePct}%`,
      passed: profile.rtkFixRatePct >= threshold.rtkFixRatePct, blocking: true,
      explanation: '统计有效遥测采样中处于 RTK FIX 的比例；设备标称精度不等于最终缺陷定位误差。',
    },
    {
      id: 'altitude', label: 'AGL 高度 P95 波动', value: `${profile.altitudeP95M.toFixed(1)} m`, threshold: `≤ ${threshold.altitudeP95M} m`,
      passed: profile.altitudeP95M <= threshold.altitudeP95M, blocking: false,
      explanation: '以任务目标离地高度为基准，检查地形跟随和高度稳定性。',
    },
    {
      id: 'geotag', label: '影像回挂 P95 残差', value: `${profile.geotagP95M.toFixed(2)} m`, threshold: `≤ ${threshold.geotagP95M} m`,
      passed: profile.geotagP95M <= threshold.geotagP95M, blocking: true,
      explanation: '综合时间戳、相机外参和姿态，将影像回挂到组件位置后的空间残差。',
    },
    {
      id: 'pair-rate', label: 'RGB-Thermal 配对率', value: `${profile.rgbThermalPairRatePct.toFixed(1)}%`, threshold: `≥ ${threshold.rgbThermalPairRatePct}%`,
      passed: profile.rgbThermalPairRatePct >= threshold.rgbThermalPairRatePct, blocking: true,
      explanation: '每个 pairId 必须同时具备一张 RGB 和一张 Thermal，缺失对不得进入自动分析。',
    },
    {
      id: 'time-skew', label: '双模态时间差 P95', value: `${profile.pairTimeSkewP95Ms} ms`, threshold: `≤ ${threshold.pairTimeSkewP95Ms} ms`,
      passed: profile.pairTimeSkewP95Ms <= threshold.pairTimeSkewP95Ms, blocking: true,
      explanation: '检查同一证据对的采集时间差；时间同步通过后仍需执行空间配准。',
    },
    {
      id: 'irradiance', label: '太阳辐照度', value: `${irradianceWm2} W/m²`, threshold: `≥ ${threshold.minimumIrradianceWm2} W/m²`,
      passed: irradianceWm2 >= threshold.minimumIrradianceWm2, blocking: true,
      explanation: '光伏热检查需要足够热对比；平台采用 FLIR 公开指南中的 600 W/m² 基线。',
    },
    {
      id: 'view-angle', label: '最小观测夹角', value: `${profile.minimumViewAngleDeg}°`, threshold: `≥ ${threshold.minimumViewAngleDeg}°`,
      passed: profile.minimumViewAngleDeg >= threshold.minimumViewAngleDeg, blocking: false,
      explanation: '过小角度会增强反射干扰；该值应由相机姿态、组件倾角与航迹共同计算。',
    },
  ];
  const failed = checks.filter((check) => !check.passed);
  const state: GateState = failed.some((check) => check.blocking) ? 'fail' : failed.length ? 'attention' : 'pass';
  return {
    state,
    score: Math.round((checks.filter((check) => check.passed).length / checks.length) * 100),
    checks,
    failed,
  };
}
