import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ohright-tg-'));
let store: { data: { ownerChatId: string | null } };
let ingest: (m: unknown) => void;

beforeAll(async () => {
  process.env.STORE_FILE = join(dir, 'store.json');
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.APP_TOKEN;
  // @ts-expect-error plain JS module
  store = (await import('../server/store.mjs')).store;
  // @ts-expect-error plain JS module
  ingest = (await import('../server/telegram.mjs'))._ingestForTests;
});

const start = (id: number) => ({ chat: { id, type: 'private', first_name: 'U' + id }, text: '/start', date: Date.now() / 1000 });

describe('telegram pairing', () => {
  it('first /start pairs, later /start from another chat cannot take over', () => {
    ingest(start(111));
    expect(store.data.ownerChatId).toBe('111');
    ingest(start(666));
    expect(store.data.ownerChatId).toBe('111');
    ingest(start(111));
    expect(store.data.ownerChatId).toBe('111');
  });
});

describe('store recovery', () => {
  it('moves a corrupt store aside instead of overwriting it', async () => {
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{"reminders": [');
    process.env.STORE_FILE = file;
    vi.resetModules();
    // @ts-expect-error plain JS module
    const fresh = (await import('../server/store.mjs')).store;
    expect(fresh.data.reminders).toEqual([]);
    expect(readdirSync(dir).some((f) => f.startsWith('broken.json.corrupt-'))).toBe(true);
  });
});

describe('owner commands and opt-in pings', () => {
  const sent = () => (store as unknown as { data: { outbox: { chatId: string; text: string }[] } }).data.outbox;
  const group = (text: string, id = -500) => ({ chat: { id, type: 'group', title: 'Team' }, from: { first_name: 'Ada' }, text, date: Date.now() / 1000 });
  const owner = (text: string) => ({ chat: { id: 111, type: 'private', first_name: 'U111' }, text, date: Date.now() / 1000 });
  const last = () => sent().at(-1)!;

  it('pings are off by default: a group message sends the owner nothing', () => {
    const before = sent().length;
    ingest(group('hello'));
    expect(sent().length).toBe(before);
  });

  it('/notify on pings the owner once per chat per half minute, with the sender and text', () => {
    ingest(owner('/notify on'));
    expect(last().text).toContain('Pings are on');
    const before = sent().length;
    ingest(group('Can you confirm the time?', -501));
    ingest(group('and the room?', -501));
    expect(sent().length).toBe(before + 1);
    expect(last()).toMatchObject({ chatId: '111' });
    expect(last().text).toContain('Ada: Can you confirm the time?');
  });

  it('/mute silences pings and /mute off restores them', () => {
    ingest(owner('/mute 60'));
    const before = sent().length;
    ingest(group('quiet please', -502));
    expect(sent().length).toBe(before);
    ingest(owner('/mute off'));
    ingest(group('back again', -503));
    expect(sent().at(-1)!.text).toContain('back again');
  });

  it('/notify off stops pings, bad arguments are explained, and strangers cannot run commands', () => {
    ingest(owner('/notify maybe'));
    expect(last().text).toContain('Use /notify on or /notify off');
    ingest(owner('/notify off'));
    const before = sent().length;
    ingest(group('ignored', -504));
    expect(sent().length).toBe(before);
    ingest({ chat: { id: 999, type: 'private', first_name: 'X' }, text: '/notify on', date: Date.now() / 1000 });
    expect(sent().length).toBe(before);
    ingest(owner('/status'));
    expect(last().text).toContain('Pings for new messages: off');
  });
});
