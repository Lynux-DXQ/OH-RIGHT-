import { store } from './store.mjs';

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const TTL_MS = 60 * 60 * 1000;
const allowed = () => new Set((process.env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));

const threads = new Map();
let offset = 0;
let running = false;

export const telegramEnabled = () => Boolean(TOKEN());

async function api(method, body, timeoutMs = 15000) {
  const res = await fetch('https://api.telegram.org/bot' + TOKEN() + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error('Telegram: ' + (json.description || res.status));
  return json.result;
}

export async function sendTelegram(chatId, text) {
  if (!telegramEnabled()) {
    store.data.outbox.push({ at: new Date().toISOString(), chatId, text, demo: true });
    store.data.outbox = store.data.outbox.slice(-50);
    store.save();
    console.log('[demo telegram -> ' + chatId + '] ' + text.length + ' characters');
    return { demo: true };
  }
  await api('sendMessage', { chat_id: chatId, text: text.slice(0, 4000) });
  return { demo: false };
}

function ingest(msg) {
  if (!msg?.chat || typeof msg.text !== 'string') {
    if (msg?.chat) console.log('[telegram] ignored a non-text message from chat ' + msg.chat.id);
    return;
  }
  const chatId = String(msg.chat.id);
  const owner = store.data.ownerChatId;

  if (msg.chat.type === 'private' && /^\/start\b/.test(msg.text)) {
    if (owner && owner !== chatId) {
      sendTelegram(chatId, 'This bot is already paired.').catch(() => {});
      return;
    }
    const needed = process.env.APP_TOKEN;
    const given = msg.text.split(/\s+/)[1] || '';
    if (needed && given !== needed) {
      sendTelegram(chatId, 'Send /start followed by your app token to pair this bot.').catch(() => {});
      return;
    }
    store.data.ownerChatId = chatId;
    store.save();
    sendTelegram(chatId, 'OH, RIGHT! is paired. Reminders you confirm on your glasses will arrive here.').catch(() => {});
    return;
  }

  if (chatId === owner) {
    console.log('[telegram] message from the owner chat ignored (owner messages are never replied-to threads)');
    return;
  }
  const filter = allowed();
  if (filter.size && !filter.has(chatId)) {
    console.log('[telegram] chat ' + chatId + ' is not in ALLOWED_CHAT_IDS');
    return;
  }

  const name = msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || msg.chat.username || 'Chat ' + chatId;
  const from = msg.from ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || msg.from.username || 'Someone' : 'Someone';
  const t = threads.get(chatId) || { id: chatId, name, messages: [], unread: 0 };
  t.name = name;
  t.messages.push({ from, text: msg.text.slice(0, 600), at: (msg.date || Date.now() / 1000) * 1000 });
  t.messages = t.messages.slice(-12);
  t.unread += 1;
  threads.set(chatId, t);
  console.log('[telegram] new message in chat ' + chatId + ' (' + t.messages.length + ' held)');
  if (threads.size > 50) threads.delete(recentThreads().at(-1).id);
}

export function recentThreads(now = Date.now()) {
  for (const [id, t] of threads) {
    t.messages = t.messages.filter((m) => now - m.at < TTL_MS);
    if (!t.messages.length) threads.delete(id);
  }
  return [...threads.values()].sort((a, b) => b.messages.at(-1).at - a.messages.at(-1).at);
}

export function markRead(chatId) {
  const t = threads.get(String(chatId));
  if (t) t.unread = 0;
}

export async function startPolling() {
  if (!telegramEnabled() || running) return;
  running = true;
  await api('deleteWebhook', {}).catch(() => {});
  while (running) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 35000);
      for (const u of updates) {
        offset = u.update_id + 1;
        ingest(u.message);
      }
    } catch (err) {
      console.error('[telegram] poll error:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export const _ingestForTests = ingest;
