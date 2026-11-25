// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

type Handler = (ev: Record<string, unknown>) => void;
const calls: Array<{ fn: string; arg: unknown }> = [];
let emit: Handler = () => {};
let createResult = 0;

vi.mock('@evenrealities/even_hub_sdk', async (orig) => {
  const real = await orig<typeof import('@evenrealities/even_hub_sdk')>();
  const bridge = {
    onEvenHubEvent: (h: Handler) => { emit = h; return () => {}; },
    createStartUpPageContainer: async (arg: unknown) => { calls.push({ fn: 'create', arg }); return createResult; },
    rebuildPageContainer: async (arg: unknown) => { calls.push({ fn: 'rebuild', arg }); return true; },
    textContainerUpgrade: async (arg: unknown) => { calls.push({ fn: 'upgrade', arg }); return true; },
    audioControl: async (on: boolean) => { calls.push({ fn: 'audio', arg: on }); return true; },
  };
  return { ...real, waitForEvenAppBridge: async () => bridge };
});

let server: import('node:http').Server;
const store = new Map<string, string>();

beforeAll(async () => {
  process.env.STORE_FILE = join(mkdtempSync(join(tmpdir(), 'ohright-rt-')), 'store.json');
  for (const k of ['TELEGRAM_BOT_TOKEN', 'LLM_API_KEY', 'ICS_URL', 'APP_TOKEN']) delete process.env[k];
  // @ts-expect-error plain JS module
  server = (await import('../server/index.mjs')).server;
  await new Promise<void>((r) => server.listen(0, r));
  store.set('ohright.api', 'http://127.0.0.1:' + (server.address() as AddressInfo).port);
  (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
});
afterAll(() => server.close());

const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); }
};

describe('runtime on a fake glasses bridge', () => {
  it('falls back to rebuild when the startup page already exists (app reload)', async () => {
    const { Runtime } = await import('../app/src/runtime');
    createResult = 1;
    calls.length = 0;
    const rt = new Runtime();
    await rt.start();
    await until(() => calls.some((c) => c.fn === 'rebuild'));
    emit({ listEvent: { currentSelectItemIndex: 1 } });
    await until(() => rt.state.screen.t === 'meeting');
    await until(() => calls.some((c) => JSON.stringify(c.arg).includes('Product sync')));
    createResult = 0;
  });


  it('draws home, then runs prep it and send it end to end', async () => {
    const { Runtime } = await import('../app/src/runtime');
    const rt = new Runtime();
    await rt.start();
    await until(() => calls.some((c) => c.fn === 'create'));
    const create = calls.find((c) => c.fn === 'create')!.arg as { listObject: unknown[]; textObject: unknown[] };
    expect(create.listObject).toHaveLength(1);

    emit({ listEvent: { currentSelectItemIndex: 1 } });
    await until(() => rt.state.screen.t === 'meeting');
    await until(() => calls.some((c) => JSON.stringify(c.arg).includes('Product sync')));

    emit({ sysEvent: { eventType: 3 } });
    await until(() => rt.state.screen.t === 'home');

    emit({ listEvent: { currentSelectItemIndex: 2 } });
    await until(() => rt.state.screen.t === 'threads');
    emit({ textEvent: { eventType: undefined } });
    await until(() => rt.state.screen.t === 'draft');
    await new Promise((r) => setTimeout(r, 150));
    emit({ textEvent: { eventType: undefined } });
    await until(() => rt.state.screen.t === 'done');
    expect((rt.state.screen as { title: string }).title).toBe('Sent');
  });

  it('typed reminder flow schedules once even when confirm is tapped repeatedly', async () => {
    const { Runtime } = await import('../app/src/runtime');
    const rt = new Runtime();
    await rt.start();
    emit({ listEvent: { currentSelectItemIndex: 0 } });
    expect(rt.state.screen.t).toBe('prompt');
    rt.submitText('Remind me to get milk at six');
    await until(() => rt.state.screen.t === 'reminder');
    emit({ textEvent: { eventType: undefined } });
    await new Promise((r) => setTimeout(r, 30));
    emit({ textEvent: { eventType: undefined } });
    await until(() => rt.state.screen.t === 'done');
    const list = (await (await fetch(store.get('ohright.api') + '/api/reminders')).json()).reminders as Array<{ title: string }>;
    expect(list.filter((r) => r.title === 'Get milk')).toHaveLength(1);
  });

  it('server down shows a retryable error, and double tap while busy discards the stale result', async () => {
    const { Runtime } = await import('../app/src/runtime');
    const good = store.get('ohright.api')!;
    store.set('ohright.api', 'http://127.0.0.1:1');
    const rt = new Runtime();
    await rt.start();
    emit({ listEvent: { currentSelectItemIndex: 1 } });
    await until(() => rt.state.screen.t === 'error');
    expect((rt.state.screen as { retry: unknown }).retry).toEqual({ e: 'fetchNext' });
    store.set('ohright.api', good);
    emit({ textEvent: { eventType: undefined } });
    await until(() => rt.state.screen.t === 'meeting');
    emit({ textEvent: { eventType: undefined } });
    emit({ listEvent: { currentSelectItemIndex: 1 } });
    emit({ sysEvent: { eventType: 3 } });
    await new Promise((r) => setTimeout(r, 300));
    expect(rt.state.screen.t).toBe('home');
  });

  it('long press records, releases and sends audio to stt (501 here becomes a recoverable error)', async () => {
    const { Runtime } = await import('../app/src/runtime');
    const rt = new Runtime();
    await rt.start();
    emit({ sysEvent: { eventType: 9 } });
    await until(() => rt.state.screen.t === 'listening');
    emit({ audioEvent: { audioPcm: new Uint8Array(16000) } });
    emit({ sysEvent: { eventType: 10 } });
    await until(() => rt.state.screen.t === 'error');
    expect(calls.filter((c) => c.fn === 'audio').map((c) => c.arg).slice(-2)).toEqual([true, false]);
  });
});
