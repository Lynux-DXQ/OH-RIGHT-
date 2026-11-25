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
