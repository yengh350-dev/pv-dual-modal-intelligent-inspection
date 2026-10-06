import { api, type ApiEnvelope, type ThermalPrediction } from './api';

export type LiveModality = 'RGB' | 'THERMAL';
export type SourceKind = 'recording' | 'hls';
export type LivePrediction = Omit<ThermalPrediction, 'modality'> & { modality: string };
export interface Observation {
  id: string; missionId: string; sourceKind: SourceKind; sourceName: string;
  modality: LiveModality; mediaTime: number; capturedAt: string; createdAt: string;
  count: number; modelId: string; workOrderId: string | null; imageHash: string;
  prediction?: LivePrediction; imageData?: string;
}
export interface LiveMission { id: string; name: string; site: string; aircraft: string }
export async function getLiveMissions() {
  return (await api.get<ApiEnvelope<LiveMission[]>>('/missions?page_size=100')).data.data;
}
export async function getObservations(missionId: string) {
  return (await api.get<ApiEnvelope<Observation[]>>('/live/observations', { params: { mission_id: missionId } })).data.data;
}
export async function getObservation(id: string) {
  return (await api.get<ApiEnvelope<Observation>>('/live/observations/' + id)).data.data;
}
export async function analyzeFrame(image: Blob, modality: LiveModality, confidence: number, signal: AbortSignal) {
  const data = new FormData(); data.append('image', image, 'frame.jpg');
  data.append('confidence', String(confidence)); data.append('modality', modality);
  return (await api.post<ApiEnvelope<LivePrediction>>(
    '/analysis/preview', data,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000, signal })).data.data;
}
export async function saveObservation(image: Blob, metadata: { missionId: string; kind: SourceKind; name: string; modality: LiveModality; mediaTime: number; capturedAt: string; confidence: number }) {
  const data = new FormData();
  data.append('image', image, 'frame.jpg');
  Object.entries({ mission_id: metadata.missionId, source_kind: metadata.kind, source_name: metadata.name,
    modality: metadata.modality, media_time: metadata.mediaTime, captured_at: metadata.capturedAt,
    confidence: metadata.confidence }).forEach(([key,value]) => data.append(key, String(value)));
  return (await api.post<ApiEnvelope<Observation>>('/live/observations', data,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000 })).data.data;
}
export async function dispatchObservation(id: string, payload: { detection_index: number; location: string; review_note: string; owner: string; reviewer: string; due_at: string; priority: string }) {
  return (await api.post<ApiEnvelope<{ id: string; existing: boolean }>>('/live/observations/' + id + '/dispatch', payload)).data.data;
}
