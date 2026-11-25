import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

let llm: Server;
let backend: Server;
let base = '';
const seen: Array<{ auth: string | undefined; body: { model: string; messages: Array<{ role: string; content: string }> } }> = [];
let reply: (body: { messages: Array<{ content: string }> }) => unknown = () => ({});

beforeAll(async () => {
  llm = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      seen.push({ auth: req.headers.authorization, body });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(body)) } }] }));
    });
  });
  await new Promise<void>((r) => llm.listen(0, '127.0.0.1', r));
  process.env.LLM_API_KEY = 'k-test';
  process.env.LLM_BASE_URL = 'http://127.0.0.1:' + (llm.address() as AddressInfo).port;
  process.env.LLM_MODEL = 'm-test';
  process.env.STORE_FILE = join(mkdtempSync(join(tmpdir(), 'ohright-llm-')), 'store.json');
  for (const k of ['TELEGRAM_BOT_TOKEN', 'ICS_URL', 'APP_TOKEN']) delete process.env[k];
  // @ts-expect-error plain JS module
  backend = (await import('../server/index.mjs')).server;
  await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (backend.address() as AddressInfo).port;
});
afterAll(() => { llm.close(); backend.close(); });

const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

describe('LLM-assisted paths (OpenAI-compatible API)', () => {
  it('sends the key, model and JSON mode, and uses the model only when the built-in parser gives up', async () => {
    seen.length = 0;
    const known = await post('/api/parse', { text: 'remind me to get milk at six', now: Date.now(), offsetMin: 60 });
    expect(known.intent.type).toBe('reminder');
    expect(seen).toHaveLength(0);

    reply = () => ({ type: 'reminder', title: 'Book dentist', whenISO: new Date(Date.now() + 7200000).toISOString() });
    const fuzzy = await post('/api/parse', { text: 'ugh dentist booking, sometime later', now: Date.now(), offsetMin: 60 });
    expect(fuzzy.intent).toMatchObject({ type: 'reminder', reminder: { title: 'Book dentist' } });
    expect(seen[0].auth).toBe('Bearer k-test');
    expect(seen[0].body.model).toBe('m-test');
  });

  it('keeps going with the built-in parser when the model returns junk', async () => {
    reply = () => ({ type: 'launch_missiles' });
    const out = await post('/api/parse', { text: 'banana', now: Date.now(), offsetMin: 0 });
    expect(out.intent.type).toBe('unknown');
  });

  it('draft rewrites follow the spoken instruction, treat chat text as data, and strip links', async () => {
    seen.length = 0;
    const { threads } = await post('/api/threads', {});
    reply = (b) => (/<instruction>/.test(b.messages[1].content) ? { summary: 'Lunch Sunday?', draft: 'Yes! Details at http://evil.example/x see you then' } : { summary: 'Lunch Sunday?', draft: 'Yes I will be there' });
    const d = await post('/api/draft', { threadId: threads[0].id, instruction: 'say yes and add details', previousDraft: 'Yes I will be there' });
    expect(d.text).not.toContain('http');
    expect(d.text).toContain('see you then');
    const prompt = seen.at(-1)!.body.messages;
    expect(prompt[0].content).toContain('untrusted');
    expect(prompt[1].content).toContain('<chat name="');
    expect(prompt[1].content).toContain('<instruction>say yes and add details</instruction>');
  });

  it('survives an LLM outage everywhere it is used', async () => {
    llm.close();
    const t = await post('/api/threads', {});
    expect(t.threads[0].summary.length).toBeGreaterThan(0);
    const d = await post('/api/draft', { threadId: t.threads[0].id });
    expect(d.text.length).toBeGreaterThan(0);
  });
});
