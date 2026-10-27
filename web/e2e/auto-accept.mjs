// Боб авто-принимает входящий звонок (для UI-тестов звонящего в браузере).
// usage: node e2e/auto-accept.mjs bob [таймаут_сек=60]
import { io } from 'socket.io-client';
const base = process.env.BASE_URL ?? 'http://localhost:3001';
const me = process.argv[2] ?? 'bob';
const keepMs = (Number(process.argv[3] ?? 60)) * 1000;
const login = async (u) => (await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: u, password: 'secret123' }),
}).then((r) => r.json()));

const a = await login(me);
if (!a?.user?.id) { console.error('login fail'); process.exit(1); }
const socket = io(base, { auth: { token: a.token }, transports: ['websocket'] });
socket.on('call:incoming', (e) => {
  console.log('incoming:', e.callId, e.kind ?? (e.call?.kind ?? ''));
  socket.emit('call:accept', { callId: e.callId });
  console.log('accepted:', e.callId);
});
socket.on('call:connected', (e) => console.log('connected:', e.callId));
socket.on('call:ended', (e) => console.log('ended:', e.reason || JSON.stringify(e)));
socket.on('connect', () => console.log('listening as', me));
setTimeout(() => { console.log('done'); socket.disconnect(); process.exit(0); }, keepMs);
