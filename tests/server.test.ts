import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

let base = '';
let server: import('node:http').Server;
let deliverDue: () => Promise<void>;

beforeAll(async () => {
  process.env.STORE_FILE = join(mkdtempSync(join(tmpdir(), 'ohright-')), 'store.json');
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.LLM_API_KEY;
  delete process.env.STT_API_KEY;
  delete process.env.ICS_URL;
  delete process.env.APP_TOKEN;
  // @ts-expect-error plain JS module
  const mod = await import('../server/index.mjs');
  server = mod.server;
  deliverDue = mod.deliverDue;
  await new Promise<void>((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('backend in demo mode', () => {
  it('health reports demo', async () => {
    expect(await (await fetch(base + '/api/health')).json()).toMatchObject({ ok: true, demo: true, llm: false });
  });

  it('parses a reminder, schedules it once and delivers it when due', async () => {
    const parsed = await (await post('/api/parse', { text: 'remind me to get milk in 1 minute', now: Date.now(), offsetMin: 60 })).json();
    expect(parsed.intent.type).toBe('reminder');
    const id = 'test-reminder-1';
    const body = { ...parsed.intent.reminder, whenISO: new Date(Date.now() - 1000).toISOString(), id };
    expect((await (await post('/api/reminders', body)).json()).scheduled).toBe(true);
    expect((await (await post('/api/reminders', body)).json()).duplicate).toBe(true);
    await deliverDue();
    const list = (await (await fetch(base + '/api/reminders')).json()).reminders;
    expect(list.filter((r: { id: string }) => r.id === id)).toHaveLength(1);
    expect(list.find((r: { id: string }) => r.id === id).delivered).toBe(true);
  });

  it('rejects malformed reminders', async () => {
    expect((await post('/api/reminders', { title: '', whenISO: 'nope' })).status).toBe(400);
  });

  it('returns a prep card', async () => {
    const out = await (await post('/api/next', { now: Date.now(), offsetMin: 60 })).json();
    expect(out.event.title).toBeTruthy();
    expect(out.event.prep).toBeTruthy();
  });

  it('parallel sends with one id reach Telegram once', async () => {
    const { threads } = await (await post('/api/threads', {})).json();
    const target = threads.find((x: { name: string }) => x.name === 'Dev group');
    const body = { threadId: target.id, text: 'hello parallel', id: 'parallel-1', confirmed: true };
    const [a, b] = await Promise.all([post('/api/send', body), post('/api/send', body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const outbox = JSON.parse(readFileSync(process.env.STORE_FILE!, 'utf8')).outbox.filter((m: { text: string }) => m.text === 'hello parallel');
    expect(outbox).toHaveLength(1);
  });

  it('lists chats, drafts, refuses unconfirmed sends and dedupes confirmed ones', async () => {
    const { threads } = await (await post('/api/threads', {})).json();
    expect(threads.length).toBeGreaterThan(0);
    const t = threads[0];
    const d = await (await post('/api/draft', { threadId: t.id })).json();
    expect(d.text.length).toBeGreaterThan(0);
    const edited = await (await post('/api/draft', { threadId: t.id, instruction: 'say I will be 10 minutes late', previousDraft: d.text })).json();
    expect(edited.text).toBe('I will be 10 minutes late');
    expect((await post('/api/send', { threadId: t.id, text: d.text })).status).toBe(400);
    const ok = await (await post('/api/send', { threadId: t.id, text: d.text, id: 's1', confirmed: true })).json();
    expect(ok.sent).toBe(true);
    const again = await (await post('/api/send', { threadId: t.id, text: d.text, id: 's1', confirmed: true })).json();
    expect(again.sent).toBe(true);
    expect((await post('/api/send', { threadId: 'nope', text: 'x', confirmed: true })).status).toBe(404);
  });

  it('rejects foreign browser origins and non-object bodies', async () => {
    const foreign = await fetch(base + '/api/threads', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    expect(foreign.status).toBe(403);
    const local = await fetch(base + '/api/health', { headers: { origin: 'http://localhost:5173' } });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect((await post('/api/next', null)).status).toBe(400);
    expect((await post('/api/parse', { text: 'what is next', now: 1e300 })).status).toBe(200);
  });

  it('refuses a reminder id reused with a different payload', async () => {
    const when = new Date(Date.now() + 3600000).toISOString();
    expect((await post('/api/reminders', { id: 'reuse', title: 'A', whenISO: when })).status).toBe(200);
    expect((await post('/api/reminders', { id: 'reuse', title: 'B', whenISO: when })).status).toBe(409);
  });

  it('overlapping delivery runs send a reminder once', async () => {
    await post('/api/reminders', { id: 'overlap-1', title: 'Overlap check', whenISO: new Date(Date.now() - 500).toISOString() });
    await Promise.all([deliverDue(), deliverDue(), deliverDue()]);
    const outbox = JSON.parse(readFileSync(process.env.STORE_FILE!, 'utf8')).outbox.filter((m: { text: string }) => m.text === 'Reminder: Overlap check');
    expect(outbox).toHaveLength(1);
  });

  it('stt is cleanly unavailable without a key', async () => {
    const res = await fetch(base + '/api/stt', { method: 'POST', body: new Uint8Array(5000) });
    expect(res.status).toBe(501);
  });
});

describe('push alert feed', () => {
  it('is empty in demo mode and reports only new unread messages when Telegram is on', async () => {
    expect(await (await post('/api/alerts', { since: 0 })).json()).toEqual({ alerts: [] });
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    try {
      // @ts-expect-error plain JS module
      const { _ingestForTests } = await import('../server/telegram.mjs');
      const at = Date.now();
      _ingestForTests({ chat: { id: -900, type: 'group', title: 'Alert group' }, from: { first_name: 'Ada' }, text: 'Can you confirm the time?', date: at / 1000 });
      const first = await (await post('/api/alerts', { since: at - 1000 })).json();
      expect(first.alerts).toHaveLength(1);
      expect(first.alerts[0]).toMatchObject({ threadId: '-900', name: 'Alert group', from: 'Ada', text: 'Can you confirm the time?' });
      expect((await (await post('/api/alerts', { since: first.alerts[0].at })).json()).alerts).toEqual([]);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  });
});
