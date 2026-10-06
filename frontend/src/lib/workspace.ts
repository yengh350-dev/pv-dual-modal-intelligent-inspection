import { api, type ApiEnvelope, type LoginResponse } from './api';

export type QueueKind = 'review' | 'dispatch' | 'orders' | 'acceptance' | 'overdue' | 'missions';
export interface WorkspaceItem {
  id: string; kind: 'anomaly' | 'order' | 'mission'; title: string;
  site: string | null; location: string; status: string; severity: string;
  owner: string | null; dueAt: string | null; overdue: boolean;
  createdAt: string | null; action: string; path: string;
}
export interface Workspace {
  checkedAt: string; environment: string; sites: string[];
  counts: Record<QueueKind, number>; items: WorkspaceItem[];
  page: number; pageSize: number; total: number;
  activity: { id: string; action: string; resourceId: string | null; resourceType: string; createdAt: string }[];
}
export interface SearchResult { id: string; kind: WorkspaceItem['kind']; title: string; status: string; path: string }
export async function getWorkspace(options: { site?: string; queue?: QueueKind; mine?: boolean; page?: number }, signal?: AbortSignal) {
  return (await api.get<ApiEnvelope<Workspace>>('/workspace', { params: options, signal })).data.data;
}
export async function searchWorkspace(q: string, signal?: AbortSignal) {
  return (await api.get<ApiEnvelope<SearchResult[]>>('/workspace/search', { params: { q, limit: 5 }, signal })).data.data;
}
export async function getIdentity() {
  return (await api.get<ApiEnvelope<LoginResponse['user']>>('/auth/me')).data.data;
}
export interface ServerMission {
  id: string; name: string; site: string; aircraft: string; payload: string;
  status: string; coverage: number; quality: number; frames: number; startedAt: string;
}
export async function getMissionList(options: { page: number; q?: string; status?: string }, signal?: AbortSignal) {
  return (await api.get<ApiEnvelope<ServerMission[]>>('/missions', { params: options, signal })).data;
}
export async function getMission(id: string) {
  return (await api.get<ApiEnvelope<ServerMission>>('/missions/' + encodeURIComponent(id))).data.data;
}
