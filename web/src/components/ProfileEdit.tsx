import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Modal, Avatar, Icon, Slider, Toggle } from './common';
import { cropToBlob, imageMeta, videoMeta, type CropState } from '../lib/media';
import { AVATAR_COLORS } from './common';
import { lastSeenText } from './Message';

/* ============ «Информация» — экран после карандаша (как в AyuGram/tdesktop) ============ */
/* Ряд вынесен НАРУЖУ: компонент, объявленный внутри рендера, ремонтируется
   на каждом вводе символа и уничтожает фокус инпута. */
interface InfoRowBigProps {
  icon: string; label: string; field: 'name' | 'username'; cur: string; mono?: boolean;
  editing: boolean; onStart: () => void; onChange: (v: string) => void; onDone: () => void;
}
function InfoRowBig({ icon, label, field, cur, mono, editing, onStart, onChange, onDone }: InfoRowBigProps) {
  return (
    <div className="info-row-big" onMouseDown={(e) => { if (editing) e.stopPropagation(); }} onClick={editing ? undefined : onStart}>
      <span className="irb-ico"><Icon name={icon} size={16} /></span>
      <div className="irb-main">
        {editing ? (
          <input className="info-edit" autoFocus value={cur} maxLength={field === 'name' ? 64 : 32}
            dir={field === 'username' ? 'ltr' : 'auto'}
            onChange={(e) => onChange(field === 'username' ? e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase() : e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              if (e.key === 'Escape') onDone();
            }}
            onBlur={onDone} />
        ) : (
          <b className={`info-row-val ${mono ? 'mono' : ''}`}>{field === 'username' ? `@${cur}` : cur}</b>
        )}
        <span className="info-row-lbl">{label}</span>
      </div>
      {!editing && <Icon name="edit" size={14} className="irb-pen" />}
    </div>
  );
}

