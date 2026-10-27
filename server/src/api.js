import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  db, createUser, updateUser, userByField, shapeUser, publicUser, getDefaultSettings, searchUsers,
  createSession, sessionByToken, touchSession, deleteSession, deleteAllSessions, deleteSessionOther, listSessions,
  createChat, upsertMember, memberOf, updateMember, chatById, chatMembers, myChats, myChatIds,
  insertMessage, msgById, shapeMessage, messagesPage, lastMessageOf, pinnedMessage,
  reactionsOf, toggleReaction, pollVotesOf, castPollVote,
  insertStory, activeStories, storiesOfUser, storyById, storyViews, viewStory, shapeStory,
  insertCall, updateCall, callById, callHistory, systemMessage, releaseScheduled, cleanupExpiredStories,
  hideMessage, allUsers,
} from './db.js';
import { uid, genToken, now, deepMerge, parseJSON, validUsername, validPassword, clamp } from './util.js';
import { genSecret, verify as totpVerify, otpauthUrl } from './totp.js';

const publicUserSafe = (u) => {
  const p = publicUser(u, false);
  delete p.twofa;
  return p;
};

function attachMeta(messages) {
  const ids = messages.map((m) => m.id);
  const reactMap = reactionsOf(ids);
  for (const m of messages) {
    m.reactions = reactMap.get(m.id) ?? [];
    if (m.type === 'poll' && m.poll) m.poll.votes = pollVotesOf(m.id);
    if (m.replyTo) {
      const r = msgById(m.replyTo);
      m.replyPreview = r ? { id: r.id, sender: r.sender, type: r.type, text: r.deleted ? '' : r.text, media: r.deleted ? null : (r.media && r.type !== 'sticker' ? { kind: r.media.kind, url: r.media.url } : null), deleted: r.deleted } : null;
    }
  }
  return messages;
}

const rateMap = new Map();
/* Лимитер считает ТОЛЬКО неудачные попытки (4xx): успешные входы/регистрации
   не расходуют лимит, анти-брутфорс при этом сохраняется. */
function failLimit(req, res, key, max, windowMs) {
  const k = `${req.ip}:${key}`;
  const rec = rateMap.get(k) ?? { count: 0, reset: now() + windowMs };
  if (rec.reset < now()) { rec.count = 0; rec.reset = now() + windowMs; }
  rateMap.set(k, rec);
  if (rec.count >= max) return false;
  res.on('finish', () => { if (res.statusCode >= 400) rec.count++; });
  return true;
}
const rateClear = (ip, key) => {
  const rec = rateMap.get(`${ip}:${key}`);
  if (rec) { rec.count = 0; rec.reset = now() + 60_000; }
};

