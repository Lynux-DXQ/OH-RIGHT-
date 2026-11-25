import { store } from './store.mjs';
import { sttEnabled, transcribe } from './llm.mjs';

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const TTL_MS = 60 * 60 * 1000;
const allowed = () => new Set((process.env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));

const threads = new Map();
const lastNotified = new Map();
const NOTIFY_GAP_MS = 30 * 1000;
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

export const sendBody = (chatId, text, via, replyTo) => ({
  chat_id: chatId,
  text: String(text).slice(0, 4000),
  ...(via ? { business_connection_id: via } : {}),
  ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
});

export async function sendTelegram(chatId, text, via, replyTo) {
  if (!telegramEnabled()) {
    store.data.outbox.push({ at: new Date().toISOString(), chatId, text, demo: true });
    store.data.outbox = store.data.outbox.slice(-50);
    store.save();
    console.log('[demo telegram -> ' + chatId + '] ' + text.length + ' characters');
    return { demo: true };
  }
  await api('sendMessage', sendBody(chatId, text, via, replyTo));
  return { demo: false };
}

const HELP = [
  'OH, RIGHT! commands:',
  '/status - what is on and what is waiting',
  '/notify on|off - get a Telegram ping when a chat messages you (off by default)',
  '/mute 60 - pause pings for 60 minutes, /mute off to resume',
  '/reminders - your upcoming reminders',
  '/help - this list',
].join('\n');

