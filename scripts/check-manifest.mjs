import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));
const hosts = manifest.permissions.filter((p) => p.name === 'network').flatMap((p) => p.whitelist ?? []);
const bad = hosts.filter((h) => !/^https:\/\//.test(h) || /YOUR-BACKEND-HOST/i.test(h));
if (!hosts.length || bad.length) {
  console.error('app.json network whitelist must list your real HTTPS backend host. Found: ' + JSON.stringify(hosts));
  process.exit(1);
}
if (!process.env.VITE_API_BASE) {
  console.error('Set VITE_API_BASE to your backend URL before packing, e.g. VITE_API_BASE=https://api.example.com npm run pack');
  process.exit(1);
}
