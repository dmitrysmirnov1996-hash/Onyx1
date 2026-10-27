// in-memory состояние сервера
export const onlineMap = new Map(); // userId -> количество активных сокетов
export const userSockets = new Map(); // userId -> Set<Socket>

export function presenceJoin(userId, socket) {
  const set = userSockets.get(userId) ?? new Set();
  set.add(socket);
  userSockets.set(userId, set);
  const count = (onlineMap.get(userId) ?? 0) + 1;
  onlineMap.set(userId, count);
  return count === 1; // true если пользователь только что стал онлайн
}

export function presenceLeave(userId, socket) {
  const set = userSockets.get(userId);
  if (!set) return false;
  set.delete(socket);
  if (!set.size) userSockets.delete(userId);
  const count = (onlineMap.get(userId) ?? 0) - 1;
  if (count <= 0) { onlineMap.delete(userId); return true; }
  onlineMap.set(userId, count);
  return false;
}

export const isOnline = (userId) => (onlineMap.get(userId) ?? 0) > 0;
