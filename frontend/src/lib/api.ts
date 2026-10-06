import axios from 'axios';
import type { FlightQualityProfile } from './flightQuality';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  timeout: 12_000,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = window.sessionStorage.getItem('sentinel_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['X-Request-ID'] = crypto.randomUUID();
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const token = window.sessionStorage.getItem('sentinel_access_token');
    // A late response from an older session must not invalidate a fresh login.
    if (status === 401 && token && error.config?.headers?.Authorization === `Bearer ${token}`) {
      window.sessionStorage.removeItem('sentinel_access_token');
      window.sessionStorage.removeItem('sentinel_refresh_token');
      window.sessionStorage.removeItem('sentinel_demo_session');
      window.dispatchEvent(new CustomEvent('sentinel:auth-expired'));
    }
    return Promise.reject(error);
  }
);

export function getApiErrorMessage(error: unknown, fallback = '操作未完成，请稍后重试') {
  if (!axios.isAxiosError(error)) return fallback;
  const message = error.response?.data?.error?.message ?? error.response?.data?.detail;
  const requestId = error.response?.data?.requestId ?? error.response?.headers?.['x-request-id'];
  return `${typeof message === 'string' ? message : fallback}${requestId ? `（追踪号 ${requestId}）` : ''}`;
}

export function isApiUnavailable(error: unknown) {
  return axios.isAxiosError(error) && !error.response;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: { page?: number; pageSize?: number; total?: number; requestId?: string };
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'bearer';
  user: { id: string; name: string; role: string; email: string };
}

export interface SystemReadiness {
  overall: 'healthy' | 'degraded';
  checkedAt: string;
  services: Array<{
    id: string;
    name: string;
    status: 'healthy' | 'degraded' | 'demo' | 'disabled';
    latencyMs?: number;
    detail: string;
  }>;
  safetyBoundary: string;
}

export interface AIProvider {
  id: string;
  label: string;
  model: string;
  configured: boolean;
  default: boolean;
  mode: 'local' | 'openai-compatible';
}

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotResponse {
  answer: string;
  sources: string[];
  provider: string;
  providerLabel: string;
  model: string;
  latencyMs: number;
  mode: 'demo' | 'live';
}

export interface DetectionModelManifest {
  baselineModel?: DetectionModelManifest['model'];
  model: {
    model_id: string;
    created_at: string;
    architecture: string;
    task: string;
    class_names: string[];
    image_size: number;
    batch_size: number;
    device: string;
    seed: number;
    metrics: {
      precision: number;
      recall: number;
      map50: number;
      map50_95: number;
      per_class_map50_95: Record<string, number>;
    };
    speed_ms_per_image: { inference: number };
    duration_seconds: number;
    runtime: Record<string, string | number | boolean>;
    limitations: string[];
  };
  dataset: {
    version: string;
    sourceImages: number;
    usableImages: number;
    duplicatesRemoved: number;
    clippedBoxes: number;
    splits: Record<string, { images: number; boxes: number }>;
    splitPolicy: string;
  };
  artifact: { weightsPresent: boolean; weightsBytes: number; runtimeReady: boolean; activationWarning?: string | null };
  decisionBoundary: {
    modality: 'THERMAL_ONLY';
    statement: string;
    requiresHumanReview: boolean;
    temperatureWarning: string;
  };
}

export interface ThermalDetection {
  classId: number;
  className: string;
  confidence: number;
  box: { x1: number; y1: number; x2: number; y2: number };
  boxNormalized: { x: number; y: number; width: number; height: number };
}

export interface ThermalPrediction {
  modelId: string;
  modality: 'THERMAL_ONLY';
  image: { width: number; height: number };
  parameters: { confidence: number; iou: number };
  detections: ThermalDetection[];
  count: number;
  elapsedMs: number;
  reviewRequired: boolean;
}

export interface RegisteredModel {
  model_id: string;
  task: string;
  architecture?: string;
  algorithm?: string;
  class_names?: string[];
  classes?: string[];
  metrics?: Record<string, unknown>;
  test?: Record<string, unknown>;
  boundary?: string;
  artifactReady: boolean;
  artifacts: string[];
}

export interface CellPrediction {
  modelId: string;
  modality: 'ELECTROLUMINESCENCE_CELL';
  predictions: Array<{ className: string; probability: number; positive: boolean }>;
  elapsedMs: number;
  reviewRequired: boolean;
  boundary: string;
}

