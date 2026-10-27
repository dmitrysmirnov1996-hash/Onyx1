// Быстрый smoke-test REST API: логин, список чатов, отправка сообщения,
// реакции, опрос, сторис. Запуск: node e2e/smoke.mjs (нужен работающий сервер).
const base = process.env.BASE_URL ?? 'http://localhost:3001';

const login = async (u) =>
  (await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'secret123' }),
  }).then((r) => r.json()));

const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 120) : ''}`);

try {
  const a = await login('alice');
  check('login alice', !!a.token, a.error);
  const h = { authorization: 'Bearer ' + a.token, 'content-type': 'application/json' };

  const me = await (await fetch(base + '/api/me', { headers: h })).json();
  check('me', me?.username === 'alice', me?.username);

  const chats = await (await fetch(base + '/api/chats', { headers: h })).json();
  check('chats list', Array.isArray(chats) && chats.length > 0, chats?.length);

  // отдельная песочница, чтобы не засорять реальные чаты
  let box = chats.find((c) => c.title === 'Smoke Тест');
  if (!box) {
    const bob = await login('bob');
    box = await (await fetch(base + '/api/chats', {
      method: 'POST', headers: h, body: JSON.stringify({ type: 'group', title: 'Smoke Тест', userIds: [bob.id] }),
    })).json();
  }
  const priv = box ?? chats[0];

  const msg = await (await fetch(base + `/api/chats/${priv.id}/messages`, {
    method: 'POST', headers: h, body: JSON.stringify({ type: 'text', text: 'smoke ' + Date.now() }),
  })).json();
  check('send message', !!msg?.id, msg?.error);

  const react = await (await fetch(base + `/api/messages/${msg.id}/react`, {
    method: 'POST', headers: h, body: JSON.stringify({ emoji: '🔥' }),
  })).json();
  check('reaction', !!react?.id || react?.reactions, react?.error ?? 'ok');

  const poll = await (await fetch(base + `/api/chats/${priv.id}/messages`, {
    method: 'POST', headers: h, body: JSON.stringify({ type: 'poll', text: '', media: { question: 'Smoke?', options: ['Да', 'Нет'] } }),
  })).json();
  check('create poll', !!poll?.id, poll?.error);

  const vote = await (await fetch(base + `/api/messages/${poll.id}/pollvote`, {
    method: 'POST', headers: h, body: JSON.stringify({ choice: 0 }),
  })).json();
  check('poll vote', !!vote?.id, vote?.error);

  const stories = await (await fetch(base + '/api/stories', { headers: { authorization: h.authorization } })).json();
  check('stories feed', !!stories, Array.isArray(stories?.stories ?? stories) ? 'list' : Object.keys(stories ?? {}));

  const page = await fetch(base + '/', { headers: {} }).then((r) => r.status);
  check('web UI served', page === 200, page);
} catch (e) {
  check('smoke error', false, String(e.message ?? e));
}

console.log(results.join('\n'));
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
