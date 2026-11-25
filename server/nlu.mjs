const NUM = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, half:0.5 };
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const num = (s) => (s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : NUM[s]);

function wallOf(ms, offsetMin) {
  const d = new Date(ms + offsetMin * 60000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
const fromWall = (y, mo, d, h, mi, offsetMin) => Date.UTC(y, mo, d, h, mi) - offsetMin * 60000;

export function formatWhen(ms, now, offsetMin) {
  const w = wallOf(ms, offsetMin);
  const n = wallOf(now, offsetMin);
  const dayDiff = Math.round((Date.UTC(w.y, w.mo, w.d) - Date.UTC(n.y, n.mo, n.d)) / 86400000);
  const h12 = w.h % 12 === 0 ? 12 : w.h % 12;
  const time = h12 + ':' + String(w.mi).padStart(2, '0') + ' ' + (w.h < 12 ? 'AM' : 'PM');
  if (dayDiff === 0) return 'Today ' + time;
  if (dayDiff === 1) return 'Tomorrow ' + time;
  if (dayDiff > 1 && dayDiff < 7) return DAY_NAMES[w.dow] + ' ' + time;
  return DAY_NAMES[w.dow] + ' ' + w.d + '/' + (w.mo + 1) + ' ' + time;
}

export function formatIn(ms, now) {
  const mins = Math.round((ms - now) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return 'in ' + mins + ' min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return 'in ' + h + 'h' + (m ? ' ' + m + 'm' : '');
}

const WEEKDAYS = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
const dayWordRe = '(today|tonight|tomorrow(?: (?:morning|afternoon|evening|night))?|this morning|this afternoon|this evening|(?:next |on )?(?:' + WEEKDAYS + '))';
const HW = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const hourRe = '(\\d{1,2}|' + HW + ')';
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const NUMRE = '\\d+(?:\\.\\d+)?|(?:twenty|thirty|forty|fifty)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|an?|' + HW + '|half an?';

function numberOf(token) {
  const t = token.toLowerCase().replace(/^half an?$/, 'half');
  if (/^\d/.test(t)) return Number(t);
  const [tens, unit] = t.split(/[ -]/);
  if (TENS[tens]) return TENS[tens] + (unit ? NUM[unit] : 0);
  return NUM[t];
}

export function normalizeSpoken(input) {
  const hourNum = (w) => (/^\d/.test(w) ? Number(w) : NUM[w.toLowerCase()]);
  return String(input)
    .replace(/,/g, ' ')
    .replace(/\btmrw\b/gi, 'tomorrow')
    .replace(/\bo['’]?\s?clock\b/gi, '')
    .replace(new RegExp('\\bhalf past (' + HW + '|\\d{1,2})\\b', 'gi'), (_, h) => hourNum(h) + ':30')
    .replace(new RegExp('\\bquarter past (' + HW + '|\\d{1,2})\\b', 'gi'), (_, h) => hourNum(h) + ':15')
    .replace(new RegExp('\\bquarter to (' + HW + '|\\d{1,2})\\b', 'gi'), (_, h) => ((hourNum(h) + 10) % 12 + 1) + ':45')
    .replace(new RegExp('\\b(at|by|around) (' + HW + '|\\d{1,2}) (thirty|fifteen|forty[ -]?five)\\b', 'gi'), (_, p, h, m) => p + ' ' + hourNum(h) + ':' + ({ thirty: '30', fifteen: '15' }[m.toLowerCase()] || '45'))
    .replace(/\b(at|by|around)\s+noon\b/gi, '$1 12 pm')
    .replace(/\b(at|by|around)\s+midnight\b/gi, '$1 12 am')
    .replace(new RegExp('(\\d{1,2}(?::\\d{2})?|' + HW + ')\\s+in the (morning|afternoon|evening)\\b', 'gi'), (_, t, p) => t + (p.toLowerCase() === 'morning' ? ' am' : ' pm'))
    .replace(new RegExp('(\\d{1,2}(?::\\d{2})?|' + HW + ')\\s+at night\\b', 'gi'), '$1 pm')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function clockAfterDays(rest, base, offsetMin) {
  const m = rest.match(/^\s*(?:at|by|around)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  if (h > 23 || mi > 59) return null;
  if (m[3] === 'pm' && h < 12) h += 12;
  else if (m[3] === 'am' && h === 12) h = 0;
  else if (!m[3] && h >= 1 && h <= 6) h += 12;
  return { ms: fromWall(base.y, base.mo, base.d, h, mi, offsetMin), span: m[0] };
}

export function parseWhen(input, now, offsetMin = 0) {
  const text = normalizeSpoken(input).toLowerCase();
  const n = wallOf(now, offsetMin);

  let m = text.match(new RegExp('\\b(?:in|after)\\s+(' + NUMRE + ')\\s*(?:hours?|hrs?)\\s*(?:and\\s+)?(?:(a half)|(' + NUMRE + ')\\s*(?:minutes?|mins?))\\b'));
  if (m) {
    const extra = m[2] ? 30 : numberOf(m[3]);
    return { ms: now + (numberOf(m[1]) * 60 + extra) * 60000, span: m[0] };
  }

  m = text.match(new RegExp('\\b(?:in|after)\\s+(' + NUMRE + ')\\s*(minutes?|mins?|hours?|hrs?|days?)\\b'));
  if (m) {
    const amount = numberOf(m[1]);
    const unit = m[2][0];
    if (unit === 'd') {
      const rest = text.slice(m.index + m[0].length);
      const base = wallOf(now + Math.round(amount * 86400000), offsetMin);
      const at = clockAfterDays(rest, base, offsetMin);
      if (at) return { ms: at.ms, span: m[0] + at.span };
    }
    return { ms: now + amount * (unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000), span: m[0] };
  }

  const clock = new RegExp('(?:\\b' + dayWordRe + '\\s+)?(?:\\b(?:at|by|around|@)\\s*)' + hourRe + '(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?(?!\\d)', 'i');
  const clock2 = new RegExp('(?:\\b' + dayWordRe + '\\s+)?\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?![a-z])', 'i');
  const clock3 = /\b(\d{1,2}):(\d{2})\b/;
  let dayWord;
  let hourRaw;
  let minRaw;
  let mer;
  let span;
  const c1 = text.match(clock);
  const c2 = text.match(clock2);
  const c3 = text.match(clock3);
  if (c1) { [span, dayWord, hourRaw, minRaw, mer] = c1; }
  else if (c2) { [span, dayWord, hourRaw, minRaw, mer] = c2; }
  else if (c3) { span = c3[0]; hourRaw = c3[1]; minRaw = c3[2]; }

  if (hourRaw !== undefined) {
    const h = numberOf(hourRaw);
    const mi = minRaw ? Number(minRaw) : 0;
    if (h === undefined || h > 24 || mi > 59) return null;
    if (!dayWord) {
      const after = text.slice(text.indexOf(span) + span.length);
      const dm = after.match(new RegExp('^\\s*' + dayWordRe));
      if (dm) { dayWord = dm[1]; span += dm[0]; }
    }
    const day = (dayWord || '').replace(/^(next|on) /, '');
    const meridiem = mer ? mer[0] : /evening|tonight|afternoon|night/.test(day) ? 'p' : /morning/.test(day) ? 'a' : '';
    const candidates = [];
    if (meridiem === 'p') candidates.push(h === 12 ? 12 : h + 12);
    else if (meridiem === 'a') candidates.push(h === 12 ? 0 : h);
    else if (h === 0 || h >= 13) candidates.push(h % 24);
    else if (h === 12) candidates.push(12);
    else candidates.push(h, h + 12);

    const baseDay = { y: n.y, mo: n.mo, d: n.d };
    const tomorrow = day.startsWith('tomorrow');
    const weekday = WEEKDAYS.split('|').includes(day);
    if (tomorrow) baseDay.d += 1;
    if (weekday) {
      let diff = (DAYS.indexOf(day) - n.dow + 7) % 7;
      if (diff === 0) diff = 7;
      baseDay.d += diff;
    }
    const futureDay = tomorrow || weekday;
    const at = (hh, plusDays = 0) => fromWall(baseDay.y, baseDay.mo, baseDay.d + plusDays, hh, mi, offsetMin);
    const hour = futureDay && candidates.length === 2 ? (h >= 7 ? h : h + 12) : candidates[0];
    let ms = at(hour);
    if (!futureDay && ms <= now) {
      const later = candidates.map((c) => at(c)).find((t) => t > now);
      ms = later ?? at(candidates[0], 1);
    }
    return { ms, span };
  }

  const words = [
    [/\b(tonight)\b/, 20, 0, 0], [/\b(this evening)\b/, 18, 0, 0], [/\b(this afternoon)\b/, 15, 0, 0],
    [/\b(this morning)\b/, 9, 0, 0], [/\b(tomorrow morning)\b/, 9, 0, 1], [/\b(tomorrow (?:evening|night))\b/, 19, 0, 1],
    [/\b(tomorrow afternoon)\b/, 15, 0, 1], [/\b(tomorrow)\b/, 9, 0, 1], [/\b(noon|midday)\b/, 12, 0, 0], [/\b(midnight)\b/, 0, 0, 1],
    [/\b(end of day|eod)\b/, 17, 0, 0],
  ];
  for (const [re, h, mi, add] of words) {
    const wm = text.match(re);
    if (!wm) continue;
    let ms = fromWall(n.y, n.mo, n.d + add, h, mi, offsetMin);
    if (ms <= now) ms += 86400000;
    return { ms, span: wm[0] };
  }
  const dm = text.match(new RegExp('\\b(?:next |on )?(' + WEEKDAYS + ')\\b'));
  if (dm) {
    let diff = (DAYS.indexOf(dm[1]) - n.dow + 7) % 7;
    if (diff === 0) diff = 7;
    return { ms: fromWall(n.y, n.mo, n.d + diff, 9, 0, offsetMin), span: dm[0] };
  }
  return null;
}

const FILLER = "(?:(?:um+|uh+|so|okay|ok|hey|can you|could you|would you|please|oh right)\\s+)*";
const REMINDER_LEAD = new RegExp('^' + FILLER + "(?:remind me(?:\\s+(?:to|that|about|of))?|set (?:a )?reminder(?:\\s+(?:to|for|that))?|reminder(?:\\s+(?:to|for|that))?|don'?t (?:let me )?forget(?:\\s+(?:to|about))?|remember to|note to self(?:\\s+to)?|add (?:a )?(?:task|todo)(?:\\s+to)?|i need to|i have to|i must)\\s*", 'i');

export function parseIntent(input, { now = Date.now(), offsetMin = 0 } = {}) {
  if (!Number.isFinite(now) || Math.abs(now) > 8.64e15 / 2) now = Date.now();
  const raw = normalizeSpoken(String(input || '').trim());
  const text = raw.toLowerCase().replace(/[.!?]+$/g, '');
  if (!text) return { type: 'unknown' };

  const isReminder = REMINDER_LEAD.test(raw) || /\b(remind me|reminder|don'?t (?:let me )?forget)\b/.test(text);

  if (!isReminder && /\b(what'?s next|what is next|what do i have|next (?:meeting|event|call)|my schedule|prep me|brief me|am i ready|meeting prep|what'?s on)\b/.test(text)) return { type: 'next' };

  const when = parseWhen(raw, now, offsetMin);
  const startsWithTask = /^(get|buy|pick|call|email|send|pay|book|text|ring|check|bring|take|water|feed|submit|finish|schedule|renew|cancel)\b/.test(text);

  if (!isReminder && !when && /\b(reply|respond|messages?|chats?|inbox|telegram|who (?:texted|messaged)|catch me up|anything new)\b/.test(text)) return { type: 'reply' };
  if (!isReminder && !(when && (startsWithTask || text.split(' ').length > 2))) return { type: 'unknown' };

  let title = raw.replace(REMINDER_LEAD, '');
  if (when) {
    const idx = title.toLowerCase().indexOf(when.span);
    if (idx >= 0) title = (title.slice(0, idx) + ' ' + title.slice(idx + when.span.length)).replace(/\s+/g, ' ');
  }
  title = title.trim().replace(/\b(?:at|by|on|around|in|for)\s*$/i, '').trim().replace(/^(?:at\s+)?(?:to|that)\s+/i, '').replace(/^at\s+/i, '').replace(/[\s,.;!?]+$/g, '').trim();
  if (!title) return { type: 'unknown' };
  title = title[0].toUpperCase() + title.slice(1);

  const ms = when ? when.ms : now + 3600000;
  const defaulted = !when;
  return {
    type: 'reminder',
    reminder: { title: title.slice(0, 120), whenISO: new Date(ms).toISOString(), whenLabel: defaulted ? formatWhen(ms, now, offsetMin) + ' (default)' : formatWhen(ms, now, offsetMin) },
  };
}

export function stripSayPrefix(input) {
  return String(input || '').trim().replace(/^(?:say|tell (?:them|him|her)|reply|respond|write|answer)\s*(?:that|with|:)?\s*/i, '').trim();
}
