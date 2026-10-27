// TOTP (RFC 6238) — совместим с Google Authenticator / Яндекс.Ключ / 1Password
// Секрет хранится base32, код 6 цифр, период 30с.
import { createHmac, randomBytes } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function genSecret(bytes = 10) {
  const buf = randomBytes(bytes);
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function b32decode(secret) {
  let bits = 0, value = 0, out = [];
  for (const c of secret.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totp(secret, time = Math.floor(Date.now() / 30000)) {
  const key = b32decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(time / 0x100000000), 0);
  msg.writeUInt32BE(time >>> 0, 4);
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[19] & 15;
  const code = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000;
  return String(code).padStart(6, '0');
}

export function verify(secret, code, window = 1) {
  if (!secret || !/^\d{6}$/.test(String(code))) return false;
  const t = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    if (totp(secret, t + i) === String(code)) return true;
  }
  return false;
}

export function otpauthUrl(secret, username) {
  return `otpauth://totp/TelegramClone:${encodeURIComponent(username)}?secret=${secret}&issuer=TelegramClone&digits=6&period=30`;
}
