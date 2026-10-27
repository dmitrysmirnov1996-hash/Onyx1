// Запускает сервер (3001) и Vite (5173) одновременно, cross-platform.
// Использование: npm run dev  (из корня проекта)
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const procs = [
  { name: 'server', args: ['run', 'start'], cwd: join(root, 'server'), color: '\x1b[36m' },
  { name: 'web', args: ['run', 'dev'], cwd: join(root, 'web'), color: '\x1b[35m' },
];

const children = procs.map(({ name, args, cwd, color }) => {
  const p = spawn(npmCmd, args, { cwd, env: process.env, shell: false });
  const pipe = (stream) => stream.on('data', (d) => process.stdout.write(`${color}[${name}]\x1b[0m ${d}`));
  pipe(p.stdout);
  pipe(p.stderr);
  p.on('exit', (code) => {
    console.log(`${color}[${name}]\x1b[0m вышел с кодом ${code}`);
    // один из детей умер — глушим остальных
    for (const c of children) if (c !== p && !c.killed) c.kill();
    process.exit(code ?? 1);
  });
  return p;
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const p of children) p.kill();
    process.exit(0);
  });
}
