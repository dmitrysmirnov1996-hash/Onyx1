import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Modal, Avatar, Icon, Slider, Toggle, ColorInput, type MenuItem } from './common';
import { ACCENT_PRESETS, PALETTES, GRADIENT_PRESETS, effectiveDark } from '../lib/theme';
import { api } from '../lib/api';
import { sound } from '../lib/media';
import { getPasscode, setPasscode, lockNow, pinHash, type PasscodeConf } from './Passcode';
import type { ThemePreset } from '../lib/types';

const SECTIONS = ['general', 'appearance', 'wallpapers', 'privacy', 'security', 'stories', 'premium', 'resetSec', 'aboutSec'] as const;
const SECTION_ICONS: Record<string, string> = {
  general: 'settings', appearance: 'palette', wallpapers: 'wallpaper',
  privacy: 'eye', security: 'lock', stories: 'story', premium: 'star', resetSec: 'trash', aboutSec: 'history',
};

export function SettingsModal() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [sec, setSec] = useState<string>('general');
  const close = st.closeModal;

  return (
    <Modal title={t('settings')} onClose={close} width={820} className="settings-modal">
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s} className={sec === s ? 'on' : ''} onClick={() => setSec(s)}>
              <span className="nav-chip"><Icon name={SECTION_ICONS[s]} size={19} /></span>
              <span>{t(s)}</span>
            </button>
          ))}
          <button onClick={() => { st.logout(); close(); }} className="nav-logout">
            <span className="nav-chip"><Icon name="logout" size={19} /></span>
            <span>{t('logout')}</span>
          </button>
        </nav>
        {sec === 'general' ? <General t={t} /> :
          sec === 'appearance' ? <Appearance t={t} /> :
          sec === 'wallpapers' ? <WallpapersSec t={t} /> :
          sec === 'privacy' ? <Privacy t={t} /> :
          sec === 'security' ? <Security t={t} /> :
          sec === 'stories' ? <StoriesSec t={t} /> :
          sec === 'premium' ? <Premium t={t} /> :
          sec === 'resetSec' ? <ResetSec t={t} /> :
          <About t={t} />}
      </div>
    </Modal>
  );
}

type TT = { t: (k: string, vars?: any) => string };

/* ============ ОБЩИЕ ============ */
function General({ t }: TT) {
  const st = useStore();
  const s = st.me!.settings;
  const set = (p: any) => st.patchSettings(p);
  return (
    <div className="settings-sec">
      <div className="row-between">
        <span>{t('language')}</span>
        <select className="inp narrow" value={s.language} onChange={(e) => set({ language: e.target.value })} dir="ltr">
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </div>
      <div className="row-between">
        <span>{t('soundsToggle')}</span>
        <Toggle value={s.sounds} onChange={(v) => set({ sounds: v })} />
      </div>
      <Row>
        <span>{t('notifSound')}</span>
        <select className="inp narrow" value={s.notifSound} onChange={(e) => { set({ notifSound: e.target.value }); sound('msg'); }} dir="ltr">
          <option value="chime">{t('soundChime')}</option>
          <option value="pop">{t('soundPop')}</option>
          <option value="silent">{t('soundSilent')}</option>
        </select>
      </Row>
      <div className="row-between">
        <span>{t('browserNotif')}</span>
        <div className="row-gap">
          <button className="btn sec sm" onClick={() => 'Notification' in window && Notification.requestPermission().then((p) => st.pushToast({ kind: 'ok', title: p === 'granted' ? 'saved' : 'error' }))}>
            {('Notification' in window && Notification.permission === 'granted') ? '✓' : '...'}
          </button>
          <Toggle value={s.browserNotif} onChange={(v) => set({ browserNotif: v })} />
        </div>
      </div>
      <div className="row-between">
        <span>{t('animations')}</span>
        <Toggle value={s.animations} onChange={(v) => set({ animations: v })} />
      </div>
      <button className="btn sec" onClick={() => { localStorage.removeItem('tg_token'); localStorage.removeItem('tg_settings'); location.reload(); }}>{t('resetAll')}</button>
    </div>
  );
}

