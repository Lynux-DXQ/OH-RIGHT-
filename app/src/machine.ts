export type Purpose = 'any' | 'reminder' | 'editReminder' | 'editDraft';

export type Reminder = { title: string; whenISO: string; whenLabel: string };
export type EventCard = { title: string; whenLabel: string; startsInLabel: string; where: string; attendees: string; prep: string };
export type Thread = { id: string; name: string; unread: number; summary: string };
export type Draft = { threadId: string; name: string; summary: string; text: string; alts?: string[] };
export type Alert = { kind: 'message'; threadId: string; name: string; from: string; text: string } | { kind: 'reminder'; id: string; title: string };
export type Intent = { type: 'reminder'; reminder: Reminder } | { type: 'next' } | { type: 'reply' } | { type: 'unknown' };

export type Screen =
  | { t: 'home'; sel: number }
  | { t: 'prompt'; purpose: Purpose }
  | { t: 'listening'; purpose: Purpose; via: 'press' | 'click'; since: number; back: Screen }
  | { t: 'busy'; label: string; purpose: Purpose; back: Screen }
  | { t: 'reminder'; r: Reminder; sel: number }
  | { t: 'meeting'; ev: EventCard | null }
  | { t: 'threads'; items: Thread[]; idx: number }
  | { t: 'draft'; d: Draft; sel: number; items: Thread[] }
  | { t: 'alert'; a: Alert }
  | { t: 'done'; title: string; detail: string }
  | { t: 'error'; msg: string; retry: Effect | null; sel: number };

export type State = { screen: Screen; unread?: number };

export type Effect =
  | { e: 'rec:start' }
  | { e: 'rec:stop' }
  | { e: 'rec:cancel' }
  | { e: 'parse'; text: string }
  | { e: 'save'; r: Reminder }
  | { e: 'snooze'; id: string; minutes: number }
  | { e: 'fetchNext' }
  | { e: 'fetchThreads' }
  | { e: 'draft'; thread: Thread; instruction?: string; previous?: string; items: Thread[] }
  | { e: 'send'; d: Draft; items: Thread[] };

export type Input =
  | { k: 'click' | 'double' | 'up' | 'down' | 'press' | 'release'; at: number }
  | { k: 'list'; idx: number; at: number }
  | { k: 'transcript'; text: string; at: number }
  | { k: 'intent'; intent: Intent; at: number }
  | { k: 'event'; ev: EventCard | null }
  | { k: 'alert'; a: Alert }
  | { k: 'alertExpire' }
  | { k: 'unread'; n: number }
  | { k: 'threads'; items: Thread[] }
  | { k: 'drafted'; d: Draft; items: Thread[] }
  | { k: 'saved'; r: Reminder }
  | { k: 'sent'; name: string }
  | { k: 'timeout'; at: number }
  | { k: 'fail'; msg: string; retry: Effect | null };

export const HOME_ITEMS = ['Remember something', 'What is next?', 'Reply to a chat'];
const REMINDER_INTERRUPTIBLE = ['home', 'done', 'meeting', 'error', 'prompt'];
export const SNOOZE_MINUTES = 10;
export const REMINDER_OPTIONS = ['Save', 'Change', 'Cancel'];
export const draftOptions = (d: Draft) => (d.alts?.length ? ['Send', 'Change', 'Other reply', 'Cancel'] : ['Send', 'Change', 'Cancel']);

const TAP_GUARD_MS = 700;

export const initialState = (): State => ({ screen: { t: 'home', sel: 0 } });

const HOME: Screen = { t: 'home', sel: 0 };
const wrap = (i: number, n: number, d: number) => (i + d + n) % n;
type R = { state: State; effects: Effect[] };
const to = (screen: Screen, ...effects: Effect[]): R => ({ state: { screen }, effects });

function purposeFor(s: Screen): Purpose {
  if (s.t === 'prompt') return s.purpose;
  if (s.t === 'reminder') return 'editReminder';
  if (s.t === 'draft') return 'editDraft';
  return 'any';
}

export function reduce(state: State, input: Input): R {
  if (input.k === 'unread') return state.unread === input.n ? { state, effects: [] } : { state: { ...state, unread: input.n }, effects: [] };
  const r = step(state, input);
  if (r.state === state || state.unread === undefined) return r;
  return { state: { ...r.state, unread: state.unread }, effects: r.effects };
}

