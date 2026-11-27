import {
  AudioInputSource,
  OsEventTypeList,
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { api } from './api';
import { pcmToWav } from './audio';
import { beginTyped, initialState, onTranscript, reduce, type Alert, type Effect, type Input, type State } from './machine';
import { render, type Layout } from './render';

const MAX_RECORD_MS = 15000;
const MIN_PCM_BYTES = 8000;
const HEADER = { id: 1, name: 'hdr' };
const BODY = { id: 2, name: 'body' };
const FOOTER = { id: 3, name: 'ftr' };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export type Listener = (layout: Layout, state: State, inGlasses: boolean) => void;

export class Runtime {
  state: State = initialState();
  private bridge: EvenAppBridge | null = null;
  private listeners = new Set<Listener>();
  private epoch = 0;
  private chunks: Uint8Array[] = [];
  private recTimer: ReturnType<typeof setTimeout> | null = null;
  private recording = false;
  private lastLayout: Layout | null = null;
  private created = false;
  private queue: Promise<void> = Promise.resolve();
  private lastGesture = { key: '', at: 0 };
  private ids = new Map<string, string>();

  private alertSince = Date.now();
  private pendingAlerts: Alert[] = [];
  private alertTimer: ReturnType<typeof setInterval> | null = null;
  private expireTimer: ReturnType<typeof setTimeout> | null = null;

  get inGlasses() { return this.bridge !== null; }

  startAlerts(everyMs = 8000) {
    if (this.alertTimer) return;
    this.alertTimer = setInterval(() => void this.checkAlerts(), everyMs);
  }

  async checkAlerts() {
    try {
      const { alerts, unread } = await api.alerts(this.alertSince);
      this.dispatch({ k: 'unread', n: unread });
      for (const a of alerts) {
        this.alertSince = Math.max(this.alertSince, a.at);
        const same = (p: Alert) => (p.kind === 'message' && a.kind === 'message' ? p.threadId === a.threadId : false);
        this.pendingAlerts = [...this.pendingAlerts.filter((p) => !same(p)), a].sort((x, y) => Number(y.kind === 'reminder') - Number(x.kind === 'reminder'));
      }
    } catch {
      return;
    }
    const next = this.pendingAlerts[0];
    if (!next) return;
    this.dispatch({ k: 'alert', a: next });
    if (this.state.screen.t !== 'alert') return;
    this.pendingAlerts.shift();
    if (this.expireTimer) clearTimeout(this.expireTimer);
    this.expireTimer = setTimeout(() => {
      const cur = this.state.screen;
      if (cur.t === 'alert' && cur.a === next) this.dispatch({ k: 'alertExpire' });
    }, next.kind === 'reminder' ? 90000 : 25000);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(render(this.state.screen, this.state.unread), this.state, this.inGlasses);
    return () => this.listeners.delete(fn);
  }

  async start() {
    const attach = (bridge: EvenAppBridge) => {
      if (this.bridge) return;
      this.bridge = bridge;
      bridge.onEvenHubEvent((ev) => this.onHubEvent(ev));
      this.lastLayout = null;
      this.paint();
    };
    const pending = waitForEvenAppBridge().then(attach, () => undefined);
    await Promise.race([pending, new Promise((r) => setTimeout(r, 2500))]);
    this.paint();
  }

  gesture(k: 'click' | 'double' | 'up' | 'down' | 'press' | 'release') {
    this.dispatch({ k, at: Date.now() });
  }

  pick(idx: number) {
    this.dispatch({ k: 'list', idx, at: Date.now() });
  }

  submitText(text: string) {
    const typed = beginTyped(this.state);
    if (typed.state === this.state) return;
    this.epoch++;
    this.apply(typed);
    this.apply(onTranscript(this.state, text));
  }

  private onHubEvent(ev: EvenHubEvent) {
    if (ev.audioEvent) {
      if (this.recording) this.chunks.push(ev.audioEvent.audioPcm);
      return;
    }
    const input = this.toInput(ev);
    if (!input) return;
    const key = input.k + ('idx' in input ? input.idx : '');
    const now = Date.now();
    if (this.lastGesture.key === key && now - this.lastGesture.at < 120) return;
    this.lastGesture = { key, at: now };
    this.dispatch(input);
  }

  private toInput(ev: EvenHubEvent): Input | null {
    const at = Date.now();
    if (ev.listEvent) {
      const t = ev.listEvent.eventType;
      if (t === undefined || t === OsEventTypeList.CLICK_EVENT) return { k: 'list', idx: ev.listEvent.currentSelectItemIndex ?? 0, at };
      if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) return { k: 'double', at };
      return null;
    }
    const t = ev.textEvent ? ev.textEvent.eventType : ev.sysEvent ? ev.sysEvent.eventType : undefined;
    if (!ev.textEvent && !ev.sysEvent) return null;
    if (ev.sysEvent?.imuData) return null;
    switch (t) {
      case undefined:
      case OsEventTypeList.CLICK_EVENT: return { k: 'click', at };
      case OsEventTypeList.DOUBLE_CLICK_EVENT: return { k: 'double', at };
      case OsEventTypeList.SCROLL_TOP_EVENT: return { k: 'up', at };
      case OsEventTypeList.SCROLL_BOTTOM_EVENT: return { k: 'down', at };
      case OsEventTypeList.LONG_PRESS_EVENT: return { k: 'press', at };
      case OsEventTypeList.LONG_PRESS_RELEASE_EVENT: return { k: 'release', at };
      default: return null;
    }
  }

  private dispatch(input: Input) {
    const wasBusy = this.state.screen.t === 'busy';
    const out = reduce(this.state, input);
    if (wasBusy && out.state.screen.t !== 'busy' && input.k !== 'fail') this.epoch++;
    this.apply(out);
  }

  private apply(out: { state: State; effects: Effect[] }) {
    this.state = out.state;
    this.paint();
    for (const e of out.effects) void this.run(e);
  }

  private settle(epoch: number, input: Input) {
    if (epoch !== this.epoch) return;
    this.dispatch(input);
  }

  private stableId(key: string) {
    let id = this.ids.get(key);
    if (!id) { id = crypto.randomUUID(); this.ids.set(key, id); }
    return id;
  }

  private async run(e: Effect) {
    const epoch = this.epoch;
    const fail = (err: unknown, retry: Effect | null) => this.settle(epoch, { k: 'fail', msg: errMsg(err), retry });
    try {
      switch (e.e) {
        case 'rec:start': return await this.recStart();
        case 'rec:cancel': return await this.recStop();
        case 'rec:stop': {
          const pcm = await this.recStop();
          if (pcm.length < MIN_PCM_BYTES) return fail(new Error('That was too short. Tap and speak a full sentence.'), null);
          const { text } = await api.stt(pcm);
          if (epoch !== this.epoch) return;
          this.apply(onTranscript(this.state, text));
          return;
        }
        case 'parse': {
          const { intent } = await api.parse(e.text);
          return this.settle(epoch, { k: 'intent', intent: intent, at: Date.now() });
        }
        case 'save': {
          const saveKey = e.r.whenISO + e.r.title;
          await api.saveReminder(e.r, this.stableId(saveKey));
          this.ids.delete(saveKey);
          return this.settle(epoch, { k: 'saved', r: e.r });
        }
        case 'snooze':
          await api.snooze(e.id, e.minutes).catch(() => undefined);
          return;
        case 'fetchNext': {
          const { event } = await api.next();
          return this.settle(epoch, { k: 'event', ev: event });
        }
        case 'fetchThreads': {
          const { threads } = await api.threads();
          return this.settle(epoch, { k: 'threads', items: threads });
        }
        case 'draft': {
          const d = await api.draft(e.thread.id, e.instruction, e.previous);
          return this.settle(epoch, { k: 'drafted', d, items: e.items });
        }
        case 'ask': {
          const brief = await api.ask(e.question);
          return this.settle(epoch, { k: 'brief', b: { title: brief.title, text: brief.text } });
        }
        case 'research': {
          const brief = await api.research();
          return this.settle(epoch, { k: 'brief', b: { title: brief.title, text: brief.text } });
        }
        case 'saveBooking': {
          const saveKey = 'booking:' + e.b.whenISO + e.b.title;
          await api.saveBooking(e.b, this.stableId(saveKey));
          this.ids.delete(saveKey);
          return this.settle(epoch, { k: 'bookingSaved', b: e.b });
        }
        case 'send': {
          const sendKey = 'send:' + e.d.threadId + e.d.text;
          const res = await api.send(e.d.threadId, e.d.text, this.stableId(sendKey));
          this.ids.delete(sendKey);
          return this.settle(epoch, { k: 'sent', name: res.name });
        }
      }
    } catch (err) {
      fail(err, e.e === 'rec:start' || e.e === 'rec:cancel' || e.e === 'rec:stop' ? null : e);
    }
  }

  private async recStart() {
    this.chunks = [];
    this.recording = true;
    if (this.recTimer) clearTimeout(this.recTimer);
    this.recTimer = setTimeout(() => { if (this.state.screen.t === 'listening') this.dispatch({ k: 'timeout', at: Date.now() }); }, MAX_RECORD_MS);
    if (!this.bridge) return;
    try {
      await this.bridge.audioControl(true, AudioInputSource.Glasses);
    } catch (err) {
      await this.recStop();
      throw err;
    }
  }

  private async recStop(): Promise<Uint8Array> {
    if (this.recTimer) clearTimeout(this.recTimer);
    this.recTimer = null;
    const was = this.recording;
    this.recording = false;
    if (was && this.bridge) await this.bridge.audioControl(false).catch(() => false);
    const chunks = this.chunks;
    this.chunks = [];
    return pcmToWav(chunks);
  }

  private paint() {
    const layout = render(this.state.screen, this.state.unread);
    for (const fn of this.listeners) fn(layout, this.state, this.inGlasses);
    if (!this.bridge) return;
    if (this.lastLayout && JSON.stringify(this.lastLayout) === JSON.stringify(layout)) return;
    const prev = this.lastLayout;
    this.lastLayout = layout;
    this.queue = this.queue.then(() => this.draw(layout, prev)).catch((err) => console.error('[glasses draw]', err instanceof Error ? err.message : JSON.stringify(err)));
  }

  private pageFor(layout: Layout) {
    const text = (c: { id: number; name: string }, content: string, y: number, h: number, capture: boolean) => new TextContainerProperty({
      xPosition: 0, yPosition: y, width: 576, height: h, containerID: c.id, containerName: c.name, content,
      isEventCapture: capture ? 1 : 0, paddingLength: 4, zOrderIndex: c.id,
    });
    const header = text(HEADER, layout.header, 0, 36, false);
    const footer = text(FOOTER, layout.footer, 244, 44, false);
    if (layout.kind === 'list') {
      return {
        containerTotalNum: 3,
        textObject: [header, footer],
        listObject: [new ListContainerProperty({
          xPosition: 0, yPosition: 44, width: 576, height: 196, containerID: BODY.id, containerName: BODY.name, isEventCapture: 1, paddingLength: 4, zOrderIndex: 2,
          itemContainer: new ListItemContainerProperty({ itemCount: layout.list!.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: layout.list! }),
        })],
      };
    }
    return { containerTotalNum: 3, textObject: [header, text(BODY, layout.body, 44, 196, true), footer] };
  }

  private async draw(layout: Layout, prev: Layout | null) {
    const bridge = this.bridge!;
    if (!this.created) {
      const res = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(this.pageFor(layout)));
      if (res !== StartUpPageCreateResult.success) {
        const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(this.pageFor(layout)));
        if (!rebuilt) throw new Error('Could not draw the first glasses page (create result ' + res + ')');
      }
      this.created = true;
      return;
    }
    if (prev && prev.kind === 'text' && layout.kind === 'text') {
      let ok = true;
      for (const [c, content] of [[HEADER, layout.header], [BODY, layout.body], [FOOTER, layout.footer]] as const) {
        ok = (await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: c.id, containerName: c.name, content }))) && ok;
      }
      if (ok) return;
    }
    if (!(await bridge.rebuildPageContainer(new RebuildPageContainer(this.pageFor(layout))))) throw new Error('The glasses did not accept the new page');
  }
}
