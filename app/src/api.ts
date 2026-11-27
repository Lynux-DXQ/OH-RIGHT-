import type { Alert, Booking, Brief, Draft, EventCard, Intent, Reminder, Thread } from './machine';

const KEY = 'ohright.api';
const TOKEN_KEY = 'ohright.token';

export const apiBase = (): string => (localStorage.getItem(KEY) ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
export const setApiBase = (v: string) => (v ? localStorage.setItem(KEY, v.trim()) : localStorage.removeItem(KEY));
export const apiToken = (): string => localStorage.getItem(TOKEN_KEY) ?? (import.meta.env.VITE_APP_TOKEN as string | undefined) ?? '';
export const setApiToken = (v: string) => (v ? localStorage.setItem(TOKEN_KEY, v.trim()) : localStorage.removeItem(TOKEN_KEY));

const clock = () => ({ now: Date.now(), offsetMin: -new Date().getTimezoneOffset() });

async function call<T>(path: string, body?: unknown, raw?: Uint8Array, timeoutMs = 25000): Promise<T> {
  const headers: Record<string, string> = {};
  const token = apiToken();
  if (token) headers['x-app-token'] = token;
  let init: RequestInit;
  if (raw) {
    headers['content-type'] = 'audio/wav';
    init = { method: 'POST', headers, body: raw as BodyInit };
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init = { method: 'POST', headers, body: JSON.stringify(body) };
  } else {
    init = { headers };
  }
  let res: Response;
  try {
    res = await fetch(apiBase() + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error('Cannot reach the OH, RIGHT! server. Check the connection.');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || 'Server error ' + res.status);
  return json as T;
}

export const api = {
  health: () => call<{ ok: boolean; telegram: boolean; llm: boolean; stt: boolean; calendar: boolean; demo: boolean }>('/api/health', undefined, undefined, 5000),
  stt: (wav: Uint8Array) => call<{ text: string }>('/api/stt', undefined, wav),
  parse: (text: string) => call<{ intent: Intent }>('/api/parse', { text, ...clock() }),
  saveReminder: (r: Reminder, id: string) => call<{ scheduled: boolean }>('/api/reminders', { ...r, id }),
  next: () => call<{ event: EventCard | null }>('/api/next', clock()),
  threads: () => call<{ threads: Thread[] }>('/api/threads', {}),
  alerts: (since: number) => call<{ alerts: (Alert & { at: number })[]; unread: number }>('/api/alerts', { since }, undefined, 8000),
  snooze: (id: string, minutes: number) => call<{ snoozed: boolean }>('/api/snooze', { id, minutes }),
  draft: (threadId: string, instruction?: string, previousDraft?: string) => call<Draft>('/api/draft', { threadId, instruction, previousDraft }),
  ask: (question: string) => call<Brief>('/api/ask', { question }),
  research: () => call<Brief>('/api/research', clock()),
  saveBooking: (b: Booking, id: string) => call<{ id: string; reserved: boolean }>('/api/bookings', { ...b, id }),
  send: (threadId: string, text: string, id: string) => call<{ sent: boolean; name: string }>('/api/send', { threadId, text, id, confirmed: true }),
};
