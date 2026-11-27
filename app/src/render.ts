import { BOOKING_KINDS, BOOKING_OPTIONS, draftOptions, HOME_ITEMS, REMINDER_OPTIONS, SNOOZE_MINUTES, type Screen } from './machine';
import { COLS, wrap } from './text';

export { wrap } from './text';

export type Layout = {
  kind: 'text' | 'list';
  header: string;
  body: string;
  footer: string;
  list?: string[];
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const options = (labels: string[], sel: number) => labels.map((l, i) => (i === sel ? '[ ' + l + ' ]' : '  ' + l + '  ')).join('  ');

export function render(s: Screen, unread = 0): Layout {
  switch (s.t) {
    case 'home':
      return { kind: 'list', header: 'OH, RIGHT!', body: '', list: HOME_ITEMS.map((l, i) => (i === 2 && unread > 0 ? l + '  (' + unread + ' new)' : l)), footer: 'Scroll, then tap  ·  Hold to speak' };

    case 'prompt':
      if (s.purpose === 'question') return { kind: 'text', header: 'Ask a question', body: 'Tap, then ask it out loud.\n\nFor example:\n"What is a good opener for a sales call?"', footer: 'Tap to talk  ·  Double tap to go back' };
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
        body: wrap(s.d.summary, COLS, 2).join('\n') + '\n\nYour reply:\n' + wrap(s.d.text, COLS, 3).join('\n'),
        footer: options(draftOptions(s.d), s.sel),
      };

    case 'alert':
      if (s.a.kind === 'reminder') {
        return { kind: 'text', header: 'Reminder', body: wrap(s.a.title, COLS, 5).join('\n'), footer: 'Tap: got it  ·  Double tap: snooze ' + SNOOZE_MINUTES + ' min' };
      }
      return {
        kind: 'text',
        header: 'New message  ·  ' + clip(s.a.name, 20),
        body: clip(s.a.from, 30) + ':\n' + wrap(s.a.text, COLS, 5).join('\n'),
        footer: 'Tap to reply  ·  Double tap to dismiss',
      };

    case 'brief':
      return { kind: 'text', header: clip(s.title, COLS), body: s.pages[s.page], footer: (s.pages.length > 1 ? 'Scroll ' + (s.page + 1) + ' of ' + s.pages.length + '  ·  ' : '') + 'Tap to finish' };

    case 'booking':
      return {
        kind: 'text',
        header: 'Book this?',
        body: clip(BOOKING_KINDS[s.b.kind] + '  ·  ' + s.b.title, COLS) + '\n' + clip(s.b.whenLabel + (s.b.where ? '  ·  ' + s.b.where : ''), COLS) + '\n\n' + wrap(s.b.notes || 'No notes', COLS, 3).join('\n'),
        footer: options(BOOKING_OPTIONS, s.sel),
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
