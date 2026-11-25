import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { parseIntent, parseWhen, formatWhen } from '../server/nlu.mjs';

const LAGOS = 60;
const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-25T12:00:00Z');

const rem = (text: string, now = NOW, off = LAGOS) => {
  const i = parseIntent(text, { now, offsetMin: off });
  if (i.type !== 'reminder') throw new Error('not a reminder: ' + JSON.stringify(i));
  return i.reminder as { title: string; whenISO: string; whenLabel: string };
};

describe('reminders', () => {
  it('remind me to get milk at six (13:00 local) picks 6 PM today', () => {
    const r = rem('Remind me to get milk at six');
    expect(r.title).toBe('Get milk');
    expect(r.whenISO).toBe('2026-11-25T17:00:00.000Z');
    expect(r.whenLabel).toBe('Today 6:00 PM');
  });
  it('rolls past times to the next occurrence', () => {
    const late = at('2026-11-25T18:30:00Z');
    expect(rem('remind me to stretch at 6', late).whenISO).toBe('2026-11-26T05:00:00.000Z');
  });
  it('relative durations', () => {
    expect(rem('remind me to check the oven in 20 minutes').whenISO).toBe(new Date(NOW + 20 * 60000).toISOString());
    expect(rem('remind me in an hour to call Sam').title).toBe('Call Sam');
    expect(rem('remind me to call Sam in half an hour').whenISO).toBe(new Date(NOW + 30 * 60000).toISOString());
  });
  it('tomorrow with explicit meridiem and minutes', () => {
    const r = rem('remind me to email Priya tomorrow at 9:30 am');
    expect(r.whenISO).toBe('2026-11-26T08:30:00.000Z');
    expect(r.title).toBe('Email Priya');
    expect(r.whenLabel).toBe('Tomorrow 9:30 AM');
  });
  it('defaults to one hour and says so when no time is given', () => {
    const r = rem('remind me to buy bread');
    expect(r.whenISO).toBe(new Date(NOW + 3600000).toISOString());
    expect(r.whenLabel).toContain('(default)');
  });
  it('bare task with a time is a reminder', () => {
    expect(rem('call the bank at 3 pm').title).toBe('Call the bank');
  });
  it('weekday names resolve to a future date', () => {
    const r = rem('remind me to pay rent on friday at 10am');
    expect(new Date(r.whenISO).getTime()).toBeGreaterThan(NOW);
    expect(r.title).toBe('Pay rent');
  });
  it('tonight', () => {
    expect(rem('remind me to take out the bins tonight').whenISO).toBe('2026-11-25T19:00:00.000Z');
  });
});

describe('other intents', () => {
  it.each(['what is next', "What's next?", 'brief me', 'what do I have'])('next: %s', (t) => expect(parseIntent(t).type).toBe('next'));
  it.each(['any messages to reply to', 'catch me up', 'check my telegram'])('reply: %s', (t) => expect(parseIntent(t).type).toBe('reply'));
  it.each(['', '   ', 'hmm', 'banana'])('unknown: %j', (t) => expect(parseIntent(t).type).toBe('unknown'));
});

describe('formatWhen', () => {
  it('formats the day relative to now', () => {
    expect(formatWhen(NOW + 86400000, NOW, LAGOS)).toMatch(/^Tomorrow/);
    expect(parseWhen('nothing here', NOW, LAGOS)).toBeNull();
  });
});

describe('regressions from the audit', () => {
  const cases: Array<[string, string, string]> = [
    ['remind me to call mum tomorrow evening at 7', 'Call mum', '2026-11-26T18:00:00.000Z'],
    ['remind me to call mum tomorrow afternoon at 3', 'Call mum', '2026-11-26T14:00:00.000Z'],
    ['remind me to call mum tomorrow morning at 9', 'Call mum', '2026-11-26T08:00:00.000Z'],
    ['remind me to call mum at 3pm tmrw', 'Call mum', '2026-11-26T14:00:00.000Z'],
    ['remind me to call mum tomorrow, at 3pm', 'Call mum', '2026-11-26T14:00:00.000Z'],
    ['remind me to call mum at 3pm, tomorrow', 'Call mum', '2026-11-26T14:00:00.000Z'],
    ['remind me to call mum tomorrow at noon', 'Call mum', '2026-11-26T11:00:00.000Z'],
    ['remind me to call mum at noon tomorrow', 'Call mum', '2026-11-26T11:00:00.000Z'],
    ['remind me to pay rent in 2 days at 9am', 'Pay rent', '2026-11-27T08:00:00.000Z'],
    ['remind me to take pills at 9 in the morning', 'Take pills', '2026-11-26T08:00:00.000Z'],
    ['remind me in 1 hour 30 minutes to stretch', 'Stretch', '2026-11-25T13:30:00.000Z'],
    ['remind me in an hour and a half to stretch', 'Stretch', '2026-11-25T13:30:00.000Z'],
    ['remind me to call mum at six thirty', 'Call mum', '2026-11-25T17:30:00.000Z'],
    ['remind me to call mum at half past six', 'Call mum', '2026-11-25T17:30:00.000Z'],
    ['remind me to call mum at quarter to five', 'Call mum', '2026-11-25T15:45:00.000Z'],
    ['remind me in twenty minutes to check the oven', 'Check the oven', '2026-11-25T12:20:00.000Z'],
    ['remind me at midnight to lock up', 'Lock up', '2026-11-25T23:00:00.000Z'],
    ['remind me at noon to eat', 'Eat', '2026-11-26T11:00:00.000Z'],
    ['remind me to get milk at 6 o clock', 'Get milk', '2026-11-25T17:00:00.000Z'],
    ['Can you remind me to get milk at six', 'Get milk', '2026-11-25T17:00:00.000Z'],
    ['Oh, right, remind me to get milk at six', 'Get milk', '2026-11-25T17:00:00.000Z'],
    ["don't forget to call mum at five", 'Call mum', '2026-11-25T16:00:00.000Z'],
    ['remind me to ask what is next on the agenda at 4', 'Ask what is next on the agenda', '2026-11-25T15:00:00.000Z'],
    ['email John about the chat tomorrow at 3', 'Email John about the chat', '2026-11-26T14:00:00.000Z'],
  ];
  it.each(cases)('%s', (text, title, iso) => {
    const r = rem(text);
    expect(r.title).toBe(title);
    expect(r.whenISO).toBe(iso);
  });
  it('tonight at midnight stays tonight', () => {
    expect(rem('remind me to pay bills tonight at midnight').whenISO).toBe('2026-11-25T23:00:00.000Z');
  });
});
