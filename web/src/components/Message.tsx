import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '../lib/store';
import { fmtDur, fmtSize, sound } from '../lib/media';
import { Icon } from './common';
import { useInView } from './common';
import type { Message } from '../lib/types';

/* ================= RichText: **жирный**, __курсив__, `код`, ||спойлер||, ссылки ================= */
export function RichText({ text, t, oneLine }: { text: string; t: (k: string) => string; oneLine?: boolean }) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\|\|[^|]+\|\||https?:\/\/[^\s<>"]+)/g;
  let last = 0, match: RegExpExecArray | null, key = 0;

  const push = (s: string) => { if (s) parts.push(<span key={key++}>{s}</span>); };

  while ((match = re.exec(text))) {
    push(text.slice(last, match.index));
    const tok = match[0];
    if (tok.startsWith('**')) parts.push(<b key={key++} style={{ fontWeight: 700 }}>{tok.slice(2, -2)}</b>);
    else if (tok.startsWith('__')) parts.push(<i key={key++}>{tok.slice(2, -2)}</i>);
    else if (tok.startsWith('`')) parts.push(<code key={key++} className="inline-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('||')) parts.push(<Spoiler key={key++} text={tok.slice(2, -2)} />);
    else parts.push(<a key={key++} href={tok} target="_blank" rel="noreferrer" className="msg-link" onClick={(e) => e.stopPropagation()}>{tok}</a>);
    last = match.index + tok.length;
  }
  push(text.slice(last));
  void t;
  return <span className={`rich ${oneLine ? 'one-line' : ''}`}>{parts}</span>;
}

export function Spoiler({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`spoiler ${open ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{text}</span>
  );
}

/* ================= Медиа сообщения ================= */
export function MessageMedia({ msg, own, inView }: { msg: Message; own: boolean; inView: boolean }) {
  const st = useStore();
  const t = (st.me?.settings?.language === 'en' ? 'en' : 'ru');
  const media = msg.media ?? {};

  switch (msg.type) {
    case 'photo':
      return <PhotoView url={media.url} w={media.w} h={media.h} msg={msg} />;
    case 'gif':
      return <PhotoView url={media.url} w={media.w} h={media.h} msg={msg} isGif />;
    case 'video':
      return <VideoView msg={msg} url={media.url} round={false} inView={inView} />;
    case 'round':
      return <VideoView msg={msg} url={media.url} round inView={inView} />;
    case 'voice':
    case 'audio':
      return <AudioView msg={msg} kind={msg.type} />;
    case 'file':
      return <FileView msg={msg} />;
    case 'sticker':
      return <div className="sticker-msg"><span>{media.emoji ?? msg.text}</span></div>;
    case 'location':
      return (
        <a className="loc-card" href={`https://www.google.com/maps?q=${media.lat},${media.lng}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          <div className="loc-map">
            <Icon name="location" size={30} />
            <div className="loc-grid" />
          </div>
          <div className="loc-meta"><b>{t === 'en' ? 'Location' : 'Геолокация'}</b><span className="mono">{Number(media.lat).toFixed(5)}, {Number(media.lng).toFixed(5)}</span></div>
        </a>
      );
    case 'poll':
      return <PollView msg={msg} />;
    default:
      return null;
  }
}

function PhotoView({ url, w, h, msg, isGif }: { url: string; w?: number; h?: number; msg: Message; isGif?: boolean }) {
  const [aspect, setAspect] = useState(w && h ? h / w : 4 / 3);
  const [loaded, setLoaded] = useState(false);
  const st = useStore();
  return (
    <div className="photo-wrap" style={{ maxWidth: Math.min(420, Math.max((w ?? 0) * 0.09, 260)) }}>
      <div style={{ aspectRatio: `1 / ${aspect}` }} className="photo-box">
        {!loaded && <div className="photo-skeleton" />}
        <img src={url} loading="lazy" draggable={true}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (!w || !h) setAspect(img.naturalHeight / img.naturalWidth);
            else setAspect(h / w);
            setLoaded(true);
          }}
          onClick={(e) => { e.stopPropagation(); st.openModal('media-viewer', { url, kind: isGif ? 'gif' : 'photo', fromMsg: msg }); }}
          className="photo-img" alt="" />
        {isGif && <span className="gif-tag">GIF</span>}
      </div>
    </div>
  );
}