function ownerCommand(chatId, text) {
  const [cmd, arg = ''] = text.trim().split(/\s+/);
  const s = store.data.settings;
  const say = (t) => sendTelegram(chatId, t).catch(() => {});
  const muted = () => s.muteUntil > Date.now();
  switch (cmd.split('@')[0].toLowerCase()) {
    case '/help':
      return say(HELP);
    case '/status': {
      const due = store.data.reminders.filter((r) => !r.delivered && !r.failed).length;
      return say([
        'Paired: yes',
        'Pings for new messages: ' + (s.notify ? (muted() ? 'on, muted for ' + Math.ceil((s.muteUntil - Date.now()) / 60000) + ' more min' : 'on') : 'off'),
        'Sending replies as: ' + (Object.keys(store.data.businessConnections).length ? 'you (Business mode)' : 'the bot'),
        'Chats waiting: ' + recentThreads().filter((t) => t.unread).length,
        'Reminders pending: ' + due,
      ].join('\n'));
    }
    case '/notify':
      if (!['on', 'off'].includes(arg.toLowerCase())) return say('Use /notify on or /notify off. Currently ' + (s.notify ? 'on' : 'off') + '.');
      s.notify = arg.toLowerCase() === 'on';
      store.save();
      return say(s.notify ? 'Pings are on. I will message you here when someone writes in a chat I can see. Use /mute 60 to pause.' : 'Pings are off. New messages still show on your glasses.');
    case '/mute': {
      if (arg.toLowerCase() === 'off') s.muteUntil = 0;
      else {
        const mins = Number(arg);
        if (!Number.isFinite(mins) || mins <= 0 || mins > 1440) return say('Use /mute 60 for an hour (up to 1440), or /mute off.');
        s.muteUntil = Date.now() + mins * 60000;
      }
      store.save();
      return say(s.muteUntil ? 'Muted for ' + Math.round((s.muteUntil - Date.now()) / 60000) + ' minutes.' : 'Unmuted.');
    }
    case '/reminders': {
      const list = store.data.reminders.filter((r) => !r.delivered && !r.failed).sort((a, b) => a.dueAt - b.dueAt).slice(0, 8);
      return say(list.length ? 'Upcoming:\n' + list.map((r) => '- ' + r.title + ' (' + new Date(r.dueAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC)').join('\n') : 'No reminders pending.');
    }
    default:
      return say('I did not recognise that. ' + HELP);
  }
}

function maybeNotify(t, from, text) {
  const s = store.data.settings;
  const owner = store.data.ownerChatId;
  if (!owner || !s.notify || s.muteUntil > Date.now()) return;
  const now = Date.now();
  if (now - (lastNotified.get(t.id) || 0) < NOTIFY_GAP_MS) return;
  lastNotified.set(t.id, now);
  sendTelegram(owner, '💬 ' + t.name.slice(0, 40) + '\n' + from.slice(0, 30) + ': ' + text.slice(0, 200) + '\n\nReply from your glasses, or /mute 60 to pause pings.').catch((err) => console.error('[telegram] ping failed:', err.message));
}

function ingestBusinessConnection(c) {
  if (!c?.id) return;
  const conns = store.data.businessConnections;
  const owner = store.data.ownerChatId;
  const userChatId = String(c.user_chat_id ?? c.user?.id ?? '');
  if (owner && userChatId !== owner) {
    console.log('[telegram] ignored a business connection from an account that is not the paired owner');
    return;
  }
  if (c.is_enabled === false) {
    delete conns[c.id];
    for (const [id, th] of threads) if (th.via === c.id) threads.delete(id);
  } else conns[c.id] = { userChatId, canReply: (c.rights?.can_reply ?? c.can_reply) !== false };
  store.save();
  if (owner) sendTelegram(owner, c.is_enabled === false ? 'Business mode disconnected. Replies will come from the bot again.' : 'Business mode connected. I can now see your chats and send replies as you, only when you tap Send on your glasses.').catch(() => {});
}

function ingest(msg) {
  if (!msg?.chat || typeof msg.text !== 'string') {
    if (msg?.chat) console.log('[telegram] ignored a non-text message from chat ' + msg.chat.id);
    return;
  }
  const chatId = String(msg.chat.id);
  const owner = store.data.ownerChatId;
  const via = msg.business_connection_id ? String(msg.business_connection_id) : '';
  if (via) {
    const conn = store.data.businessConnections[via];
    if (!conn) return;
    if (msg.from && String(msg.from.id) === conn.userChatId) {
      const mine = threads.get(chatId);
      if (mine) mine.unread = 0;
      return;
    }
  }

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

  if (!via && chatId === owner) {
    if (msg.chat.type === 'private' && msg.text.startsWith('/')) {
      ownerCommand(chatId, msg.text);
      return;
    }
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
  t.via = via;
  if (msg.message_id) t.replyTo = msg.message_id;
  t.messages.push({ from, text: msg.text.slice(0, 600), at: (msg.date || Date.now() / 1000) * 1000 });
  t.messages = t.messages.slice(-12);
  t.unread += 1;
  threads.set(chatId, t);
  console.log('[telegram] new message in chat ' + chatId + ' (' + t.messages.length + ' held)');
  maybeNotify(t, from, msg.text);
  if (threads.size > 50) threads.delete(recentThreads().at(-1).id);
}

export async function handleMessage(msg) {
  const media = msg?.voice || msg?.audio;
  if (!msg?.chat || typeof msg.text === 'string' || !media) return ingest(msg);
  let text = '[Voice note, not transcribed]';
  if (sttEnabled() && media.file_size <= 2_000_000 && (media.duration || 0) <= 90) {
    try {
      const file = await api('getFile', { file_id: media.file_id });
      const res = await fetch('https://api.telegram.org/file/bot' + TOKEN() + '/' + file.file_path, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('download ' + res.status);
      const heard = await transcribe(Buffer.from(await res.arrayBuffer()), { type: media.mime_type || 'audio/ogg', name: 'voice.ogg' });
      if (heard) text = '[Voice note] ' + heard;
    } catch (err) {
      console.error('[telegram] voice note failed:', err.message);
    }
  }
  ingest({ ...msg, text });
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
  await api('setMyCommands', { commands: [
    { command: 'status', description: 'What is on and what is waiting' },
    { command: 'notify', description: 'Ping me about new messages: on or off' },
    { command: 'mute', description: 'Pause pings, for example /mute 60' },
    { command: 'reminders', description: 'Upcoming reminders' },
    { command: 'help', description: 'Show the commands' },
  ] }).catch(() => {});
  while (running) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'business_connection', 'business_message'] }, 35000);
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.business_connection) ingestBusinessConnection(u.business_connection);
        await handleMessage(u.message || u.business_message);
      }
    } catch (err) {
      console.error('[telegram] poll error:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export const _ingestForTests = (m) => (m?.business_connection ? ingestBusinessConnection(m.business_connection) : ingest(m));
export const _handleForTests = handleMessage;
