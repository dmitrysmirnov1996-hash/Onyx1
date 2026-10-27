// HTTP API клиент (Bearer-токен) + загрузка файлов
let token = localStorage.getItem('tg_token');

export function getToken() { return token; }
export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('tg_token', t);
  else localStorage.removeItem('tg_token');
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

export async function request(path: string, opts: RequestInit = {}): Promise<any> {
  const headers = new Headers(opts.headers || {});
  if (!headers.has('content-type') && !(opts.body instanceof FormData) && opts.body) {
    headers.set('content-type', 'application/json');
  }
  if (token) headers.set('authorization', `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch('/api' + path, { ...opts, headers });
  } catch {
    throw new ApiError('network', 0);
  }
  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError((await res.json().catch(() => ({})))?.error ?? 'unauthorized', 401);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error ?? 'server_error', res.status, data?.detail);
  return data;
}

export class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(public code: string, status: number, detail?: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export const api = {
  // auth
  register: (username: string, name: string, password: string) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ username, name, password }) }),
  login: (username: string, password: string, totp?: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password, totp }) }),
  logout: () => request('/auth/logout', { method: 'POST', body: '{}' }),
  logoutAll: () => request('/auth/logout_all', { method: 'POST', body: '{}' }),
  twoFaSetup: () => request('/auth/2fa/setup', { method: 'POST', body: '{}' }),
  twoFaEnable: (code: string) => request('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  twoFaDisable: (code: string) => request('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),

  // me / users
  me: () => request('/me'),
  patchMe: (fields: any) => request('/me', { method: 'PATCH', body: JSON.stringify(fields) }),
  resetMe: () => request('/me/reset', { method: 'POST', body: '{}' }),
  sync: () => request('/sync'),
  searchUsers: (q: string) => request('/users?q=' + encodeURIComponent(q)),
  listUsers: () => request('/users?all=1'),
  getUser: (id: string) => request('/users/' + id),
  changePassword: (oldP: string, password: string) =>
    request('/me/password', { method: 'PATCH', body: JSON.stringify({ old: oldP, password }) }),

  // chats
  chats: () => request('/chats'),
  createChat: (type: string, userIds: string[], title?: string) =>
    request('/chats', { method: 'POST', body: JSON.stringify({ type, userIds, title }) }),
  getChat: (id: string) => request('/chats/' + id),
  patchChat: (id: string, fields: any) => request('/chats/' + id, { method: 'PATCH', body: JSON.stringify(fields) }),
  patchMember: (id: string, fields: any) => request(`/chats/${id}/member`, { method: 'PATCH', body: JSON.stringify(fields) }),
  addMembers: (id: string, userIds: string[]) => request(`/chats/${id}/members`, { method: 'POST', body: JSON.stringify({ userIds }) }),
  setRole: (id: string, userId: string, role: string) => request(`/chats/${id}/role`, { method: 'POST', body: JSON.stringify({ userId, role }) }),
  kickMember: (id: string, userId: string) => request(`/chats/${id}/members/${userId}`, { method: 'DELETE' }),
  deleteChat: (id: string) => request('/chats/' + id, { method: 'DELETE' }),
  joinChat: (id: string) => request(`/chats/join/${id}`, { method: 'POST', body: '{}' }),

  // messages
  messages: (chatId: string, opts: { before?: number; search?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.before != null) params.set('before', String(opts.before));
    if (opts.search) params.set('search', opts.search);
    const q = params.toString();
    return request(`/chats/${chatId}/messages${q ? '?' + q : ''}`);
  },
  scheduled: (chatId: string) => request(`/chats/${chatId}/scheduled`),
  sendMessage: (chatId: string, body: any) => request(`/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  editMessage: (id: number, text: string) => request(`/messages/${id}/edit`, { method: 'POST', body: JSON.stringify({ text }) }),
  deleteMessage: (id: number, all: boolean) => request(`/messages/${id}/delete`, { method: 'POST', body: JSON.stringify({ all }) }),
  pinMessage: (id: number, pin: boolean) => request(`/messages/${id}/pin`, { method: 'POST', body: JSON.stringify({ pin }) }),
  react: (id: number, emoji: string) => request(`/messages/${id}/react`, { method: 'POST', body: JSON.stringify({ emoji }) }),
  pollVote: (id: number, choice: number) => request(`/messages/${id}/pollvote`, { method: 'POST', body: JSON.stringify({ choice }) }),
  forward: (id: number, chatIds: string[]) => request(`/messages/${id}/forward`, { method: 'POST', body: JSON.stringify({ chatIds }) }),
  readChat: (chatId: string, lastId: number) => request(`/chats/${chatId}/read`, { method: 'POST', body: JSON.stringify({ lastId }) }),
  editHistory: (id: number) => request(`/messages/${id}/history`),

  // stories
  stories: () => request('/stories'),
  myArchive: () => request('/stories/archive'),
  userStories: (id: string) => request('/stories/user/' + id),
  postStory: (kind: string, url: string, caption: string, bg?: string) =>
    request('/stories', { method: 'POST', body: JSON.stringify({ kind, url, caption, bg }) }),
  viewStory: (id: string, reaction?: string | null) => request(`/stories/${id}/view`, { method: 'POST', body: JSON.stringify({ reaction }) }),
  storyViews: (id: string) => request(`/stories/${id}/views`),
  deleteStory: (id: string) => request(`/stories/${id}`, { method: 'DELETE' }),
  pinStory: (id: string) => request(`/stories/${id}/pin`, { method: 'POST', body: '{}' }),
  archiveStory: (id: string) => request(`/stories/${id}/archive`, { method: 'POST', body: '{}' }),

  // misc
  upload: (file: File | Blob, name: string, meta: { w?: number; h?: number; dur?: number } = {}) => {
    const fd = new FormData();
    fd.append('file', file, name);
    if (meta.w) fd.append('w', String(meta.w));
    if (meta.h) fd.append('h', String(meta.h));
    if (meta.dur) fd.append('dur', String(Math.round(meta.dur)));
    return request('/upload', { method: 'POST', body: fd });
  },
  sessions: () => request('/sessions'),
  terminateSession: (token: string) => request('/sessions/' + token, { method: 'DELETE' }),
  calls: () => request('/calls'),
  importPack: (pack: string) => request('/stickers/import?pack=' + encodeURIComponent(pack)),
};