function VideoView({ msg, url, round, inView }: { msg: Message; url: string; round: boolean; inView: boolean }) {
  const st = useStore();
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [mutedState, setMutedState] = useState(true);
  const [ready, setReady] = useState(false);
  const dur = msg.media?.dur ?? 0;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (inView && !playing && round) {
      // видеосообщения: autoplay loop when visible, muted
      v.play().then(() => setPlaying(true)).catch(() => {});
    }
    if (!inView && playing) { v.pause(); setPlaying(false); }
    const onVis = () => {
      if (document.hidden) { v.pause(); setPlaying(false); }
      else if (round && inView) { v.play().then(() => setPlaying(true)).catch(() => {}); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [inView, round]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (round) {
      const v = ref.current!;
      if (v.paused) { v.play().then(() => setPlaying(true)).catch(() => {}); setMutedState(false); v.muted = false; }
      else { v.pause(); setPlaying(false); }
      return;
    }
    st.openModal('media-viewer', { url, kind: 'video', dur });
  };

  return (
    <div className={`video-wrap ${round ? 'round' : ''}`} style={round ? undefined : { maxWidth: 420 }}>
      <video ref={ref} src={url} loop={round} playsInline muted={mutedState}
        preload={round ? 'metadata' : 'metadata'}
        onLoadedData={() => setReady(true)}
        onClick={toggle}
        style={round ? { width: 260, height: 260, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.4)' } : { width: '100%', display: 'block', cursor: 'pointer', borderRadius: 12 }}
        poster={undefined}
      />
      {!ready && !round && <div className="photo-skeleton" />}
      {round && (
        <div className="round-meta" style={{ textAlign: 'center' }}>
          <b>{fmtDur(dur)}</b>
          <button className="btn-icon sm" onClick={(e) => { e.stopPropagation(); st.openModal('media-viewer', { url, kind: 'video', dur, round: true }); }}>
            <Icon name="expand" size={16} />
          </button>
        </div>
      )}
      {!round && (
        <button className="video-play" onClick={toggle}>
          <Icon name={playing ? 'pause' : 'play'} size={22} fill />
        </button>
      )}
    </div>
  );
}

/* ---------- голосовые / аудио ---------- */
/* размеры по tdesktop: kWaveformSamplesCount=100, msgWaveformBar=2px,
   msgWaveformSkip=1px, msgWaveformMin=3px, msgWaveformMax=17px,
   fileLayout thumb=44px → фиксированная ширина, не зависит от длительности */
const VOICE_BARS = 100;

function resampleWave(wave: number[] | null): number[] {
  if (!wave?.length) return [];
  if (wave.length === VOICE_BARS) return wave;
  const out: number[] = [];
  for (let i = 0; i < VOICE_BARS; i++) {
    const from = Math.floor(i * wave.length / VOICE_BARS);
    const to = Math.max(from + 1, Math.floor((i + 1) * wave.length / VOICE_BARS));
    let m = 0;
    for (let j = from; j < to; j++) m = Math.max(m, wave[j] ?? 0);
    out.push(m);
  }
  return out;
}

export function AudioView({ msg, kind }: { msg: Message; kind: 'voice' | 'audio' }) {
  const st = useStore();
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(msg.media?.dur ?? 0);
  const [rate, setRate] = useState(1);
  const wave = useMemoWave(msg);
  const bars = useMemo(() => {
    const rs = resampleWave(wave);
    const max = Math.max(0, ...rs);
    return rs.map((h) => (max > 0 ? h / max : 0));
  }, [wave]);

  /* ---- плавная анимация волны: rAF-цикл красит бары каждый кадр ---- */
  const barsElRef = useRef<(HTMLElement | null)[]>([]);
  const rafRef = useRef(0);
  const lastPaintRef = useRef(-2);
  const durRef = useRef(dur);
  useEffect(() => { durRef.current = dur; }, [dur]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const paint = useCallback((frac: number) => {
    if (!Number.isFinite(frac)) frac = 0;
    frac = Math.min(1, Math.max(0, frac));
    const count = Math.round(frac * bars.length);
    if (count === lastPaintRef.current) return;
    for (let i = 0; i < bars.length; i++) {
      const el = barsElRef.current[i];
      if (el) el.classList.toggle('on', i < count);
    }
    lastPaintRef.current = count;
  }, [bars]);

  const startLoop = useCallback(() => {
    let lastLabel = 0;
    const step = (t: number) => {
      const a = ref.current as HTMLAudioElement | null;
      if (!a || a.paused) { return; }
      const d = durRef.current || msg.media?.dur || 0;
      if (d > 0) paint(a.currentTime / d);
      if (t - lastLabel > 240) { lastLabel = t; setPos(a.currentTime); }
      rafRef.current = window.requestAnimationFrame(step);
    };
    rafRef.current = window.requestAnimationFrame(step);
  }, [msg.media?.dur, paint]);

  const durationLabel = playing || pos > 0 ? `${fmtDur(pos)} / ${fmtDur(dur)}` : fmtDur(dur);
  const own = msg.sender === st.me?.id;

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ref.current) {
      const a = new Audio(msg.media.url);
      a.playbackRate = rate;
      a.ontimeupdate = () => { if (!rafRef.current && a.paused) setPos(a.currentTime); };
      // в webm-записях Chrome отдаёт duration: Infinity — держим длительность от рекордера
      a.onloadedmetadata = () => { const d = a.duration; if (Number.isFinite(d) && d > 0) setDur(d); };
      a.onended = () => {
        setPlaying(false); setPos(0); paint(0); lastPaintRef.current = -2;
        cancelAnimationFrame(rafRef.current);
      };
      ref.current = a as HTMLAudioElement;
    }
    const a = ref.current as HTMLAudioElement;
    if (playing) {
      a.pause(); setPlaying(false); cancelAnimationFrame(rafRef.current);
      const d = durRef.current || msg.media?.dur || 0;
      if (d > 0) paint(a.currentTime / d);
    }
    else {
      a.playbackRate = rate;
      a.play().then(() => { setPlaying(true); lastPaintRef.current = -2; startLoop(); }).catch(() => {});
      st.markRead(msg.chatId, msg.id);
    }
  };

  return (
    <div className="voice-msg" onClick={(e) => e.stopPropagation()}>
      <div className="voice-body">
        <button className="play-btn" onClick={toggle} title={playing ? 'Пауза' : 'Слушать'}>
          {playing ? (
            <svg key="pause" width="16" height="16" viewBox="0 0 18 18" aria-hidden>
              <rect x="4.2" y="2.6" width="3.7" height="12.8" rx="1.8" fill="currentColor" />
              <rect x="10.1" y="2.6" width="3.7" height="12.8" rx="1.8" fill="currentColor" />
            </svg>
          ) : (
            <svg key="play" width="17" height="17" viewBox="0 0 18 18" aria-hidden style={{ marginLeft: 2 }}>
              <path d="M5.2 3.7c0-1.4 1.5-2.2 2.6-1.5l8.4 5.3c1 .7 1 2.3 0 3l-8.4 5.3c-1.1.7-2.6-.1-2.6-1.5V3.7z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="wave-col">
          <div className="wave" onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const frac = (e.clientX - r.left) / r.width;
            const a = ref.current as HTMLAudioElement | null;
            if (a && dur) { a.currentTime = frac * dur; setPos(frac * dur); }
            paint(frac);
          }}>
            {bars.map((h, i) => {
              const px = Math.max(3, Math.round(h * 14));
              return <i key={i} ref={(el) => { barsElRef.current[i] = el; }} style={{ height: `${px}px` }} />;
            })}
          </div>
          <div className="voice-sub">
            <span className="voice-dur">{durationLabel}</span>
            <button className="rate-btn" title="скорость" onClick={(e) => { e.stopPropagation(); const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(r); if (ref.current) ref.current.playbackRate = r; }}>{rate}×</button>
          </div>
        </div>
      </div>
      {kind === 'audio' && (
        <a className="voice-name mono small" href={msg.media.url} download target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{msg.media?.name}</a>
      )}
    </div>
  );
}

function useMemoWave(msg: Message): number[] | null {
  const [wave] = useState<number[] | null>(() => msg.media?.waveform ?? null);
  return wave;
}

export function FileView({ msg }: { msg: Message }) {
  const m = msg.media ?? {};
  const ext = (m.name ?? '').split('.').pop()?.toUpperCase()?.slice(0, 4) || 'FILE';
  return (
    <a className="file-msg" href={m.url} download target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      <div className="file-ico mono">{ext}</div>
      <div className="file-meta">
        <b className="one-line">{m.name}</b>
        <span className="dim small">{fmtSize(m.size ?? 0)}</span>
      </div>
      <Icon name="download" size={18} className="dim" />
    </a>
  );
}

/* ---------- опрос ---------- */
export function PollView({ msg }: { msg: Message }) {
  const st = useStore();
  const t = (st.me?.settings?.language === 'en' ? 'en' : 'ru');
  const poll = msg.poll ?? { question: msg.media?.question ?? '', options: msg.media?.options ?? [], votes: [] };
  const myId = st.me?.id;
  const myVote = poll.votes.find((v) => v.userId === myId);
  const total = poll.votes.length;
  const voted = myVote != null;

  return (
    <div className="poll-msg" onClick={(e) => e.stopPropagation()}>
      <b className="poll-q">{poll.question}</b>
      <div className="poll-note small dim">{t === 'en' ? 'Anonymous poll' : 'Анонимный опрос'}</div>
      <div className="poll-opts">
        {poll.options.map((opt, i) => {
          const voters = poll.votes.filter((v) => v.choice === i);
          const pct = total ? Math.round(voters.length / total * 100) : 0;
          return (
            <button key={i} className={`poll-opt ${myVote?.choice === i ? 'mine' : ''}`}
              disabled={voted}
              onClick={() => { st.pollVote(msg.id, i); }}>
              <span className={`ring ${myVote?.choice === i ? 'on' : ''}`} />
              <div className="poll-opt-main">
                <span>{opt}</span>
                <div className="poll-bar" style={{ width: `${pct}%` }} />
              </div>
              {voted && <span className="mono small">{pct}%</span>}
            </button>
          );
        })}
      </div>
      <div className="small dim">{total} {t === 'en' ? 'votes' : 'голосов'}</div>
    </div>
  );
}

/* ---------- "был(а) недавно" ---------- */
export function lastSeenText(user: any, t: (k: string) => string): string {
  if (!user?.lastSeen) return t('offline');
  const diff = (Date.now() - user.lastSeen) / 1000;
  if (diff < 60) return t('online');
  if (diff < 3600) return `${t('wasOnline')} ${Math.floor(diff / 60)} мин ${t('ago')}`;
  if (diff < 86400 * 2) return `${t('wasOnline')} ${t('yesterday').toLowerCase()}`;
  const d = new Date(user.lastSeen);
  return `${t('wasOnline')} ${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })}`;
}
