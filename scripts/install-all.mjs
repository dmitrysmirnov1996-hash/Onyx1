// Ставит зависимости сервера и веб-клиента (cross-platform, без "&").
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const dir of ['server', 'web']) {
  console.log(`> npm install —prefix ${dir}`);
  const r = spawnSync(npmCmd, ['install', '--prefix', dir, '--no-audit', '--no-fund'], {
    cwd: root, stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