const Row = ({ children }: any) => <div className="row-between">{children}</div>;

/* «прозрачный режим» — в боди-классе, поэтому нужен стейт, чтобы тумблер жил честно */
function GlassMoreToggle() {
  const [on, setOn] = useState(() => document.body.classList.contains('glass-more'));
  return <Toggle value={on} onChange={(v) => { setOn(v); document.body.classList.toggle('glass-more', v); }} />;
}

/* ============ ОФОРМЛЕНИЕ ============ */
function Appearance({ t }: TT) {
  const st = useStore();
  const s = st.me!.settings;
  const set = (p: any) => st.patchSettings(p);

  const importTheme = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      f.text().then((txt) => {
        try {
          const theme = JSON.parse(txt);
          const list = [...(s.customThemes ?? []), theme];
          set({ customThemes: list });
        } catch {}
      });
    };
    inp.click();
  };

  return (
    <div className="settings-sec">
      <div className="row-between">
        <span>{t('theme')}</span>
        <div className="theme-picker">
          {(['light', 'dark', 'auto'] as const).map((v) => (
            <button key={v} className={s.theme === v ? 'on' : ''} onClick={() => set({ theme: v })}>{t(v === 'auto' ? 'autoTh' : v)}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="dim small" style={{ margin: '6px 0' }}>{t('accent')}</div>
        <div className="accent-grid">
          {ACCENT_PRESETS.map((c) => (
            <button key={c} className={`swatch ${s.accent === c ? 'sel' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} />
          ))}
          <ColorInput label="" value={s.accent} onChange={(c) => set({ accent: c })} />
        </div>
      </div>
      <Row><span>{t('blurIntensity')}</span></Row>
      <Slider value={s.uiScale} min={85} max={140} onChange={(v) => set({ uiScale: v })} label={t('uiScale')} />
      <Slider value={s.fontSize} min={13} max={22} onChange={(v) => set({ fontSize: v })} label={t('fontSize')} />
      <Slider value={s.bubbleRadius} min={0} max={22} onChange={(v) => set({ bubbleRadius: v })} label={t('cornerRadius')} />
      <Row><span>{t('transparent')} (blur)</span>
        <GlassMoreToggle />
      </Row>
      <div>
        <div className="dim small" style={{ margin: '6px 0' }}>{t('colorsCustom')}</div>
        <ColorInput label={t('bg')} value={s.colors?.bg ?? ''} onChange={(c) => set({ colors: { ...s.colors, bg: c } })} />
        <ColorInput label={t('text')} value={s.colors?.text ?? ''} onChange={(c) => set({ colors: { ...s.colors, text: c } })} />
        <ColorInput label={t('bubbleMine')} value={s.colors?.bubbleOut ?? ''} onChange={(c) => set({ colors: { ...s.colors, bubbleOut: c } })} />
        <ColorInput label={t('bubbleOther')} value={s.colors?.bubbleIn ?? ''} onChange={(c) => set({ colors: { ...s.colors, bubbleIn: c } })} />
      </div>
      <div>
        <div className="dim small" style={{ margin: '6px 0' }}>{t('customThemes')}</div>
        <div className="row-gap">
          <button className="btn sec sm" onClick={() => {
            const name = prompt(t('themeNamePh'));
            if (!name) return;
            const theme: ThemePreset = { name, dark: effectiveDark(s), accent: s.accent, colors: { ...s.colors }, bubbleRadius: s.bubbleRadius };
            set({ customThemes: [...(s.customThemes ?? []), theme] });
          }}>+ {t('saveTheme')}</button>
          <button className="btn sec sm" onClick={importTheme}>{t('importTheme')}</button>
        </div>
        <div className="theme-list">
          {(s.customThemes ?? []).map((th, i) => (
            <div key={i} className="theme-row">
              <span className="swatch" style={{ background: th.accent }} />
              <b className="grow">{th.name}</b>
              <button className="btn sm" onClick={() => set({ accent: th.accent, colors: th.colors, bubbleRadius: th.bubbleRadius ?? s.bubbleRadius })}>{t('applyTheme')}</button>
              <button className="btn sec sm" onClick={() => {
                const blob = new Blob([JSON.stringify(th)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = th.name + '.json';
                a.click();
              }}>{t('exportTheme')}</button>
              <button className="btn-icon sm" onClick={() => set({ customThemes: s.customThemes.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============ ФОНЫ ============ */
function WallpapersSec({ t }: TT) {
  const st = useStore();
  const cur = st.me!.settings.wallpaper;
  return (
    <div className="settings-sec">
      <div className="small dim">{t('wpLibrary')}</div>
      <div className="wp-grid">
        <button className={`wp-tile pattern ${(!cur || cur.mode === 'pattern' || (!cur.url && !cur.gradient)) ? 'sel' : ''}`}
          title={t('wpPattern')} onClick={() => st.patchSettings({ wallpaper: null })}>
          <span>{t('wpPattern')}</span>
        </button>
        {GRADIENT_PRESETS.map((g) => (
          <button key={g.id} className={`wp-tile ${cur?.mode === 'gradient' && cur.gradient === g.css ? 'sel' : ''}`}
            style={{ background: g.css }} title={g.id}
            onClick={() => st.patchSettings({ wallpaper: { mode: 'gradient', gradient: g.css } })} />
        ))}
      </div>
      <div className="wp-grid-sec">
        <button className="btn sec sm" onClick={() => st.openModal('wallpaper-editor', {})}><Icon name="image" size={16} /> {t('wpUpload')}</button>
      </div>
      <div className="small dim">{t('wpThisChat')}: правый клик по чату в списке → {t('wallpapers')}.</div>
    </div>
  );
}

/* ============ СБРОС ============ */
function ResetSec({ t }: TT) {
  const st = useStore();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!armed) { setArmed(true); return; }
    if (busy) return;
    setBusy(true);
    try {
      await st.resetAll();
      setArmed(false);
      st.pushToast({ kind: 'ok', title: 'resetDone' });
    } catch {
      st.pushToast({ kind: 'error', title: 'networkError' });
    }
    setBusy(false);
  };

  return (
    <div className="settings-sec">
      <div className="rp-section-title">{t('resetTitle')}</div>
      <div className="small dim">{t('resetDesc')}</div>
      <div className="row-gap reset-row">
        <button className={`btn danger ${armed ? 'armed' : ''}`} disabled={busy} onClick={go}>
          <Icon name="trash" size={16} />
          {busy ? t('loading') : armed ? t('resetConfirm') : t('resetBtn')}
        </button>
        {armed && <button className="btn text" onClick={() => setArmed(false)}>{t('clearSelection')}</button>}
      </div>
      <div className="small dim reset-note">{t('resetNote')}</div>
    </div>
  );
}

/* ============ ПРИВАТНОСТЬ ============ */
function Privacy({ t }: TT) {
  const st = useStore();
  const s = st.me!.settings;
  const set = (p: any) => st.patchSettings({ privacy: { ...s.privacy, ...p } });
  return (
    <div className="settings-sec">
      <div className="row-between">
        <span>{t('lastSeenTitle')}</span>
        <div className="theme-picker">
          {(['all', 'none'] as const).map((v) => (
            <button key={v} className={s.privacy.lastSeen === v ? 'on' : ''} onClick={() => set({ lastSeen: v })}>
              {t(v === 'all' ? 'lastSeenAll' : 'lastSeenNone')}
            </button>
          ))}
        </div>
      </div>
      <div className="row-between">
        <div><span>{t('showOnline')}</span><div className="small dim">WebSocket presence</div></div>
        <Toggle value={s.privacy.online !== false} onChange={(v) => set({ online: v })} />
      </div>
      <BlockedBlock t={t} />
      <div className="small dim">📍 {t('callHistory')}: история хранится на сервере.</div>
    </div>
  );
}

/* ============ КОД-ПАРОЛЬ (tdesktop passcode_box: set/change/off + autolock + lockOnMinimize) ============ */
function PasscodeBlock({ t }: TT) {
  const st = useStore();
  const [conf, setConf] = useState<PasscodeConf | null>(() => getPasscode());
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [editing, setEditing] = useState(false);

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);
  const save = () => {
    setPasscode({ hash: pinHash(p1), autoLockMin: conf?.autoLockMin ?? 0, lockOnMinimize: conf?.lockOnMinimize ?? true });
    setConf(getPasscode());
    setP1(''); setP2(''); setEditing(false);
    st.pushToast({ kind: 'ok', title: 'saved' });
  };
  const upd = (patch: Partial<PasscodeConf>) => {
    const cur = conf!;
    setPasscode({ hash: cur.hash, lockOnMinimize: cur.lockOnMinimize ?? false, autoLockMin: cur.autoLockMin ?? 0, ...patch });
    setConf(getPasscode());
    st.pushToast({ kind: 'ok', title: 'saved' });
  };

  return (
    <div>
      <div className="rp-section-title">{t('passcodeTitle')}</div>
      <div className="small dim">{t('passcodeDesc')}</div>
      {!conf || editing ? (
        <>
          <div className="row-gap wrap">
            <input className="inp narrow" inputMode="numeric" autoComplete="off" placeholder={t('passcodeNew')} value={p1} onChange={(e) => setP1(digits(e.target.value))} />
            <input className="inp narrow" inputMode="numeric" autoComplete="off" placeholder={t('passcodeRepeat')} value={p2} onChange={(e) => setP2(digits(e.target.value))} />
            <button className="btn primary" disabled={p1.length !== 4 || p1 !== p2} onClick={save}>{t('save')}</button>
            {conf && <button className="btn sec" onClick={() => { setEditing(false); setP1(''); setP2(''); }}>{t('cancel')}</button>}
          </div>
          {p1.length === 4 && p1 !== p2 && <div className="small" style={{ color: '#e84040' }}>{t('passcodeMismatch')}</div>}
        </>
      ) : (
        <div className="row-gap wrap">
          <button className="btn sec" onClick={() => lockNow()}><Icon name="lock" size={16} /> {t('passcodeLockNow')}</button>
          <button className="btn sec" onClick={() => setEditing(true)}>{t('passcodeChange')}</button>
          <button className="btn sec" onClick={() => { setPasscode(null); setConf(null); setEditing(false); st.pushToast({ kind: 'ok', title: 'saved' }); }}>{t('passcodeRemove')}</button>
        </div>
      )}
      {conf && (
        <>
          <div className="row-between" style={{ marginTop: 10 }}>
            <span>{t('passcodeAutolock')}</span>
            <div className="theme-picker">
              {([0, 1, 5, 60] as const).map((v: number, i: number) => (
                <button key={v} className={(conf.autoLockMin ?? 0) === v ? 'on' : ''} onClick={() => upd({ autoLockMin: v })}>
                  {t(['autolockOff', 'autolock1m', 'autolock5m', 'autolock1h'][i])}
                </button>
              ))}
            </div>
          </div>
          <div className="row-between">
            <span>{t('passcodeOnMinimize')}</span>
            <Toggle value={!!conf.lockOnMinimize} onChange={(v) => upd({ lockOnMinimize: v })} />
          </div>
        </>
      )}
    </div>
  );
}

/* ============ ЧЁРНЫЙ СПИСОК (tdesktop privacy: blocked users + unblock) ============ */
function BlockedBlock({ t }: TT) {
  const st = useStore();
  const ids: string[] = st.me!.settings.blocked ?? [];
  const [extra, setExtra] = useState<Record<string, any>>({});

  useEffect(() => {
    let alive = true;
    ids.forEach((id) => {
      if (st.userById(id) || extra[id] !== undefined) return;
      api.getUser(id).then((u: any) => { if (alive) setExtra((x) => ({ ...x, [id]: u })); })
        .catch(() => { if (alive) setExtra((x) => ({ ...x, [id]: null })); });
    });
    return () => { alive = false; };
  }, [ids.join(',')]);

  const unblock = (id: string) => {
    st.patchSettings({ blocked: ids.filter((x) => x !== id) });
    st.pushToast({ kind: 'ok', title: 'userUnblocked' });
  };

  return (
    <div>
      <div className="rp-section-title">{t('blockedTitle')}</div>
      <div className="small dim">{t('blockedDesc')}</div>
      {!ids.length && <div className="small dim">{t('blockedEmpty')}</div>}
      {ids.map((id) => {
        const u: any = st.userById(id) ?? extra[id] ?? null;
        return (
          <div key={id} className="blocked-row">
            {u ? <Avatar user={u} size={38} /> : <Icon name="user" size={36} />}
            <div className="grow one-line">
              <b>{u ? u.name : id}</b>
              {u?.username && <div className="dim small mono">@{u.username}</div>}
            </div>
            <button className="btn sec sm" onClick={() => unblock(id)}>{t('unblockUser')}</button>
          </div>
        );
      })}
    </div>
  );
}

/* ============ БЕЗОПАСНОСТЬ ============ */
function Security({ t }: TT) {
  const st = useStore();
  const me = st.me!;
  const [sessions, setSessions] = useState<any[]>([]);
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const refresh = () => api.sessions().then(setSessions);
  useEffect(() => { refresh(); }, []);

  const changePass = async () => {
    try {
      await api.changePassword(oldP, newP);
      st.pushToast({ kind: 'ok', title: 'saved' });
      setOldP(''); setNewP('');
    } catch { st.pushToast({ kind: 'error', title: 'wrongPassword' }); }
  };

  return (
    <div className="settings-sec">
      <div className="rp-section-title">{t('changePassword')}</div>
      <div className="row-gap wrap">
        <input className="inp" type="password" name="current-password" autoComplete="current-password" placeholder={t('oldPassword')} value={oldP} onChange={(e) => setOldP(e.target.value)} />
        <input className="inp" type="password" name="new-password" autoComplete="new-password" placeholder={t('newPassword')} value={newP} onChange={(e) => setNewP(e.target.value)} />
        <button className="btn primary" disabled={!oldP || newP.length < 6} onClick={changePass}>{t('save')}</button>
      </div>

      <div className="rp-section-title">{t('twoFa')}</div>
      <div className="small dim">{t('twoFaDesc')}</div>
      {me.twofa ? (
        <div className="row-gap">
          <input className="inp narrow" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" name="totp-code" />
          <button className="btn sec" disabled={code.length !== 6} onClick={async () => {
            try { await api.twoFaDisable(code); st.patchMe({}); st.pushToast({ kind: 'ok', title: 'saved' }); }
            catch { st.pushToast({ kind: 'error', title: 'bad2fa' }); }
          }}>{t('twoFaDisable')}</button>
        </div>
      ) : (
        <div className="row-gap">
          <button className="btn primary" onClick={async () => {
            const r = await api.twoFaSetup();
            setSecret(r.secret);
          }}>{t('twoFaEnable')}</button>
        </div>
      )}
      {secret && (
        <div className="totp-block glass">
          <div className="small">{t('secretScan')}</div>
          <code className="mono big">{secret.match(/.{1,4}/g)?.join(' ')}</code>
          <div className="row-gap">
            <input className="inp narrow" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" name="totp-confirm" />
            <button className="btn primary" disabled={code.length !== 6} onClick={async () => {
              try { await api.twoFaEnable(code); await st.patchMe({}); setSecret(null); setCode(''); st.pushToast({ kind: 'ok', title: 'saved' }); }
              catch { st.pushToast({ kind: 'error', title: 'bad2fa' }); }
            }}>{t('confirm')}</button>
          </div>
        </div>
      )}

      <PasscodeBlock t={t} />

      <div className="rp-section-title">{t('sessions')}</div>
      {sessions.map((ss) => (
        <div key={ss.token} className="session-row">
          <Icon name="lock" size={16} />
          <div className="grow one-line small" title={ss.device}>
            <b>{ss.device?.split(')')[0]?.slice(0, 60) || 'device'}</b>
            <div className="dim">{ss.current ? t('thisDevice') : new Date(ss.last_active).toLocaleString()}</div>
          </div>
          {!ss.current && (
            <button className="btn sec sm" onClick={async () => { await api.terminateSession(ss.token); refresh(); }}>{t('terminate')}</button>
          )}
        </div>
      ))}
      <button className="btn sec" onClick={async () => {
        await api.logoutAll();
        st.pushToast({ kind: 'ok', title: 'saved' });
      }}>{t('terminateAll')}</button>
    </div>
  );
}

/* ============ ИСТОРИИ ============ */
function StoriesSec({ t }: TT) {
  const st = useStore();
  return (
    <div className="settings-sec">
      <button className="btn primary" onClick={() => st.openModal('story-publish')}><Icon name="story" size={17} /> {t('publishStory')}</button>
      <button className="btn sec" onClick={() => st.openModal('story-archive')}><Icon name="archive" size={17} /> {t('archive')}</button>
    </div>
  );
}

/* ============ PREMIUM (демо) ============ */
function Premium({ t }: TT) {
  const st = useStore();
  const me = st.me!;
  const s = me.settings;
  const set = (p: any) => st.patchSettings(p);
  return (
    <div className="settings-sec">
      <div className="premium-banner">
        <Icon name="star" size={30} fill />
        <div>
          <b>Onyx Premium — {t('send')} · демо</b>
          <div className="small dim">{t('demoAccount')}</div>
        </div>
      </div>
      <div className="row-between"><span>⭐ {t('frameAnimated')}</span><Toggle value={s.premium} onChange={(v) => set({ premium: v })} /></div>
      <div className="row-between"><span>🎨 Premium-реакции в меню сообщения</span><Toggle value={s.premium} onChange={(v) => set({ premium: v })} /></div>
      <div className="row-between"><span>🖼️ Уникальные фоны и рамки</span><Toggle value={s.premium} onChange={(v) => set({ premium: v })} /></div>
    </div>
  );
}

/* ============ О ПРОГРАММЕ ============ */
function About({ t }: TT) {
  const st = useStore();
  return (
    <div className="settings-sec">
      <div className="about-block">
        <b>Onyx 2026</b>
        <div className="small dim">v1.0 — self-hosted messenger</div>
      </div>
      <ul className="stack-list">
        <li>Frontend: React 18 + Vite + TypeScript</li>
        <li>Backend: Node.js 24 + Express + Socket.IO</li>
        <li>БД: SQLite (WAL, встроенный node:sqlite)</li>
        <li>Медиа: uploads + multer, WebRTC звонки</li>
        <li>Авторизация: bcrypt + Bearer-сессии + TOTP 2FA</li>
      </ul>
      <div className="small dim">
        Реализовано: real-time сообщения, группы/каналы, реакции, опросы, голосовые, круглые видео,
        истории, звонки 1-на-1 (WebRTC), 2FA, сессии, темы и кастомизация, обои (фото/GIF/видео),
        видео-аватарки, отложенные сообщения, поиск. Не реализовано: групповые звонки,
        SMS-верификация с внешним провайдером, AI-виртуальные фоны камеры, сквозное шифрование E2E.
      </div>
    </div>
  );
}
