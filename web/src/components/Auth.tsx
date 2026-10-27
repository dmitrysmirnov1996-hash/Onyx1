import React, { useState } from 'react';
import { useStore } from '../lib/store';
import { tFor, type Lang } from '../lib/i18n';
import { OnyxMark } from './common';
export default function Auth({ lang }: { lang: Lang }) {
  const st = useStore();
  const t = tFor(lang);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [need2fa, setNeed2fa] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await st.login(username.trim().toLowerCase(), password, totp || undefined);
      else await st.register(username.trim().toLowerCase(), name.trim() || username.trim(), password);
    } catch (err: any) {
      /* коды сервера в snake_case → ключи i18n (поддерживаются также camelCase) */
      const code = String(err?.message ?? '');
      const norm: Record<string, string> = {
        bad_credentials: 'badCredentials', badCredentials: 'badCredentials',
        need_2fa: 'need2fa', need2fa: 'need2fa',
        bad_2fa: 'bad2fa', bad2fa: 'bad2fa',
        username_taken: 'usernameTaken', usernameTaken: 'usernameTaken',
        bad_username: 'badUsername', badUsername: 'badUsername',
        bad_password: 'badPassword', badPassword: 'badPassword',
        too_many: 'tooMany', tooMany: 'tooMany',
      };
      const k = norm[code] ?? (code === 'network' ? 'networkError' : 'networkError');
      if (norm[code] === 'need2fa') setNeed2fa(true);
      else setError(t(k));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-decor a" />
      <div className="auth-decor b" />
      <div className="auth-card glass">
        <div className="auth-logo"><OnyxMark size={84} className="auth-mark" /></div>
        <h1 className="auth-name">{t('appName')}</h1>
        <p className="auth-tagline">{t('tagline')}</p>

        <form onSubmit={submit} className="auth-form">
          <label className="field">
            <span>{t('username')}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus
              placeholder="alice" autoComplete="username" dir="ltr" />
          </label>
          {mode === 'register' && (
            <label className="field">
              <span>{t('name')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('userNamePh')} />
            </label>
          )}
          <label className="field">
            <span>{t('password')}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>
          {need2fa && (
            <label className="field">
              <span>{t('totp')} — {t('totpHint')}</span>
              <input value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" placeholder="000000" dir="ltr" />
            </label>
          )}
          {error && <div className="auth-error">{error}</div>}
          <button className="btn primary big" disabled={busy || !username || !password}>
            {busy ? t('loading') : mode === 'login' ? t('loginBtn') : t('registerBtn')}
          </button>
          <button type="button" className="btn text" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setNeed2fa(false); setError(''); setTotp(''); }}>
            {mode === 'login' ? t('noAccount') : t('haveAccount')}
          </button>
        </form>
      </div>
    </div>
  );
}
