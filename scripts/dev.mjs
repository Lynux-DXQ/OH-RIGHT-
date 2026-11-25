import { spawn } from 'node:child_process';

const run = (name, args) => {
  const p = spawn(process.execPath, args, { stdio: 'inherit' });
  p.on('exit', (code) => { console.log('[' + name + '] exited with ' + code); process.exit(code ?? 1); });
  return p;
};

const server = run('server', ['server/index.mjs']);
const vite = run('app', ['node_modules/vite/bin/vite.js', '--config', 'app/vite.config.ts']);
process.on('SIGINT', () => { server.kill(); vite.kill(); process.exit(0); });