export interface PowerPrediction {
  modelId: string;
  predictedPower: number;
  unit: string;
  elapsedMs: number;
  reviewRequired: boolean;
  boundary: string;
}

export interface GridFaultPrediction {
  modelId: string;
  windows: number;
  dominantClass: string;
  classProbabilities: Array<{ className: string; probability: number }>;
  elapsedMs: number;
  reviewRequired: boolean;
  boundary: string;
}

export interface PanelSegmentationPrediction {
  modelId: string;
  modality: 'AERIAL_RGB';
  image: { width: number; height: number };
  parameters: { confidence: number; iou: number };
  instances: Array<{ className: string; confidence: number | null; polygonNormalized: Array<[number, number]> }>;
  count: number;
  elapsedMs: number;
  reviewRequired: boolean;
  boundary: string;
}

export interface EvidenceEvaluationInput {
  alignmentQuality: number;
  registrationErrorPx: number;
  syncOffsetMs: number;
  localizationAccuracyM: number;
  persistentFrames: number;
  persistentSeconds: number;
  radiometricCalibrated: boolean;
  environmentComplete: boolean;
  temperatureDeltaC: number;
  modelConfidence: number;
  irradianceWM2?: number;
  temperatureUncertaintyC?: number;
  reflectionRisk?: number;
  occlusionRatio?: number;
  repeatObservations?: number;
  assetCriticality?: number;
}

export interface EvidenceEvaluation {
  algorithmVersion: string;
  qualityScore: number;
  reliabilityScore: number;
  reviewPriorityScore: number;
  gateStatus: 'pass' | 'review' | 'blocked';
  priority: 'critical_review' | 'high_review' | 'medium_review' | 'observe' | 'unrated';
  components: Record<string, number>;
  priorityComponents: Record<string, number>;
  temperatureDeltaIntervalC: [number, number];
  actionEligibility: { canReview: boolean; canCreateWorkOrder: boolean; requiresReflight: boolean; requiresHumanReview: true };
  findings: string[];
  warnings: string[];
  blockers: string[];
  nextAction: string;
  automaticFaultConclusion: false;
  decisionBoundary: string;
}

export async function login(email: string, password: string) {
  const response = await api.post<ApiEnvelope<LoginResponse>>('/auth/login', { email, password });
  return response.data.data;
}

export async function askCopilot(message: string, context: Record<string, unknown>, provider = 'auto', history: CopilotMessage[] = [], signal?: AbortSignal) {
  const response = await api.post<ApiEnvelope<CopilotResponse>>('/ai/chat', {
    message,
    context,
    provider,
    history
  }, { timeout: 130_000, signal });
  return response.data.data;
}

export async function getAIProviders() {
  const response = await api.get<ApiEnvelope<{ providers: AIProvider[]; defaultProvider: string }>>('/ai/providers');
  return response.data.data;
}

export async function testAIProvider(provider: string) {
  const response = await api.post<ApiEnvelope<{ provider: string; model: string; latencyMs: number; status: string }>>(`/ai/providers/${provider}/test`, undefined, { timeout: 130_000 });
  return response.data.data;
}

export async function getSystemReadiness() {
  const response = await api.get<ApiEnvelope<SystemReadiness>>('/system/readiness');
  return response.data.data;
}

export async function getCurrentDetectionModel() {
  const response = await api.get<ApiEnvelope<DetectionModelManifest>>('/models/current');
  return response.data.data;
}

export async function predictThermalImage(image: File, confidence = 0.25) {
  const payload = new FormData();
  payload.append('image', image);
  payload.append('confidence', String(confidence));
  payload.append('iou', '0.70');
  const response = await api.post<ApiEnvelope<ThermalPrediction>>('/models/current/predict', payload, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000
  });
  return response.data.data;
}

export async function getRegisteredModels() {
  const response = await api.get<ApiEnvelope<{ models: RegisteredModel[]; count: number; policy: string }>>('/models');
  return response.data.data;
}

export async function predictCellImage(image: File) {
  const payload = new FormData();
  payload.append('image', image);
  const response = await api.post<ApiEnvelope<CellPrediction>>('/models/cell-anomaly/predict', payload, {
    headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000
  });
  return response.data.data;
}

