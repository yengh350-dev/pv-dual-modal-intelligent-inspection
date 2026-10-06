export type NoticeTone = 'success' | 'info' | 'warning' | 'error';

export interface NoticePayload {
  id: string;
  message: string;
  detail?: string;
  tone: NoticeTone;
}

const NOTICE_EVENT = 'sentinel:notice';

export function notify(message: string, detail?: string, tone: NoticeTone = 'success') {
  const payload: NoticePayload = { id: crypto.randomUUID(), message, detail, tone };
  window.dispatchEvent(new CustomEvent<NoticePayload>(NOTICE_EVENT, { detail: payload }));
}

export function subscribeNotices(listener: (notice: NoticePayload) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<NoticePayload>).detail);
  window.addEventListener(NOTICE_EVENT, handler);
  return () => window.removeEventListener(NOTICE_EVENT, handler);
}

export function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  notify('文件已生成', filename, 'success');
}

export function downloadJson(filename: string, value: unknown) {
  downloadText(filename, JSON.stringify(value, null, 2), 'application/json;charset=utf-8');
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${csv}`, 'text/csv;charset=utf-8');
}
