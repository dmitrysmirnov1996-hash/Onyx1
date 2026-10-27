// Состояние приложения: zustand + Socket.IO real-time
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { api, setToken, getToken, setUnauthorizedHandler } from './api';
import { sound, startRing, stopRing } from './media';
import type {
  MeUser, PublicUser, Chat, Message, Member, Story, Toast, Wallpaper, UploadResult, UserSettings,
} from './types';
import { tFor } from './i18n';

export interface CallUI {
  phase: 'incoming' | 'outgoing' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  callId: string;
  kind: 'voice' | 'video';
  peer: PublicUser | null;
  startedAt?: number;
  minimized?: boolean;
  remoteScreen?: boolean;
  remoteScreenQ?: string;
  remoteMicOn?: boolean;
}

interface Modal { name: string; params?: any }

export interface Store {
  me: MeUser | null;
  authed: boolean;
  booting: boolean;
  users: Record<string, PublicUser>;
  chats: Chat[];
  chatsLoaded: boolean;
  activeChatId: string | null;
  activeChat: Chat | null;
  messages: Record<string, Message[]>;
  msgsLoaded: Record<string, boolean>;
  typing: Record<string, Record<string, { name?: string; kind: string }>>;
  online: Set<string>;
  stories: Story[];
  toasts: Toast[];
  modals: Modal[];
  previewMsgId: number | null;
  selection: number[] | null;
  call: CallUI | null;
  rateCall: { peer: PublicUser | null; kind: 'voice' | 'video'; durMs: number } | null;
  replyTo: Message | null;
  editing: Message | null;
  connected: boolean;

  boot: () => Promise<void>;
  login: (u: string, p: string, totp?: string) => Promise<MeUser>;
  register: (u: string, n: string, p: string) => Promise<MeUser>;
  logout: (all?: boolean) => Promise<void>;
  patchMe: (fields: any) => Promise<void>;
  patchSettings: (s: Partial<UserSettings>) => Promise<void>;
  resetAll: () => Promise<void>;
  pushToast: (t: Omit<Toast, 'id'>, vars?: Record<string, any>) => void;
  dropToast: (id: number) => void;
  openModal: (name: string, params?: any) => void;
  closeModal: () => void;

  openChat: (id: string) => Promise<void>;
  closeChat: () => void;
  openFavorites: () => Promise<void>;
  readEverything: () => Promise<void>;
  loadMessages: (chatId: string, before?: number) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  searchMessages: (chatId: string, q: string) => Promise<Message[]>;
  refreshChat: (id: string) => Promise<void>;
  sendMsg: (chatId: string, payload: { type: string; text?: string; media?: any; replyTo?: number; scheduleAt?: number }) => Promise<void>;
  sendTyping: (chatId: string, kind: string | null) => void;
  markRead: (chatId: string, lastId: number) => void;
  reactMsg: (id: number, emoji: string) => Promise<void>;
  editMsg: (id: number, text: string) => Promise<void>;
  deleteMsg: (id: number, forAll: boolean) => Promise<void>;
  pinMsg: (id: number, pin: boolean) => Promise<void>;
  forwardMsgs: (ids: number[], chatIds: string[]) => Promise<void>;
  pollVote: (id: number, choice: number) => Promise<void>;
  setReplyTo: (m: Message | null) => void;
  setEditing: (m: Message | null) => void;
  setSelection: (ids: number[] | null) => void;

  createChat: (type: 'private' | 'group' | 'channel', userIds: string[], title?: string) => Promise<Chat>;
  joinByLink: (id: string) => Promise<void>;
  patchChat: (id: string, fields: any) => Promise<void>;
  patchChatMember: (id: string, fields: any) => Promise<void>;
  addChatMembers: (id: string, userIds: string[]) => Promise<void>;
  setRole: (id: string, userId: string, role: string) => Promise<void>;
  kickMember: (id: string, userId: string) => Promise<void>;
  leaveChat: (id: string) => Promise<void>;
  userById: (id: string | null | undefined) => PublicUser | null;
  chatOf: (id: string | null | undefined) => Chat | null;
  upsertMessage: (chatId: string, message: Message) => void;
  chatTitle: (c: Chat) => string;
  chatAvatar: (c: Chat) => any;
  peerOf: (c: Chat) => PublicUser | null;

