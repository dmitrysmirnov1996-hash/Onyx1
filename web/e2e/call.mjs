// Сквозная проверка сигналинга звонков через Socket.IO (как это делает браузер).
// Проверяет: incoming/ringing, busy (механика tdesktop), accept → signal exchange
// (offer/ice), declined/end с корректными reason.
// WebRTC-медиа здесь не проверяется: в headless-окружении нет микрофона/камеры.
//
// Использование: node e2e/call.mjs
import { io } from 'socket.io-client';

const base = process.env.BASE_URL ?? 'http://localhost:3001';
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + (cond ? '' : ' ✗') + ' ' + label); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (u) =>
  (await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'secret123' }),
  }).then((r) => r.json()));

const a = await login('alice');
const b = await login('bob');
if (!a?.user?.id || !b?.user?.id) { console.error('Не удалось войти', { a, b }); process.exit(1); }

const mk = (token) => io(base, { auth: { token }, transports: ['websocket'] });

const race = (p, ms = 4000) => Promise.race([p, sleep(ms).then(() => null)]);

const sA = mk(a.token);       // alice,_calls
const sA2 = mk(a.token);      // alice, вторая «сессия» (для busy)
const sB = mk(b.token);       // bob

const once = (sock, ev) => new Promise((res) => sock.once(ev, res));
const qA = once(sA, 'connect').then(() => true);
const qB = once(sB, 'connect').then(() => true);
await Promise.all([qA, once(sA2, 'connect'), qB]);

const incoming = once(sB, 'call:incoming');
const ringing = once(sA, 'call:ringing');
const callId = 'e2e-' + Date.now().toString(36);
sA.emit('call:start', { callId, to: b.user.id, kind: 'voice' });

const [inc, ring] = await race(Promise.all([incoming, ringing]));
ok(!!inc && !!ring, 'bob получает call:incoming, alice — call:ringing');

// busy: второй звонок alice (другая сессия) к занятому bob отклоняется сервером
const busy = race(once(sA2, 'call:ended'));
sA2.emit('call:start', { callId: callId + '-2', to: b.user.id, kind: 'voice' });
const busyHit = await busy;
ok(busyHit?.reason === 'busy', 'второй звонок занятому → reason=busy');

// b declined
const endedDeclined = race(once(sA, 'call:ended'));
sB.emit('call:decline', { callId });
const ed = await endedDeclined;
ok(ed?.reason === 'declined', 'отказ b → alice: reason=declined');

await sleep(300);
// accept + signaling exchange
const accA = once(sA, 'call:accepted');
const sigA = once(sA, 'call:signal');
const callId2 = callId + '-3';
sA.emit('call:start', { callId: callId2, to: b.user.id, kind: 'voice' });
await race(once(sB, 'call:incoming'));
sB.emit('call:accept', { callId: callId2 });
const acc = await race(accA);
ok(!!acc, 'вызвавший получает call:accepted (у вызываемого фаза локальная)');
sB.emit('call:signal', { callId: callId2, to: a.user.id, data: { type: 'ice', candidate: { candidate: 'candidate:fake', sdpMid: '0', sdpMLineIndex: 0 } } });
const sig = await race(sigA);
ok(sig?.data?.type === 'ice', 'обмен сигналом ice доходит');

// end
const endedEnd = race(once(sA, 'call:ended'));
sB.emit('call:end', { callId: callId2 });
const ee = await endedEnd;
ok(ee?.reason === 'ended', 'завершение b → alice: reason=ended');

// история звонков содержит записи
const hist = await fetch(base + '/api/calls', { headers: { authorization: 'Bearer ' + a.token } }).then((r) => r.json());
ok(Array.isArray(hist) && hist.some((c) => c.status === 'ended' || c.status === 'declined' || c.status === 'missed'), `история звонков пишется (${hist.length} записей)`);

for (const s of [sA, sA2, sB]) s.disconnect();
await sleep(300);
process.exitCode = failures ? 1 : 0;
