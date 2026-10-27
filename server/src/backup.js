/* =============================================================
   Персистентность на бесплатном Render: диск эфемерный, каждый
   деплой стирает data/ (аккаунты, чаты, сообщения, сессии).
   Решение: сервер сам хранит снапшот БД в приватном GitHub-репо:
   • при старте — восстанавливает БД из снапшота, если своя пустая;
   • каждые 20 минут и перед стопом — выгружает свежий снапшот.
   Требуется env GITHUB_TOKEN (Personal Access Token с repo-доступом).
   ============================================================= */
import { db } from './db.js';

const OWNER = process.env.GITHUB_OWNER || 'dmitrysmirnov1996-hash';
const REPO = process.env.GITHUB_BACKUP_REPO || 'Onyx1-app-data';
const TOKEN = process.env.GITHUB_TOKEN || '';
const PATH = 'data/backup.json';
const TABLES = [
  'users', 'sessions', 'chats', 'members', 'messages', 'reactions',
  'poll_votes', 'stories', 'story_views', 'calls', 'msg_hides',
];

const gh = (path, opts = {}) => fetch('https://api.github.com' + path, {
  ...opts,
  headers: {
    authorization: `Bearer ${TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'onyx-backup/1',
    ...(opts.body ? { 'content-type': 'application/json' } : {}),
  },
});

function snapshot() {
  const out = { at: Date.now(), tables: {} };
  for (const t of TABLES) out.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return JSON.stringify(out);
}

function restoreIfEmpty(json) {
  try {
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (users > 0) return false;
    const data = JSON.parse(json);
    db.exec('BEGIN');
    for (const t of TABLES) {
      const rows = data.tables?.[t] ?? [];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const st = db.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) st.run(...cols.map((c) => r[c]));
    }
    db.exec('COMMIT');
    const n = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    console.log(`[backup] БД восстановлена из снапшота (${n} пользователей)`);
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[backup] восстановление не удалось:', e.message);
    return false;
  }
}

async function getRemote() {
  if (!TOKEN) return null;
  try {
    const r = await gh(`/repos/${OWNER}/${REPO}/contents/${PATH}`);
    if (!r.ok) return null;
    const j = await r.json();
    return { sha: j.sha, content: Buffer.from(j.content, 'base64').toString('utf8') };
  } catch { return null; }
}

async function ensureRepo() {
  if (!TOKEN) return;
  try {
    const r = await gh(`/repos/${OWNER}/${REPO}`);
    if (r.ok) return;
    const c = await gh('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: REPO,
        private: true,
        description: 'Бэкапы БД Onyx (создаётся автоматически)',
        auto_init: false,
      }),
    });
    if (c.ok) console.log(`[backup] создан приватный репо ${OWNER}/${REPO}`);
    else console.error('[backup] не удалось создать репо:', c.status);
  } catch (e) { console.error('[backup] create repo error:', e.message); }
}

export async function pushBackup() {
  if (!TOKEN) return;
  try {
    const remote = await getRemote();
    const body = {
      message: 'snapshot ' + new Date().toISOString(),
      content: Buffer.from(snapshot()).toString('base64'),
    };
    if (remote) body.sha = remote.sha;
    const r = await gh(`/repos/${OWNER}/${REPO}/contents/${PATH}`, { method: 'PUT', body: JSON.stringify(body) });
    if (r.ok) console.log('[backup] снапшот выгружен в GitHub');
    else console.error('[backup] выгрузка не удалась:', r.status);
  } catch (e) {
    console.error('[backup] выгрузка ошибка:', e.message);
  }
}

export async function initBackup() {
  if (!TOKEN) { console.log('[backup] GITHUB_TOKEN не задан — сохранение после пересборки отключено'); return; }
  await ensureRepo();
  const remote = await getRemote();
  if (remote) {
    restoreIfEmpty(remote.content);
  } else {
    await pushBackup();
  }
}

export function startBackupLoop() {
  if (!TOKEN) return;
  const tick = () => pushBackup().catch((e) => console.error('[backup]:', e.message));
  tick();
  setInterval(tick, 20 * 60 * 1000);
  /* Render присылает SIGTERM перед остановкой сервиса — успеваем выгрузить */
  process.on('SIGTERM', () => { pushBackup().catch(() => {}).finally?.(() => {}); });
}