  refreshStories: () => Promise<void>;
  postStory: (kind: string, url: string, caption: string, bg?: string) => Promise<void>;
  deleteStory: (id: string) => Promise<void>;
  setCall: (c: CallUI | null) => void;
  pushRateCall: (r: { peer: PublicUser | null; kind: 'voice' | 'video'; durMs: number }) => void;
  uploads: (file: File | Blob, name: string, meta?: any) => Promise<UploadResult>;
}

export function messageLabelOf(m: Message): string {
  switch (m.type) {
    case 'photo': return '📷 ' + (m.text || 'Фотография');
    case 'video': return '🎞 ' + (m.text || 'Видео');
    case 'gif': return 'GIF';
    case 'sticker': return (m.media?.emoji ?? '') + ' Стикер';
    case 'file': return '📄 ' + (m.media?.name ?? 'Файл');
    case 'audio': return '🎵 ' + (m.media?.name ?? 'Аудио');
    case 'voice': return '🎤 Голосовое сообщение';
    case 'round': return '📹 Видеосообщение';
    case 'poll': return '📊 ' + (m.poll?.question ?? 'Опрос');
    case 'location': return '📍 Геолокация';
    default: return m.text || 'Сообщение';
  }
}

let socket: Socket | null = null;
export function getSocket() { return socket; }

// Колбэки, которым нужен живой сокет после каждого (пере)подключения (напр., сигналинг звонков)
const socketHooks: ((s: Socket) => void)[] = [];
export function onSocket(fn: (s: Socket) => void) {
  socketHooks.push(fn);
  if (socket) { try { fn(socket); } catch {} }
}

let pendingId = -1;
function nextPendingId() { return pendingId--; }

const emptySettings: UserSettings = {
  theme: 'dark', accent: '#2ad46e', language: 'ru', fontSize: 15, uiScale: 100,
  animations: true, sounds: true, browserNotif: true, bubbleRadius: 16,
  bubbleColorMine: '', avatarShape: 'circle', avatarFrame: { style: 'none', color: '' },
  wallpaper: null, privacy: { lastSeen: 'all', online: true }, notifSound: 'chime',
  colors: { bg: '', text: '', bubbleIn: '', bubbleOut: '' },
  premium: true, customThemes: [],
};

function normalizeMe(raw: any): MeUser {
  const s = { ...emptySettings, ...(raw.settings ?? {}) };
  s.privacy = { lastSeen: 'all', online: true, ...(raw.settings?.privacy ?? {}) };
  s.colors = { bg: '', text: '', bubbleIn: '', bubbleOut: '', ...(raw.settings?.colors ?? {}) };
  s.avatarFrame = raw.settings?.avatarFrame ?? { style: 'none', color: '' };
  s.customThemes = raw.settings?.customThemes ?? [];
  return { ...raw, settings: s };
}

function chatSort(a: Chat, b: Chat): number {
  if (a.member?.pinned && !b.member?.pinned) return -1;
  if (b.member?.pinned && !a.member?.pinned) return 1;
  return (b.lastMessage?.createdAt ?? b.createdAt) - (a.lastMessage?.createdAt ?? a.createdAt);
}

export function peerIdOfChat(c: Chat, myId: string): string {
  const others = c.members?.filter((m) => m.userId !== myId);
  if (others?.length) return others[0].userId;
  return c.id;
}

/* «Избранное» — приватный чат с самим собой (один участник) */
export function isFavChat(c: Chat | null | undefined, myId: string): boolean {
  return !!c && c.type === 'private' && (((c.members?.length ?? 1) < 2) || (c.members?.length === 1 && c.members[0].userId === myId));
}

