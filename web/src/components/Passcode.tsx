/* Лок-пароль приложения — механика из tdesktop (boxes/passcode_box.cpp, window/window_unlock_passcode_box.cpp):
   4-значный код, автоблокировка (autolock: выкл/1м/5м/1ч), блокировка при сворачивании окна,
   экран разблокировки при старте. Честно: код хранится в localStorage как локальный хеш —
   это блокировка интерфейса браузера, не серверная защита. */
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Avatar, Icon } from './common';

export interface PasscodeConf { hash: string; lockOnMinimize?: boolean; autoLockMin?: number; }

const KEY = 'tg_passcode';
const LOCKED = 'tg_passcode_lock';

/* лёгкий детерминированный хеш для локальной блокировки интерфейса */
export function pinHash(pin: string): string {
  const s = 'tdpc:' + pin;
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    h1 = (h1 ^ s.charCodeAt(i)) * 16777619 >>> 0;
    h2 = (h2 * 31 + s.charCodeAt(i)) ^ (h2 << 5) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + s.length.toString(36));
}

export function getPasscode(): PasscodeConf | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

export function setPasscode(c: PasscodeConf | null) {
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else { localStorage.removeItem(KEY); localStorage.removeItem(LOCKED); }
  window.dispatchEvent(new Event('tg:passcode'));
}

export function passcodeLocked(): boolean {
  return !!getPasscode() && localStorage.getItem(LOCKED) === '1';
}

export function lockNow() {
  if (getPasscode()) { localStorage.setItem(LOCKED, '1'); window.dispatchEvent(new Event('tg:passcode')); }
}

export function unlock() {
  localStorage.removeItem(LOCKED);
  lastActivity = Date.now();
  window.dispatchEvent(new Event('tg:passcode'));
}

let lastActivity = Date.now();
function bump() { lastActivity = Date.now(); }

export function PasscodeGuard() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [locked, setLocked] = useState(passcodeLocked());
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const [forgot, setForgot] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const conf = getPasscode();

  useEffect(() => {
    const onChange = () => setLocked(passcodeLocked());
    window.addEventListener('tg:passcode', onChange);
    ['mousemove', 'keydown', 'touchstart', 'click'].forEach((e) => window.addEventListener(e, bump));
    // блокировка при сворачивании окна (lockOnMinimize как в tdesktop)
    const onVis = () => {
      const c = getPasscode();
      if (c?.lockOnMinimize && document.hidden) lockNow();
      setLocked(passcodeLocked());
    };
    document.addEventListener('visibilitychange', onVis);
    // автоблокировка (tdesktop autolock: 1м/5м/1ч)
    const iv = setInterval(() => {
      const c = getPasscode();
      if (!c || passcodeLocked()) return;
      const limitMs = (c.autoLockMin ?? 0) * 60_000;
      if (limitMs > 0 && Date.now() - lastActivity > limitMs) { lockNow(); setLocked(true); }
      else setLocked(false);
    }, 5000);
    return () => {
      window.removeEventListener('tg:passcode', onChange);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(iv);
      ['mousemove', 'keydown', 'touchstart', 'click'].forEach((e) => window.removeEventListener(e, bump));
    };
  }, []);

  useEffect(() => {
    if (locked) setTimeout(() => inputRef.current?.focus(), 50);
  }, [locked]);

  if (!locked || !conf) return null;

  const me = st.me;
  const submit = (val: string) => {
    if (pinHash(val) === conf.hash) {
      setPin(''); setErr(false); unlock();
    } else {
      setErr(true); setPin('');
      setTimeout(() => setErr(false), 700);
    }
  };
  const onInput = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    if (digits.length === 4) submit(digits);
  };

  return (
    <div className="passcode-lock">
      <div className={`passcode-card ${err ? 'err' : ''}`}>
        {me && <Avatar user={me} size={72} />}
        <div className="passcode-title">{t('passcodeEnter')}</div>
        <input ref={inputRef} className="passcode-input" value={pin} inputMode="numeric" autoComplete="off"
          placeholder="••••" onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && pin) submit(pin); }} />
        {err && <div className="passcode-error">{t('passcodeWrong')}</div>}
        <button className="passcode-forgot" onClick={() => setForgot(true)}>{t('passcodeForgot')}</button>
      </div>
      {forgot && (
        <div className="passcode-forgot-modal" onClick={() => setForgot(false)}>
          <div className="passcode-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="passcode-strong"><Icon name="lock" size={26} /></div>
            <div className="passcode-title">{t('passcodeForgotTitle')}</div>
            <div className="small dim">{t('passcodeForgotDesc')}</div>
            <div className="row-gap">
              <button className="btn sec" onClick={() => setForgot(false)}>{t('cancel')}</button>
              <button className="btn danger" onClick={async () => { setPasscode(null); await st.logout(true); }}>
                {t('passcodeForgotLogout')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