export function buildApi(io) {
  const api = Router();

  const emitToUser = (uidVal, event, data) => io.to(`user:${uidVal}`).emit(event, data);
  const emitChat = (chatId, event, data) => io.to(`chat:${chatId}`).emit(event, data);
  const ensureChatsJoined = (socket, userId) => {
    socket.join(`user:${userId}`);
    for (const id of myChatIds(userId)) socket.join(`chat:${id}`);
  };

  /* ---------- auth middleware ---------- */
  const auth = (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const session = sessionByToken(token);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    req.user = userByField('id', session.user_id);
    req.session = session;
    touchSession(token);
    next();
  };

  const needAdmin = (chatId, userId) => {
    const m = memberOf(chatId, userId);
    return m && (m.role === 'owner' || m.role === 'admin') ? m : null;
  };

  /* ---------- auth routes ---------- */

  api.post('/auth/register', (req, res) => {
    if (!failLimit(req, res, 'reg', 12, 60_000)) return res.status(429).json({ error: 'too_many' });
    const { username, name, password } = req.body ?? {};
    if (!validUsername(username ?? '')) return res.status(400).json({ error: 'bad_username', detail: '3–32 символа: латиница, цифры, _' });
    if (!validPassword(password)) return res.status(400).json({ error: 'bad_password', detail: 'минимум 6 символов' });
    if (userByField('username', username.toLowerCase())) return res.status(409).json({ error: 'username_taken' });
    const hash = bcrypt.hashSync(password, 10);
    const id = uid();
    const settings = getDefaultSettings();
    createUser({ id, username: username.toLowerCase(), name: (name || username).slice(0, 64), passwordHash: hash, createdAt: now(), lastSeen: now() });
    updateUser(id, { settings: JSON.stringify(settings) });
    const token = genToken();
    createSession(token, id, String(req.headers['user-agent'] ?? '').slice(0, 120));
    res.json({ token, user: meResponse(userByField('id', id)) });
    io.emit('user:updated', publicUserSafe(userByField('id', id)));
  });

  api.post('/auth/login', (req, res) => {
    const allow = failLimit(req, res, 'login', 15, 60_000);
    const { username, password, totp: code } = req.body ?? {};
    const user = userByField('username', String(username ?? '').toLowerCase());
    let failError = null;
    if (!user || !bcrypt.compareSync(String(password ?? ''), user.passwordHash)) failError = 'bad_credentials';
    else if (user.twofa) {
      if (!code) failError = 'need_2fa';
      else if (!totpVerify(user.totpSecret, code)) failError = 'bad_2fa';
    }
    if (failError) {
      /* даже при исчерпанном лимите корректные данные пускают — 429 только для неверных */
      if (!allow) return res.status(429).json({ error: 'too_many' });
      return res.status(401).json({ error: failError });
    }
    rateClear(req.ip, 'login');
    const token = genToken();
    createSession(token, user.id, String(req.headers['user-agent'] ?? '').slice(0, 120));
    res.json({ token, user: meResponse(user) });
  });

  api.post('/auth/logout', auth, (req, res) => {
    deleteSession(req.session.token);
    res.json({});
  });
  api.post('/auth/logout_all', auth, (req, res) => {
    deleteAllSessions(req.user.id);
    res.json({});
  });

  api.post('/auth/2fa/setup', auth, (req, res) => {
    const secret = genSecret();
    updateUser(req.user.id, { totp_secret: secret });
    res.json({ secret, otpauth: otpauthUrl(secret, req.user.username) });
  });
  api.post('/auth/2fa/enable', auth, (req, res) => {
    const u = userByField('id', req.user.id);
    if (!u.totpSecret) return res.status(400).json({ error: 'no_secret' });
    if (!totpVerify(u.totpSecret, req.body?.code)) return res.status(400).json({ error: 'bad_code' });
    updateUser(u.id, { twofa: 1 });
    res.json({ ok: true });
  });
  api.post('/auth/2fa/disable', auth, (req, res) => {
    const u = userByField('id', req.user.id);
    if (!totpVerify(u.totpSecret, req.body?.code)) return res.status(400).json({ error: 'bad_code' });
    updateUser(u.id, { twofa: 0, totp_secret: null });
    res.json({ ok: true });
  });

  function meResponse(u) {
    const { passwordHash, totpSecret, ...rest } = shapeUser(u);
    return { ...rest, twofa: !!u.twofa };
  }

  /* ---------- me / users ---------- */

  api.get('/me', auth, (req, res) => res.json(meResponse(req.user)));

  api.patch('/me', auth, (req, res) => {
    const b = req.body ?? {};
    const fields = {};
    if (typeof b.name === 'string') fields.name = b.name.slice(0, 64);
    if (typeof b.bio === 'string') fields.bio = b.bio.slice(0, 280);
    if (typeof b.username === 'string') {
      const un = b.username.toLowerCase();
      if (!validUsername(un)) return res.status(400).json({ error: 'bad_username' });
      const taken = userByField('username', un);
      if (taken && taken.id !== req.user.id) return res.status(409).json({ error: 'username_taken' });
      fields.username = un;
    }
    if (b.avatar === null || (b.avatar && typeof b.avatar.url === 'string')) fields.avatar = JSON.stringify(b.avatar);
    if (b.cover === null || (b.cover && typeof b.cover.url === 'string')) fields.cover = JSON.stringify(b.cover);
    if (b.password && typeof b.password === 'string') fields.password_hash = bcrypt.hashSync(b.password, 10);
    if (b.settings && typeof b.settings === 'object') {
      // wallpaper — атомарное поле: null = сброс, объект = замена целиком (не deep-merge),
      // иначе нельзя «вернуть стандартный фон» и пресеты наследуют старые свойства
      const patch = { ...b.settings };
      let wpReplace;
      if ('wallpaper' in patch) { wpReplace = patch.wallpaper ?? null; delete patch.wallpaper; }
      const merged = deepMerge(req.user.settings, patch);
      if (wpReplace !== undefined) merged.wallpaper = wpReplace;
      fields.settings = JSON.stringify(merged);
    }
    updateUser(req.user.id, fields);
    const fresh = userByField('id', req.user.id);
    io.emit('user:updated', publicUserSafe(fresh));
    // переключение «Режима призрака» на лету: прячем/показываем присутствие всем
    if (Object.prototype.hasOwnProperty.call(b.settings?.privacy ?? {}, 'online')) {
      if (b.settings.privacy.online === false) io.emit('presence', { id: req.user.id, online: false, lastSeen: Date.now() });
      else { updateUser(req.user.id, { last_seen: Date.now() }); io.emit('presence', { id: req.user.id, online: true }); }
    }
    res.json(meResponse(fresh));
  });

  /* «Сбросить настройки»: заводские настройки + удаление персональных обоев на чатах.
     Личность (имя/юзернейм/аватар) и контент (сообщения/истории) не трогаем. */
  api.post('/me/reset', auth, (req, res) => {
    updateUser(req.user.id, { settings: JSON.stringify(getDefaultSettings()) });
    const hit = db.prepare(`SELECT chat_id FROM members WHERE user_id = ? AND wallpaper IS NOT NULL AND wallpaper != 'null'`).all(req.user.id);
    db.prepare(`UPDATE members SET wallpaper = 'null' WHERE user_id = ?`).run(req.user.id);
    const chatIds = (hit ?? []).map((r) => r.chat_id);
    const fresh = userByField('id', req.user.id);
    io.emit('user:updated', publicUserSafe(fresh));
    for (const cid of chatIds) emitChat(cid, 'chat:updated', chatFull(cid));
    // после сброса privacy.online снова true — если сидели в «Призраке», возвращаемся в сети
    if (fresh.settings?.privacy?.online !== false) {
      updateUser(req.user.id, { last_seen: Date.now() });
      io.emit('presence', { id: req.user.id, online: true });
    }
    res.json(meResponse(fresh));
  });

  api.get('/sync', auth, (req, res) => {
    const chats = myChats(req.user.id);
    const users = new Map();
    const membersAll = db.prepare(`SELECT DISTINCT u.* FROM members m JOIN users u ON u.id = m.user_id WHERE m.chat_id IN (SELECT chat_id FROM members WHERE user_id = ?)`).all(req.user.id);
    for (const row of membersAll) users.set(row.id, publicUserSafe(shapeUser(row)));
    const stories = activeStories();
    const storyUserIds = [...new Set(stories.map((s) => s.userId))];
    for (const id of storyUserIds) {
      if (!users.has(id)) {
        const u = userByField('id', id);
        if (u) users.set(id, publicUserSafe(u));
      }
    }
    for (const s of stories) {
      s.viewed = !!db.prepare('SELECT 1 FROM story_views WHERE story_id = ? AND user_id = ?').get(s.id, req.user.id);
    }
    res.json({
      me: meResponse(req.user),
      chats,
      users: [...users.values()],
      stories,
      onlineIds: [...onlineMap.entries()].filter(([, n]) => n > 0).map(([id]) => id),
    });
  });

  api.get('/users', auth, (req, res) => {
    /* ?all=1 — телефонная книга: все зарегистрированные юзеры */
    if (String(req.query.all ?? '') === '1') {
      return res.json(allUsers(req.user.id).map(publicUserSafe));
    }
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json([]);
    res.json(searchUsers(q, req.user.id).map(publicUserSafe));
  });

  api.get('/users/:id', auth, (req, res) => {
    const u = userByField('id', req.params.id);
    if (!u) return res.status(404).json({ error: 'not_found' });
    const pu = publicUserSafe(u);
    pu.stories = storiesOfUser(u.id, u.id === req.user.id).filter((s) => s.archived || s.expiresAt > now());
    if (u.id === req.user.id) {
      pu.sessionsCount = listSessions(u.id).length;
    }
    res.json(pu);
  });

  api.patch('/me/password', auth, (req, res) => {
    const { old: oldP, password } = req.body ?? {};
    if (!bcrypt.compareSync(String(oldP ?? ''), req.user.passwordHash)) return res.status(403).json({ error: 'wrong_password' });
    if (!validPassword(password)) return res.status(400).json({ error: 'bad_password' });
    updateUser(req.user.id, { password_hash: bcrypt.hashSync(password, 10) });
    res.json({ ok: true });
  });

  /* ---------- chats ---------- */

  api.get('/chats', auth, (req, res) => res.json(myChats(req.user.id)));

  api.post('/chats', auth, (req, res) => {
    const { type = 'private', userIds = [], title } = req.body ?? {};
    if (type === 'private') {
      const peerId = userIds[0];
      // «Избранное» — приватный чат с самим собой, отдельный путь
      if (peerId === req.user.id) {
        const exist = db.prepare(`
          SELECT c.id FROM chats c
          JOIN members m ON m.chat_id = c.id
          WHERE c.type = 'private'
          GROUP BY c.id
          HAVING COUNT(DISTINCT m.user_id) = 1 AND SUM(CASE WHEN m.user_id = ? THEN 1 ELSE 0 END) = 1
          ORDER BY c.created_at DESC LIMIT 1
        `).get(req.user.id);
        if (exist) return res.json(chatFull(exist.id));
        const id = uid();
        createChat({ id, type, createdBy: req.user.id, createdAt: now() });
        upsertMember(id, req.user.id, 'owner');
        broadcastChatNew(chatFull(id));
        return res.json(chatFull(id));
      }
      const peer = userByField('id', peerId);
      if (!peer) return res.status(404).json({ error: 'user_not_found' });
      const exist = db.prepare(`
        SELECT c.id FROM chats c
        JOIN members m1 ON m1.chat_id = c.id AND m1.user_id = ?
        JOIN members m2 ON m2.chat_id = c.id AND m2.user_id = ?
        WHERE c.type = 'private' AND (SELECT COUNT(*) FROM members WHERE chat_id = c.id) = 2 LIMIT 1
      `).get(req.user.id, peerId);
      if (exist) return res.json(chatFull(exist.id));
      const id = uid();
      createChat({ id, type, createdBy: req.user.id, createdAt: now() });
      upsertMember(id, req.user.id, 'owner');
      upsertMember(id, peerId, 'member');
      broadcastChatNew(chatFull(id));
      return res.json(chatFull(id));
    }
    if (!title || !title.trim()) return res.status(400).json({ error: 'need_title' });
    const id = uid();
    createChat({ id, type, title: title.trim().slice(0, 128), createdBy: req.user.id, createdAt: now() });
    upsertMember(id, req.user.id, 'owner');
    for (const pid of (type === 'channel' ? userIds.slice(0, 50) : userIds).slice(0, 50)) {
      if (userByField('id', pid)) upsertMember(id, pid);
    }
    const sys = systemMessage(id, `${req.user.name} создал(а) ${type === 'channel' ? 'канал' : 'группу'} «${title.trim()}»`);
    broadcastChatNew(chatFull(id));
    emitChat(id, 'msg:new', newMsgPayload(sys));
    res.json(chatFull(id));
  });

  function chatFull(id) {
    if (id && typeof id === 'object') return id; // already full
    const chat = chatById(id);
    if (!chat) return null;
    chat.members = chatMembers(id);
    const pinned = pinnedMessage(id);
    return { ...chat, pinnedMessage: pinned ? { id: pinned.id, sender: pinned.sender, type: pinned.type, text: pinned.text, deleted: pinned.deleted } : null };
  }

  function newMsgPayload(m) { return { chatId: m.chatId, message: attachMeta([m])[0] }; }
  function broadcastChatNew(chat) {
    if (!chat) return;
    for (const m of chat.members) emitToUser(m.userId, 'chat:new', { chat: { ...chat, members: undefined }, users: chat.members.map((mm) => mm.user) });
  }

  api.post('/chats/:id/join-room', auth, (req, res) => { // восстановление комнат после создания чата
    const sockets = userSockets.get(req.user.id);
    if (sockets) for (const s of sockets) s.join(`chat:${req.params.id}`);
    res.json({});
  });

  api.get('/chats/:id', auth, (req, res) => {
    const chat = chatFull(req.params.id);
    if (!chat) return res.status(404).json({ error: 'not_found' });
    if (!memberOf(req.params.id, req.user.id)) return res.status(403).json({ error: 'forbidden' });
    res.json(chat);
  });

  api.patch('/chats/:id', auth, (req, res) => {
    const chat = chatById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'not_found' });
    const m = memberOf(req.params.id, req.user.id);
    const priv = chat.type === 'private';
    if (!priv && !(m && (m.role === 'owner' || m.role === 'admin'))) return res.status(403).json({ error: 'forbidden' });
    const b = req.body ?? {};
    const sets = [], vals = [];
    if (typeof b.title === 'string') { sets.push('title = ?'); vals.push(b.title.slice(0, 128)); }
    if (typeof b.about === 'string') { sets.push('about = ?'); vals.push(b.about.slice(0, 256)); }
    if (b.avatar === null || (b.avatar && typeof b.avatar.url === 'string')) { sets.push('avatar = ?'); vals.push(JSON.stringify(b.avatar)); }
    if (b.wallpaper === null || (b.wallpaper && typeof b.wallpaper === 'object')) { sets.push('wallpaper = ?'); vals.push(JSON.stringify(b.wallpaper)); }
    if (sets.length) {
      vals.push(req.params.id);
      db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      const sys = systemMessage(req.params.id, 'Настройки чата изменены');
      emitChat(req.params.id, 'msg:new', newMsgPayload(sys));
    }
    const fresh = chatFull(req.params.id);
    emitChat(req.params.id, 'chat:updated', fresh);
    res.json(fresh);
  });

  api.post('/chats/join/:id', auth, (req, res) => {
    const chat = chatById(req.params.id);
    if (!chat || chat.type === 'private') return res.status(404).json({ error: 'not_found' });
    if (memberOf(req.params.id, req.user.id)) return res.json(chatFull(req.params.id));
    upsertMember(req.params.id, req.user.id);
    const sys = systemMessage(req.params.id, `${req.user.name} присоединил(ся/ась) по ссылке`);
    const sockets = userSockets.get(req.user.id);
    if (sockets) for (const s of sockets) s.join(`chat:${req.params.id}`);
    emitChat(req.params.id, 'msg:new', newMsgPayload(sys));
    const fresh = chatFull(req.params.id);
    emitChat(req.params.id, 'chat:updated', fresh);
    emitToUserAll([req.user.id], 'chat:new', { chat: { ...fresh, members: undefined }, users: fresh.members.map((m) => m.user) });
    res.json(fresh);
  });

  api.post('/chats/:id/members', auth, (req, res) => {
    const chat = chatById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'not_found' });
    if (chat.type === 'private') return res.status(400).json({ error: 'private' });
    if (!needAdmin(req.params.id, req.user.id)) return res.status(403).json({ error: 'forbidden' });
    const added = [];
    for (const pid of (req.body?.userIds ?? []).slice(0, 50)) {
      if (!userByField('id', pid)) continue;
      if (memberOf(req.params.id, pid)) continue;
      upsertMember(req.params.id, pid);
      added.push(pid);
      const sockets = userSockets.get(pid);
      if (sockets) for (const s of sockets) s.join(`chat:${req.params.id}`);
    }
    for (const pid of added) {
      const sys = systemMessage(req.params.id, `${req.user.name} добавил(а) участника`);
      emitChat(req.params.id, 'msg:new', newMsgPayload(sys));
    }
    const fresh = chatFull(req.params.id);
    emitChat(req.params.id, 'chat:updated', fresh);
    emitToUserAll(added, 'chat:new', { chat: { ...fresh, members: undefined }, users: fresh.members.map((m) => m.user) });
    res.json(fresh);
  });

  function emitToUserAll(uids, event, data) {
    for (const u of uids) emitToUser(u, event, data);
  }

  api.delete('/chats/:id/members/:uid', auth, (req, res) => {
    const chat = chatById(req.params.id);
    if (!chat || chat.type === 'private') return res.status(400).json({ error: 'bad' });
    const self = req.params.uid === req.user.id;
    if (!self && !needAdmin(req.params.id, req.user.id)) return res.status(403).json({ error: 'forbidden' });
    if (chat.type !== 'private') {
      db.prepare('DELETE FROM members WHERE chat_id = ? AND user_id = ?').run(req.params.id, req.params.uid);
      const sys = systemMessage(req.params.id, self ? `${req.user.name} покинул(а) чат` : `Участник удалён`);
      emitChat(req.params.id, 'msg:new', newMsgPayload(sys));
      emitChat(req.params.id, 'chat:removed', { chatId: req.params.id, userId: req.params.uid });
    }
    res.json({});
  });

  api.post('/chats/:id/role', auth, (req, res) => {
    const chat = chatById(req.params.id);
    if (!chat || chat.type === 'private') return res.status(400).json({ error: 'bad' });
    if (!needAdmin(req.params.id, req.user.id)) return res.status(403).json({ error: 'forbidden' });
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    updateMember(req.params.id, req.body?.userId, { role });
    emitChat(req.params.id, 'chat:updated', chatFull(req.params.id));
    res.json({ ok: true });
  });

  api.delete('/chats/:id', auth, (req, res) => {
    const chat = chatById(req.params.id);
    if (!chat) return res.status(404).json({ error: 'not_found' });
    if (chat.type === 'private') {
      db.prepare('DELETE FROM members WHERE chat_id = ?').run(req.params.id);
    } else if (chat.type === 'group' && chat.createdBy === req.user.id) {
      db.prepare('DELETE FROM members WHERE chat_id = ?').run(req.params.id);
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);
      db.prepare('DELETE FROM chats WHERE id = ?').run(req.params.id);
    } else {
      db.prepare('DELETE FROM members WHERE chat_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    }
    emitChat(req.params.id, 'chat:removed', { chatId: req.params.id, userId: req.user.id });
    res.json({});
  });

  api.patch('/chats/:id/member', auth, (req, res) => {
    const b = req.body ?? {};
    const fields = {};
    if ('muted' in b) fields.muted = !!b.muted;
    if ('pinned' in b) fields.pinned = !!b.pinned;
    if ('notif' in b) fields.notif = !!b.notif;
    if ('draft' in b) fields.draft = String(b.draft ?? '');
    if ('wallpaper' in b) fields.wallpaper = b.wallpaper ?? null;
    updateMember(req.params.id, req.user.id, fields);
    res.json(memberOf(req.params.id, req.user.id));
  });

  /* ---------- messages ---------- */

  api.get('/chats/:id/messages', auth, (req, res) => {
    if (!memberOf(req.params.id, req.user.id)) return res.status(403).json({ error: 'forbidden' });
    const page = messagesPage(req.params.id, {
      before: Number(req.query.before ?? Number.MAX_SAFE_INTEGER),
      limit: clamp(Number(req.query.limit ?? 60), 1, 100),
      search: String(req.query.search ?? ''),
      forUser: req.user.id,
    });
    res.json({ ...page, messages: attachMeta(page.messages) });
  });

  api.get('/chats/:id/scheduled', auth, (req, res) => {
    if (!memberOf(req.params.id, req.user.id)) return res.status(403).json({ error: 'forbidden' });
    const rows = db.prepare(`SELECT * FROM messages WHERE chat_id = ? AND sent = 0 ORDER BY send_at ASC`).all(req.params.id).map(shapeMessage);
    res.json(rows);
  });

  api.post('/chats/:id/messages', auth, (req, res) => {
    const chat = chatById(req.params.id);
    const m = memberOf(req.params.id, req.user.id);
    if (!chat || !m) return res.status(403).json({ error: 'forbidden' });
    if (chat.type === 'channel' && m.role === 'member') return res.status(403).json({ error: 'readonly_channel' });
    if (chat.type === 'private') {
      // Чёрный список (privacy.blocked как в tdesktop): если кто-то из сторон заблокировал — отправка запрещена
      const mine = parseJSON(req.user.settings, {}) ?? {};
      for (const mb of chatMembers(chat.id)) {
        if (mb.userId === req.user.id) continue;
        if (Array.isArray(mine.blocked) && mine.blocked.includes(mb.userId)) return res.status(403).json({ error: 'blocked_target' });
        const pu = userByField('id', mb.userId);
        const ps = pu ? parseJSON(pu.settings, {}) ?? {} : {};
        if (Array.isArray(ps.blocked) && ps.blocked.includes(req.user.id)) return res.status(403).json({ error: 'you_are_blocked' });
      }
    }
    const b = req.body ?? {};
    const type = b.type ?? 'text';
    const allowed = ['text', 'photo', 'video', 'gif', 'sticker', 'file', 'audio', 'voice', 'round', 'poll', 'location'];
    if (!allowed.includes(type)) return res.status(400).json({ error: 'bad_type' });
    const text = String(b.text ?? '').slice(0, 4000);
    const media = b.media && typeof b.media === 'object' ? b.media : null;
    if (type === 'text' && !text.trim()) return res.status(400).json({ error: 'empty' });
    if (type !== 'text' && !text.trim() && !media) return res.status(400).json({ error: 'empty' });
    const sendAt = b.scheduleAt && Number(b.scheduleAt) > now() ? Number(b.scheduleAt) : null;
    const created = sendAt ? sendAt : now();
    const result = insertMessage({
      chatId: req.params.id, sender: req.user.id, type, text, media,
      replyTo: b.replyTo ? Number(b.replyTo) : null,
      createdAt: created, sendAt, sent: !sendAt,
    });
    const msg = msgById(result.lastInsertRowid);
    if (sendAt) return res.json(msg);
    // обновим last_read автора
    updateMember(req.params.id, req.user.id, { last_read: msg.id });
    emitChat(req.params.id, 'msg:new', newMsgPayload(msg));
    res.json(attachMeta([msg])[0]);
  });

  api.get('/messages/:id/history', auth, (req, res) => {
    const msg = msgById(Number(req.params.id));
    if (!msg) return res.status(404).json({ error: 'not_found' });
    res.json({ edits: msg.edits ?? [] });
  });

  api.post('/messages/:id/edit', auth, (req, res) => {
    const msg = msgById(Number(req.params.id));
    if (!msg || msg.sender !== req.user.id || msg.deleted) return res.status(403).json({ error: 'forbidden' });
    const text = String(req.body?.text ?? '').slice(0, 4000);
    if (!text.trim()) return res.status(400).json({ error: 'empty' });
    const edits = Array.isArray(msg.edits) ? msg.edits : (msg.edits ? [msg.edits] : []);
    const prev = edits.length ? edits[edits.length - 1] : null;
    const hist = [];
    if (msg.text) hist.push({ text: msg.text, at: prev?.at ?? msg.createdAt });
    const newEdits = [...(msg.edits ?? []), ...hist.filter((h) => h.text !== text)];
    db.prepare('UPDATE messages SET text = ?, edits = ?, created_at = ? WHERE id = ?').run(text, JSON.stringify(newEdits), now(), msg.id);
    const fresh = msgById(msg.id);
    emitChat(msg.chatId, 'msg:update', newMsgPayload(fresh));
    res.json(attachMeta([fresh])[0]);
  });

  api.post('/messages/:id/delete', auth, (req, res) => {
    const msg = msgById(Number(req.params.id));
    if (!msg) return res.status(404).json({ error: 'not_found' });
    const chat = chatById(msg.chatId);
    const canAll = chat?.createdBy === req.user.id;
    if (msg.sender !== req.user.id && !canAll) return res.status(403).json({ error: 'forbidden' });
    const forAll = !!req.body?.all || canAll;
    if (forAll) {
      db.prepare(`UPDATE messages SET deleted = 1, text = '', media = 'null', edits = 'null', pinned = 0 WHERE id = ?`).run(msg.id);
      if (chat?.pinnedMsg === msg.id) { db.prepare('UPDATE chats SET pinned_msg = NULL WHERE id = ?').run(msg.chatId); }
      emitChat(msg.chatId, 'msg:update', newMsgPayload(msgById(msg.id) ?? { ...msg, deleted: true, text: '', media: null }));
    } else {
      /* «удалить у себя»: скрываем сообщение только для этого юзера */
      hideMessage(msg.id, req.user.id);
      emitToUser(req.user.id, 'msg:remove', { chatId: msg.chatId, id: msg.id });
    }
    res.json({ ok: true });
  });

  api.post('/messages/:id/pin', auth, (req, res) => {
    const msg = msgById(Number(req.params.id));
    if (!msg || msg.deleted) return res.status(404).json({ error: 'not_found' });
    if (!memberOf(msg.chatId, req.user.id)) return res.status(403).json({ error: 'forbidden' });
    const pin = !!req.body?.pin;
    if (pin) db.prepare('UPDATE chats SET pinned_msg = ? WHERE id = ?').run(msg.id, msg.chatId);
    else db.prepare('UPDATE chats SET pinned_msg = NULL WHERE id = ?').run(msg.chatId);
    db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(pin ? 1 : 0, msg.id);
    emitChat(msg.chatId, 'msg:update', newMsgPayload(msgById(msg.id)));
    emitChat(msg.chatId, 'chat:updated', chatFull(msg.chatId));
    res.json({ ok: true });
  });

  api.post('/messages/:id/react', auth, (req, res) => {
    const msg = msgById(Number(req.params.id));
    if (!msg || msg.deleted) return res.status(404).json({ error: 'not_found' });
    const emoji = String(req.body?.emoji ?? '');
    if (/[a-z\u0410-\u042F\u0400-\u04FF]/i.test(emoji) && emoji.length > 8) return res.status(400).json({ error: 'bad_emoji' });
    toggleReaction(msg.id, req.user.id, emoji);
    const fresh = msgById(msg.id);
    emitChat(msg.chatId, 'msg:update', newMsgPayload(fresh));
    res.json(attachMeta([fresh])[0]);
  });

  api.post('/messages/:id/pollvote', auth, (req, res) => {
    const msg = msgById(Number(req.params.id));
    if (!msg || msg.type !== 'poll') return res.status(404).json({ error: 'not_found' });
    const choice = Number(req.body?.choice);
    if (!(choice >= 0 && choice < (msg.media?.options?.length ?? 0))) return res.status(400).json({ error: 'bad_choice' });
    castPollVote(msg.id, req.user.id, choice);
    const fresh = msgById(msg.id);
    emitChat(msg.chatId, 'msg:update', newMsgPayload(fresh));
    res.json(attachMeta([fresh])[0]);
  });

  api.post('/messages/:id/forward', auth, (req, res) => {
    const msg = msgById(Number(req.params.id));
    if (!msg || msg.deleted) return res.status(404).json({ error: 'not_found' });
    const chatIds = (req.body?.chatIds ?? []).slice(0, 10);
    const created = [];
    for (const cid of chatIds) {
      const chat = chatById(cid);
      const m = memberOf(cid, req.user.id);
      if (!chat || !m) continue;
      if (chat.type === 'channel' && m.role === 'member') continue;
      const row = insertMessage({
        chatId: cid, sender: req.user.id, type: msg.type, text: msg.text, media: msg.media,
        replyTo: null, createdAt: now(), sent: true,
      });
      const fresh = msgById(row.lastInsertRowid);
      emitChat(cid, 'msg:new', newMsgPayload(fresh));
      created.push(cid);
    }
    res.json({ ok: true, chatIds: created });
  });

  api.post('/chats/:id/read', auth, (req, res) => {
    const m = memberOf(req.params.id, req.user.id);
    if (!m) return res.status(403).json({ error: 'forbidden' });
    const lastId = Number(req.body?.lastId ?? 0);
    if (lastId > (m.last_read ?? 0)) {
      updateMember(req.params.id, req.user.id, { last_read: lastId });
      emitToUser(req.user.id, 'read:me', { chatId: req.params.id, lastId });
      io.to(`chat:${req.params.id}`).emit('read', { chatId: req.params.id, userId: req.user.id, lastId });
    }
    res.json({});
  });

  /* ---------- stories ---------- */

  api.get('/stories', auth, (req, res) => {
    const stories = activeStories();
    for (const s of stories) s.viewed = !!db.prepare('SELECT 1 FROM story_views WHERE story_id = ? AND user_id = ?').get(s.id, req.user.id);
    res.json(stories);
  });
  api.get('/stories/archive', auth, (req, res) => {
    res.json(db.prepare('SELECT * FROM stories WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id).map(shapeStory));
  });
  api.get('/stories/user/:id', auth, (req, res) => {
    const u = userByField('id', req.params.id);
    if (!u) return res.status(404).json({ error: 'not_found' });
    const own = u.id === req.user.id;
    res.json(storiesOfUser(u.id, own));
  });
  api.post('/stories', auth, (req, res) => {
    const b = req.body ?? {};
    if (!b.url || !b.kind) return res.status(400).json({ error: 'need_media' });
    const s = {
      id: uid(), userId: req.user.id, kind: b.kind, url: String(b.url),
      caption: String(b.caption ?? '').slice(0, 140), bg: String(b.bg ?? ''),
      createdAt: now(), expiresAt: now() + 24 * 3600 * 1000,
    };
    insertStory(s);
    io.emit('stories:update');
    res.json(storyById(s.id));
  });
  api.post('/stories/:id/view', auth, (req, res) => {
    const reaction = req.body?.reaction ? String(req.body.reaction) : null;
    const r = viewStory(req.params.id, req.user.id, reaction);
    io.emit('stories:update');
    res.json({ reaction: r });
  });
  api.get('/stories/:id/views', auth, (req, res) => {
    const story = storyById(req.params.id);
    if (!story || story.userId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    res.json(storyViews(req.params.id));
  });
  api.delete('/stories/:id', auth, (req, res) => {
    const story = storyById(req.params.id);
    if (!story || story.userId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    db.prepare('DELETE FROM stories WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM story_views WHERE story_id = ?').run(req.params.id);
    io.emit('stories:update');
    res.json({});
  });
  api.post('/stories/:id/pin', auth, (req, res) => {
    const story = storyById(req.params.id);
    if (!story || story.userId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    db.prepare('UPDATE stories SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id);
    io.emit('stories:update');
    res.json({ ok: true });
  });
  api.post('/stories/:id/archive', auth, (req, res) => {
    const story = storyById(req.params.id);
    if (!story || story.userId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    db.prepare('UPDATE stories SET archived = CASE WHEN archived = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id);
    io.emit('stories:update');
    res.json({ ok: true });
  });

  /* ---------- calls / sessions ---------- */

  api.get('/calls', auth, (req, res) => {
    res.json(callHistory(req.user.id, Number(req.query.limit ?? 30)).map((c) => ({
      id: c.id, kind: c.kind, a: c.a, b: c.b, status: c.status,
      createdAt: c.created_at, endedAt: c.ended_at, duration: c.duration,
      withUser: c.a === req.user.id ? c.b : c.a,
    })));
  });

  api.get('/sessions', auth, (req, res) => res.json(listSessions(req.user.id).map((s) => ({ ...s, current: s.token === req.session.token }))));
  api.delete('/sessions/:token', auth, (req, res) => {
    const s = sessionByToken(req.params.token);
    if (!s || s.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
    deleteSession(req.params.token);
    emitForceLogout(req.params.token);
    res.json({});
  });

  function emitForceLogout(token) {
    io.to(`sess:${token}`).emit('force:logout');
  }

  /* ---------- scheduled release ---------- */
  setInterval(() => {
    const released = releaseScheduled();
    if (released > 0) io.emit('sched:released');
  }, 4000);

  return { api, ensureChatsJoined, emitToUser, emitChat, emitForceLogout };
}

import { onlineMap, userSockets } from './state.js';