export const useStore = create<Store>((set, get): any => ({
  me: null, authed: false, booting: true, users: {}, chats: [], chatsLoaded: false,
  activeChatId: null, activeChat: null, messages: {}, msgsLoaded: {}, typing: {},
  online: new Set(), stories: [], toasts: [], modals: [], previewMsgId: null, selection: null,
  call: null, rateCall: null, replyTo: null, editing: null, connected: false,

  /* ---------- auth / sync ---------- */
  async boot() {
    set({ booting: true });
    const token = getToken();
    if (!token) { set({ booting: false }); return; }
    try {
      const data = await api.sync();
      const me = normalizeMe(data.me);
      socketConnect();
      set({
        me, chats: (data.chats ?? []).sort(chatSort), chatsLoaded: true,
        users: Object.fromEntries((data.users ?? []).map((u: PublicUser) => [u.id, u])),
        stories: data.stories ?? [], online: new Set(data.onlineIds ?? []),
        authed: true, booting: false,
      });
    } catch {
      setToken(null);
      set({ booting: false });
    }
  },

  async login(username, password, totp) {
    const { token: t, user } = await api.login(username, password, totp);
    setToken(t);
    const me = normalizeMe(user);
    socketConnect();
    set({ me, authed: true });
    const data = await api.sync();
    set({
      chats: (data.chats ?? []).sort(chatSort), chatsLoaded: true,
      users: Object.fromEntries((data.users ?? []).map((u: PublicUser) => [u.id, u])),
      stories: data.stories ?? [], online: new Set(data.onlineIds ?? []),
    });
    return me;
  },

  async register(username, name, password) {
    const { token: t, user } = await api.register(username, name, password);
    setToken(t);
    const me = normalizeMe(user);
    socketConnect();
    set({ me, authed: true, chats: [], chatsLoaded: true, stories: [], users: {}, online: new Set() });
    return me;
  },

  async logout(all?: boolean) {
    try { await (all ? api.logoutAll() : api.logout()); } catch {}
    socket?.disconnect();
    setToken(null);
    set({ me: null, authed: false, chats: [], messages: {}, activeChatId: null, activeChat: null, call: null, rateCall: null, stories: [] });
  },

  async patchMe(fields) {
    const user = await api.patchMe(fields);
    set({ me: normalizeMe(user) });
  },
  async patchSettings(s) {
    await get().patchMe({ settings: s });
  },

  /* «Сбросить всё»: заводские настройки + чистые обои на чатах (сервер /me/reset) */
  async resetAll() {
    const user = await api.resetMe();
    set({
      me: normalizeMe(user),
      chats: get().chats.map((c) => (c.member?.wallpaper ? { ...c, member: { ...c.member!, wallpaper: null } } : c)),
    });
  },

  /* ---------- toasts / modals ---------- */
  pushToast(t, vars) {
    const id = Date.now() + Math.random();
    const lang = get().me?.settings?.language ?? 'ru';
    const tr = tFor(lang);
    set({ toasts: [...get().toasts, { ...t, title: tr(t.title, vars), text: t.text ? tr(t.text, vars) : undefined, id }] });
    setTimeout(() => get().dropToast(id), 4500);
  },
  dropToast(id) { set({ toasts: get().toasts.filter((x) => x.id !== id) }); },
  openModal(name, params) { set({ modals: [...get().modals, { name, params }] }); },
  closeModal() { set({ modals: get().modals.slice(0, -1) }); },

  /* ---------- chat ---------- */
  async openChat(id) {
    const st = get();
    if (st.activeChatId === id) return;
    set({ activeChatId: id, activeChat: null, replyTo: null, editing: null, selection: null });
    api.getChat(id).then((chat) => set({ activeChat: chat })).catch(() => {});
    try {
      if (!st.messages[id]?.length) await get().loadMessages(id);
    } catch {}
    const list = get().messages[id];
    const last = list?.[list.length - 1]?.id ?? null;
    if (last != null) get().markRead(id, last);
  },

  closeChat() { set({ activeChatId: null, activeChat: null, replyTo: null, editing: null, selection: null }); },

  /* «Избранное»: создаем/открываем свою личную переписку с самим собой */
  async openFavorites() {
    const st = get();
    const existing = st.chats.find((c) => isFavChat(c, st.me?.id ?? ''));
    if (existing) { st.openChat(existing.id); return; }
    const chat = await st.createChat('private', [st.me!.id]);
    st.openChat(chat.id);
  },

  /* прочитать все чаты с непрочитанными (сохранение на сервере) */
  async readEverything() {
    const st = get();
    for (const c of st.chats) {
      if ((Number(c.unread) || 0) > 0 && c.lastMessage?.id != null) st.markRead(c.id, c.lastMessage.id);
    }
  },

  async loadMessages(chatId, before) {
    const data = await api.messages(chatId, { before });
    const st = get();
    if (before == null) {
      set({ messages: { ...st.messages, [chatId]: data.messages }, msgsLoaded: { ...st.msgsLoaded, [chatId]: true } });
    } else {
      const existing = st.messages[chatId] ?? [];
      const have = new Set(existing.map((m) => m.id));
      const merged = [...data.messages.filter((m: Message) => !have.has(m.id)), ...existing];
      set({ messages: { ...st.messages, [chatId]: merged } });
    }
  },

  async loadMoreMessages() {
    const st = get();
    const id = st.activeChatId;
    if (!id) return;
    const list = st.messages[id] ?? [];
    if (!list.length) return;
    await get().loadMessages(id, list[0].id);
  },

  async searchMessages(chatId, q) {
    const data = await api.messages(chatId, { search: q });
    return data.messages;
  },

  async refreshChat(id) {
    try {
      const chat = await api.getChat(id);
      set({ activeChat: get().activeChatId === id ? chat : get().activeChat });
    } catch {}
  },

  upsertMessage(chatId, message) {
    const st = get();
    const list = st.messages[chatId];
    if (!list) return;
    const i = list.findIndex((m) => m.id === message.id);
    if (i === -1) {
      // Убираем ровно один оптимистичный pending, совпадающий по содержимому,
      // а не все подряд — иначе быстрый дабл-сенд стирал второе сообщение.
      let removed = false;
      const nl = list.filter((m) => {
        if (!m.pending || removed) return true;
        if (m.sender === message.sender && m.type === message.type && (m.text ?? '') === (message.text ?? '')) {
          removed = true;
          return false;
        }
        return true;
      });
      // fallback: если совпадения нет (например, медиасообщение), убираем старейший pending
      const finalList = removed ? nl : (() => {
        const idx = nl.findIndex((m) => m.pending);
        if (idx === -1) return nl;
        return [...nl.slice(0, idx), ...nl.slice(idx + 1)];
      })();
      set({ messages: { ...st.messages, [chatId]: [...finalList, message] } });
      return;
    }
    const nl = [...list];
    nl[i] = { ...nl[i], ...message };
    set({ messages: { ...st.messages, [chatId]: nl } });
  },

  async sendMsg(chatId, payload) {
    const st = get();
    if (payload.scheduleAt) {
      await api.sendMessage(chatId, payload);
      get().pushToast({ kind: 'ok', title: 'sentScheduled', text: undefined as any }, { t: new Date(payload.scheduleAt).toLocaleString() });
      return;
    }
    const me = st.me!;
    const tmpId = nextPendingId();
    const optimistic: Message = {
      id: tmpId, chatId, sender: me.id, type: payload.type, text: payload.text ?? '',
      media: payload.media ?? null, replyTo: payload.replyTo ?? null, edits: null, deleted: false,
      pinned: false, createdAt: Date.now(), sendAt: null, sent: false, pending: true,
    };
    const list = st.messages[chatId];
    if (list) set({ messages: { ...st.messages, [chatId]: [...list, optimistic] } });
    set({ chats: st.chats.map((c) => c.id === chatId ? { ...c, lastMessage: optimistic } : c) });
    try {
      const real = await api.sendMessage(chatId, payload);
      get().upsertMessage(chatId, real);
      set({ chats: get().chats.map((c) => c.id === chatId ? { ...c, lastMessage: real } : c) });
      get().markRead(chatId, real.id);
    } catch (e: any) {
      set({ messages: { ...get().messages, [chatId]: (get().messages[chatId] ?? []).filter((m) => m.id !== tmpId) } });
      const blockedText = e?.code === 'you_are_blocked' ? 'youBlocked'
        : e?.code === 'blocked_target' ? 'blockedTarget' : undefined;
      get().pushToast({ kind: 'error', title: 'error', text: e?.code === 'readonly_channel' ? 'Канал: только админы могут писать' : (blockedText ?? undefined as any) });
    }
  },

  _typing: { last: 0, kind: null, timer: null },
  sendTyping(chatId, kind) {
    const tc = (get() as any)._typing;
    if (kind === null) {
      if (tc.kind) { clearTimeout(tc.timer); socket?.emit('typing', { chatId, kind: null }); tc.kind = null; }
      return;
    }
    if (tc.kind === kind && Date.now() - tc.last < 2000) return;
    tc.kind = kind; tc.last = Date.now();
    socket?.emit('typing', { chatId, kind });
    if (tc.timer) clearTimeout(tc.timer);
    tc.timer = setTimeout(() => socket?.emit('typing', { chatId, kind: null }), 4000);
  },

  markRead(chatId, lastId) {
    const st = get();
    const chat = st.chats.find((c) => c.id === chatId);
    if (!chat) return;
    if ((chat.member?.lastRead ?? 0) >= lastId) return;
    set({ chats: st.chats.map((c) => c.id === chatId ? { ...c, unread: 0, member: { ...c.member!, lastRead: lastId } } : c) });
    api.readChat(chatId, lastId).catch(() => {});
  },

  async reactMsg(id, emoji) {
    const st = get();
    for (const [cid, list] of Object.entries(st.messages)) {
      const i = list.findIndex((m) => m.id === id);
      if (i >= 0) {
        const m = list[i];
        const reactions = [...(m.reactions ?? [])];
        const my = st.me!.id;
        const mineIdx = reactions.findIndex((r) => r.userIds.includes(my));
        const targetIdx = mineIdx >= 0 ? (reactions[mineIdx].emoji === emoji ? mineIdx : -1) : -1;
        if (targetIdx >= 0) {
          reactions[targetIdx] = { ...reactions[targetIdx], userIds: reactions[targetIdx].userIds.filter((u) => u !== my) };
          if (!reactions[targetIdx].userIds.length) reactions.splice(targetIdx, 1);
        } else {
          if (mineIdx >= 0) {
            reactions[mineIdx] = { ...reactions[mineIdx], userIds: reactions[mineIdx].userIds.filter((u) => u !== my) };
            if (!reactions[mineIdx].userIds.length) reactions.splice(mineIdx, 1);
          }
          const ri = reactions.findIndex((r) => r.emoji === emoji);
          if (ri >= 0) reactions[ri] = { ...reactions[ri], userIds: [...reactions[ri].userIds, my] };
          else reactions.push({ emoji, userIds: [my] });
        }
        const nl = [...list];
        nl[i] = { ...m, reactions };
        set({ messages: { ...st.messages, [cid]: nl } });
        break;
      }
    }
    try { await api.react(id, emoji); } catch {}
  },

  async editMsg(id, text) {
    try { await api.editMessage(id, text); set({ editing: null }); } catch {}
  },
  async deleteMsg(id, forAll) {
    try { await api.deleteMessage(id, forAll); } catch {}
  },
  async pinMsg(id, pin) {
    try { await api.pinMessage(id, pin); } catch {}
  },
  async forwardMsgs(ids, chatIds) {
    for (const id of ids) {
      try { await api.forward(id, chatIds); } catch {}
    }
  },
  async pollVote(id, choice) {
    try {
      const m = await api.pollVote(id, choice);
      get().upsertMessage(m.chatId, m);
    } catch {}
  },
  setReplyTo(m) { set({ replyTo: m }); },
  setEditing(m) { set({ editing: m }); },
  setSelection(ids) { set({ selection: ids }); },

  /* ---------- управление чатами ---------- */
  async createChat(type, userIds, title) {
    const chat = await api.createChat(type, userIds, title);
    socket?.emit('chat:join-room' as any, { chatId: chat.id });
    const fresh = await api.chats();
    set({ chats: fresh.sort(chatSort) });
    return chat;
  },
  async joinByLink(id) {
    await api.joinChat(id);
    const list = await api.chats();
    set({ chats: list.sort(chatSort), chatsLoaded: true });
  },
  async patchChat(id, fields) {
    const chat = await api.patchChat(id, fields);
    set({
      chats: get().chats
        .map((c) => (c.id === id
          ? { ...c, ...chat, members: c.members, member: c.member, lastMessage: c.lastMessage, unread: c.unread }
          : c))
        .sort(chatSort),
    });
    if (get().activeChatId === id) {
      set({ activeChat: { ...get().activeChat, ...chat, members: get().activeChat?.members ?? chat.members } as any });
    }
  },
  async patchChatMember(id, fields) {
    await api.patchMember(id, fields);
    set({ chats: get().chats.map((c) => c.id === id ? { ...c, member: { ...c.member!, ...fields } } : c) });
  },
  async addChatMembers(id, userIds) {
    const chat = await api.addMembers(id, userIds);
    set({ activeChat: get().activeChatId === id ? chat : get().activeChat });
  },
  async setRole(id, userId, role) {
    await api.setRole(id, userId, role);
    await get().refreshChat(id);
  },
  async kickMember(id, userId) {
    await api.kickMember(id, userId);
    await get().refreshChat(id);
  },
  async leaveChat(id) {
    try { await api.deleteChat(id); } catch {}
    set({
      chats: get().chats.filter((c) => c.id !== id),
      activeChatId: get().activeChatId === id ? null : get().activeChatId,
      activeChat: get().activeChatId === id ? null : get().activeChat,
    });
  },

  /* ---------- справочники ---------- */
  chatOf(id) {
    if (!id) return null;
    return get().chats.find((c) => c.id === id) ?? null;
  },

  userById(id) {
    if (!id) return null;
    const st = get();
    if (st.me?.id === id) return st.me as any;
    const known = st.users[id];
    if (known) return known;
    const mem = st.activeChat?.members?.find((m) => m.userId === id);
    if (mem) return mem.user;
    api.getUser(id).then((u) => set({ users: { ...get().users, [id]: u } })).catch(() => {});
    return null;
  },

  chatTitle(c) {
    const st = get();
    if (c.type === 'private') {
      if (isFavChat(c, st.me?.id ?? '')) return st.me?.settings?.language === 'en' ? 'Saved messages' : 'Избранное';
      return st.userById(peerIdOfChat(c, st.me?.id ?? ''))?.name ?? c.title ?? 'Чат';
    }
    return c.title ?? 'Чат';
  },

  chatAvatar(c) {
    const st = get();
    if (c.type === 'private') {
      if (isFavChat(c, st.me?.id ?? '')) return null;
      return st.userById(peerIdOfChat(c, st.me?.id ?? ''))?.avatar ?? null;
    }
    return c.avatar ?? null;
  },

  peerOf(c) {
    const st = get();
    if (c.type !== 'private') return null;
    if (isFavChat(c, st.me?.id ?? '')) return null;
    return st.userById(peerIdOfChat(c, st.me?.id ?? ''));
  },

  /* ---------- stories ---------- */
  async refreshStories() {
    try { set({ stories: await api.stories() }); } catch {}
  },
  async postStory(kind, url, caption, bg) {
    await api.postStory(kind, url, caption, bg);
    await get().refreshStories();
  },
  async deleteStory(id) {
    await api.deleteStory(id);
    await get().refreshStories();
  },
  setCall(c) { set({ call: c }); },
  pushRateCall(r) { set({ rateCall: r }); },

  async uploads(file, name, meta) {
    return api.upload(file, name, meta ?? {});
  },
}));

