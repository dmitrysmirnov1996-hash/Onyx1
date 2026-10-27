import { randomBytes } from 'node:crypto';

export const uid = () => randomBytes(16).toString('hex');
export const genToken = () => randomBytes(32).toString('hex');
export const now = () => Date.now();

export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

export function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  const out = { ...base };
  for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k]);
  return out;
}

export function parseJSON(str, fallback = null) {
  if (str === null || str === undefined) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export function validUsername(u) { return USERNAME_RE.test(u); }
export function validPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 128; }
