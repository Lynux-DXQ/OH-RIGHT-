import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.env.STORE_FILE || join(dirname(fileURLToPath(import.meta.url)), 'data', 'store.json');

let data = { reminders: [], ownerChatId: null, outbox: [], settings: { notify: false, muteUntil: 0 }, glassesQueue: [], businessConnections: {}, bookings: [] };
if (existsSync(FILE)) {
  try {
    const saved = JSON.parse(readFileSync(FILE, 'utf8'));
    data = { ...data, ...saved, settings: { ...data.settings, ...saved.settings } };
  } catch {
    renameSync(FILE, FILE + '.corrupt-' + Date.now());
    console.error('[store] store file was unreadable; moved aside and starting clean');
  }
}

export const store = {
  get data() { return data; },
  save() {
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    try {
      const fd = openSync(tmp, 'r+');
      fsyncSync(fd);
      closeSync(fd);
    } catch { /* fsync is best effort */ }
    renameSync(tmp, FILE);
  },
};
