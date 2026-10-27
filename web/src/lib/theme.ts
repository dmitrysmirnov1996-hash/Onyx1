// Тема: применение CSS-переменных из настроек пользователя
import type { UserSettings } from './types';

export const PALETTES = {
  light: {
    bg: '#fafdf8', surface: '#eef6ef', surface2: '#e2efe4', surface3: '#d3e7d8',
    text: '#0a1710', text2: '#5e7a68', sidebar: '#f4faf4', hover: 'rgba(20,80,40,.06)',
    bubbleIn: '#ffffff', bubbleInText: '#0a1710', bubbleOut: '#d9f5e2', bubbleOutText: '#07240f',
    outCheck: '#1faf5d', border: 'rgba(10,50,25,.09)', overlay: 'rgba(5,20,10,.42)', glass: 'rgba(248,253,248,.78)',
    accentText: '#04220f', scrollbar: 'rgba(10,60,35,.22)',
  },
  dark: {
    bg: '#0d1b14', surface: '#13211a', surface2: '#1a2c21', surface3: '#23382b',
    text: '#eef7f0', text2: '#8fa99a', sidebar: '#101d16', hover: 'rgba(140,255,190,.07)',
    bubbleIn: '#18271f', bubbleInText: '#eef7f0', bubbleOut: '#1f5f3f', bubbleOutText: '#eafff2',
    outCheck: '#7be79f', border: 'rgba(150,255,200,.09)', overlay: 'rgba(4,10,7,.56)', glass: 'rgba(18,32,24,.72)',
    accentText: '#062312', scrollbar: 'rgba(150,255,200,.24)',
  },
};

export function effectiveDark(s: UserSettings): boolean {
  if (s.theme === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches;
  return s.theme === 'dark';
}

export function applyTheme(s: UserSettings) {
  const dark = effectiveDark(s);
  const p = PALETTES[dark ? 'dark' : 'light'];
  const r = document.documentElement;
  for (const [k, v] of Object.entries(p)) r.style.setProperty('--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), v);
  r.style.setProperty('--accent', s.accent || '#2ad46e');
  r.style.setProperty('--bg-base', s.colors?.bg ? s.colors.bg : p.bg);
  r.style.setProperty('--text-base', s.colors?.text ? s.colors.text : p.text);
  // кастомные цвета пузырей: только ПЕРЕКРЫВАЮТ слайм-палитру (иначе остаются значения Light/Dark)
  if (s.colors?.bubbleIn) r.style.setProperty('--bubble-in', s.colors.bubbleIn);
  if (s.colors?.bubbleOut) r.style.setProperty('--bubble-out', s.colors.bubbleOut);
  r.style.setProperty('--bubble-radius', `${s.bubbleRadius ?? 16}px`);
  r.style.setProperty('--app-scale', String((s.uiScale ?? 100) / 100));
  r.style.setProperty('--fs-msg', `${s.fontSize ?? 15}px`);
  r.style.setProperty('--anim', s.animations ? '1' : '0');
  document.body.classList.toggle('no-anim', !s.animations);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#101d16' : '#fafdf8');
}

export const ACCENT_PRESETS = ['#2ad46e', '#12b981', '#0fa75e', '#7ad60a', '#57c9ec', '#2ec2c2', '#3390ec', '#6b5ce7', '#c257d2', '#e0533f', '#ee7b2e', '#e0a63f', '#ee5b96', '#f27a9b', '#8e8e8e', '#5ce8d8'];
const SLIME_BG = 'linear-gradient(135deg,#0d3b1e 0%,#127a3e 45%,#4be289 100%)';

export const GRADIENT_PRESETS: { id: string; css: string }[] = [
  { id: 'slime', css: SLIME_BG },
  { id: 'plain', css: 'linear-gradient(180deg,#132119,#0d1b14)' },
  { id: 'midnight', css: 'linear-gradient(135deg,#050505,#1a2a4a,#0f2027)' },
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

// Стандартный узор (data-svg) в фирменном зелёном Slime
export function patternURI(dark: boolean, opacity = 1): string {
  const col = dark ? '#8bf0bd' : '#2ad46e';
  const op = (dark ? 0.05 : 0.07) * opacity;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>
<rect width='160' height='160' fill='${dark ? '#0d1b14' : '#fafdf8'}'/>
<g fill='${col}' fill-opacity='${op}'>
<circle cx='20' cy='24' r='10'/><circle cx='24' cy='20' r='6' fill='${dark ? '#0d1b14' : '#fafdf8'}'/>
<path d='M30 60q8-10 18-6t10 14q6 2 5 9t-9 7h-28q-7 0-7-7t6-8q-1-6 5-9z'/>
<path d='M100 30l14 8v16l-14 8-14-8V38z'/>
<circle cx='70' cy='110' r='8'/><rect x='120' y='100' width='22' height='22' rx='5' transform='rotate(15 131 110)'/>
<path d='M50 140q5-7 12-4t7 9' stroke='${col}' stroke-opacity='${op * 2}' fill='none' stroke-width='3' stroke-linecap='round'/>
<path d='M140 20a12 12 0 1 1-12 12' stroke='${col}' stroke-opacity='${op * 1.5}' fill='none' stroke-width='4'/>
</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
