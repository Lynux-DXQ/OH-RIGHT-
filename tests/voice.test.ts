// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

type Handler = (ev: Record<string, unknown>) => void;
const bridgeCalls: Array<{ fn: string; arg: unknown }> = [];
let emit: Handler = () => {};

vi.mock('@evenrealities/even_hub_sdk', async (orig) => {
  const real = await orig<typeof import('@evenrealities/even_hub_sdk')>();
  const bridge = {
    onEvenHubEvent: (h: Handler) => { emit = h; return () => {}; },
    createStartUpPageContainer: async () => 0,
    rebuildPageContainer: async () => true,
    textContainerUpgrade: async () => true,
    audioControl: async (on: boolean, source?: unknown) => { bridgeCalls.push({ fn: 'audio', arg: { on, source } }); return true; },
  };
  return { ...real, waitForEvenAppBridge: async () => bridge };
});

type Upload = { sampleRate: number; channels: number; bits: number; pcm: Buffer; model: string };
const uploads: Upload[] = [];
let sttMode: { text?: string; status?: number } = {};
let sttServer: Server;
let backend: Server;
const store = new Map<string, string>();

beforeAll(async () => {
  sttServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (sttMode.status) { res.writeHead(sttMode.status).end('{"error":"boom"}'); return; }
      const body = Buffer.concat(chunks);
      const at = body.indexOf('RIFF');
      const dataLen = body.readUInt32LE(at + 40);
      uploads.push({
        sampleRate: body.readUInt32LE(at + 24),
        channels: body.readUInt16LE(at + 22),
        bits: body.readUInt16LE(at + 34),
        pcm: body.subarray(at + 44, at + 44 + dataLen),
        model: /name="model"\r\n\r\n([^\r]+)/.exec(body.toString('latin1'))?.[1] ?? '',
      });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: sttMode.text ?? '' }));
    });
  });
  await new Promise<void>((r) => sttServer.listen(0, '127.0.0.1', r));
  process.env.STT_API_KEY = 'test-key';
  process.env.STT_BASE_URL = 'http://127.0.0.1:' + (sttServer.address() as AddressInfo).port;
  process.env.STT_MODEL = 'whisper-test';
  process.env.STORE_FILE = join(mkdtempSync(join(tmpdir(), 'ohright-voice-')), 'store.json');
  for (const k of ['TELEGRAM_BOT_TOKEN', 'LLM_API_KEY', 'ICS_URL', 'APP_TOKEN']) delete process.env[k];
  // @ts-expect-error plain JS module
  backend = (await import('../server/index.mjs')).server;
  await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
  store.set('ohright.api', 'http://127.0.0.1:' + (backend.address() as AddressInfo).port);
  (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
});
afterAll(() => { sttServer.close(); backend.close(); });
beforeEach(() => { uploads.length = 0; bridgeCalls.length = 0; sttMode = {}; });

const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tone = (seconds: number) => {
  const samples = Math.round(16000 * seconds);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2);
  return buf;
};
const frames = (pcm: Buffer) => { const out: Buffer[] = []; for (let i = 0; i < pcm.length; i += 3200) out.push(pcm.subarray(i, i + 3200)); return out; };
const feed = (pcm: Buffer) => { for (const f of frames(pcm)) emit({ audioEvent: { audioPcm: new Uint8Array(f) } }); };

const start = async () => {
  const { Runtime } = await import('../app/src/runtime');
  const rt = new Runtime();
  await rt.start();
  return rt;
};

