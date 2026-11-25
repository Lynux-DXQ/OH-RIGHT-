import { DRAFT_OPTIONS, HOME_ITEMS, REMINDER_OPTIONS, type Screen } from './machine';

export type Layout = {
  kind: 'text' | 'list';
  header: string;
  body: string;
  footer: string;
  list?: string[];
};

const COLS = 40;
const BODY_LINES = 8;

export function wrap(text: string, cols = COLS, maxLines = BODY_LINES): string[] {
  const out: string[] = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = word.length > cols ? word.slice(0, cols - 1) + '…' : word;
      if (!line) line = w;
      else if ((line + ' ' + w).length <= cols) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].slice(0, cols - 1) + '…';
    return cut;
  }
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const options = (labels: string[], sel: number) => labels.map((l, i) => (i === sel ? '[ ' + l + ' ]' : '  ' + l + '  ')).join('  ');

export function render(s: Screen): Layout {
  switch (s.t) {
    case 'home':
      return { kind: 'list', header: 'OH, RIGHT!', body: '', list: HOME_ITEMS, footer: 'Scroll, then tap  ·  Hold to speak' };

    case 'prompt':
      return {
        kind: 'text',
        header: 'Remember something',
        body: 'Tap, then say it out loud.\n\nFor example:\n"Remind me to get milk at six"',
        footer: 'Tap to talk  ·  Double tap to go back',
      };

    case 'listening':
      return { kind: 'text', header: '● Listening', body: 'Go ahead, I am listening.\n\nTap again when you are done.', footer: 'Double tap to cancel' };

    case 'busy':
      return { kind: 'text', header: s.label + '…', body: 'One moment.', footer: s.label === 'Sending' || s.label === 'Scheduling' ? ' ' : 'Double tap to cancel' };

    case 'reminder':
      return {
        kind: 'text',
        header: 'Save this reminder?',
        body: wrap(s.r.title, COLS, 3).join('\n') + '\n\n' + s.r.whenLabel + '\nI will message you on Telegram.',
        footer: options(REMINDER_OPTIONS, s.sel),
      };

    case 'meeting':
      if (!s.ev) return { kind: 'text', header: 'Up next', body: 'Nothing else on your calendar.\nEnjoy the quiet.', footer: 'Tap to go back' };
      return {
        kind: 'text',
        header: clip('Up next  ·  ' + s.ev.startsInLabel, COLS),
        body:
          wrap(s.ev.title, COLS, 2).join('\n') + '\n' +
          clip([s.ev.whenLabel.replace(/^Today /, ''), clip(s.ev.where, 20), s.ev.attendees].filter(Boolean).join('  ·  '), COLS) +
          '\n\n' + wrap(s.ev.prep, COLS, 4).join('\n'),
        footer: 'Tap to go back',
      };

    case 'threads': {
      const t = s.items[s.idx];
      return {
        kind: 'text',
        header: 'Chats  ' + (s.idx + 1) + ' of ' + s.items.length,
        body: clip(t.name, COLS) + (t.unread ? '  (' + t.unread + ' new)' : '') + '\n\n' + wrap(t.summary, COLS, 5).join('\n'),
        footer: 'Tap to reply  ·  Scroll for next',
      };
    }

    case 'draft':
      return {
        kind: 'text',
        header: 'Reply to ' + clip(s.d.name, 26),
        body: wrap(s.d.summary, COLS, 3).join('\n') + '\n\nYour reply:\n' + wrap(s.d.text, COLS, 3).join('\n'),
        footer: options(DRAFT_OPTIONS, s.sel),
      };

    case 'alert':
      return {
        kind: 'text',
        header: 'New message  ·  ' + clip(s.a.name, 20),
        body: clip(s.a.from, 30) + ':\n' + wrap(s.a.text, COLS, 5).join('\n'),
        footer: 'Tap to reply  ·  Double tap to dismiss',
      };

    case 'done':
      return { kind: 'text', header: s.title, body: wrap(s.detail).join('\n'), footer: 'Tap to finish' };

    case 'error':
      return {
        kind: 'text',
        header: 'Oops',
        body: wrap(s.msg, COLS, 6).join('\n'),
        footer: options([s.retry ? 'Try again' : 'Speak again', 'Home'], s.sel),
      };
  }
}
