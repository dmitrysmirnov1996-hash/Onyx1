// Чёрный список: сервер запрещает отправку в личный чат при блоке любой стороны
const B = 'http://localhost:3001';
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('PASS ' + name); };
const no = (name, extra) => { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const api = async (m, p, token, body) => {
  const r = await fetch(B + '/api' + p, {
    method: m,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return [r.status, await j(r)];
};

const [, A] = await api('POST', '/auth/login', null, { username: 'alice', password: 'secret123' });
const [, Bb] = await api('POST', '/auth/login', null, { username: 'bob', password: 'secret123' });
const [, meA] = await api('GET', '/me', A.token);
const [, meB] = await api('GET', '/me', Bb.token);
const [, chatsA] = await api('GET', '/chats', A.token);
const chat = chatsA.find((c) => c.type === 'private'
  && c.members?.some((m) => (m.userId ?? m.user_id ?? m.id) === meB.id)
  && c.members?.some((m) => (m.userId ?? m.user_id ?? m.id) === meA.id));
if (!chat) { console.log('FAIL no private chat alice<->bob'); process.exit(1); }

// 1) alice блокирует bob
await api('PATCH', '/me', A.token, { settings: { blocked: [meB.id] } });
const [s1, r1] = await api('POST', `/chats/${chat.id}/messages`, Bb.token, { type: 'text', text: 'probe-blocked-bob' });
(s1 === 403 && r1.error === 'you_are_blocked') ? ok(`bob→alice blocked: ${s1} ${r1.error}`) : no('bob→alice should be blocked', JSON.stringify([s1, r1]));

// 2) встречный блок: bob блокирует alice
await api('PATCH', '/me', Bb.token, { settings: { blocked: [meA.id] } });
const [s2, r2] = await api('POST', `/chats/${chat.id}/messages`, A.token, { type: 'text', text: 'probe-blocked-alice' });
(s2 === 403 && r2.error === 'blocked_target') ? ok(`alice→bob blocked: ${s2} ${r2.error}`) : no('alice→bob should be blocked_target', JSON.stringify([s2, r2]));

// 3) разблок с обеих сторон → отправка снова работает
await api('PATCH', '/me', A.token, { settings: { blocked: [] } });
await api('PATCH', '/me', Bb.token, { settings: { blocked: [] } });
const [s3, r3] = await api('POST', `/chats/${chat.id}/messages`, Bb.token, { type: 'text', text: 'probe-unblocked-ok (teardown)' });
if (s3 === 200 && r3.id) {
  ok('unblock → send works again');
  const [ds] = await api('POST', `/messages/${r3.id}/delete`, Bb.token, { forAll: true });
  ds === 200 ? ok('teardown: probe message deleted') : no('teardown delete', 'status ' + ds);
} else no('unblock should allow sending', JSON.stringify([s3, r3]));

console.log(`${pass}/${pass + fail} PASS`);
process.exitCode = fail ? 1 : 0;
