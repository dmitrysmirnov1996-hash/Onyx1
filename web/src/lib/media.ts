// Медиа-утилиты: метаданные файлов, звуки через WebAudio, форматирование
export function imageMeta(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ w: 0, h: 0 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export function videoMeta(file: File | Blob): Promise<{ w: number; h: number; dur: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve({ w: v.videoWidth, h: v.videoHeight, dur: v.duration || 0 });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => { resolve({ w: 0, h: 0, dur: 0 }); URL.revokeObjectURL(url); };
    v.src = url;
  });
}

export function audioMeta(blob: Blob): Promise<{ dur: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.onloadedmetadata = () => { resolve({ dur: a.duration || 0 }); URL.revokeObjectURL(url); };
    a.onerror = () => { resolve({ dur: 0 }); URL.revokeObjectURL(url); };
    a.src = url;
  });
}

/* ---------- canvas: обрезка изображений (квадрат / широкий овал / стори 9:16) ---------- */
export interface CropState { zoom: number; offsetX: number; offsetY: number; rotation: number }

export function cropToBlob(
  img: HTMLImageElement | HTMLVideoElement,
  ratio: number, // width / height
  crop: CropState,
  maxSize = 1280,
  mime = 'image/jpeg',
): Promise<Blob> {
  const srcW = (img as HTMLVideoElement).videoWidth ?? (img as HTMLImageElement).naturalWidth;
  const srcH = (img as HTMLVideoElement).videoHeight ?? (img as HTMLImageElement).naturalHeight;
  let outW = srcW, outH = srcH;
  const curRatio = srcW / srcH;
  if (curRatio > ratio) outW = Math.round(srcH * ratio); else outH = Math.round(srcW / ratio);
  if (outW > maxSize) { outH = Math.round(outH * maxSize / outW); outW = maxSize; }
  const cvs = document.createElement('canvas');
  cvs.width = outW; cvs.height = outH;
  const ctx = cvs.getContext('2d')!;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((crop.rotation * Math.PI) / 180);
  const base = Math.max(outW / srcW, outH / srcH);
  const s = base * crop.zoom;
  ctx.scale(s, s);
  ctx.translate(-srcW / 2 - crop.offsetX / s, -srcH / 2 - crop.offsetY / s);
  ctx.drawImage(img as any, 0, 0);
  return new Promise((r) => cvs.toBlob((b) => r(b!), mime, 0.92));
}

/* ---------- звуки (WebAudio, без файлов) ---------- */
let actx: AudioContext | null = null;
function ctx() {
  if (!actx) actx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return actx;
}

function tone(freq: number, t0: number, dur: number, gain = 0.12, type: OscillatorType = 'sine') {
  const c = ctx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + t0);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + t0);
  o.stop(c.currentTime + t0 + dur + 0.05);
}

/* «стеклянный» звон: основная нота + октавный обертон, яркая атака, мягкий хвост */
function chime(freq: number, t0: number, dur: number, gain: number) {
  const c = ctx();
  const t = c.currentTime + t0;
  const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(gain * 0.18, t + 0.008);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.55);
  o.connect(g); g.connect(c.destination);
  o2.connect(g2); g2.connect(c.destination);
  o.start(t); o.stop(t + dur + 0.05);
  o2.start(t); o2.stop(t + dur * 0.6 + 0.05);
}

/* лёгкий механический клик: короткий шум по высоких частотам — придаёт «физичность» */
function clickNoise(t0: number, gain = 0.08) {
  const c = ctx();
  const b = c.createBuffer(1, 882, 44100); // ~20 мс
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(); src.buffer = b;
  const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2200;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(c.destination);
  src.start(c.currentTime + t0);
}

export function sound(kind: 'msg' | 'pop' | 'ring' | 'ringback' | 'hangup') {
  try {
    switch (kind) {
      /* уведомление о сообщении: современный двухнотный звон (ярко и громко) */
      case 'msg':
        clickNoise(0.004, 0.07);
        chime(1318.5, 0, 0.32, 0.3);   // E6 — «крышка»
        chime(1975.5, 0.08, 0.5, 0.24); // B6 — «разрешение» вверх
        break;
      /* отправка: короткий упругий бренк */
      case 'pop': clickNoise(0.002, 0.05); tone(880, 0, 0.07, 0.2); tone(1244.5, 0.05, 0.1, 0.16); break;
      /* входящий звонок: тёплые три ноты с октавой сверху — громкий и узнаваемый */
      case 'ring':
        chime(783.99, 0, 0.3, 0.24);
        chime(987.77, 0.3, 0.3, 0.24);
        chime(1174.66, 0.6, 0.55, 0.22);
        tone(1567.98, 0.6, 0.4, 0.09);
        break;
      case 'ringback': tone(440, 0, 0.5, 0.14); tone(480, 0.5, 0.4, 0.14); break;
      case 'hangup': tone(392, 0, 0.15, 0.18); tone(294, 0.12, 0.25, 0.18); break;
    }
  } catch {}
}

