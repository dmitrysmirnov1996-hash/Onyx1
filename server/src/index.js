import express from 'express';
import http from 'node:http';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import multer from 'multer';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApi } from './api.js';
import {
  db, userByField, updateUser, cleanupExpiredStories,
  sessionByToken, touchSession, shapeUser, publicUser,
  myChatIds, callById, privateChatBetween, ensurePrivateCallChat,
  chatMembers, systemMessage, chatById, shapeChat,
} from './db.js';
import { onlineMap, userSockets, presenceJoin, presenceLeave, isOnline } from './state.js';
import { parseJSON, uid } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });

app.use(express.json({ limit: '12mb' }));

// статика загруженных файлов
app.use('/uploads', express.static(join(__dirname, '..', '..', 'uploads'), { maxAge: '7d', immutable: true }));

const { api, ensureChatsJoined, emitToUser, emitChat, emitForceLogout } = buildApi(io);
app.use('/api', api);

/* ---------- upload (отдельный роут) ---------- */
const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
};
const kindOf = (mime, name = '') => {
  if (mime === 'image/gif' || /\.gif$/i.test(name)) return 'gif';
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
};
const uploadsDir = join(__dirname, '..', '..', 'uploads');
mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = EXT[file.mimetype] || (file.originalname || '').match(/\.[a-z0-9]{1,6}$/i)?.[0]?.toLowerCase() || '';
    cb(null, `${Date.now().toString(36)}-${uid().slice(0, 10)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 512 * 1024 * 1024, files: 1 } });

app.post('/api/upload', (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const session = sessionByToken(token);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.userId = session.user_id;
  touchSession(token);
  next();
}, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const f = req.file;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  res.json({
    url: `/uploads/${f.filename}`,
    kind: kindOf(f.mimetype, f.originalname),
    mime: f.mimetype,
    name: f.originalname || f.filename,
    size: f.size,
    w: num(req.body.w), h: num(req.body.h), dur: num(req.body.dur),
  });
});

/* ---------- импорт стикер-пака по ссылке t.me (превьюшки пака как свои стикеры) ---------- */
app.get('/api/stickers/import', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const session = sessionByToken(token);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  touchSession(token);
  const name = String(req.query.pack || '').trim().replace(/^.*addstickers\//i, '').replace(/^@/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!name) return res.status(400).json({ error: 'no_pack' });
  (async () => {
    // t.me может быть блокирован (например, на хостинге в РФ) — пробуем оба домена
    let urls = null;
    for (const src of [`https://t.me/addstickers/${name}`, `https://telegram.me/addstickers/${name}`]) {
      try {
        const r = await fetch(src, {
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) continue;
        const html = await r.text();
        // на странице пака Telegram отдаёт прямые превьюшки (webp/webm)
        const found = [...new Set((html.match(/https:\/\/[^"'()\s]+?\.(?:webp|webm)/gi) || []))];
        if (found.length) { urls = found; break; }
      } catch {}
    }
    if (!urls) return res.status(502).json({ error: 'pack_unreachable' });
    res.json({ pack: name, stickers: urls.slice(0, 60) });
  })().catch(() => res.status(500).json({ error: 'server_error' }).end());
});

/* ---------- SPA ---------- */
const distDir = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|uploads|socket\.io).*/, (req, res) => res.sendFile(join(distDir, 'index.html')));
}

/* ---------- 404 + errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => {
  console.error('[err]', err?.message ?? err);
  if (res.headersSent) return next(err);
  res.status(err?.status ?? 500).json({ error: 'server_error', detail: String(err?.message ?? err).slice(0, 200) });
});

/* ---------- Socket.IO ---------- */
io.use((socket, next) => {
  let token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (token?.startsWith('Bearer ')) token = token.slice(7);
  const session = sessionByToken(token);
  if (!session) return next(new Error('unauthorized'));
  socket.uid = session.user_id;
  socket.token = token;
  sessionByToken(token) && touchSession(token);
  next();
});

/* «Режим призрака»: settings.privacy.online === false — не светим присутствие */
const ghostOf = (userId) => {
  try { return userByField('id', userId)?.settings?.privacy?.online === false; } catch { return false; }
};

