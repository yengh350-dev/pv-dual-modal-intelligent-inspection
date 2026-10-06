import { api, type ApiEnvelope } from './api';
import type { LiveModality, LivePrediction, Observation } from './liveInspection';

export type TaskState = 'queued' | 'running' | 'cancel_requested' | 'cancelled' | 'succeeded' | 'failed';
export interface AnalysisTask {
  id: string; missionId: string; state: TaskState; attempts: number; paired: boolean;
  createdAt: string; startedAt: string | null; completedAt: string | null;
  observationId: string | null; error: string | null; observation?: Observation;
  config?: { profile: string; confidence: number; resolutionPolicy: string }; inputDigest?: string;
  result?: {
    schemaVersion: string; predictions: Record<string, LivePrediction>; failures: Record<string,string>;
    fusion: { state: string; reasons: string[]; matches: { rgbIndex:number; thermalIndex:number; spatialIoU:number }[]; unmatchedRgb?:number[]; unmatchedThermal?:number[]; captureSkewMs?:number|null; registrationRmsePx?:number|null };
    timing: { queueWaitMs: number | null; submissionToAttemptStartMs?:number; processingMs: number }; boundary: string;
    lineage: { frameId:string; modality:string; sha256:string; width:number; height:number; metadata: Record<string,unknown> }[];
  } | null;
}
export interface FrameMetadata {
  source_kind: 'recording' | 'hls' | 'upload'; source_name: string;
  timestamp_kind: 'device_capture' | 'browser_sample' | 'unknown';
  captured_at?: string; clock_id?: string; media_time?: number;
}
export async function submitAnalysis(input: { image:Blob; pairedImage?:File; missionId:string; modality:LiveModality; confidence:number; key:string; metadata?:FrameMetadata; pairedMetadata?:FrameMetadata; registration?:Record<string,unknown> }) {
  const body = new FormData(); body.append('image', input.image, 'evidence.png');
  if (input.pairedImage) body.append('paired_image', input.pairedImage);
  Object.entries({ mission_id:input.missionId, modality:input.modality, confidence:input.confidence, idempotency_key:input.key,
    metadata:JSON.stringify(input.metadata ?? {}), paired_metadata:JSON.stringify(input.pairedMetadata ?? {}), registration:JSON.stringify(input.registration ?? {}) })
    .forEach(([key,value]) => body.append(key,String(value)));
  return (await api.post<ApiEnvelope<AnalysisTask>>('/analysis/tasks',body,{headers:{'Content-Type':'multipart/form-data'},timeout:60_000})).data.data;
}
export async function listAnalysis(missionId?:string) {
  return (await api.get<ApiEnvelope<AnalysisTask[]>>('/analysis/tasks',{params:{mission_id:missionId || undefined}})).data.data;
}
export async function getAnalysis(id:string) {
  return (await api.get<ApiEnvelope<AnalysisTask>>('/analysis/tasks/'+id)).data.data;
}
export async function changeAnalysis(id:string, action:'cancel'|'retry') {
  return (await api.post<ApiEnvelope<AnalysisTask>>('/analysis/tasks/'+id+'/'+action)).data.data;
}
export async function exportAnalysis(id:string) {
  return (await api.get('/analysis/tasks/'+id+'/export')).data;
}
