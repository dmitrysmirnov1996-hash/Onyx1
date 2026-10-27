// Тема: применение CSS-переменных из настроек пользователя.
// Палитра «NOIR» (графит + ирис) живёт здесь — так настройки темы и акцента
// реально применяются, а не перекрываются жёстким CSS.
import type { UserSettings } from './types';

export const IRIS = '#8b5cf6';
/* Акценты старых дефолтов (slime-зелёный, синий) считаем «не выбрано»:
   у старых аккаунтов они сохранены в БД, но юзер их не выбирал сам. */
const LEGACY_DEFAULT_ACCENTS = ['#2ad46e', '#3390ec'];

export function resolveAccent(s: UserSettings): string {
  const a = (s.accent ?? '').toLowerCase();
  return a && !LEGACY_DEFAULT_ACCENTS.includes(a) ? a : IRIS;
}

export function effectiveDark(s: UserSettings): boolean {
  if (s.theme === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches;
  return s.theme === 'dark';
}

const PALETTES_BASE = {
  light: {
    bg: '#f4f4f8',
    surface: '#ffffff',
    surface2: '#eef0f6',
    surface3: '#e3e6f0',
    text: '#14161d',
    text2: '#6b7286',
    sidebar: '#fafafd',
    hover: 'rgba(88,60,180,.06)',
    border: 'rgba(20,22,40,.09)',
    overlay: 'rgba(10,10,20,.42)',
    glass: 'rgba(250,250,253,.78)',
    scrollbar: 'rgba(20,22,40,.2)',
  },
  dark: {
    bg: '#0b0d12',
    surface: '#14171e',
    surface2: '#1a1e26',
    surface3: '#212630',
    text: '#edf0f6',
    text2: '#98a1b3',
    sidebar: '#0e1117',
    hover: 'rgba(139,92,246,.08)',
    border: 'rgba(158,168,200,.085)',
    overlay: 'rgba(3,4,8,.6)',
    glass: 'rgba(17,20,27,.74)',
    scrollbar: 'rgba(255,255,255,.15)',
  },
} as const;

export function applyTheme(s: UserSettings) {
  const dark = effectiveDark(s);
  const accent = resolveAccent(s);
  const p = PALETTES_BASE[dark ? 'dark' : 'light'];
  const r = document.documentElement;
  for (const [k, v] of Object.entries(p)) r.style.setProperty('--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), v);

  // акцент и его контентный текст
  r.style.setProperty('--accent', accent);
  r.style.setProperty('--accentText', '#ffffff');

  // базовые тонировки
  r.style.setProperty('--bg-base', s.colors?.bg ? s.colors.bg : p.bg);
  r.style.setProperty('--text-base', s.colors?.text ? s.colors.text : p.text);

  // пузыри: кастомные цвета из настроек перекрывают палитру,
  // дефолт в тёмной теме — ирисовая подложка, в светлой — белый/светлый
  r.style.setProperty('--bubble-in', s.colors?.bubbleIn || (dark ? 'color-mix(in srgb, var(--text) 7%, var(--surface))' : '#ffffff'));
  r.style.setProperty('--bubble-in-text', dark ? '#edf0f6' : '#14161d');
  r.style.setProperty('--bubble-out', s.colors?.bubbleOut || `color-mix(in srgb, ${accent} ${dark ? '26' : '30'}%, ${dark ? '#131017' : '#ffffff'})`);
  r.style.setProperty('--bubble-out-text', dark ? '#f4f1ff' : '#ffffff');
  r.style.setProperty('--out-check', dark ? '#c4b5fd' : accent);

  r.style.setProperty('--bubble-radius', `${s.bubbleRadius ?? 16}px`);
  r.style.setProperty('--app-scale', String((s.uiScale ?? 100) / 100));
  r.style.setProperty('--fs-msg', `${s.fontSize ?? 15}px`);
  r.style.setProperty('--anim', s.animations ? '1' : '0');
  document.body.classList.toggle('no-anim', !s.animations);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b0d12' : '#f4f4f8');
}

export const ACCENT_PRESETS = [IRIS, '#a78bfa', '#6b5ce7', '#0fa75e', '#2ad46e', '#ee7b2e', '#e0533f', '#3390ec', '#57c9ec', '#2ec2c2', '#c257d2', '#ee5b96', '#e0a63f', '#8e8e8e', '#5ce8d8', '#7ad60a'];
const SLIME_BG = 'linear-gradient(135deg,#0d3b1e 0%,#127a3e 45%,#4be289 100%)';

export const GRADIENT_PRESETS: { id: string; css: string }[] = [
  { id: 'slime', css: SLIME_BG },
  { id: 'plain', css: 'linear-gradient(180deg,#132119,#0d1b14)' },
  { id: 'midnight', css: 'linear-gradient(135deg,#050505,#1a2a4a,#0f2027)' },
  { id: 'noir', css: 'linear-gradient(135deg,#0b0d12,#2a1e4a,#0b0d12)' },
  { id: 'sunset', css: 'linear-gradient(135deg,#355c7d,#c06c84,#f67280)' },
  { id: 'lagoon', css: 'linear-gradient(135deg,#005c97,#36d1dc)' },
  { id: 'orchid', css: 'linear-gradient(135deg,#654ea3,#eaafc8)' },
  { id: 'citrus', css: 'linear-gradient(135deg,#f7971e,#ffd200)' },
  { id: 'violet', css: 'linear-gradient(135deg,#4e54c8,#8f94fb)' },
  { id: 'forest', css: 'linear-gradient(135deg,#134e5e,#71b280)' },
  { id: 'mono', css: 'linear-gradient(135deg,#232526,#414345)' },
  { id: 'peach', css: 'linear-gradient(135deg,#ffecd2,#fcb69f)' },
  { id: 'aurora', css: 'linear-gradient(120deg,#a1c4fd,#c2e9fb,#a8edea,#fed6e3)' },
  { id: 'cyber', css: 'linear-gradient(135deg,#f0f, #0ff)' },
  { id: 'coral', css: 'linear-gradient(135deg,#ff5f6d,#ffc371)' },
];

// Стандартный узор (data-svg) — красится фирменным акцентом
export function patternURI(dark: boolean, opacity = 1, accent = IRIS): string {
  const col = dark ? accent ?? IRIS : accent;
  const op = (dark ? 0.05 : 0.07) * opacity;
  const bg = dark ? '#0b0d12' : '#f4f4f8';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>
<rect width='160' height='160' fill='${bg}'/>
<g fill='${col}' fill-opacity='${op}'>
<circle cx='20' cy='24' r='10'/><circle cx='24' cy='20' r='6' fill='${bg}'/>
<path d='M30 60q8-10 18-6t10 14q6 2 5 9t-9 7h-28q-7 0-7-7t6-8q-1-6 5-9z'/>
<path d='M100 30l14 8v16l-14 8-14-8V38z'/>
<circle cx='70' cy='110' r='8'/><rect x='120' y='100' width='22' height='22' rx='5' transform='rotate(15 131 110)'/>
<path d='M50 140q5-7 12-4t7 9' stroke='${col}' stroke-opacity='${op * 2}' fill='none' stroke-width='3' stroke-linecap='round'/>
<path d='M140 20a12 12 0 1 1-12 12' stroke='${col}' stroke-opacity='${op * 1.5}' fill='none' stroke-width='4'/>
</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
