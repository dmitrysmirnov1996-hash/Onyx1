import React, { useEffect, useRef, useState } from 'react';
import { useStore, getSocket, onSocket } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Avatar, Icon } from './common';
import { CallManager, SCREEN_PRESETS } from '../lib/call';
import { fmtDur } from '../lib/media';

type MenuKind = '' | 'cam' | 'mic' | 'speaker' | 'screen';

// подписи пресетов качества демонстрации (RU/EN)
const SCREEN_Q_LABELS = (t: (k: string) => string): Record<string, string> => ({
  asis: t('qAsis'),
  '1080p': '1080p · 30',
  '720p': '720p · 24',
  '480p': '480p · 15',
  '360p': '360p · 10',
});

// единый менеджер на приложение
export const callManager = new CallManager({
  getState: () => useStore.getState(),
  setState: useStore.setState,
});

// дебаг-доступ для диагностики звонка из консоли/проб
if (typeof window !== 'undefined') (window as any).__callManager = callManager;

// подписка на сигналинг звонков: текущий сокет + все последующие
onSocket((s) => callManager.attach(s));
callManager.attach(getSocket());

export default function CallOverlay() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const call = st.call;
  const hasVideo = call?.kind === 'video';
  const incoming = call?.phase === 'incoming';
  const peerScreen = !!call?.remoteScreen;
  const [menu, setMenu] = useState<MenuKind>('');
  const [devices, setDevices] = useState<Record<MenuKind, MediaDeviceInfo[]>>({} as any);
  const [wmic, setMic] = useState(() => callManager.micOn);
  const [wcam, setCam] = useState(() => callManager.camOn);
  const [wscreen, setScreen] = useState(() => callManager.screenOn);
  const [wspk, setSpk] = useState(true);
  // уровень микрофона: живё в ref, к DOM применяется в rAF-цикле (плавный лерп),
  // а НЕ через setState — иначе конвульсии каждые 80мс и лишние ре-рендеры всего оверлея
  const levelRef = useRef(0);
  const ringRef = useRef<HTMLSpanElement>(null);
  const avaBoxRef = useRef<HTMLDivElement>(null);
  const [fp, setFp] = useState(callManager.fingerprint);
  const [dur, setDur] = useState(0);
  const [, tick] = useState(0);
  const rerender = () => tick((x) => x + 1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  // единый ref на контейнер PiP: внутри <video>, источник = экран или камера по состоянию
  const pipRef = useRef<HTMLDivElement>(null);
  const [mediaTick, bumpMedia] = useState(0);
  // СВОЯ трансляция приоритетна для большого вида (как в tdesktop);
  // чужая демка уходит в мини-окно
  const ownShare = wscreen;
  const showRemoteVideo = ownShare || (hasVideo && !incoming) || peerScreen;
  // «открыть чужую демку»: клик по мини-окну показывает ЧУЖОЙ экран в большом виде,
  // своя трансляция уезжает в мини-окно (swap, как в tdesktop). Актуален только когда оба показываем.
  const [expandedRemote, setExpandedRemote] = useState(false);
  const expandedRef = useRef(false);
  const flipExpand = (v: boolean) => { expandedRef.current = v; setExpandedRemote(v); rerender(); };
  useEffect(() => {
    // перестал показывать кто-то из двоих — возвращаем обычный режим
    if (!peerScreen || !ownShare) { expandedRef.current = false; setExpandedRemote(false); }
  }, [peerScreen, ownShare, call?.callId]);

  // колбэки менеджера → DOM-привязки потоков (по data-атрибутам, без rAF-цикла)
  useEffect(() => {
    callManager.onRemote = (s) => {
      const cm = callManager;
      // большой вид: если пользователь «открыл» чужую демку в большой вид — чужой экран,
      // иначе своя трансляция приоритетна; без своей — чужая демка / камера собеседника
      const src = (expandedRef.current && cm.remoteScreenStream) ? cm.remoteScreenStream
        : (cm.screenOn && cm.screenStream ? cm.screenStream : (cm.remoteScreenStream ?? s));
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== src) remoteVideoRef.current.srcObject = src;
      if (audioRef.current && audioRef.current.srcObject !== s) audioRef.current.srcObject = s;
      audioRef.current?.play().catch(() => {});
      // мини-окно: при «раскрытой» чужой демке там СВОЙ экран, иначе камера/экран собеседника
      const rbox = document.querySelector('.cc-pip.remote') as HTMLDivElement | null;
      const rvid = rbox?.querySelector('video') as HTMLVideoElement | null;
      const ownShotTrack = cm.screenStream?.getVideoTracks()[0] ?? null;
      const miniTrack = expandedRef.current && ownShotTrack
        ? ownShotTrack
        : cm.screenOn
          ? (cm.remoteScreenTrack ?? s.getVideoTracks().find((x) => x !== cm.remoteScreenTrack) ?? null)
          : (s.getVideoTracks().find((x) => x !== cm.remoteScreenTrack) ?? null);
      if (rvid && miniTrack && (rvid as any).__bt !== miniTrack) {
        (rvid as any).__bt = miniTrack;
        rvid.srcObject = new MediaStream([miniTrack]);
        rvid.play().catch(() => {});
      }
      rerender();
    };
    callManager.onLocal = () => bumpMedia((x) => x + 1);
    callManager.onScreen = (s) => {
      setScreen(!!s);
      bumpMedia((x) => x + 1);
      rerender();
    };
    callManager.onLevel = (lv) => { levelRef.current = Math.max(0.04, Math.min(1, lv)); };
    callManager.onQuality = () => rerender();
    callManager.onFingerprint = (emo) => setFp(emo);
  }, []);

  // перепривязка при смене звонка/фазы/вида (и когда пришёл локальный поток)
  useEffect(() => {
    if (!call) return;
    const cm = callManager;
    // большой вид: «раскрытая» чужая демка > своя трансляция > чужая демка > камера собеседника
    const peerShot = peerScreen ? cm.remoteScreenStream : null;
    const bigSrc = (expandedRemote && peerShot) ? peerShot
      : (cm.screenOn && cm.screenStream ? cm.screenStream : (peerShot ?? cm.remoteStream));
    if (remoteVideoRef.current && bigSrc && remoteVideoRef.current.srcObject !== bigSrc) {
      remoteVideoRef.current.srcObject = bigSrc;
      remoteVideoRef.current.play().catch(() => {});
    }
    if (audioRef.current && cm.remoteStream && audioRef.current.srcObject !== cm.remoteStream) {
      audioRef.current.srcObject = cm.remoteStream;
      audioRef.current.play().catch(() => {});
    }
    const pipVid = pipRef.current?.querySelector('video') ?? null;
    if (pipVid && cm.localStream && pipVid.srcObject !== cm.localStream) pipVid.srcObject = cm.localStream;
    else if (pipVid && !cm.localStream) pipVid.srcObject = null;
    pipVid?.play().catch(() => {});
  }, [call?.callId, call?.phase, call?.kind, wscreen, wcam, showRemoteVideo, mediaTick, expandedRemote, peerScreen]);

  // большой вид показываем только при живом треке — иначе «чёрный» кадр вместо картинки
  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    // трек для показа: «раскрытая» чужая демка > своя трансляция > чужая демка > камера собеседника
    const cm = callManager;
    const track = (expandedRemote && peerScreen
      ? (cm.remoteScreenTrack || cm.remoteScreenStream?.getVideoTracks()[0] || null)
      : ((cm.screenOn && cm.screenStream?.getVideoTracks()[0]) || cm.remoteScreenTrack
        || cm.remoteStream?.getVideoTracks().find((x) => x.readyState === 'live') || null));
    const apply = () => {
      el.style.opacity = track && !track.muted && track.enabled && track.readyState === 'live' ? '1' : '0';
    };
    apply();
    track?.addEventListener('mute', apply);
    track?.addEventListener('unmute', apply);
    track?.addEventListener('ended', apply);
    return () => {
      track?.removeEventListener('mute', apply);
      track?.removeEventListener('unmute', apply);
      track?.removeEventListener('ended', apply);
    };
  }, [showRemoteVideo, call?.kind, call?.remoteScreen, call?.remoteScreenQ, call?.phase, call?.callId, mediaTick, wscreen, expandedRemote, peerScreen]);

  // мини-окно: камера/экран собеседника; при «раскрытой» чужой демке там СВОЙ экран — живость трека → видимость
  useEffect(() => {
    const box = document.querySelector('.cc-pip.remote') as HTMLDivElement | null;
    if (!box) return;
    const cm = callManager;
    const ownShotTrack = cm.screenStream?.getVideoTracks()[0] ?? null;
    const camTrack = (expandedRemote && ownShotTrack) ? ownShotTrack
      : cm.screenOn && cm.remoteScreenTrack
        ? cm.remoteScreenTrack
        : cm.remoteStream?.getVideoTracks().find((x) => x !== cm.remoteScreenTrack) ?? null;
    const vid = box.querySelector('video');
    if (vid && camTrack && (vid as any).__bt !== camTrack) {
      (vid as any).__bt = camTrack;
      vid.srcObject = new MediaStream([camTrack]);
      vid.play().catch(() => {});
    } else if (vid && !camTrack) {
      (vid as any).__bt = null;
      vid.srcObject = null;
    }
    const apply = () => {
      const live = !!camTrack && !camTrack.muted && camTrack.enabled && camTrack.readyState === 'live';
      box.style.opacity = live ? '1' : '0';
    };
    apply();
    camTrack?.addEventListener('mute', apply);
    camTrack?.addEventListener('unmute', apply);
    camTrack?.addEventListener('ended', apply);
    return () => {
      camTrack?.removeEventListener('mute', apply);
      camTrack?.removeEventListener('unmute', apply);
      camTrack?.removeEventListener('ended', apply);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.remoteScreen, call?.kind, call?.phase, call?.callId, mediaTick, wscreen, expandedRemote]);

  // то же для PiP (своя камера): пусто/выключено — рамка целиком прозрачна
  useEffect(() => {
    const box = pipRef.current;
    if (!box) return;
    const cm = callManager;
    const src = cm.localStream;
    const track = src?.getVideoTracks()[0] ?? null;
    const apply = () => {
      const live = !!track && track.enabled && !track.muted && track.readyState === 'live';
      box.style.opacity = live ? '1' : '0';
    };
    apply();
    track?.addEventListener('mute', apply);
    track?.addEventListener('unmute', apply);
    track?.addEventListener('ended', apply);
    return () => {
      track?.removeEventListener('mute', apply);
      track?.removeEventListener('unmute', apply);
      track?.removeEventListener('ended', apply);
    };
  }, [wscreen, wcam, hasVideo, call?.phase, call?.callId, mediaTick]);

  // таймер разговора
  useEffect(() => {
    if (!call) { setDur(0); return; }
    if (call.phase !== 'connected') return;
    const iv = setInterval(() => setDur(Math.floor((Date.now() - (call.startedAt ?? Date.now())) / 1000)), 500);
    return () => clearInterval(iv);
  }, [call?.phase, call?.startedAt, call?.callId]);

  /* Плавная анимация «говорю»: rAF-лерп уровня микрофона (быстрый аттаκ, мягкий спад).
     Красим кольцо вокруг аватара и чуть «дышим» аватаром — напрямую, без ре-рендеров. */
  const speaking = call?.phase === 'connected';
  useEffect(() => {
    if (!speaking) return;
    let raf = 0;
    let cur = 0;
    const loop = () => {
      const target = levelRef.current;
      // рост в 2.5 раза быстрее спада: реакция на голос мгновенная, угасание мягкое
      cur += (target - cur) * (target > cur ? 0.28 : 0.1);
      if (target < 0.08 && cur < 0.015) cur = 0;
      const ring = ringRef.current;
      if (ring) {
        const deg = Math.round(cur * 360);
        ring.style.background = `conic-gradient(var(--accent) ${deg}deg, rgba(255,255,255,.07) 0)`;
        ring.style.opacity = String(Math.min(1, 0.35 + cur));
      }
      const box = avaBoxRef.current;
      if (box) {
        const s = 1 + cur * 0.038;
        box.style.transform = `scale(${s.toFixed(4)})`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (ringRef.current) { ringRef.current.style.background = ''; ringRef.current.style.opacity = ''; }
      if (avaBoxRef.current) avaBoxRef.current.style.transform = '';
    };
  }, [speaking, call?.callId]);

  // закрытие меню устройств по клику вне
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('.call-slot');
      if (!el) setMenu('');
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  if (!call) return null;

  const peer = call.peer;
  const minimized = call.minimized;
  const connected = call.phase === 'connected';
  const failed = call.phase === 'failed';

  const status =
    call.phase === 'outgoing' ? t('ringing') :
    call.phase === 'incoming' ? (call.kind === 'video' ? t('videoCall') : t('voiceCall')) :
    call.phase === 'connecting' ? t('connecting') :
    call.phase === 'reconnecting' ? t('reconnecting') :
    failed ? t('connectionBad') :
    connected ? fmtDur(dur) : t('connecting');

  // идёт демонстрация (в чью-то сторону) → среднюю «аватарную» сцену прячем,
  // чтобы не загораживать просмотр демки
  const demoStage = connected && (ownShare || peerScreen);

  const openMenu = async (m: MenuKind) => {
    if (menu === m) { setMenu(''); return; }
    setMenu(m);
    if (m && m !== 'screen') setDevices({ [m]: await callManager.devices(m) } as any);
  };

  // запуск своей демонстрации: с выбором качества
  const startScreen = async (presetId: string) => {
    setMenu('');
    await callManager.toggleScreen(true, presetId);
    rerender();
  };

  // ВАЖНО: это функция, а не подкомпонент — React сохраняет те же DOM-узлы между
  // рендерами (без перемонтирования), иначе клики теряются из-за частого уровня микрофона.
  const slot = ({ icon, label, on, onClick, caret, menuKind, danger }: any) => (
    <div className="call-slot">
      <span className="call-round-wrap">
        <button
          className={`call-round ${danger ? 'danger' : on ? '' : 'off'}`}
          title={label}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          <Icon name={icon} size={23} strokeWidth={2.1} />
        </button>
        {caret && !failed && (
          <button
            className="call-caret"
            title={t('quality')}
            onClick={(e) => { e.stopPropagation(); openMenu(menuKind); }}
          >
            <Icon name="chevDown" size={11} strokeWidth={2.4} />
          </button>
        )}
      </span>
      {caret && menu === menuKind && (
        <div className="call-device-menu" onClick={(e) => e.stopPropagation()}>
          <div className="call-device-title">{t(menuKind === 'cam' ? 'camera' : menuKind === 'speaker' ? 'speakers' : 'microphone')}</div>
          {(devices[menuKind] ?? []).map((d) => {
            const cur = menuKind === 'speaker'
              ? callManager.speakerId === d.deviceId
              : callManager.currentDevice(menuKind as any) === (d as any).deviceId;
            return (
              <button key={d.deviceId} className={cur ? 'on' : ''} onClick={async () => {
                if (menuKind === 'speaker') { await callManager.switchSpeaker(d.deviceId); setSpk(true); }
                else await callManager.switchDevice(menuKind as any, d.deviceId);
                rerender();
                openMenu(menuKind);
              }}>
                <span>{d.label || (menuKind === 'cam' ? t('camera') : t('microphone'))}</span>
                {cur && <Icon name="check" size={14} />}
              </button>
            );
          })}
          {!(devices[menuKind] ?? []).length && <div className="call-device-empty">{t('noDevices')}</div>}
        </div>
      )}
      {/* выбор качества демонстрации (слот «Экран») */}
      {menuKind === 'screen' && menu === 'screen' && (
        <div className="call-quality-menu" onClick={(e) => e.stopPropagation()}>
          <div className="call-device-title">{t('screenQTitle')}</div>
          {SCREEN_PRESETS.map((p) => (
            <button key={p.id} className={callManager.screenQuality === p.id ? 'on' : ''} onClick={(e) => { e.stopPropagation(); void startScreen(p.id); }}>
              <span>{SCREEN_Q_LABELS(t)[p.id]}</span>
              {callManager.screenQuality === p.id && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
      <small>{label}</small>
    </div>
  );

  if (minimized) {
    // tdesktop calls_top_bar.style: полоса 38px во всю ширину верха окна:
    // слева сигнал-бары, таймер (callBarLabel semibold), справа кнопки 41×38
    // (callBarMuteToggle 41×38 iconPosition 3px, callBarHangup), skip 10/12px.
    const miniStatus = connected ? fmtDur(dur) :
      call.phase === 'incoming' ? t('incomingCall') :
      call.phase === 'failed' ? t('connectionBad') : status;
    const quality = callManager.connQuality;
    const bars = quality === 'good' ? 4 : quality === 'ok' ? 3 : quality === 'bad' ? 2 : 1;
    return (
      <div className="call-topbar" title={t('minimizeCallBack')}>
        <div className="ctb-signal" aria-hidden>
          {[1, 2, 3, 4].map((i) => <i key={i} data-on={i <= bars ? '1' : '0'} />)}
        </div>
        <div className="ctb-duration" onClick={() => st.setCall({ ...call, minimized: false })}>
          {peer?.name ? <b className="ctb-name">{peer.name}</b> : null}
          {miniStatus}
        </div>
        <button className="ctb-btn" title={t('microphone')} onClick={(e) => { e.stopPropagation(); callManager.toggleMic(!wmic); setMic(!wmic); rerender(); }}>
          <Icon name={wmic ? 'callMic' : 'callMicOff'} size={18} />
        </button>
        <button className="ctb-btn ctb-hangup" title={t('endCall')} onClick={(e) => { e.stopPropagation(); callManager.hangup(); }}>
          <Icon name="callEnd" size={19} />
        </button>
      </div>
    );
  }

  return (
    <div className="call-screen" data-phase={call.phase} data-kind={call.kind} data-own-screen={wscreen ? '1' : '0'}>
      <audio ref={audioRef} data-call-remote autoPlay playsInline style={{ display: 'none' }} />
      <div className="call-veil" />

      {showRemoteVideo && (
        <video ref={remoteVideoRef} className="cc-video" autoPlay playsInline muted />
      )}

      {/* мини-окно собеседника: камера/экран собеседника (или свой экран — когда чужую демку «открыли») */}
      {(peerScreen || (ownShare && hasVideo && !incoming)) && (
        <div
          className={`cc-pip remote ${expandedRemote ? 'act' : ''}`}
          title={expandedRemote ? (st.me?.name ?? 'Я') : (peer?.name ?? t('peerScreen'))}
          onClick={() => (peerScreen && ownShare) && flipExpand(!expandedRemote)}
        >
          <video autoPlay playsInline muted />
          <span className="pip-label">{expandedRemote ? (st.me?.name ?? 'Я') : (peer?.name ?? t('peerScreen'))}</span>
        </div>
      )}

      {/* своя камера пиP */}
      {hasVideo && !incoming && (
        <div ref={pipRef} className="cc-pip">
          <video autoPlay playsInline muted />
          <span className="pip-label">{st.me?.name ?? 'Я'}</span>
        </div>
      )}

      <div className="cc-head">
        <div className="cc-chip" data-q={callManager.connQuality} title={`${t('connection')}: ${t('conn_' + callManager.connQuality)}`}>
          <i /><i /><i />
        </div>
        {/* плашки демки: своя — качество; чужая — имя и качество */}
        {ownShare && !failed && (
          <span className="cc-tag">{t('demo')} · {SCREEN_Q_LABELS(t)[callManager.screenQuality] ?? ''}</span>
        )}
        {peerScreen && (
          <span className="cc-tag name">{peer?.name ?? ''} · {t('demo')} · {SCREEN_Q_LABELS(t)[call.remoteScreenQ ?? ''] ?? '—'}</span>
        )}
        <div className="grow" />
        <button className="btn-icon" title={t('minimize')} onClick={() => st.setCall({ ...call, minimized: true })}>
          <Icon name="minimize" size={17} />
        </button>
      </div>

      {/* во время демки центральный аватарный блок убираем — он загораживал просмотр */}
      {!(demoStage) && (
      <div className="cc-center">
        <div className={`cc-avatar ${connected ? '' : 'ring'}`} ref={avaBoxRef} style={{ willChange: 'transform' }}>
          {connected && <span ref={ringRef} className="cc-ring" />}
          <Avatar user={peer} size={168} />
        </div>
        {!connected && !failed && <div className="cc-bars"><i /><i /><i /><i /></div>}
        <h2 className="cc-name">
          {peer?.name || (peer?.username ? `@${peer.username}` : '—')}
          {call.remoteMicOn === false && <span className="cc-name-muted" title={t('muted')}><Icon name="micOff" size={15} /></span>}
        </h2>
        {connected && peer?.username && <p className="cc-uname">@{peer.username}</p>}
        <p className="cc-status">
          {connected ? `${fmtDur(dur)}${callManager.connQuality !== 'good' ? ' · ' + t('conn_' + callManager.connQuality) : ''}` : status}
          {call.remoteScreen && (
            <span className="cc-screenbadge" title={t('screenQTitle')}>
              {t('demo')} · {SCREEN_Q_LABELS(t)[call.remoteScreenQ ?? ''] ?? '—'}
            </span>
          )}
        </p>
        {!incoming && !failed && (
          <div className="cc-fingerprint" title={t('fingerprintTt')}>
            {fp ? <b>{fp.split('').map((ch, i) => <span key={i}>{ch}</span>)}</b> : <span className="fp-dots">····</span>}
          </div>
        )}
      </div>
      )}

      {incoming ? (
        <div className="call-controls incoming">
          <div className="call-slot">
            <button className="call-round lg danger" title={t('decline')} onClick={() => callManager.decline()}>
              <Icon name="phone" size={26} style={{ transform: 'rotate(135deg)' }} />
            </button>
            <small>{t('decline')}</small>
          </div>
          <div className="call-slot">
            <button className="call-round lg ok" title={t('answer')} onClick={() => callManager.accept()}>
              <Icon name="phone" size={26} />
            </button>
            <small>{t('answer')}</small>
          </div>
          {call.kind === 'video' && (
            <div className="call-slot">
              <button className="call-round lg ok" title={t('answerWithVideo')} onClick={() => callManager.accept(true)}>
                <Icon name="video" size={24} strokeWidth={2.1} />
              </button>
              <small>{t('answerWithVideo')}</small>
            </div>
          )}
        </div>
      ) : failed ? (
        <div className="call-controls">
          <div className="call-slot">
            <button className="call-round" title={t('retryCall')} onClick={() => callManager.retry()}>
              <Icon name="flip" size={22} />
            </button>
            <small>{t('retryCall')}</small>
          </div>
          <div className="call-slot">
            <button className="call-round danger" title={t('endCall')} onClick={() => callManager.hangup()}>
              <Icon name="phone" size={24} style={{ transform: 'rotate(135deg)' }} />
            </button>
            <small>{t('endCall')}</small>
          </div>
        </div>
      ) : (
        <div className="call-controls">
          {slot({ icon: 'screen', label: t('screenBtn'), on: wscreen, menuKind: 'screen',
            onClick: async () => {
              if (wscreen) await callManager.toggleScreen(false);
              else openMenu('screen'); // выбор качества перед включением
              rerender();
            } })}
          {slot({ icon: 'video', label: t('videoBtn'), on: hasVideo && wcam, menuKind: 'cam', caret: true,
            onClick: () => { callManager.toggleCam(!(hasVideo && wcam)); setCam(!(hasVideo && wcam)); rerender(); } })}
          {slot({ icon: 'mic', label: t('mute'), on: wmic, menuKind: 'mic', caret: true,
            onClick: () => { callManager.toggleMic(!wmic); setMic(!wmic); rerender(); } })}
          {slot({ icon: 'phone', label: t('endCall'), on: false, danger: true,
            onClick: () => callManager.hangup() })}
          {slot({ icon: 'volume', label: t('soundBtn'), on: wspk, menuKind: 'speaker', caret: true,
            onClick: () => { setSpk(!wspk); const a = audioRef.current; if (a && wspk) a.muted = true; else if (a) a.muted = false; } })}
        </div>
      )}
    </div>
  );
}

/* ---------- Оценка звонка (tdesktop calls_rate_call) ---------- */
/* const из calls_rate_call.cpp: kCardShowScaleFrom 0.7, kStarShowDelay 16ms,
   kSelectDuration 250, kStarPressedScale 0.8; лейблы lng_call_rate_title/description */
export function RateCall() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const rate = st.rateCall;
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const label = t(['rateBad', 'rateBad', 'rateBad', 'rateOK', 'rateGood', 'rateExcellent'][hover || rating] ?? '');

  if (!rate) return null;

  const finish = () => {
    // серверного эндпоинта в клоне нет — сохраняем локально (честно отмечено в README)
    try {
      const log = JSON.parse(localStorage.getItem('tg_call_ratings') ?? '[]');
      log.push({ peer: rate.peer?.username ?? rate.peer?.id, kind: rate.kind, durMs: rate.durMs, rating, comment, at: Date.now() });
      localStorage.setItem('tg_call_ratings', JSON.stringify(log.slice(-50)));
    } catch {}
    st.pushToast({ kind: 'ok', title: t('rateThanks') });
    st.pushRateCall(null as any);
  };

  return (
    <div className="rate-call" onClick={finish}>
      <div className="rate-card" onClick={(e) => e.stopPropagation()}>
        {rate.peer && <Avatar user={rate.peer} size={64} />}
        <h3>{t('rateTitle')}</h3>
        <p className="dim">{t('rateDesc')}</p>
        <div className="rate-stars">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} className={i <= (hover || rating) ? 'on' : ''} style={{ animationDelay: `${i * 16}ms` }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(0)}
              onClick={() => setRating(i)}>
              <Icon name="star" size={30} />
            </button>
          ))}
        </div>
        {(rating || hover) > 0 && <div className="rate-quality">{label}</div>}
        {rating > 0 && (
          <div className="rate-actions">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={512}
              placeholder={t('rateComment')} rows={2} />
            <button className="btn primary" onClick={finish}>{t('send')}</button>
          </div>
        )}
        <button className="rate-close" onClick={finish}>{t('close')}</button>
      </div>
    </div>
  );
}
