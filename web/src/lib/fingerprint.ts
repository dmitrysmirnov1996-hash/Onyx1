// Эмодзи-отпечаток звонка (механика Telegram Desktop calls_emoji_fingerprint):
// sha-256 разбивается на 8-байтовые части -> индекс -> 4 эмодзи,
// одинаковые на обоих устройствах для одного и того же соединения.
// Отличие от tdesktop: набор эмодзи заменён на 64 хорошо поддерживаемых
// (tdesktop'овская таблица содержит редкие/U+1F3xx-варианты, которые в браузерных
// шрифтах иногда не отрисовываются — вместо эмодзи видны квадратики). Механика та же:
// коды зависят только от DTLS-отпечатков обеих сторон и идентичны у обоих участников.
export const EMOJI_SET: string[] = [
  '🍎', '🍊', '🍋', '🍉', '🍇', '🍓', '🍒', '🍑', '🥭', '🍍', '🥝', '🍅', '🥑', '🥕', '🌽', '🍞',
  '🧀', '🌭', '🍔', '🍟', '🍕', '🌮', '🍦', '🍩', '🍪', '🎂', '🍫', '🍿', '☕', '🍵', '🍺', '🥂',
  '⚽', '🏀', '🎾', '🎱', '🏆', '🎮', '🎲', '🎯', '🎸', '🎧', '🎺', '🎹', '🚀', '🚗', '🚲', '🚁',
  '🚂', '⛵', '🏠', '🌋', '🗿', '🗽', '🎠', '🌈', '🌸', '🌻', '🌴', '🌵', '🐝', '🦋', '🐢', '🐬',
  '🐳', '🐙', '🦊', '🦄', '🦆', '🐧', '🌙', '⭐', '⚡', '🔥', '💧', '🎈', '🎁', '🔧', '🧲', '💡',
];
const COUNT = EMOJI_SET.length; // 80

// Точный порт ComputeEmojiIndex: старший бит первого байта сброшен, чтобы результат
// всегда помещался в беззнаковый 63-битный диапазон (как uint64 в tdesktop).
function emojiIndex(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    const b = BigInt(bytes[i] & (i === 0 ? 0x7f : 0xff));
    v |= b << BigInt(56 - i * 8);
  }
  return v;
}

/** 32-байтовый отпечаток (sha-256) -> 4 эмодзи из набора EMOJI_SET */
export function emojiFingerprint(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 8 <= bytes.length; i += 8) {
    const idx = Number(emojiIndex(bytes.subarray(i, i + 8)) % BigInt(COUNT));
    out += EMOJI_SET[idx];
  }
  return out;
}

/** Стабильный отпечаток текущего звонка: сортировка DTLS-отпечатков обеих сторон. */
export function callFingerprintSeed(...parts: string[]): string {
  return [...parts].sort().join('|');
}

export async function sha256(text: string): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}