io.on('connection', async (socket) => {
  const uidVal = socket.uid;
  socket.join(`sess:${socket.token}`);
  ensureChatsJoined(socket, uidVal);
  const first = presenceJoin(uidVal, socket);

  if (first && !ghostOf(uidVal)) {
    updateUser(uidVal, { last_seen: Date.now() });
    io.emit('presence', { id: uidVal, online: true });
  }

  socket.on('typing', (data = {}) => {
    const { chatId, kind } = data;
    if (!chatId) return;
    if (kind === null) return socket.to(`chat:${chatId}`).emit('typing', { chatId, userId: uidVal, kind: null });
    const u = userByField('id', uidVal);
    socket.to(`chat:${chatId}`).emit('typing', { chatId, userId: uidVal, kind, name: u?.name ?? '' });
  });

  socket.on('chat:join-room', ({ chatId } = {}) => {
    try {
      if (myChatIds(uidVal).includes(chatId)) socket.join(`chat:${chatId}`);
    } catch {}
  });

  /* ---------- звонки ---------- */
  const ringTimers = new Map();

  // Активный звонок пользователя (ringing/accepted) — для busy-детекта
  const busyCallOf = (userId) => db.prepare(
    `SELECT * FROM calls WHERE (a = ? OR b = ?) AND status IN ('ringing', 'accepted')
     ORDER BY created_at DESC LIMIT 1`
  ).get(userId, userId);

  // Служебное сообщение о звонке в чате (механика Telegram: звонки попадают в историю чата)
  const logCall = (call, status, durationSec = 0) => {
    try {
      if (!call?.a || !call?.b || call.a === call.b) return;
      const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      const text =
        status === 'missed' ? '📞 Пропущенный звонок' :
        status === 'declined' ? '📞 Звонок отклонён' :
        status === 'busy' ? '📞 Занято' :
        status === 'unavailable' ? '📞 Пользователь недоступен' :
        durationSec > 0 ? `📞 Звонок · ${fmt(durationSec)}` : '📞 Звонок';
      let cid = privateChatBetween(call.a, call.b);
      let created = false;
      if (!cid) { const r = ensurePrivateCallChat(call.a, call.b); cid = r.id; created = true; }
      if (!cid) return;
      const m = systemMessage(cid, text);
      io.to(`chat:${cid}`).emit('msg:new', { chatId: cid, message: { ...m, reactions: [] } });
      if (created) {
        const members = chatMembers(cid);
        const row = chatById(cid);
        if (row) {
          const chat = { ...shapeChat(row), members: undefined };
          const users = members.map((x) => x.user);
          for (const mm of members) {
            for (const s of userSockets.get(mm.userId) ?? []) s.emit('chat:new', { chat, users });
          }
        }
      }
    } catch (e) { console.error('logCall', e.message); }
  };

  socket.on('call:start', (d = {}) => {
    try {
      const { callId, to, kind = 'voice' } = d;
      if (!callId || !to) return;
      const target = userByField('id', to);
      if (!target || !isOnline(to)) {
        socket.emit('call:ended', { callId, reason: 'unavailable' });
        return;
      }
      const set = userSockets.get(to);
      if (!set?.size) { socket.emit('call:ended', { callId, reason: 'unavailable' }); return; }
      // busy: адресат уже разговаривает/звонит (механика tdesktop)
      const busy = busyCallOf(to);
      if (busy) {
        socket.emit('call:ended', { callId, reason: 'busy' });
        return;
      }
      db.prepare('INSERT OR REPLACE INTO calls (id, kind, a, b, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(callId, kind, uidVal, to, 'ringing', Date.now());
      for (const s of set) s.emit('call:incoming', { callId, from: uidVal, kind });
      socket.emit('call:ringing', { callId, to });
      const timer = setTimeout(() => {
        const call = callById(callId);
        if (call?.status === 'ringing') {
          db.prepare('UPDATE calls SET status = ?, ended_at = ? WHERE id = ?').run('missed', Date.now(), callId);
          for (const s of set) s.emit('call:ended', { callId, reason: 'missed' });
          socket.emit('call:ended', { callId, reason: 'missed' });
          logCall(call, 'missed');
        }
        ringTimers.delete(callId);
      }, 45000);
      ringTimers.set(callId, { timer, set });
    } catch (e) { console.error('call:start', e.message); }
  });

  socket.on('call:accept', ({ callId } = {}) => {
    if (!callId) return;
    db.prepare('UPDATE calls SET status = ?, accepted_at = ? WHERE id = ? AND status = ?')
      .run('accepted', Date.now(), callId, 'ringing');
    const call = callById(callId);
    if (call) {
      const t = ringTimers.get(callId);
      if (t) { clearTimeout(t.timer); ringTimers.delete(callId); }
      const other = call.a === uidVal ? call.b : call.a;
      const set = userSockets.get(other);
      if (set) for (const s of set) s.emit('call:accepted', { callId });
    }
  });

  socket.on('call:decline', ({ callId } = {}) => {
    if (!callId) return;
    const call = callById(callId);
    if (!call) return;
    db.prepare('UPDATE calls SET status = ?, ended_at = ? WHERE id = ?').run('declined', Date.now(), callId);
    const t = ringTimers.get(callId);
    if (t) { clearTimeout(t.timer); ringTimers.delete(callId); }
    const other = call.a === uidVal ? call.b : call.a;
    const set = userSockets.get(other);
    if (set) for (const s of set) s.emit('call:ended', { callId, reason: 'declined' });
    logCall(call, 'declined');
  });

  socket.on('call:end', ({ callId } = {}) => {
    if (!callId) return;
    const call = callById(callId);
    if (!call) return;
    const t = ringTimers.get(callId);
    if (t) { clearTimeout(t.timer); ringTimers.delete(callId); }
    if (call.status === 'accepted') {
      const ended = Date.now();
      const duration = Math.round((ended - (call.accepted_at ?? call.created_at)) / 1000);
      db.prepare('UPDATE calls SET status = ?, ended_at = ?, duration = ? WHERE id = ?')
        .run('ended', ended, duration, callId);
      const other = call.a === uidVal ? call.b : call.a;
      const set = userSockets.get(other);
      if (set) for (const s of set) s.emit('call:ended', { callId, reason: 'ended' });
      logCall(call, 'ended', duration);
    } else {
      // Отмена до ответа = пропущенный звонок у вызываемого
      db.prepare('UPDATE calls SET status = ?, ended_at = ? WHERE id = ?').run('missed', Date.now(), callId);
      const other = call.a === uidVal ? call.b : call.a;
      const set = userSockets.get(other);
      if (set) for (const s of set) s.emit('call:ended', { callId, reason: 'missed' });
      logCall(call, 'missed');
    }
  });

  socket.on('call:signal', ({ callId, to, data } = {}) => {
    if (!callId || !to || !data) return;
    const set = userSockets.get(to);
    if (set) for (const s of set) s.emit('call:signal', { callId, from: uidVal, data });
  });

  socket.on('call:state', ({ callId, from, to, data } = {}) => {
    const set = userSockets.get(to);
    if (set) for (const s of set) s.emit('call:state', { callId, from, data });
  });

  socket.on('disconnect', async () => {
    const went = presenceLeave(uidVal, socket);
    if (went && !ghostOf(uidVal)) {
      updateUser(uidVal, { last_seen: Date.now() });
      io.emit('presence', { id: uidVal, online: false, lastSeen: Date.now() });
      // активный звонок умер вместе с сокетом — честно закрываем его (иначе busy-навсегда)
      try {
        const active = db.prepare(
          `SELECT * FROM calls WHERE (a = ? OR b = ?) AND status IN ('ringing', 'accepted')
           ORDER BY created_at DESC LIMIT 1`
        ).get(uidVal, uidVal);
        if (active) {
          const other = active.a === uidVal ? active.b : active.a;
          const missed = active.status === 'ringing';
          db.prepare('UPDATE calls SET status = ?, ended_at = ? WHERE id = ?')
            .run(missed ? 'missed' : 'ended', Date.now(), active.id);
          const set = userSockets.get(other);
          if (set) for (const s of set) s.emit('call:ended', { callId: active.id, reason: missed ? 'missed' : 'ended' });
          logCall(active, missed ? 'missed' : 'ended', missed ? 0 : Math.max(0, Math.round((Date.now() - (active.accepted_at ?? active.created_at)) / 1000)));
        }
      } catch (e) { console.error('disconnect call cleanup', e.message); }
    }
  });
});

/* ---------- фоновые задачи ---------- */
setInterval(() => {
  try { db.exec(`DELETE FROM reactions WHERE message_id NOT IN (SELECT id FROM messages)`); } catch {}
}, 60_000);
setInterval(() => {
  try { cleanupExpiredStories(); } catch {}
}, 5 * 60_000);

server.listen(PORT, () => {
  console.log(`✅ Telegram Clone server: http://localhost:${PORT}`);
});
