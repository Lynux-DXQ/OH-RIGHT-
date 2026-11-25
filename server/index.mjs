import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { store } = await import('./store.mjs');
const { parseIntent, formatWhen } = await import('./nlu.mjs');
const { chatJson, llmEnabled, sttEnabled, transcribe } = await import('./llm.mjs');
const { nextEvent } = await import('./calendar.mjs');
const { demoThreads, summarise, draftReply } = await import('./replies.mjs');
const { telegramEnabled, recentThreads, markRead, sendTelegram, startPolling } = await import('./telegram.mjs');

const PORT = Number(process.env.PORT || 8787);
const MAX_ATTEMPTS = 5;
const demoState = demoThreads();
const sentIds = new Map();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function allThreads() {
  return telegramEnabled() ? recentThreads() : demoState.filter((t) => t.messages.length);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const readJson = async (req) => {
  const buf = await readBody(req, 100_000);
  let body;
  try { body = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw new HttpError(400, 'Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object');
  return body;
};

const clientTime = (body) => ({
  now: Number.isFinite(body.now) && Math.abs(body.now - Date.now()) < 86400000 * 2 ? body.now : Date.now(),
  offsetMin: Number.isFinite(body.offsetMin) ? Math.max(-840, Math.min(840, body.offsetMin)) : 0,
});

async function llmIntent(text, now, offsetMin) {
  const out = await chatJson(
    'Classify a spoken command for a glasses assistant. Reply as JSON: {"type":"reminder"|"next"|"reply"|"unknown","title":string,"whenISO":string|null}. "reminder" = save a task/reminder (title is short imperative, whenISO is a UTC ISO time in the future or null). "next" = asks about next meeting or schedule. "reply" = wants to read or answer messages. Current UTC time: ' + new Date(now).toISOString() + ', user UTC offset minutes: ' + offsetMin + '.',
    text.slice(0, 400),
  );
  if (!out) return null;
  if (out.type === 'next' || out.type === 'reply') return { type: out.type };
  if (out.type === 'reminder' && out.title) {
    const ms = out.whenISO && Date.parse(out.whenISO) > now ? Date.parse(out.whenISO) : now + 3600000;
    return { type: 'reminder', reminder: { title: String(out.title).slice(0, 120), whenISO: new Date(ms).toISOString(), whenLabel: formatWhen(ms, now, offsetMin) + (out.whenISO ? '' : ' (default)') } };
  }
  return null;
}

const routes = {
  'GET /api/health': async () => ({ ok: true, telegram: telegramEnabled(), llm: llmEnabled(), stt: sttEnabled(), calendar: Boolean(process.env.ICS_URL), demo: !telegramEnabled() }),

  'POST /api/stt': async (req) => {
    if (!sttEnabled()) throw new HttpError(501, 'Voice is not set up on the server. Type your command in the phone app instead.');
    const wav = await readBody(req, 3_000_000);
    if (wav.length < 2000) throw new HttpError(400, 'Recording too short');
    return { text: (await transcribe(wav)) || '' };
  },

  'POST /api/parse': async (req) => {
    const body = await readJson(req);
    const { now, offsetMin } = clientTime(body);
    const text = String(body.text || '').slice(0, 400);
    let intent = parseIntent(text, { now, offsetMin });
    if (intent.type === 'unknown' && text.trim() && llmEnabled()) {
      try { intent = (await llmIntent(text, now, offsetMin)) || intent; } catch (err) { console.error('[llm intent]', err.message); }
    }
    return { intent, text };
  },

  'POST /api/reminders': async (req) => {
    const body = await readJson(req);
    const dueAt = Date.parse(body.whenISO);
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title || !Number.isFinite(dueAt)) throw new HttpError(400, 'title and whenISO are required');
    const id = String(body.id || randomUUID());
    const existing = store.data.reminders.find((r) => r.id === id);
    if (existing) {
      if (existing.title !== title || existing.dueAt !== dueAt) throw new HttpError(409, 'That reminder id is already used');
      return { id, scheduled: true, duplicate: true };
    }
    if (store.data.reminders.filter((r) => !r.delivered && !r.failed).length >= 200) throw new HttpError(429, 'Too many pending reminders');
    store.data.reminders.push({ id, title, dueAt, attempts: 0, delivered: false, failed: false });
    store.data.reminders = store.data.reminders.filter((r) => !(r.delivered || r.failed) || Date.now() - r.dueAt < 7 * 86400000).slice(-500);
    store.save();
    return { id, scheduled: true, delivery: telegramEnabled() ? (store.data.ownerChatId ? 'telegram' : 'pending-pairing') : 'demo' };
  },

  'GET /api/reminders': async () => ({ reminders: store.data.reminders.slice(-50) }),

  'POST /api/next': async (req) => {
    const { now, offsetMin } = clientTime(await readJson(req));
    return nextEvent(now, offsetMin);
  },

  'POST /api/threads': async () => {
    const list = allThreads().slice(0, 6);
    const items = await Promise.all(list.map(async (t) => ({ id: t.id, name: t.name.slice(0, 28), unread: t.unread, summary: await summarise(t) })));
    return { threads: items, demo: !telegramEnabled() };
  },

  'POST /api/draft': async (req) => {
    const body = await readJson(req);
    const t = allThreads().find((x) => x.id === String(body.threadId));
    if (!t) throw new HttpError(404, 'That conversation is no longer available');
    const out = await draftReply(t, body.instruction, body.previousDraft);
    return { threadId: t.id, name: t.name.slice(0, 28), summary: out.summary, text: out.text };
  },

  'POST /api/send': async (req) => {
    const body = await readJson(req);
    if (body.confirmed !== true) throw new HttpError(400, 'Sending requires explicit confirmation');
    const text = String(body.text || '').trim();
    if (!text || text.length > 1000) throw new HttpError(400, 'Message text is empty or too long');
    const sendId = body.id ? String(body.id) : '';
    if (sendId && sentIds.has(sendId)) return sentIds.get(sendId);
    const t = allThreads().find((x) => x.id === String(body.threadId));
    if (!t) throw new HttpError(404, 'That conversation is no longer available');
    const job = (async () => {
      await sendTelegram(t.id, text);
      if (telegramEnabled()) markRead(t.id);
      else {
        const demo = demoState.find((x) => x.id === t.id);
        if (demo) demo.messages = [];
      }
      return { sent: true, name: t.name };
    })();
    if (sendId) {
      sentIds.set(sendId, job);
      if (sentIds.size > 200) sentIds.delete(sentIds.keys().next().value);
      job.catch(() => sentIds.delete(sendId));
    }
    return job;
  },
};

const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o);