function step(state: State, input: Input): R {
  const s = state.screen;
  const stay: R = { state, effects: [] };

  if (input.k === 'fail') return to({ t: 'error', msg: input.msg, retry: input.retry, sel: 0 });
  if (input.k === 'alert') {
    const ok = input.a.kind === 'reminder' ? REMINDER_INTERRUPTIBLE.includes(s.t) : s.t === 'home';
    return ok ? to({ t: 'alert', a: input.a }) : stay;
  }
  if (input.k === 'alertExpire') return s.t === 'alert' ? to(HOME) : stay;

  if (s.t === 'busy') {
    switch (input.k) {
      case 'double': return s.label === 'Sending' || s.label === 'Scheduling' ? stay : to(HOME);
      case 'transcript': return stay;
      case 'intent': {
        const i = input.intent;
        if (i.type === 'reminder') return to({ t: 'reminder', r: i.reminder, sel: 0 });
        if (i.type === 'next') return to({ t: 'busy', label: 'Checking your calendar', purpose: 'any', back: HOME }, { e: 'fetchNext' });
        if (i.type === 'reply') return to({ t: 'busy', label: 'Reading your chats', purpose: 'any', back: HOME }, { e: 'fetchThreads' });
        return to({ t: 'error', msg: 'I did not catch that. Try saying: "remind me to call Sam at 5".', retry: null, sel: 0 });
      }
      case 'event': return to({ t: 'meeting', ev: input.ev });
      case 'threads':
        return input.items.length
          ? to({ t: 'threads', items: input.items, idx: 0 })
          : to({ t: 'done', title: 'All caught up', detail: 'No chats to reply to.' });
      case 'drafted': return to({ t: 'draft', d: input.d, sel: 0, items: input.items });
      case 'saved': return to({ t: 'done', title: 'Reminder set', detail: input.r.title + '\n' + input.r.whenLabel + '\nI will message you on Telegram.' });
      case 'sent': return to({ t: 'done', title: 'Sent', detail: 'Your reply to ' + input.name + ' was sent.' });
      default: return stay;
    }
  }

  if (input.k === 'intent' || input.k === 'event' || input.k === 'threads' || input.k === 'drafted' || input.k === 'saved' || input.k === 'sent' || input.k === 'transcript') return stay;

  if (input.k === 'timeout') return s.t === 'listening' ? to({ t: 'busy', label: 'Working on it', purpose: s.purpose, back: s.back }, { e: 'rec:stop' }) : stay;

  if (s.t === 'listening') {
    if (input.k === 'double') return to(s.back, { e: 'rec:cancel' });
    const stop = input.k === 'release' ? s.via === 'press' : input.k === 'click' && input.at - s.since > TAP_GUARD_MS;
    if (stop) return to({ t: 'busy', label: 'Working on it', purpose: s.purpose, back: s.back }, { e: 'rec:stop' });
    return stay;
  }

  if (input.k === 'release') return stay;

  if (input.k === 'press') return to({ t: 'listening', purpose: purposeFor(s), via: 'press', since: input.at, back: s }, { e: 'rec:start' });

  switch (s.t) {
    case 'home':
      if (input.k === 'list') {
        if (input.idx === 1) return to({ t: 'busy', label: 'Checking your calendar', purpose: 'any', back: HOME }, { e: 'fetchNext' });
        if (input.idx === 2) return to({ t: 'busy', label: 'Reading your chats', purpose: 'any', back: HOME }, { e: 'fetchThreads' });
        return to({ t: 'prompt', purpose: 'reminder' });
      }
      if (input.k === 'up') return to({ t: 'home', sel: wrap(s.sel, HOME_ITEMS.length, -1) });
      if (input.k === 'down') return to({ t: 'home', sel: wrap(s.sel, HOME_ITEMS.length, 1) });
      return stay;

    case 'prompt':
      if (input.k === 'click') return to({ t: 'listening', purpose: s.purpose, via: 'click', since: input.at, back: s }, { e: 'rec:start' });
      if (input.k === 'double') return to(HOME);
      return stay;

    case 'reminder':
      if (input.k === 'up' || input.k === 'down') return to({ ...s, sel: wrap(s.sel, REMINDER_OPTIONS.length, input.k === 'down' ? 1 : -1) });
      if (input.k === 'double') return to(HOME);
      if (input.k === 'click') {
        if (s.sel === 0) return to({ t: 'busy', label: 'Scheduling', purpose: 'any', back: HOME }, { e: 'save', r: s.r });
        if (s.sel === 1) return to({ t: 'listening', purpose: 'editReminder', via: 'click', since: input.at, back: s }, { e: 'rec:start' });
        return to(HOME);
      }
      return stay;

    case 'draft':
      if (input.k === 'up' || input.k === 'down') return to({ ...s, sel: wrap(s.sel, draftOptions(s.d).length, input.k === 'down' ? 1 : -1) });
      if (input.k === 'double') return to({ t: 'threads', items: s.items, idx: Math.max(0, s.items.findIndex((x) => x.id === s.d.threadId)) });
      if (input.k === 'click') {
        if (s.sel === 0) return to({ t: 'busy', label: 'Sending', purpose: 'any', back: HOME }, { e: 'send', d: s.d, items: s.items });
        if (s.sel === 1) return to({ t: 'listening', purpose: 'editDraft', via: 'click', since: input.at, back: s }, { e: 'rec:start' });
        if (s.sel === 2 && s.d.alts?.length) {
          const [next, ...rest] = s.d.alts;
          return to({ ...s, d: { ...s.d, text: next, alts: [...rest, s.d.text] } });
        }
        return to({ t: 'threads', items: s.items, idx: Math.max(0, s.items.findIndex((x) => x.id === s.d.threadId)) });
      }
      return stay;

    case 'threads':
      if (input.k === 'up' || input.k === 'down') return to({ ...s, idx: wrap(s.idx, s.items.length, input.k === 'down' ? 1 : -1) });
      if (input.k === 'double') return to(HOME);
      if (input.k === 'click') {
        const thread = s.items[s.idx];
        return to({ t: 'busy', label: 'Drafting a reply', purpose: 'any', back: HOME }, { e: 'draft', thread, items: s.items });
      }
      return stay;

    case 'alert':
      if (s.a.kind === 'reminder') {
        if (input.k === 'double') return to(HOME, { e: 'snooze', id: s.a.id, minutes: SNOOZE_MINUTES });
        if (input.k === 'click') return to(HOME);
        return stay;
      }
      if (input.k === 'double') return to(HOME);
      if (input.k === 'click') {
        const thread = { id: s.a.threadId, name: s.a.name, unread: 1, summary: '' };
        return to({ t: 'busy', label: 'Drafting a reply', purpose: 'any', back: HOME }, { e: 'draft', thread, items: [thread] });
      }
      return stay;

    case 'meeting':
    case 'done':
      if (input.k === 'click' || input.k === 'double') return to(HOME);
      return stay;

    case 'error':
      if (input.k === 'up' || input.k === 'down') return to({ ...s, sel: wrap(s.sel, 2, 1) });
      if (input.k === 'double') return to(HOME);
      if (input.k === 'click') {
        if (s.sel === 1) return to(HOME);
        if (s.retry) return to({ t: 'busy', label: 'Trying again', purpose: 'any', back: HOME }, s.retry);
        return to({ t: 'prompt', purpose: 'any' });
      }
      return stay;
  }
  return stay;
}

