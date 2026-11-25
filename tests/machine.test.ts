import { describe, expect, it } from 'vitest';
import { beginTyped, draftOptions, initialState, onTranscript, reduce, type Input, type State, type Effect } from '../app/src/machine';
import { render, wrap } from '../app/src/render';

const T = 1_000_000;
const feed = (state: State, ...inputs: Input[]) => {
  const effects: Effect[] = [];
  for (const i of inputs) { const r = reduce(state, i); state = r.state; effects.push(...r.effects); }
  return { state, effects };
};
const reminder = { title: 'Get milk', whenISO: '2026-11-25T17:00:00.000Z', whenLabel: 'Today 6:00 PM' };

describe('catch it', () => {
  it('home -> prompt -> listen via tap -> stop after guard', () => {
    let r = feed(initialState(), { k: 'list', idx: 0, at: T });
    expect(r.state.screen.t).toBe('prompt');
    r = feed(r.state, { k: 'click', at: T });
    expect(r.state.screen.t).toBe('listening');
    expect(r.effects).toEqual([{ e: 'rec:start' }]);
    const early = feed(r.state, { k: 'click', at: T + 300 });
    expect(early.state.screen.t).toBe('listening');
    const done = feed(r.state, { k: 'click', at: T + 1500 });
    expect(done.state.screen.t).toBe('busy');
    expect(done.effects).toEqual([{ e: 'rec:stop' }]);
  });

  it('confirm schedules exactly one save', () => {
    const busy = feed(initialState(), { k: 'list', idx: 0, at: T }, { k: 'click', at: T }, { k: 'click', at: T + 2000 }).state;
    const withIntent = feed(busy, { k: 'intent', intent: { type: 'reminder', reminder }, at: T }).state;
    expect(withIntent.screen.t).toBe('reminder');
    const confirm = feed(withIntent, { k: 'click', at: T });
    expect(confirm.effects).toEqual([{ e: 'save', r: reminder }]);
    const dup = feed(confirm.state, { k: 'click', at: T }, { k: 'click', at: T });
    expect(dup.effects).toEqual([]);
    expect(feed(confirm.state, { k: 'saved', r: reminder }).state.screen.t).toBe('done');
  });

  it('cancel and double tap never save', () => {
    let s = feed(initialState(), { k: 'press', at: T }, { k: 'release', at: T + 900 }).state;
    s = feed(s, { k: 'intent', intent: { type: 'reminder', reminder }, at: T }).state;
    expect(feed(s, { k: 'down', at: T }, { k: 'down', at: T }, { k: 'click', at: T })).toMatchObject({ effects: [], state: { screen: { t: 'home' } } });
    expect(feed(s, { k: 'double', at: T }).effects).toEqual([]);
  });

  it('empty transcript and unknown intent show recoverable errors', () => {
    const busy = feed(initialState(), { k: 'press', at: T }, { k: 'release', at: T + 900 }).state;
    expect(onTranscript(busy, '  ').state.screen.t).toBe('error');
    expect(feed(busy, { k: 'intent', intent: { type: 'unknown' }, at: T }).state.screen.t).toBe('error');
  });
});

