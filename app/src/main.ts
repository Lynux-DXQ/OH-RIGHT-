import { api, apiBase, apiToken, setApiBase, setApiToken } from './api';
import { Runtime } from './runtime';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rt = new Runtime();

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

rt.subscribe((layout, state, inGlasses) => {
  const body = layout.kind === 'list' ? (layout.list ?? []).map((l, i) => (i === (state.screen.t === 'home' ? state.screen.sel : 0) ? '> ' : '  ') + l).join('\n') : layout.body;
  $('hdr').textContent = layout.header;
  $('body').innerHTML = esc(body);
  $('ftr').textContent = layout.footer;
  $('mode').textContent = inGlasses ? 'Connected to your glasses' : 'Preview mode: no glasses connected';
  const s = state.screen;
  $('hint').textContent =
    s.t === 'listening' ? 'Listening. Speak, or type what you would say below.' : '';
  document.body.dataset.screen = s.t;
});

document.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => {
  b.addEventListener('click', () => {
    const g = b.dataset.g as 'click' | 'double' | 'up' | 'down' | 'press' | 'release';
    rt.gesture(g);
  });
});

const homeList = () => rt.state.screen.t === 'home';
document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
  b.addEventListener('click', () => {
    if (!homeList()) return;
    rt.pick(Number(b.dataset.pick));
  });
});

const form = $('say') as HTMLFormElement;
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('sayText') as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  rt.submitText(text);
});
document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((b) => {
  b.addEventListener('click', () => rt.submitText(b.dataset.example!));
});

const apiInput = $('apiBase') as HTMLInputElement;
const tokenInput = $('apiToken') as HTMLInputElement;
apiInput.value = apiBase();
tokenInput.value = apiToken();
$('saveCfg').addEventListener('click', () => {
  setApiBase(apiInput.value);
  setApiToken(tokenInput.value);
  void refreshHealth();
});

async function refreshHealth() {
  const el = $('health');
  try {
    const h = await api.health();
    const flags = [h.demo ? 'sample chats' : 'Telegram connected', h.llm ? 'AI on' : 'basic understanding', h.stt ? 'voice on' : 'typing only', h.calendar ? 'your calendar' : 'sample calendar'];
    el.textContent = 'Connected: ' + flags.join(', ');
    el.className = 'ok';
  } catch (err) {
    el.textContent = (err as Error).message;
    el.className = 'bad';
  }
}

void rt.start();
void refreshHealth();