export async function predictVisibleDefect(image: File, confidence = 0.25) {
  const payload = new FormData();
  payload.append('image', image);
  payload.append('confidence', String(confidence));
  payload.append('iou', '0.70');
  const response = await api.post<ApiEnvelope<ThermalPrediction>>('/models/visible-defect/predict', payload, {
    headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000
  });
  return response.data.data;
}

export async function predictPanelSegmentation(image: File, confidence = 0.25) {
  const payload = new FormData();
  payload.append('image', image);
  payload.append('confidence', String(confidence));
  payload.append('iou', '0.70');
  const response = await api.post<ApiEnvelope<PanelSegmentationPrediction>>('/models/panel-segmentation/predict', payload, {
    headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000
  });
  return response.data.data;
}

export async function predictPower(input: { ambientTemperature: number; irradiance: number; moduleTemperature: number; inclinationAngle: number; humidity: number; hour: number }) {
  const response = await api.post<ApiEnvelope<PowerPrediction>>('/models/power/predict', input);
  return response.data.data;
}

export async function predictGridFault(waveform: File) {
  const payload = new FormData();
  payload.append('waveform', waveform);
  const response = await api.post<ApiEnvelope<GridFaultPrediction>>('/models/grid-fault/predict', payload, {
    headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000
  });
  return response.data.data;
}

export async function getFlightQuality(missionId: string) {
  const response = await api.get<ApiEnvelope<FlightQualityProfile>>(`/missions/${missionId}/quality-gate`);
  return response.data.data;
}

export async function evaluateEvidence(input: EvidenceEvaluationInput) {
  const response = await api.post<ApiEnvelope<EvidenceEvaluation>>('/analysis/evaluate', input);
  return response.data.data;
}

export async function createMission(draft: { name: string; site: string; aircraft: string; payload: string }) {
  const response = await api.post<ApiEnvelope<{ id: string; status: string }>>('/missions', draft);
  return response.data.data;
}

export async function reviewAnomaly(anomalyId: string, status: string, reason?: string) {
  const response = await api.patch<ApiEnvelope<{ id: string; status: string }>>(`/anomalies/${anomalyId}`, undefined, { params: { status, reason } });
  return response.data.data;
}

export interface WorkOrderDraft {
  anomalyId?: string;
  title: string;
  owner: string;
  priority: string;
  dueAt?: string;
  reviewer?: string;
  requirements?: string;
  initialStatus?: '待排程' | '已派发';
}

export async function createWorkOrder(draft: WorkOrderDraft) {
  const response = await api.post<ApiEnvelope<{ id: string; status: string }>>('/work-orders', {
    anomaly_id: draft.anomalyId,
    title: draft.title,
    owner: draft.owner,
    priority: draft.priority,
    due_at: draft.dueAt,
    reviewer: draft.reviewer,
    requirements: draft.requirements,
    initial_status: draft.initialStatus
  });
  return response.data.data;
}

export type WorkOrderStatus = '待排程' | '已派发' | '处理中' | '待验收' | '已关闭' | '已取消';
export interface ServerWorkOrder {
  id: string; anomalyId: string | null; title: string; owner: string; reviewer: string;
  priority: string; status: WorkOrderStatus; dueAt: string | null; createdAt: string;
  resolution: string; requirements: string; notes: string; revision: number;
  checklist: { id: string; label: string; done: boolean }[];
  liveObservationId?: string;
  history?: { action: string; detail: string; createdAt: string; actorId: string }[];
}
export interface ServerAnomaly {
  id: string; missionId: string; type: string; severity: string; array: string; module: string;
  deltaT: number; confidence: number; alignment: number; status: string; detectedAt: string;
}
export async function getAnomalies() {
  return (await api.get<ApiEnvelope<ServerAnomaly[]>>('/anomalies')).data.data;
}
export async function getWorkOrders() {
  return (await api.get<ApiEnvelope<ServerWorkOrder[]>>('/work-orders')).data.data;
}
export async function getWorkOrder(id: string) {
  return (await api.get<ApiEnvelope<ServerWorkOrder>>(`/work-orders/${encodeURIComponent(id)}`)).data.data;
}
export async function updateWorkOrder(order: ServerWorkOrder, status?: WorkOrderStatus) {
  return (await api.patch<ApiEnvelope<ServerWorkOrder>>(`/work-orders/${encodeURIComponent(order.id)}`, {
    expected_revision: order.revision, status, reviewer: order.reviewer,
    notes: order.notes, checklist: order.checklist, resolution: order.resolution.trim() || undefined
  })).data.data;
}