describe('send it', () => {
  const threads = [{ id: 'a', name: 'Mum', unread: 2, summary: 'Lunch?' }, { id: 'b', name: 'Dev', unread: 1, summary: 'Deploy?' }];
  const draft = { threadId: 'b', name: 'Dev', summary: 'Deploy?', text: 'Shipping at 5.' };

  it('requires an explicit Send selection before any send effect', () => {
    let s = feed(initialState(), { k: 'list', idx: 2, at: T }).state;
    s = feed(s, { k: 'threads', items: threads }).state;
    const down = feed(s, { k: 'down', at: T });
    const open = feed(down.state, { k: 'click', at: T });
    expect(open.effects).toEqual([{ e: 'draft', thread: threads[1], items: threads }]);
    const drafted = feed(open.state, { k: 'drafted', d: draft, items: threads });
    expect(drafted.state.screen.t).toBe('draft');
    expect(feed(drafted.state, { k: 'down', at: T }, { k: 'click', at: T }).effects.some((e) => e.e === 'send')).toBe(false);
    expect(feed(drafted.state, { k: 'click', at: T }).effects).toEqual([{ e: 'send', d: draft, items: threads }]);
  });

  it('spoken edit re-drafts with the instruction and previous text', () => {
    const d = feed(initialState(), { k: 'list', idx: 2, at: T }, { k: 'threads', items: threads }, { k: 'click', at: T }, { k: 'drafted', d: draft, items: threads }).state;
    const listening = feed(d, { k: 'press', at: T }, { k: 'release', at: T + 900 }).state;
    const out = onTranscript(listening, 'say I will be late');
    expect(out.effects).toEqual([{ e: 'draft', thread: threads[1], instruction: 'say I will be late', previous: 'Shipping at 5.', items: threads }]);
    expect(feed(d, { k: 'press', at: T }, { k: 'double', at: T + 10 }).state.screen.t).toBe('draft');
  });

  it('failed send is retryable', () => {
    const sendEffect: Effect = { e: 'send', d: draft, items: threads };
    const err = feed(initialState(), { k: 'fail', msg: 'offline', retry: sendEffect }).state;
    const retry = feed(err, { k: 'click', at: T });
    expect(retry.effects).toEqual([sendEffect]);
  });

  it('double tap cannot abandon a send that is already on its way', () => {
    const items = [{ id: 'b', name: 'Dev', unread: 1, summary: 'x' }];
    const sending = feed(initialState(), { k: 'list', idx: 2, at: T }, { k: 'threads', items }, { k: 'click', at: T }, { k: 'drafted', d: draft, items }, { k: 'click', at: T }).state;
    expect(sending.screen).toMatchObject({ t: 'busy', label: 'Sending' });
    expect(feed(sending, { k: 'double', at: T }).state.screen.t).toBe('busy');
  });

  it('empty chat list says all caught up', () => {
    const s = feed(initialState(), { k: 'list', idx: 2, at: T }, { k: 'threads', items: [] }).state;
    expect(s.screen).toMatchObject({ t: 'done', title: 'All caught up' });
  });
});

describe('prep it and typed input', () => {
  it('shows the meeting card, with and without an event', () => {
    const s = feed(initialState(), { k: 'list', idx: 1, at: T }).state;
    expect(feed(s, { k: 'event', ev: null }).state.screen).toMatchObject({ t: 'meeting', ev: null });
  });

  it('typed text works from any screen and cancels an open recording', () => {
    const listening = feed(initialState(), { k: 'list', idx: 0, at: T }, { k: 'click', at: T }).state;
    const r = beginTyped(listening);
    expect(r.effects).toEqual([{ e: 'rec:cancel' }]);
    expect(onTranscript(r.state, 'what is next').effects).toEqual([{ e: 'parse', text: 'what is next' }]);
  });
});

describe('render', () => {
  it('keeps every screen within the glasses budget', () => {
    const long = 'x'.repeat(300);
    const screens = [
      { t: 'reminder', r: { ...reminder, title: long }, sel: 0 },
      { t: 'draft', d: { threadId: 'a', name: long, summary: long, text: long }, sel: 1, items: [] },
      { t: 'meeting', ev: { title: long, whenLabel: 'Today 6:00 PM', startsInLabel: 'in 5 min', where: long, attendees: '5 people', prep: long } },
      { t: 'error', msg: long, retry: null, sel: 0 },
    ] as const;
    for (const s of screens) {
      const l = render(s as never);
      expect(l.header.length).toBeLessThanOrEqual(45);
      expect(l.body.split('\n').length).toBeLessThanOrEqual(9);
      for (const line of l.body.split('\n')) expect(line.length).toBeLessThanOrEqual(44);
    }
  });
  it('wrap never exceeds width', () => {
    for (const line of wrap('a very long sentence '.repeat(30), 20, 50)) expect(line.length).toBeLessThanOrEqual(20);
  });
});