let ringInterval: ReturnType<typeof setInterval> | null = null;
export function startRing(kind: 'incoming' | 'outgoing') {
  stopRing();
  sound(kind === 'incoming' ? 'ring' : 'ringback');
  ringInterval = setInterval(() => sound(kind === 'incoming' ? 'ring' : 'ringback'), 2000);
}
export function stopRing() {
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
}

/* ---------- форматирование ---------- */
export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function fmtDateFull(ts: number): string {
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}
/* разделитель дат в чате — как в tdesktop: «16 октября», год только если не текущий */
export function fmtDateSep(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
}
export function fmtDur(sec: number): string {
  const s = Number.isFinite(sec) ? Math.max(0, Math.round(sec)) : 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtLastSeen(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = Date.now();
  const diff = (now - ts) / 1000;
  if (diff < 60) return 'сейчас онлайн';
  if (diff < 3600) return `был(а) ${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `был(а) в ${fmtTime(ts)}`;
  if (diff < 2 * 86400) return `был(а) вчера`;
  return `был(а) ${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })}`;
}
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

export function dayKey(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const STICKERS = ['😀','😂','🥹','😍','🤪','😎','🥳','😴','🤯','🥰','😘','😜','🤗','🤔','🤨','😐','😏','🙄','😢','😭','😤','😡','🤬','🫡','🤝','🙏','💪','👏','👌','🤙','👍','👎','❤️','🧡','💛','💚','💙','💜','🖤','🔥','💯','🎉','🎂','🎁','☕','🍕','🍔','🍺','⚽','🏀','🎮','🚀','✈️','🏖️','🦊','🐱','🐶','🐼','🐨','🦁','🐯','🐷','🐸','🐵','🦄','🐝','🌸','🌈','⭐','🌙','☀️','⚡','❄️','🌈','👻','🎃','🤡','💀','🤖','🥑','🍉','🍓','🍒','🍩','🍫','🧁','🍦','🍿','🥂','🍷','🎤','🎸','🎧','📷','🎬','🏆','🥇','🎯','💎','👑','🧠','🫠'];

export const QUICK_REACTIONS = ['❤️', '👍', '🔥', '😂', '🥰', '😮', '😢', '🤔', '🎉', '💯'];

export const EMOJI_CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [
  {
    name: 'Смайлы', icon: '😀',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','🤖','😺','😹','😼','😻','🙀','😿','😾'],
  },
  {
    name: 'Жесты', icon: '👍',
    emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🖊','🖋','📱','💻','⌨️','🖥','🖨','🖱','💾','💿','📀','📷','📸','🎥','📼','📞','☎️','📠','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','🧯','🛢','💸','💵','💴','💶','💷','💰','💳','💎','⚖️','🔧','🔨','🛠','⛏','🚧','🧲','💊','💉','🩹','🩺','🚑','🚀','🛸','✈️','🚁'],
  },
  {
    name: 'Животные', icon: '🐶',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🪲','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐈','🐓','🦃','🦚','🦜','🦢','🕊','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀'],
  },
  {
    name: 'Еда', icon: '🍕',
    emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🧇','🧀','🥚','🍳','🧈','🥞','🥓','🍖','🍗','🌭','🍔','🍟','🍕','🥪','🌮','🌯','🫔','🥙','🧆','🥘','🫕','🍝','🥫','🍛','🍜','🍚','🍙','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🫖','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🍸','🍹','🧉','🍾','🧊'],
  },
  {
    name: 'Символы', icon: '❤️',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪','🕉','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','🌙','🌞','⭐','🌟','💫','✨','☄️','🔥','🌈','☀️','⛅','☁️','🌦','🌧','⛈','🌩','🌨','❄️','☃️','⛄','🌬','💨','🌪','🌫','🌊','💧'],
  },
];
