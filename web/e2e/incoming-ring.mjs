// Входящий звонок в UI: bob звонит alice, сокет остается открытым 25 c
// (можно вручную принять/отклонить в браузере). usage: node e2e/incoming-ring.mjs
import { io } from 'socket.io-client';
const base = process.env.BASE_URL ?? 'http://localhost:3001';
const caller = process.argv[2] ?? 'bob';
const callee = process.argv[3] ?? 'alice';
const login = async (u) => (await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: u, password: 'secret123' }),
}).then((r) => r.json()));

const a = await login(caller);
const b = await login(callee);
if (!a?.user?.id || !b?.user?.id) { console.error('login fail'); process.exit(1); }
const socket = io(base, { auth: { token: a.token }, transports: ['websocket'] });
socket.on('call:ringing', (e) => console.log('ringing:', e.callId));
socket.on('call:ended', (e) => console.log('ended:', e.reason || JSON.stringify(e)));
socket.on('call:accepted', (e) => console.log('accepted!', e.callId));
socket.on('connect', () => {
  const callId = 'ui-in-' + Date.now().toString(36);
  console.log('emitting call:start', callId, '->', callee);
  socket.emit('call:start', { callId, to: b.user.id, kind: 'voice' });
});
setTimeout(() => { socket.disconnect(); process.exit(0); }, 25000);