describe('voice capture on the glasses microphone', () => {
  it('hold to talk: opens the glasses mic, uploads exactly the PCM that was spoken as 16 kHz mono 16-bit WAV, and creates the reminder', async () => {
    sttMode = { text: 'Remind me to get milk at six' };
    const rt = await start();
    const pcm = tone(2);
    emit({ sysEvent: { eventType: 9 } });
    await until(() => rt.state.screen.t === 'listening');
    expect(bridgeCalls.at(-1)).toMatchObject({ fn: 'audio', arg: { on: true } });
    feed(pcm);
    emit({ sysEvent: { eventType: 10 } });
    await until(() => rt.state.screen.t === 'reminder');
    expect(bridgeCalls.at(-1)).toMatchObject({ fn: 'audio', arg: { on: false } });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ sampleRate: 16000, channels: 1, bits: 16, model: 'whisper-test' });
    expect(Buffer.compare(uploads[0].pcm, pcm)).toBe(0);
    expect((rt.state.screen as unknown as { r: { title: string } }).r.title).toBe('Get milk');
  });

  it('tap to talk from the menu: tap starts, a later tap stops, and the spoken command is routed', async () => {
    sttMode = { text: 'What is next?' };
    const rt = await start();
    emit({ listEvent: { currentSelectItemIndex: 0 } });
    expect(rt.state.screen.t).toBe('prompt');
    await wait(150);
    emit({ textEvent: { eventType: undefined } });
    await until(() => rt.state.screen.t === 'listening');
    feed(tone(1.5));
    await wait(800);
    emit({ textEvent: { eventType: undefined } });
    await until(() => rt.state.screen.t === 'meeting');
    expect(uploads).toHaveLength(1);
  });

  it('a recording that is too short never reaches the speech service', async () => {
    const rt = await start();
    emit({ sysEvent: { eventType: 9 } });
    await until(() => rt.state.screen.t === 'listening');
    feed(tone(0.1));
    emit({ sysEvent: { eventType: 10 } });
    await until(() => rt.state.screen.t === 'error');
    expect((rt.state.screen as unknown as { msg: string }).msg).toContain('too short');
    expect(uploads).toHaveLength(0);
  });

  it('silence (empty transcript) asks you to speak again', async () => {
    sttMode = { text: '' };
    const rt = await start();
    emit({ sysEvent: { eventType: 9 } });
    await until(() => rt.state.screen.t === 'listening');
    feed(tone(1));
    emit({ sysEvent: { eventType: 10 } });
    await until(() => rt.state.screen.t === 'error');
    expect((rt.state.screen as unknown as { msg: string }).msg).toContain('did not hear');
  });

  it('a speech service outage becomes a friendly error and the microphone is closed', async () => {
    sttMode = { status: 500 };
    const rt = await start();
    emit({ sysEvent: { eventType: 9 } });
    await until(() => rt.state.screen.t === 'listening');
    feed(tone(1));
    emit({ sysEvent: { eventType: 10 } });
    await until(() => rt.state.screen.t === 'error');
    expect(bridgeCalls.filter((c) => c.fn === 'audio').at(-1)).toMatchObject({ arg: { on: false } });
  });

  it('double tap while listening cancels: mic closed, nothing uploaded', async () => {
    const rt = await start();
    emit({ sysEvent: { eventType: 9 } });
    await until(() => rt.state.screen.t === 'listening');
    feed(tone(1));
    await wait(130);
    emit({ sysEvent: { eventType: 3 } });
    await until(() => rt.state.screen.t === 'home');
    await wait(100);
    expect(bridgeCalls.filter((c) => c.fn === 'audio').at(-1)).toMatchObject({ arg: { on: false } });
    expect(uploads).toHaveLength(0);
  });

  it('audio from an earlier recording never leaks into the next one', async () => {
    sttMode = { text: 'What is next' };
    const rt = await start();
    emit({ sysEvent: { eventType: 9 } });
    await until(() => rt.state.screen.t === 'listening');
    feed(tone(1));
    await wait(130);
    emit({ sysEvent: { eventType: 3 } });
    await until(() => rt.state.screen.t === 'home');
    await wait(200);
    emit({ sysEvent: { eventType: 9 } });
    await until(() => rt.state.screen.t === 'listening');
    const second = tone(1.2);
    feed(second);
    emit({ sysEvent: { eventType: 10 } });
    await until(() => rt.state.screen.t === 'meeting');
    expect(Buffer.compare(uploads[0].pcm, second)).toBe(0);
  });
});