export function onTranscript(state: State, text: string): R {
  const s = state.screen;
  if (s.t !== 'busy') return { state, effects: [] };
  const clean = text.trim();
  if (!clean) return to({ t: 'error', msg: 'I did not hear anything. Hold or tap, then speak.', retry: null, sel: 0 });
  if (s.purpose === 'editDraft' && s.back.t === 'draft') {
    const { d, items } = s.back;
    const thread = items.find((x) => x.id === d.threadId);
    if (thread) return { state, effects: [{ e: 'draft', thread, instruction: clean, previous: d.text, items }] };
  }
  if (s.purpose === 'editReminder' && s.back.t === 'reminder' && !/remind/i.test(clean)) {
    const bit = clean.replace(/^(please\s+)?(make it|change (it )?to|set (it )?to|actually|move it to)\s+/i, '');
    const text = /^(at\s+)?\d|^(at|in|tomorrow|tonight|today|next|on|this)\b/i.test(bit) ? 'remind me to ' + s.back.r.title + ' ' + (/^\d/.test(bit) ? 'at ' : '') + bit : 'remind me to ' + bit + ' ' + s.back.r.whenLabel;
    return { state, effects: [{ e: 'parse', text }] };
  }
  return { state, effects: [{ e: 'parse', text: clean }] };
}

export function beginTyped(state: State): R {
  const s = state.screen;
  if (s.t === 'busy') return { state, effects: [] };
  const listening = s.t === 'listening';
  const screen: Screen = { t: 'busy', label: 'Working on it', purpose: listening ? s.purpose : purposeFor(s), back: listening ? s.back : s };
  return { state: { screen }, effects: listening ? [{ e: 'rec:cancel' }] : [] };
}
