// Слой данных — SQLite через встроенный node:sqlite (WAL-режим).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJSON, uid } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  bio TEXT DEFAULT '',
  avatar TEXT DEFAULT 'null',
  cover TEXT DEFAULT 'null',
  settings TEXT DEFAULT 'null',
  password_hash TEXT NOT NULL,
  totp_secret TEXT,
  twofa INTEGER DEFAULT 0,
  premium INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT,
  about TEXT DEFAULT '',
  avatar TEXT DEFAULT 'null',
  wallpaper TEXT DEFAULT 'null',
  pinned_msg INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  muted INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  draft TEXT DEFAULT '',
  notif INTEGER DEFAULT 1,
  wallpaper TEXT DEFAULT 'null',
  last_read INTEGER DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  sender TEXT,
  type TEXT NOT NULL,
  text TEXT DEFAULT '',
  media TEXT DEFAULT 'null',
  reply_to INTEGER,
  edits TEXT DEFAULT 'null',
  deleted INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  send_at INTEGER,
  sent INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS msg_hides (
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages (chat_id, id);
CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  choice INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  caption TEXT DEFAULT '',
  bg TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  archived INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS story_views (
  story_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reaction TEXT,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT,
  status TEXT DEFAULT 'ringing',
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration INTEGER DEFAULT 0
);
`);
try { db.exec('ALTER TABLE calls ADD COLUMN accepted_at INTEGER'); } catch { /* колонка уже есть */ }

/* ---------- users ---------- */

export const createUser = (u) => db.prepare(
  `INSERT INTO users (id, username, name, bio, avatar, cover, settings, password_hash, premium, created_at, last_seen)
   VALUES (?, ?, ?, '', 'null', 'null', 'null', ?, 1, ?, ?)`
).run(u.id, u.username, u.name, u.passwordHash, u.createdAt, u.lastSeen);

export const userByField = (field, value) => {
  const row = field === 'id'
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(value)
    : db.prepare('SELECT * FROM users WHERE username = ?').get(value);
  return row ? shapeUser(row) : null;
};

export const shapeUser = (row) => row && ({
  id: row.id,
  username: row.username,
  name: row.name,
  bio: row.bio,
  avatar: parseJSON(row.avatar, null),
  cover: parseJSON(row.cover, null),
  settings: parseJSON(row.settings, getDefaultSettings()),
  twofa: !!row.twofa,
  premium: !!row.premium,
  createdAt: row.created_at,
  lastSeen: row.last_seen,
  passwordHash: row.password_hash,
  totpSecret: row.totp_secret,
});

export function getDefaultSettings() {
  return {
    theme: 'dark',
    accent: '#8b5cf6',
    language: 'ru',
    fontSize: 15,
    chatFontSize: 15,
    uiScale: 100,
    animations: true,
    sounds: true,
    browserNotif: true,
    bubbleRadius: 12,
    bubbleColorMine: '',
    avatarShape: 'circle',
    avatarFrame: { style: 'none', color: '' },
    wallpaper: null,
    privacy: { lastSeen: 'all', profilePhotos: 'all' },
    notifSound: 'chime',
    messageCorners: 'rounded',
    premium: true,
  };
}

export const publicUser = (u, fullSettings = false) => u && ({
  id: u.id,
  username: u.username,
  name: u.name,
  bio: u.bio,
  avatar: u.avatar,
  cover: u.cover,
  premium: u.premium,
  twofa: u.twofa,
  lastSeen: (u.settings?.privacy?.lastSeen === 'none') ? null : u.lastSeen,
  settings: fullSettings ? u.settings : {
    avatarShape: u.settings?.avatarShape ?? 'circle',
    avatarFrame: u.settings?.avatarFrame ?? { style: 'none', color: '' },
    privacy: { lastSeen: u.settings?.privacy?.lastSeen ?? 'all' },
  },
  createdAt: u.createdAt,
});

export const updateUser = (id, fields) => {
  const vals = [];
  const sets = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); vals.push(v); }
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return userByField('id', id);
};

export const searchUsers = (q, excludeId, limit = 12) => {
  const like = `%${q.trim()}%`;
  const low = `%${q.trim().toLowerCase()}%`;
  return db.prepare(
    `SELECT * FROM users
     WHERE (username LIKE ? OR LOWER(name) LIKE ?) AND id != ?
     ORDER BY username LIMIT ?`
  ).all(like, low, excludeId, limit).map(shapeUser);
};

/* «удалить у себя»: скрываем сообщение только для одного юзера */
export const hideMessage = (messageId, userId) =>
  db.prepare('INSERT OR IGNORE INTO msg_hides (message_id, user_id) VALUES (?, ?)').run(messageId, userId);

/* ---------- sessions ---------- */

export const createSession = (token, userId, device) =>
  db.prepare('INSERT INTO sessions (token, user_id, device, created_at, last_active) VALUES (?, ?, ?, ?, ?)')
    .run(token, userId, device, Date.now(), Date.now());

export const sessionByToken = (token) =>
  token ? db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) : null;

export const touchSession = (token) =>
  db.prepare('UPDATE sessions SET last_active = ? WHERE token = ?').run(Date.now(), token);

export const deleteSession = (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
export const deleteAllSessions = (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
export const deleteSessionOther = (userId, token) =>
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, token);
export const listSessions = (userId) =>
  db.prepare('SELECT token, device, created_at, last_active FROM sessions WHERE user_id = ? ORDER BY last_active DESC').all(userId);

/* ---------- chats / members ---------- */

export const createChat = (c) => {
  db.prepare('INSERT INTO chats (id, type, title, about, avatar, wallpaper, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(c.id, c.type, c.title ?? null, c.about ?? '', JSON.stringify(c.avatar ?? null), JSON.stringify(c.wallpaper ?? null), c.createdBy, c.createdAt);
};

export const upsertMember = (chatId, userId, role = 'member') =>
  db.prepare(`INSERT INTO members (chat_id, user_id, role, joined_at, last_read) VALUES (?, ?, ?, ?, 0)
              ON CONFLICT(chat_id, user_id) DO NOTHING`)
    .run(chatId, userId, role, Date.now());

export const memberOf = (chatId, userId) =>
  db.prepare('SELECT * FROM members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);

export const updateMember = (chatId, userId, fields) => {
  const allowed = ['muted', 'pinned', 'draft', 'notif', 'wallpaper', 'last_read', 'role'];
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    if (k === 'wallpaper') { sets.push('wallpaper = ?'); vals.push(v == null ? 'null' : JSON.stringify(v)); }
    else if (k === 'draft') { sets.push('draft = ?'); vals.push(String(v ?? '')); }
    else if (k === 'last_read') { sets.push('last_read = ?'); vals.push(Number(v) || 0); }
    else if (k === 'role') { sets.push('role = ?'); vals.push(String(v)); }
    else { sets.push(`${k} = ?`); vals.push(v ? 1 : 0); }
  }
  if (!sets.length) return memberOf(chatId, userId);
  vals.push(chatId, userId);
  db.prepare(`UPDATE members SET ${sets.join(', ')} WHERE chat_id = ? AND user_id = ?`).run(...vals);
  return memberOf(chatId, userId);
};

export const chatById = (id) => {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
  return row ? shapeChat(row) : null;
};

export const shapeChat = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  about: row.about,
  avatar: parseJSON(row.avatar, null),
  wallpaper: parseJSON(row.wallpaper, null),
  pinnedMsg: row.pinned_msg,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

export const chatMembers = (chatId) =>
  db.prepare(`SELECT m.*, u.username, u.name, u.avatar, u.settings FROM members m
              JOIN users u ON u.id = m.user_id WHERE m.chat_id = ?`).all(chatId)
    .map((m) => ({
      userId: m.user_id,
      role: m.role,
      muted: !!m.muted,
      pinned: !!m.pinned,
      notif: !!m.notif,
      draft: m.draft,
      wallpaper: parseJSON(m.wallpaper, null),
      lastRead: m.last_read,
      user: publicUser(shapeUserSafe(m)),
    }));

function shapeUserSafe(m) {
  return { id: m.user_id, username: m.username, name: m.name, avatar: parseJSON(m.avatar, null), settings: parseJSON(m.settings, null), bio: '', cover: null, premium: 0, twofa: 0, lastSeen: 0, createdAt: 0 };
}

export const chatMembersUpdateBroadcast = null; // (helpers live in api.js)

export const myChatIds = (userId) =>
  db.prepare('SELECT chat_id FROM members WHERE user_id = ?').all(userId).map((r) => r.chat_id);

// Полный список чатов пользователя с lastMessage/unread
export function myChats(userId) {
  const rows = db.prepare(`
    SELECT c.*, m.role AS mrole, m.muted AS mmuted, m.pinned AS mpinned, m.draft AS mdraft,
           m.notif AS mnotif, m.wallpaper AS mwallpaper, m.last_read AS mlastread, m.joined_at AS mjoined
    FROM chats c JOIN members m ON m.chat_id = c.id AND m.user_id = ?
    ORDER BY c.created_at DESC
  `).all(userId);
  const lastMsgStmt = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND sent = 1 AND deleted = 0 ORDER BY id DESC LIMIT 1');
  const unreadStmt = db.prepare(`SELECT COUNT(*) AS cnt FROM messages WHERE chat_id = ? AND sent = 1 AND deleted = 0 AND id > ? AND COALESCE(sender,'') != ?`);
  return rows.map((r) => {
    const last = lastMsgStmt.get(r.id);
    const unread = unreadStmt.get(r.id, r.mlastread ?? 0, userId).cnt;
    return {
      ...shapeChat(r),
      members: chatMembers(r.id),
      member: { role: r.mrole, muted: !!r.mmuted, pinned: !!r.mpinned, notif: !!r.mnotif, draft: r.mdraft, wallpaper: parseJSON(r.mwallpaper, null), lastRead: r.mlastread, joinedAt: r.mjoined },
      lastMessage: last ? shapeMessage(last) : null,
      unread,
    };
  });
}

/* ---------- messages ---------- */

export const insertMessage = (m) => db.prepare(
  `INSERT INTO messages (chat_id, sender, type, text, media, reply_to, created_at, send_at, sent)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(m.chatId, m.sender, m.type, m.text ?? '', JSON.stringify(m.media ?? null), m.replyTo ?? null, m.createdAt, m.sendAt ?? null, m.sent ? 1 : 0);

export const msgById = (id) => {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  return row ? shapeMessage(row) : null;
};

export function shapeMessage(row) {
  const msg = {
    id: row.id,
    chatId: row.chat_id,
    sender: row.sender,
    type: row.type,
    text: row.text,
    media: parseJSON(row.media, null),
    replyTo: row.reply_to,
    edits: parseJSON(row.edits, null),
    deleted: !!row.deleted,
    pinned: !!row.pinned,
    createdAt: row.created_at,
    sendAt: row.send_at,
    sent: !!row.sent,
  };
  if (row.type === 'poll') msg.poll = parseJSON(row.media, null);
  return msg;
}

export function messagesPage(chatId, { before = Number.MAX_SAFE_INTEGER, limit = 60, search = '', forUser = '' } = {}) {
  let sql = 'SELECT * FROM messages WHERE chat_id = ? AND sent = 1 AND id < ?';
  const params = [chatId, before];
  /* скрытые этим юзером («удалить у себя») не отдаём */
  if (forUser) { sql += ' AND id NOT IN (SELECT message_id FROM msg_hides WHERE user_id = ?)'; params.push(forUser); }
  if (search) { sql += ' AND text LIKE ?'; params.push(`%${search}%`); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return { messages: rows.reverse().map(shapeMessage), hasMore: rows.length === limit };
}

export const lastMessageOf = (chatId) => {
  const row = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND sent = 1 ORDER BY id DESC LIMIT 1').get(chatId);
  return row ? shapeMessage(row) : null;
};

export const pinnedMessage = (chatId) => {
  const chat = chatById(chatId);
  return chat?.pinnedMsg ? msgById(chat.pinnedMsg) : null;
};

export const reactionsOf = (messageIds) => {
  if (!messageIds.length) return new Map();
  const inClause = messageIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${inClause})`).all(...messageIds);
  const map = new Map();
  for (const r of rows) {
    const key = r.message_id;
    if (!map.has(key)) map.set(key, []);
    let entry = map.get(key).find((e) => e.emoji === r.emoji);
    if (!entry) { entry = { emoji: r.emoji, userIds: [] }; map.get(key).push(entry); }
    entry.userIds.push(r.user_id);
  }
  return map;
};

export const toggleReaction = (messageId, userId, emoji) => {
  const existing = db.prepare('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?').get(messageId, userId);
  if (existing) {
    if (existing.emoji === emoji) { db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').run(messageId, userId); return null; }
    db.prepare('UPDATE reactions SET emoji = ? WHERE message_id = ? AND user_id = ?').run(emoji, messageId, userId);
    return emoji;
  }
  db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, userId, emoji);
  return emoji;
};

export const pollVotesOf = (messageId) => {
  const rows = db.prepare('SELECT user_id, choice FROM poll_votes WHERE message_id = ?').all(messageId);
  return rows.map((r) => ({ userId: r.user_id, choice: r.choice }));
};

export const castPollVote = (messageId, userId, choice) => {
  const existing = db.prepare('SELECT choice FROM poll_votes WHERE message_id = ? AND user_id = ?').get(messageId, userId);
  if (existing) return false;
  db.prepare('INSERT INTO poll_votes (message_id, user_id, choice) VALUES (?, ?, ?)').run(messageId, userId, choice);
  return true;
};

/* ---------- stories ---------- */

export const shapeStory = (row) => ({
  id: row.id,
  userId: row.user_id,
  kind: row.kind,
  url: row.url,
  caption: row.caption,
  bg: row.bg,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  archived: !!row.archived,
  pinned: !!row.pinned,
});

export const insertStory = (s) => db.prepare(
  'INSERT INTO stories (id, user_id, kind, url, caption, bg, created_at, expires_at, archived, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
).run(s.id, s.userId, s.kind, s.url, s.caption ?? '', s.bg ?? '', s.createdAt, s.expiresAt, s.archived ? 1 : 0, s.pinned ? 1 : 0);

export const storyById = (id) => {
  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  return row ? shapeStory(row) : null;
};

export const activeStories = () =>
  db.prepare(`SELECT * FROM stories WHERE archived = 0 AND expires_at > ? ORDER BY created_at ASC`).all(Date.now()).map(shapeStory);

export const storiesOfUser = (userId, includeArchived) =>
  db.prepare(`SELECT * FROM stories WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0 AND expires_at > ' + Date.now()} ORDER BY created_at ASC`)
    .all(userId).map(shapeStory);

export const storyViews = (storyId) =>
  db.prepare(`SELECT v.*, u.name, u.username FROM story_views v JOIN users u ON u.id = v.user_id WHERE v.story_id = ? ORDER BY v.viewed_at DESC`).all(storyId)
    .map((r) => ({ userId: r.user_id, reaction: r.reaction, viewedAt: r.viewed_at, name: r.name, username: r.username }));

export const viewStory = (storyId, userId, reaction) => {
  const existing = db.prepare('SELECT reaction FROM story_views WHERE story_id = ? AND user_id = ?').get(storyId, userId);
  if (existing) {
    if (reaction && reaction !== existing.reaction) {
      db.prepare('UPDATE story_views SET reaction = ? WHERE story_id = ? AND user_id = ?').run(reaction, storyId, userId);
      return reaction;
    }
    return existing.reaction;
  }
  db.prepare('INSERT INTO story_views (story_id, user_id, reaction, viewed_at) VALUES (?, ?, ?, ?)').run(storyId, userId, reaction ?? null, Date.now());
  return reaction ?? null;
};

/* ---------- calls ---------- */

export const insertCall = (c) => db.prepare('INSERT INTO calls (id, kind, a, b, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  .run(c.id, c.kind, c.a, c.b, 'ringing', Date.now());

export const updateCall = (id, fields) => {
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); vals.push(v); }
  vals.push(id);
  db.prepare(`UPDATE calls SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
};

export const callById = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id);

export const callHistory = (userId, limit = 30) =>
  db.prepare(`SELECT * FROM calls WHERE a = ? OR b = ? ORDER BY created_at DESC LIMIT ?`).all(userId, userId, limit);

/* Приватный чат двух пользователей (тот же запрос, что и POST /chats) */
export const privateChatBetween = (a, b) => db.prepare(`
  SELECT c.id FROM chats c
  JOIN members m1 ON m1.chat_id = c.id AND m1.user_id = ?
  JOIN members m2 ON m2.chat_id = c.id AND m2.user_id = ?
  WHERE c.type = 'private' AND (SELECT COUNT(*) FROM members WHERE chat_id = c.id) = 2 LIMIT 1
`).get(a, b)?.id ?? null;

/* Создаёт приватный чат, если пары чатов ещё нет — для лога звонков как в Telegram */
export function ensurePrivateCallChat(a, b) {
  if (a === b) return { id: null, created: false };
  const exist = privateChatBetween(a, b);
  if (exist) return { id: exist, created: false };
  const id = uid();
  createChat({ id, type: 'private', createdBy: a, createdAt: Date.now() });
  upsertMember(id, a, 'owner');
  upsertMember(id, b, 'member');
  return { id, created: true };
}

/* ---------- system ---------- */

export function systemMessage(chatId, text) {
  const row = insertMessage({ chatId, sender: null, type: 'system', text, createdAt: Date.now(), sent: true });
  return msgById(row.lastInsertRowid);
}

export function releaseScheduled() {
  const rows = db.prepare('SELECT id FROM messages WHERE sent = 0 AND send_at IS NOT NULL AND send_at <= ?').all(Date.now());
  for (const r of rows) {
    db.prepare('UPDATE messages SET sent = 1, created_at = send_at WHERE id = ?').run(r.id);
  }
  return rows.length;
}

/* ---------- cleanup ---------- */

export function cleanupExpiredStories() {
  db.prepare(`DELETE FROM stories WHERE expires_at < ? AND archived = 0 AND pinned = 0`).run(Date.now() - 48 * 3600 * 1000);
}