const tokenOk = (given) => {
  const want = Buffer.from(process.env.APP_TOKEN || '');
  const got = Buffer.from(String(given || ''));
  return want.length === got.length && timingSafeEqual(want, got);
};

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const protectedByToken = Boolean(process.env.APP_TOKEN);
  if (origin && (protectedByToken || isLocalOrigin(origin))) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'content-type,x-app-token');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  } else if (origin) {
    return send(403, { error: 'Origin not allowed. Set APP_TOKEN to use the backend from other sites.' });
  }
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  const path = (req.url || '').split('?')[0];
  if (protectedByToken && path !== '/api/health' && !tokenOk(req.headers['x-app-token'])) return send(401, { error: 'Bad or missing app token' });
  const handler = routes[req.method + ' ' + path];
  if (!handler) return send(404, { error: 'Not found' });

  try {
    send(200, await handler(req));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502;
    if (!(err instanceof HttpError)) console.error('[' + path + ']', err);
    send(status, { error: err instanceof HttpError ? err.message : 'Upstream service failed: ' + err.message });
  }
});

let delivering = false;

async function deliverDue() {
  if (delivering) return;
  delivering = true;
  try {
    await deliverBatch();
  } finally {
    delivering = false;
  }
}

async function deliverBatch() {
  const now = Date.now();
  for (const r of store.data.reminders) {
    if (r.delivered || r.failed || r.dueAt > now) continue;
    const chat = store.data.ownerChatId || (telegramEnabled() ? null : 'demo');
    if (!chat) continue;
    try {
      await sendTelegram(chat, 'Reminder: ' + r.title);
      r.delivered = true;
    } catch (err) {
      r.attempts += 1;
      r.dueAt = now + 15000 * r.attempts;
      if (r.attempts >= MAX_ATTEMPTS) r.failed = true;
      console.error('[reminder]', err.message);
    }
    store.save();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  setInterval(() => deliverDue().catch((e) => console.error(e)), 5000).unref();
  const host = process.env.HOST || (process.env.APP_TOKEN ? '0.0.0.0' : '127.0.0.1');
  if (!process.env.APP_TOKEN && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.error('Refusing to listen on ' + host + ' without APP_TOKEN. Set APP_TOKEN in .env first.');
    process.exit(1);
  }
  server.listen(PORT, host, () => {
    console.log('OH, RIGHT! backend on http://' + host + ':' + PORT + (telegramEnabled() ? '' : '  (DEMO mode: no TELEGRAM_BOT_TOKEN)'));
    startPolling();
  });
}

export { server, deliverDue };