describe('push alerts', () => {
  const a = { kind: 'message' as const, threadId: '77', name: 'Mum', from: 'Mum', text: 'Are you coming?' };
  it('shows a new message alert only from the home screen', () => {
    expect(reduce(initialState(), { k: 'alert', a }).state.screen).toMatchObject({ t: 'alert', a });
    const busy: State = { screen: { t: 'busy', label: 'Sending', purpose: 'any', back: { t: 'home', sel: 0 } } };
    expect(reduce(busy, { k: 'alert', a }).state).toBe(busy);
    const draft = feed(initialState(), { k: 'alert', a }, { k: 'click', at: T }).state;
    expect(reduce(draft, { k: 'alert', a }).state).toBe(draft);
  });
  it('tap drafts a reply, double tap and expiry dismiss, nothing is sent', () => {
    const shown = reduce(initialState(), { k: 'alert', a }).state;
    const tap = reduce(shown, { k: 'click', at: T });
    expect(tap.effects).toEqual([{ e: 'draft', thread: expect.objectContaining({ id: '77' }), items: [expect.objectContaining({ id: '77' })] }]);
    expect(reduce(shown, { k: 'double', at: T }).state.screen.t).toBe('home');
    expect(reduce(shown, { k: 'alertExpire' }).state.screen.t).toBe('home');
    expect(reduce(initialState(), { k: 'alertExpire' }).state.screen.t).toBe('home');
  });
  it('renders the sender and text', () => {
    const l = render({ t: 'alert', a });
    expect(l.header).toContain('Mum');
    expect(l.body).toContain('Are you coming?');
    expect(l.footer).toContain('dismiss');
  });
});

describe('reminder alerts and unread badge', () => {
  const ra = { kind: 'reminder' as const, id: 'r1', title: 'Call Sam' };
  it('interrupts busy screens, dismisses on tap, snoozes on double tap', () => {
    const busy = feed(initialState(), { k: 'click', at: T }).state;
    const shown = reduce(busy, { k: 'alert', a: ra }).state;
    expect(shown.screen.t).toBe('alert');
    expect(reduce(shown, { k: 'click', at: T + 1000 }).state.screen.t).toBe('home');
    const d = reduce(shown, { k: 'double', at: T + 1000 });
    expect(d.state.screen.t).toBe('home');
    expect(d.effects).toContainEqual({ e: 'snooze', id: 'r1', minutes: 10 });
  });
  it('shows the unread count on home and renders the reminder card', () => {
    const s = reduce(initialState(), { k: 'unread', n: 3 }).state;
    expect(s.unread).toBe(3);
    expect(render(s.screen, 3)).toMatchObject({ kind: 'list' });
    expect(JSON.stringify(render(s.screen, 3))).toContain('(3 new)');
    expect(JSON.stringify(render({ t: 'alert', a: ra }))).toContain('snooze');
  });
});

describe('other reply picker and spoken reminder edits', () => {
  const d = { threadId: 'b', name: 'Dev', summary: 'Deploy?', text: 'Shipping at 5.', alts: ['Sounds good.', 'Busy, later.'] };
  const th = [{ id: 'b', name: 'Dev', unread: 1, summary: '' }];
  it('Other reply cycles the draft without sending anything', () => {
    const s = feed(initialState(), { k: 'list', idx: 2, at: T }, { k: 'threads', items: th }, { k: 'click', at: T }, { k: 'drafted', d, items: th }, { k: 'down', at: T }, { k: 'down', at: T }, { k: 'click', at: T });
    expect(s.effects.some((e) => e.e === 'send')).toBe(false);
    expect(s.state.screen).toMatchObject({ t: 'draft', d: { text: 'Sounds good.', alts: ['Busy, later.', 'Shipping at 5.'] } });
  });
  it('Other reply is not offered without alternatives', () => {
    expect(draftOptions({ ...d, alts: [] })).toEqual(['Send', 'Change', 'Cancel']);
  });
  it('a spoken time change keeps the reminder title', () => {
    const rem = { t: 'busy' as const, label: 'x', purpose: 'editReminder' as const, back: { t: 'reminder' as const, r: { title: 'call Sam', whenISO: '', whenLabel: 'Tomorrow 6:00 PM' }, sel: 1 } };
    expect(onTranscript({ screen: rem }, 'make it 7 pm').effects).toEqual([{ e: 'parse', text: 'remind me to call Sam at 7 pm' }]);
    expect(onTranscript({ screen: rem }, 'remind me to call Ann at 8').effects).toEqual([{ e: 'parse', text: 'remind me to call Ann at 8' }]);
  });
});