// живой доступ к стору для отладки/автотестов (не влияет на рантайм UI)
if (typeof window !== 'undefined') (window as any).__store = useStore;

/* ---------- сокет ---------- */
function notifyMessage(chat: Chat, message: Message) {
  const st = useStore.getState();
  const s = st.me?.settings;
  if (!s) return;
  const user = st.userById(message.sender ?? chat.id);
  const label = messageLabelOf(message);
  if (s.sounds && s.notifSound !== 'silent') sound('msg');
  if (s.browserNotif && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(user?.name ?? st.chatTitle(chat), {
        body: label, icon: user?.avatar?.url ?? undefined, tag: `chat-${chat.id}`,
      });
      n.onclick = () => { window.focus(); useStore.getState().openChat(chat.id); n.close(); };
      setTimeout(() => n.close(), 6000);
    } catch {}
  }
  st.pushToast({ kind: 'msg', title: user?.name ?? st.chatTitle(chat), text: label });
}

function socketConnect() {
  if (socket) socket.disconnect();
  socket = io('/', { auth: { token: getToken() } });
  socket.on('connect', () => useStore.setState({ connected: true }));
  socket.on('disconnect', () => useStore.setState({ connected: false }));
  socket.on('force:logout', () => {
    socket?.disconnect();
    setToken(null);
    useStore.setState({ me: null, authed: false });
    setTimeout(() => location.reload(), 300);
  });
  for (const h of socketHooks) { try { h(socket); } catch {} }

  socket.on('msg:new', ({ chatId, message }: any) => {
    const st = useStore.getState();
    st.upsertMessage(chatId, message);
    let chat = st.chats.find((c) => c.id === chatId);
    if (!chat) {
      api.chats().then((list) => useStore.setState({ chats: list.sort(chatSort) })).catch(() => {});
      return;
    }
    const isActive = st.activeChatId === chatId && document.hasFocus();
    const isMine = message.sender === st.me?.id;
    const chats = [...st.chats];
    const idx = chats.indexOf(chat);
    let unread = chat.unread;
    if (!isMine && !isActive) {
      unread += 1;
      if (chat.member && !chat.member.muted) notifyMessage(chat, message);
    }
    chats.splice(idx, 1);
    chats.unshift({ ...chat, lastMessage: message, unread });
    useStore.setState({ chats });
    if (isActive) useStore.getState().markRead(chatId, message.id);
  });

  socket.on('msg:update', ({ chatId, message }: any) => {
    useStore.getState().upsertMessage(chatId, message);
    const c = useStore.getState().chats.find((x) => x.id === chatId);
    if (c?.lastMessage?.id === message.id) {
      useStore.setState({ chats: useStore.getState().chats.map((x) => x.id === chatId ? { ...x, lastMessage: message } : x) });
    }
  });

  socket.on('read', ({ chatId, userId, lastId }: any) => {
    const st = useStore.getState();
    if (userId === st.me?.id) return;
    if (st.chats.find((c) => c.id === chatId)?.type === 'private') {
      useStore.setState({
        chats: st.chats.map((c) => c.id === chatId ? ({ ...c, peerLastRead: Math.max(lastId, (c as any).peerLastRead ?? 0) } as any) : c),
      });
    }
  });

  socket.on('read:me', ({ chatId }: any) => {
    useStore.setState({ chats: useStore.getState().chats.map((c) => c.id === chatId ? { ...c, unread: 0 } : c) });
  });

  socket.on('typing', ({ chatId, userId, kind, name }: any) => {
    const st = useStore.getState();
    const per = { ...(st.typing[chatId] ?? {}) };
    delete per[userId];
    if (kind != null && userId !== st.me?.id) per[userId] = { kind, name };
    useStore.setState({ typing: { ...st.typing, [chatId]: per } });
  });

  socket.on('presence', ({ id, online, lastSeen }: any) => {
    const st = useStore.getState();
    const one = new Set(st.online);
    if (online) one.add(id); else one.delete(id);
    const users = { ...st.users };
    if (users[id] && !online) users[id] = { ...users[id], lastSeen: lastSeen };
    useStore.setState({ online: one, users });
  });

  socket.on('user:updated', (user: PublicUser) => {
    const st = useStore.getState();
    const patch: any = { users: { ...st.users, [user.id]: { ...st.users[user.id], ...user } } };
    if (st.me?.id === user.id) {
      patch.me = { ...st.me, name: user.name, username: user.username, bio: user.bio, avatar: user.avatar, cover: user.cover, premium: user.premium };
    }
    useStore.setState(patch);
  });

  socket.on('chat:new', ({ chat, users }: any) => {
    const st = useStore.getState();
    useStore.setState({
      users: { ...st.users, ...Object.fromEntries((users ?? []).map((u: PublicUser) => [u.id, u])) },
      chats: st.chats.some((c) => c.id === chat.id) ? st.chats : [{ ...chat, unread: 0 }, ...st.chats],
    });
    socket?.emit('chat:join-room' as any, { chatId: chat.id });
  });

  socket.on('chat:updated', (chat: any) => {
    const st = useStore.getState();
    useStore.setState({
      chats: st.chats.map((c) => (c.id === chat.id ? { ...c, ...chat, members: undefined, member: c.member ?? chat.member } : c)).sort(chatSort),
    });
    if (st.activeChatId === chat.id) useStore.getState().refreshChat(chat.id);
  });

  socket.on('chat:removed', ({ chatId, userId }: any) => {
    const st = useStore.getState();
    if (userId !== st.me?.id && st.activeChatId === chatId) {
      useStore.getState().refreshChat(chatId);
      return;
    }
    useStore.setState({
      chats: st.chats.filter((c) => c.id !== chatId),
      activeChatId: st.activeChatId === chatId ? null : st.activeChatId,
      activeChat: st.activeChatId === chatId ? null : st.activeChat,
    });
  });

  socket.on('stories:update', () => { useStore.getState().refreshStories(); });
  socket.on('sched:released', () => {
    const id = useStore.getState().activeChatId;
    if (id) useStore.getState().loadMessages(id);
  });
}

setUnauthorizedHandler(() => {
  setToken(null);
  useStore.setState({ me: null, authed: false });
});