/* ============ День рождения: разбор/формат даты + вкладка ============ */
const BD_MONTHS_NOM = {
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const BD_MONTHS_GEN = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const ZODIAC_NAMES = {
  ru: ['Водолей', 'Рыбы', 'Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог'],
  en: ['Aquarius', 'Pisces', 'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn'],
};
const ZODIAC_EMO = ['♒', '♓', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑'];
/* граница «после этого дня — знак месяца» */
const BD_CUTS = [20, 19, 21, 20, 21, 21, 23, 23, 23, 23, 22, 22];

function parseBday(s?: string | null): { y?: number; m: number; d: number } | null {
  if (!s) return null;
  const p = s.split('-').map(Number);
  if (p.length === 3 && p[0] >= 1900 && p[1] >= 1 && p[1] <= 12) return { y: p[0], m: p[1], d: p[2] };
  if (p.length === 2 && p[0] >= 1 && p[0] <= 12 && p[1] >= 1 && p[1] <= 31) return { m: p[0], d: p[1] };
  return null;
}
function zodiacIdxOf(m: number, d: number): number {
  return d >= BD_CUTS[m - 1] ? m - 1 : (m - 2 + 12) % 12;
}
function daysInMonth(m: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
function daysUntilBday(m: number, d: number): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let target = new Date(now.getFullYear(), m - 1, d);
  if (target.getTime() < today.getTime()) target = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
function ruDaysWord(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}
function fmtBday(b: { y?: number; m: number; d: number }, lang: 'ru' | 'en'): string {
  const z = ZODIAC_EMO[zodiacIdxOf(b.m, b.d)];
  const sign = ZODIAC_NAMES[lang][zodiacIdxOf(b.m, b.d)];
  return `${b.d} ${BD_MONTHS_GEN[lang][b.m - 1]}${b.y ? ` ${b.y}` : ''} · ${z} ${sign}`;
}

function BirthdayTab() {
  const st = useStore();
  const lang = (st.me?.settings?.language ?? 'ru') as 'ru' | 'en';
  const t = tFor(lang);
  const me = st.me!;
  const cur = parseBday(me.settings?.birthday);
  const [d, setD] = useState(cur?.d ?? 14);
  const [m, setM] = useState(cur?.m ?? 5);
  const [y, setY] = useState(cur?.y ? String(cur.y) : '');

  const apply = (nd: number, nm: number, ny: string) => {
    const day = Math.min(Math.max(1, nd), daysInMonth(nm));
    setD(day); setM(nm); setY(ny);
    const v = ny
      ? `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : `${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    st.patchSettings({ birthday: v });
  };

  const nowYear = new Date().getFullYear();
  const dayN = Math.min(d, daysInMonth(m));
  const zIdx = zodiacIdxOf(m, dayN);
  const eta = daysUntilBday(m, dayN);
  const etaTxt = eta === 0
    ? (lang === 'ru' ? 'Днюха сегодня!' : 'Birthday is today!')
    : lang === 'ru' ? `Через ${eta} ${ruDaysWord(eta)}` : `In ${eta} ${eta === 1 ? 'day' : 'days'}`;

  return (
    <div className="bday-tab">
      <div className="bday-preview">
        <div className="bday-cake" aria-hidden><Icon name="cake" size={42} /></div>
        <b className="bday-date">{dayN} {BD_MONTHS_GEN[lang][m - 1]}{y ? ` ${y}` : ''}</b>
        <div className="bday-zodiac"><Icon name="star" size={13} /> {ZODIAC_NAMES[lang][zIdx]}</div>
        <div className="bday-eta"><Icon name="sparkles" size={12} /> {etaTxt}</div>
      </div>
      <div className="bday-pickers">
        <label><span>{t('bdayDay')}</span>
          <select value={d} onChange={(e) => apply(Number(e.target.value), m, y)} dir="ltr">
            {Array.from({ length: daysInMonth(m) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label><span>{t('bdayMonth')}</span>
          <select value={m} onChange={(e) => apply(d, Number(e.target.value), y)}>
            {BD_MONTHS_NOM[lang].map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
          </select>
        </label>
        <label><span>{t('bdayYear')}</span>
          <select value={y} onChange={(e) => {
            if (e.target.value === '__') { setY(''); st.patchSettings({ birthday: `${String(m).padStart(2, '0')}-${String(Math.min(d, daysInMonth(m))).padStart(2, '0')}` }); return; }
            apply(d, m, e.target.value);
          }} dir="ltr">
            <option value="__">{t('bdayYearNone')}</option>
            {Array.from({ length: nowYear - 1909 }, (_, i) => nowYear - i).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="small dim info-hint">{t('bdayHint')}</div>
    </div>
  );
}

/* ============ Вкладка «Рамка»: сезонные украшения аватара ============ */
const FRAME_OPTS = [
  { id: 'none', emo: '', ru: 'Без рамки', en: 'No frame' },
  { id: 'winter', emo: '❄️', ru: 'Новый год', en: 'New Year' },
  { id: 'spring', emo: '🌸', ru: 'Весна', en: 'Spring' },
  { id: 'summer', emo: '🌻', ru: 'Лето', en: 'Summer' },
  { id: 'autumn', emo: '🍁', ru: 'Осень', en: 'Autumn' },
  { id: 'galaxy', emo: '', ru: 'Космос', en: 'Galaxy' },
  { id: 'halloween', emo: '', ru: 'Хэллоуин', en: 'Halloween' },
  { id: 'love', emo: '', ru: 'Любовь', en: 'Love' },
  { id: 'ocean', emo: '', ru: 'Океан', en: 'Ocean' },
];

function SheetFrameTab() {
  const st = useStore();
  const lang = (st.me?.settings?.language ?? 'ru') as 'ru' | 'en';
  const me = st.me!;
  const cur = me.settings?.avatarFrame?.style ?? 'none';
  return (
    <div className="frame-sheet">
      <div className="frame-stage"><Avatar user={me} size={112} /></div>
      <div className="frame-cap">
        <b>{cur === 'none' ? (lang === 'ru' ? 'Классический аватар' : 'Classic avatar') : FRAME_OPTS.find((o) => o.id === cur)?.[lang]}</b>
        <span>{cur === 'none'
          ? (lang === 'ru' ? 'Аватар без сезонного украшения' : 'Avatar without seasonal decor')
          : (lang === 'ru' ? 'Украшает аватар — видно всем' : 'Decorates your avatar — visible to all')}</span>
      </div>
      <div className="frame-grid">
        {FRAME_OPTS.map((o) => (
          <button key={o.id} className={cur === o.id ? 'on' : ''}
            onClick={() => st.patchSettings({ avatarFrame: { style: o.id as any, color: '' } })}>
            <span className="fg-ava"><Avatar user={me} size={44} frame={{ style: o.id, color: '' }} /></span>
            <span className="fg-lbl">{o[lang]}</span>
          </button>
        ))}
      </div>
      <div className="small dim info-hint">{lang === 'ru' ? 'Украшение синхронно двигается по кругу вокруг аватара — видно всем в чатах и списках.' : 'The decoration slowly orbits around your avatar — visible to everyone in chats and lists.'}</div>
    </div>
  );
}

export function InfoSheet() {
  const st = useStore();
  const bLang = (st.me?.settings?.language === 'en' ? 'en' : 'ru') as 'ru' | 'en';
  const t = tFor(bLang);
  const me = st.me!;
  const [tab, setTab] = useState<'info' | 'bday' | 'frame'>('info');
  const [editing, setEditing] = useState<null | 'name' | 'username' | 'bio'>(null);
  const [name, setName] = useState(me.name);
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio ?? '');
  const [errors, setErrors] = useState('');
  const [busy, setBusy] = useState(false);

  /* словно defend: если_patchme не удался — остаёмся в режиме правки */
  const save = async (field: 'name' | 'username' | 'bio', value: string) => {
    setEditing(null);
    if (busy) return;
    const clean = field === 'username' ? value.trim().toLowerCase() : value.trim();
    const old = field === 'name' ? me.name : field === 'username' ? me.username : (me.bio ?? '');
    if (clean === old) return;
    if (field !== 'bio' && !clean) return;
    setBusy(true);
    try {
      await st.patchMe({ [field]: clean });
      setErrors('');
      st.pushToast({ kind: 'ok', title: 'saved' });
    } catch (e: any) {
      setErrors(e.code === 'username_taken' ? t('usernameTaken') : t('badUsername'));
    }
    setBusy(false);
  };


  const inputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) (e.currentTarget as HTMLTextAreaElement).blur();
    if (e.key === 'Escape') { setBio(me.bio ?? ''); setEditing(null); }
  };

  return (
    <Modal onClose={st.closeModal} width={430} className="info-modal">
      <div className="info-sheet">
        <div className="ih-top">
          <b className="grow">{t('infoTitle')}</b>
          <button className="btn-icon" onClick={st.closeModal}><Icon name="close" size={18} /></button>
        </div>

        {me.cover?.url ? (
          <div className="ih-cover">
            {me.cover.kind === 'video'
              ? <video src={me.cover.url} autoPlay muted loop playsInline />
              : <img src={me.cover.url} alt="" draggable={false} />}
            <div className="ih-cover-fade" />
          </div>
        ) : null}
        <div className={`info-ava${me.cover?.url ? '' : ' no-cover'}`}>
          <span className="ava-aura" aria-hidden />
          <Avatar user={me} size={104} onClick={() => {
            const av = me.avatar;
            if (av?.url) st.openModal('avatar-view', { url: av.url, kind: av.kind });
            else st.openModal('avatar-editor');
          }} />
          <button className="ava-cam" title={t('changeAvatar')} onClick={() => st.openModal('avatar-editor')}><Icon name="camera" size={14} /></button>
        </div>
        <b className="info-name">{me.name}</b>
        <div className="ih-meta">
          <div className="pf-status on"><span className="dot" /><span>{t('online')}</span></div>
          {(() => {
            const fs = me.settings?.avatarFrame?.style ?? 'none';
            const ico = ({ winter: 'snowflake', spring: 'flower', summer: 'sun', autumn: 'leaf', halloween: 'ghost', love: 'heart', galaxy: 'rocket', ocean: 'waves' } as Record<string, string>)[fs];
            const name = FRAME_OPTS.find((o) => o.id === fs)?.[bLang];
            return (
              <button className="ih-chip" title={t('tabFrame')} onClick={() => setTab('frame')}>
                <Icon name={ico ?? 'sparkles'} size={14} />
                <span>{name}</span>
              </button>
            );
          })()}
        </div>

        {/* вкладки: Информация / День рождения / Рамка — с едущим индикатором */}
        <div className="ih-tabs" style={{ '--ti': ['info', 'bday', 'frame'].indexOf(tab) } as React.CSSProperties}>
          <span className="ih-ind" aria-hidden />
          {([['info', t('tabInfo')], ['bday', t('tabBday')], ['frame', t('tabFrame')]] as const).map(([id, lbl]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>

        {tab === 'info' ? (<>
          {/* О себе */}
          {editing === 'bio' ? (
            <textarea className="info-bio-edit" autoFocus rows={3} maxLength={280} value={bio}
              onChange={(e) => setBio(e.target.value)}
              onKeyDown={(e) => inputKey(e)}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={() => save('bio', bio)} />
          ) : (
            <div className="info-bio" onClick={() => { setErrors(''); setEditing('bio'); }}>
              <span className="ib-lbl">{t('bio')}</span>
              <div className="ib-val">{me.bio ? me.bio : <span className="dim">{t('bioPh')}</span>}</div>
              <i className="small dim">{t('bioHint')}</i>
              <Icon name="edit" size={13} className="ib-pen" />
            </div>
          )}

          <div className="info-rows">
            <InfoRowBig icon="user" label={t('name')} field="name" cur={name}
              editing={editing === 'name'} onStart={() => { setErrors(''); setName(me.name); setEditing('name'); }}
              onChange={setName} onDone={() => save('name', name)} />
            <InfoRowBig icon="at" label={t('username')} field="username" cur={username} mono
              editing={editing === 'username'} onStart={() => { setErrors(''); setUsername(me.username); setEditing('username'); }}
              onChange={setUsername} onDone={() => save('username', username)} />
          </div>

          {errors && <div className="auth-error">{errors}</div>}

          <div className="info-foot center">
            <button className="btn sec sm" onClick={() => st.openModal('cover-editor')}><Icon name="wallpaper" size={15} /> {t('cover')}</button>
          </div>
        </>) : tab === 'bday' ? <BirthdayTab /> : <SheetFrameTab />}
      </div>
    </Modal>
  );
}

/* ============ Шапка профиля: обложка + аватар + имя (как у каналов) ============ */
export function ProfileHero({
  user, chat, avatarSize = 88, onEdit, onClose, onClickAvatar,
}: {
  user?: any;
  chat?: any;
  avatarSize?: number;
  onEdit?: () => void;
  onClose?: () => void;
  onClickAvatar?: (e: React.MouseEvent) => void;
}) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const isPriv = !chat || chat.type === 'private';
  const cover = isPriv ? user?.cover : null;
  const chatAvatar = chat?.avatar;
  const name = isPriv ? (user?.name ?? '') : (chat?.title ?? '');
  const sub = isPriv ? (user?.bio || '') : (chat?.about || '');
  const status = isPriv
    ? (user ? (st.online.has(user.id) ? t('online') : user.lastSeen ? lastSeenText(user, t) : '—') : '')
    : (chat?.type === 'group'
      ? `${chat?.members?.length ?? 0} ${t('members')}`
      : `${chat?.members?.length ?? 0} ${t('subscribers')}`);

  const coverSrc = isPriv
    ? cover?.url ?? user?.avatar?.url ?? null
    : (chatAvatar?.url ?? null);
  const coverIsVideo = isPriv
    ? (cover?.kind ?? user?.avatar?.kind) === 'video'
    : chatAvatar?.kind === 'video';

  const storyProp = isPriv && user?.stories?.length
    ? (user.stories.some((s: any) => !s.viewed) ? 'unseen' as const : 'seen' as const)
    : undefined;

  // мягкий градиент обложки из цвета аватарки (как заливка в tdesktop)
  const colorIdx = user && !chat ? Math.abs([...String(user.id ?? '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 9)) % AVATAR_COLORS.length : 0;
  const fallbackBg = `linear-gradient(135deg, ${AVATAR_COLORS[colorIdx]}, ${AVATAR_COLORS[(colorIdx + 3) % AVATAR_COLORS.length]})`;

  return (
    <div className={`pf-hero ${isPriv ? 'priv' : ''} ${onClose ? 'pop' : ''}`}>
      <div className="pf-cover" style={{ background: coverSrc ? undefined : fallbackBg }}>
        {coverSrc ? (
          coverIsVideo
            ? <video src={coverSrc} autoPlay muted loop playsInline />
            : <img src={coverSrc} alt="" draggable={false} />
        ) : null}
        <div className="pf-cover-shade" />
        {(onEdit || onClose) && (
          <div className="pp-tools">
            {onEdit && <button className="btn-icon glassy" title={t('editShort')} onClick={onEdit}><Icon name="edit" size={16} /></button>}
            {onClose && <button className="btn-icon glassy" title={t('close') || '✕'} onClick={onClose}><Icon name="close" size={17} /></button>}
          </div>
        )}
      </div>
      <div className="pf-ava-row">
        <Avatar
          user={isPriv ? user : undefined}
          avatar={isPriv ? undefined : chatAvatar}
          size={avatarSize}
          story={storyProp}
          onClick={onClickAvatar}
        />
      </div>
      <div className="pf-names">
        <b className="pf-name">{name}</b>
        {sub && <div className="pf-sub">{sub}</div>}
        <div className={`pf-status ${isPriv && user && st.online.has(user.id) ? 'on' : ''}`}>
          {isPriv && user && st.online.has(user.id) && <span className="dot" />}
          {status}
        </div>
      </div>
    </div>
  );
}

export function ProfileEdit() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const me = st.me!;
  const [name, setName] = useState(me.name);
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState('');

  const save = async () => {
    setBusy(true);
    try {
      await st.patchMe({ name, username: username.trim().toLowerCase(), bio });
      st.pushToast({ kind: 'ok', title: 'saved' });
    } catch (e: any) {
      setErrors(e.code === 'username_taken' ? t('usernameTaken') : t('badUsername'));
    }
    setBusy(false);
  };

  return (
    <Modal title={t('myProfile')} onClose={st.closeModal} width={520}>
      <div className="profile-edit">
        <div className="avatar-edit-row">
          <BigPreview user={me} onClick={() => st.openModal('avatar-editor')} />
          <div className="grow">
            <button className="btn primary sm" onClick={() => st.openModal('avatar-editor')}><Icon name="camera" size={16} /> {t('changeAvatar')}</button>
            <button className="btn sec sm" onClick={() => st.openModal('cover-editor')}><Icon name="wallpaper" size={16} /> {t('cover')}</button>
          </div>
        </div>

        <label className="field"><span>{t('name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>
        <label className="field"><span>{t('username')}</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" maxLength={32} />
        </label>
        <label className="field"><span>{t('bio')}</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} maxLength={280} />
        </label>
        {errors && <div className="auth-error">{errors}</div>}
        <div className="row-between">
          <button className="btn sec" onClick={() => st.openModal('profile-preview')}><Icon name="eye" size={16} /> {t('previewProfile')}</button>
          <div className="row-gap">
            <button className="btn" onClick={st.closeModal}>{t('close')}</button>
            <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>{busy ? t('loading') : t('saveProfile')}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* -------- предпросмотр того, как видят другие -------- */
export function ProfilePreview() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const me = st.me!;
  return (
    <Modal title={t('previewProfile')} onClose={st.closeModal} width={380}>
      <div className="preview-card" style={{ background: '#000' }}>
        <div className="pv-cover">
          {me.cover?.kind === 'video' && me.cover.url ? <video src={me.cover.url} autoPlay muted loop playsInline /> :
            me.cover?.url ? <img src={me.cover.url} /> :
            <div style={{ height: 160, background: 'linear-gradient(135deg,var(--accent),#0004)' }} />}
        </div>
        <div className="pv-body">
          <div className="pv-ava" style={{ position: 'relative', top: -42, width: 84 }}>
            <Avatar user={me} size={84} />
          </div>
          <b>{me.name}</b>
          <div className="mono dim">@{me.username}</div>
          {me.bio && <p>{me.bio}</p>}
        </div>
      </div>
    </Modal>
  );
}

/* -------- рамки аватарки -------- */
function BigPreview({ user, onClick }: { user: any; onClick: () => void }) {
  return <Avatar user={user} size={96} onClick={onClick} />;
}

export function FrameSettings() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const s = st.me!.settings;
  const set = (p: any) => st.patchSettings(p);
  return (
    <div className="settings-sec">
      <div className="frame-picker">
        {(['none', 'solid', 'neon', 'animated', 'winter', 'spring', 'summer', 'autumn', 'halloween', 'love', 'galaxy', 'ocean'] as const).map((v) => (
          <button key={v} className={s.avatarFrame?.style === v ? 'on' : ''}
            onClick={() => st.patchSettings({ avatarFrame: { style: v, color: s.avatarFrame?.color ?? '' } })}>
            {v === 'winter' ? 'НГ' : v === 'spring' ? 'Весна' : v === 'summer' ? 'Лето' : v === 'autumn' ? 'Осень'
              : v === 'halloween' ? 'Хэллоуин' : v === 'love' ? 'Любовь' : v === 'galaxy' ? 'Космос' : v === 'ocean' ? 'Океан' :
              t(v === 'none' ? 'frameNone' : v === 'solid' ? 'frameSolid' : v === 'neon' ? 'frameNeonFrame' : 'frameAnimated')}
          </button>
        ))}
      </div>
      <div className="row-between">
        <span>{t('frameColor')}</span>
        <div className="color-quick">
          {AVATAR_COLORS.slice(0, 6).map((c) => (
            <button key={c} style={{ background: c }} onClick={() => st.patchSettings({ avatarFrame: { ...s.avatarFrame, color: c } })} />
          ))}
          <input type="color" value={s.avatarFrame?.color ?? '#2ad46e'} onChange={(e) => st.patchSettings({ avatarFrame: { ...s.avatarFrame, color: e.target.value } })} />
        </div>
      </div>
      <div className="row-between">
        <span>{t('shape')}</span>
        <div className="theme-picker">
          {(['circle', 'squircle'] as const).map((v) => (
            <button key={v} className={s.avatarShape === v ? 'on' : ''} onClick={() => set({ avatarShape: v })}>{t(v === 'circle' ? 'shapeCircle' : 'shapeSquircle')}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= Редактор аватарки ================= */
export function AvatarEditor() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const me = st.me!;
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'photo' | 'gif' | 'video' | null>(null);
  const [url, setUrl] = useState('');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });
  const [videoStart, setVideoStart] = useState(0);
  const [videoDur, setVideoDur] = useState(0);
  const [videoMuted, setVideoMuted] = useState(true);
  const [busy, setBusy] = useState(false);
  const vidRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const avatar = me.avatar;

  const pick = (f: File) => {
    setFile(f);
    const u = URL.createObjectURL(f);
    setUrl(u);
    if (f.type.startsWith('video/')) {
      setKind('video');
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = u;
      v.onloadedmetadata = () => { setVideoDur(Math.max(0, v.duration || 0)); setVideoStart(0); };
    } else if (f.type === 'image/gif') {
      setKind('gif');
    } else {
      setKind('photo');
      const i = new Image();
      i.src = u;
      i.onload = () => setImg(i);
    }
  };

  const injectVideo = () => {
    // подгрузка выбранного промежутка в <video> превью
    const v = vidRef.current;
    if (v && videoDur > 0) {
      v.currentTime = Math.min(videoStart, Math.max(0, videoDur - 0.2));
    }
  };

  const save = async () => {
    if (!file || !kind) return;
    setBusy(true);
    try {
      let blobOut: Blob = file;
      let finalKind: 'photo' | 'gif' | 'video' = kind;
      if (kind === 'photo' && img) {
        blobOut = await cropToBlob(imgRef.current ?? img, 1, crop, 512, 'image/jpeg');
      }
      const meta: any = {};
      if (kind === 'video') {
        const m = await videoMeta(blobOut);
        meta.dur = Math.round(m.dur); meta.w = m.w; meta.h = m.h;
      } else if (kind === 'photo') {
        const m = await imageMeta(file);
        meta.w = m.w; meta.h = m.h;
      }
      const up = await st.uploads(blobOut, kind === 'video' ? 'avatar.mp4' : kind === 'gif' ? 'avatar.gif' : 'avatar.jpg', meta);
      await st.patchMe({ avatar: { kind: finalKind === 'gif' ? 'gif' : finalKind, url: up.url, offset: kind === 'video' ? Math.round(videoStart) : undefined } });
      st.pushToast({ kind: 'ok', title: 'saved' });
      st.closeModal();
    } catch { st.pushToast({ kind: 'error', title: 'networkError' }); }
    setBusy(false);
  };

  const remove = async () => {
    try {
      await st.patchMe({ avatar: null });
      st.closeModal();
    } catch {}
  };

  // автовоспроизведение с выбранного кадра
  useEffect(() => {
    injectVideo();
  }, [videoStart, url]);

  return (
    <Modal title={t('editingAvatar')} onClose={st.closeModal} width={470}>
      {!file && (
        <div className="story-pick">
          <label className="btn primary big"><Icon name="image" size={20} /> {t('avatarPhoto')}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
          </label>
          <label className="btn sec big"><Icon name="film" size={20} /> {t('avatarGif')}
            <input type="file" accept="image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
          </label>
          <label className="btn sec big"><Icon name="video" size={20} /> {t('avatarVideo')}
            <input type="file" accept="video/mp4,video/webm,video/quicktime" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
          </label>
          <FrameSettings />
          {avatar?.url && <button className="btn" onClick={remove}><Icon name="trash" size={16} /> {t('removeAvatar')}</button>}
        </div>
      )}
      {file && (
        <>
          <div className="avatar-crop">
            {kind === 'video' ? (
              <video ref={vidRef} src={url} autoPlay loop muted={videoMuted} playsInline className="crop-video"
                onLoadedMetadata={(e) => { const v = e.currentTarget; setVideoDur(v.duration || videoDur); injectVideo(); }} />
            ) : kind === 'photo' ? (
              <div style={{ transform: `translate(${crop.offsetX}px, ${crop.offsetY}px) rotate(${crop.rotation}deg)` }}>
                <img ref={imgRef} src={url} style={{ maxHeight: 300 }} draggable={false} />
              </div>
            ) : (
              <img src={url} style={{ maxHeight: 300 }} draggable={false} />
            )}
          </div>

          {kind === 'photo' && (
            <>
              <Slider label={t('crop')} value={crop.zoom} min={1} max={3} step={0.02} onChange={(v) => setCrop((c) => ({ ...c, zoom: v }))} />
              <div className="row-between">
                <button className="btn-icon" onClick={() => setCrop((c) => ({ ...c, rotation: c.rotation - 90 }))}><Icon name="flip" size={18} /></button>
                <span className="small dim">{t('rotate')} -90°</span>
                <button className="btn-icon" onClick={() => setCrop((c) => ({ ...c, rotation: c.rotation + 90 }))}><Icon name="flip" size={18} style={{ transform: 'scaleX(-1)' }} /></button>
              </div>
            </>
          )}
          {kind === 'video' && (
            <>
              <Slider label={`${t('videoTrim')} (${videoDur.toFixed(1)}s)`} value={videoStart} min={0} max={Math.max(0.1, videoDur - 0.5)} step={0.1} onChange={setVideoStart} />
              <div className="row-between small dim">
                <span>🎬 {t('videoTrim')} → стартовое время {videoStart.toFixed(1)}с</span>
                <button className="btn-icon sm" onClick={() => setVideoMuted(!videoMuted)}><Icon name="volume" size={16} /></button>
              </div>
            </>
          )}
          <div className="row-between">
            <button className="btn sec" onClick={() => { setFile(null); setUrl(''); setImg(null); }}>{t('cancel')}</button>
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? t('loading') : t('save')}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ================= Редактор обложки профиля ================= */
/* встроенные обложки (как у Telegram): сцены + узорные */
const PRESET_COVERS = [
  { url: '/covers/city.svg' }, { url: '/covers/mountains.svg' }, { url: '/covers/sea.svg' },
  { url: '/covers/forest.svg' }, { url: '/covers/aurora.svg' }, { url: '/covers/desert.svg' },
  { url: '/covers/p1.svg' }, { url: '/covers/p2.svg' }, { url: '/covers/p3.svg' },
];

export function CoverEditor() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const me = st.me!;
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'photo' | 'video' | null>(null);
  const [url, setUrl] = useState('');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const cover = me.cover;
  const lang = (st.me?.settings?.language === 'en' ? 'en' : 'ru') as 'ru' | 'en';
  const pick = (f: File) => {
    setFile(f);
    const u = URL.createObjectURL(f);
    setUrl(u);
    if (f.type.startsWith('video/')) setKind('video');
    else {
      setKind('photo');
      const i = new Image();
      i.src = u;
      i.onload = () => setImg(i);
    }
  };

  const save = async () => {
    if (!file || !kind) return;
    setBusy(true);
    try {
      let blobOut: Blob = file;
      if (kind === 'photo' && (imgRef.current || img)) {
        blobOut = await cropToBlob(imgRef.current ?? img!, 2.2, crop, 1200, 'image/jpeg');
      }
      const up = await st.uploads(blobOut, kind === 'video' ? 'cover.mp4' : 'cover.jpg', {});
      await st.patchMe({ cover: { kind: kind === 'photo' ? (file.type === 'image/gif' ? 'gif' : 'photo') : 'video', url: up.url } });
      st.pushToast({ kind: 'ok', title: 'saved' });
      st.closeModal();
    } catch { st.pushToast({ kind: 'error', title: 'networkError' }); }
    setBusy(false);
  };

  return (
    <Modal title={t('cover')} onClose={st.closeModal} width={520}>
      {!file ? (
        <div className="story-pick">
          <div className="cover-presets">
            <span className="cp-title">{lang === 'ru' ? 'Готовые обложки' : 'Preset covers'}</span>
            <div className="cp-grid">
              {PRESET_COVERS.map((c) => (
                <button key={c.url} className={`cp-item ${me.cover?.url === c.url ? 'on' : ''}`}
                  onClick={async () => {
                    try {
                      await st.patchMe({ cover: { kind: 'photo', url: c.url } });
                      st.pushToast({ kind: 'ok', title: 'saved' });
                      st.closeModal();
                    } catch { st.pushToast({ kind: 'error', title: 'networkError' }); }
                  }}>
                  <img src={c.url} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
            <span className="small dim">{lang === 'ru' ? 'Применяется сразу — видно всем.' : 'Applies instantly — visible to everyone.'}</span>
          </div>
          <div className="pv-cover-preview">
            {cover?.url ? (cover.kind === 'video' ? <video src={cover.url} autoPlay muted loop playsInline /> : <img src={cover.url} />) :
              <div className="empty-list">{t('none')}</div>}
          </div>
          <div className="row-gap">
            <label className="btn primary"><Icon name="image" size={18} /> {t('coverPhoto')}
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
            </label>
            <label className="btn sec"><Icon name="video" size={18} /> {t('coverVideo')}
              <input type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
            </label>
            {cover?.url && <button className="btn" onClick={async () => { await st.patchMe({ cover: null }); st.closeModal(); }}>{t('removeCover')}</button>}
          </div>
        </div>
      ) : (
        <>
          <div className="avatar-crop wide">
            {kind === 'video' ? <video src={url} autoPlay loop muted playsInline style={{ width: '100%' }} /> :
              <div style={{ transform: `translate(${crop.offsetX}px, ${crop.offsetY}px) rotate(${crop.rotation}deg)` }}>
                <img ref={imgRef} src={url} style={{ width: '100%' }} draggable={false} />
              </div>}
          </div>
          {kind === 'photo' && (
            <>
              <Slider label={t('crop')} value={crop.zoom} min={1} max={3} step={0.02} onChange={(v) => setCrop((c) => ({ ...c, zoom: v }))} />
              <div className="row-between">
                <button className="btn-icon" onClick={() => setCrop((c) => ({ ...c, rotation: c.rotation - 90 }))}><Icon name="flip" size={18} /></button>
                <button className="btn-icon" onClick={() => setCrop((c) => ({ ...c, rotation: c.rotation + 90 }))}><Icon name="flip" size={18} style={{ transform: 'scaleX(-1)' }} /></button>
              </div>
            </>
          )}
          <div className="row-between">
            <button className="btn sec" onClick={() => { setFile(null); setUrl(''); }}>{t('cancel')}</button>
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? t('loading') : t('save')}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
