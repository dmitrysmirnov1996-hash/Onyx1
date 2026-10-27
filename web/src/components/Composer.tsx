import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Icon, Modal } from './common';
import { RichText } from './Message';
import { useInView } from './common';
import { EMOJI_CATEGORIES, STICKERS, sound, imageMeta, videoMeta, audioMeta, fmtDur } from '../lib/media';
import type { Message } from '../lib/types';

export function Composer({ chatId }: { chatId: string }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const me = st.me!;
  const chat = st.chats.find((c) => c.id === chatId);
  const meRole = chat?.members?.find((m) => m.userId === me.id)?.role ?? 'member';
  const canWrite = chat?.type !== 'channel' || meRole !== 'member';

  const [text, setText] = useState('');
  const [emojiTab, setEmojiTab] = useState<'emoji' | 'stickers' | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduled, setScheduled] = useState<Message[]>([]);
  const [roundOpen, setRoundOpen] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [draftTimer, setDraftTimer] = useState<any>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  // черновик
  useEffect(() => {
    const draft = chat?.member?.draft ?? '';
    setText(draft);
    setEditingText(st.editing?.text ?? '');
    if (st.editing) st.setEditing(st.editing);
    return () => { st.sendTyping(chatId, null); };
  }, [chatId]);
  const [editingText, setEditingText] = useState('');

  useEffect(() => { setEditingText(st.editing?.text ?? ''); }, [st.editing]);

  // авторазмер: растёт как в tdesktop до historyComposeFieldMaxHeight (224px), потом скролл
  function autoSize() {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(224, el.scrollHeight) + 'px';
  }

  const send = async (extra?: { type: string; media?: any }) => {
    const payloadText = (st.editing && !extra) ? editingText : text;
    if (!payloadText.trim() && !extra?.media && !(st.editing && !extra)) return;
    if (st.editing && !extra) {
      await st.editMsg(st.editing.id, editingText);
      setText('');
      if (draftTimer) clearTimeout(draftTimer);
      st.patchChatMember(chatId, { draft: '' });
      return;
    }
    const type = extra?.type ?? 'text';
    st.sendMsg(chatId, { type, text: payloadText, media: extra?.media ?? undefined, replyTo: st.replyTo?.id });
    setText('');
    st.setReplyTo(null);
    sound('pop');
    if (draftTimer) clearTimeout(draftTimer);
    st.patchChatMember(chatId, { draft: '' });
    setTimeout(autoSize, 0);
  };

  const onInput = () => {
    autoSize();
    if (ta.current?.value.trim()) st.sendTyping(chatId, 'text');
    if (draftTimer) clearTimeout(draftTimer);
    setDraftTimer(setTimeout(() => st.patchChatMember(chatId, { draft: ta.current?.value ?? '' }), 800));
  };

  const pickFile = (accept: string, forceType?: string) => (
    <input type="file" accept={accept} hidden onChange={async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      setUploading(f.name);
      try {
        if (f.type.startsWith('image/')) {
          const { w, h } = await imageMeta(f);
          const up = await st.uploads(f, f.name, { w, h, dur: undefined as any });
          const kind = f.type === 'image/gif' ? 'gif' : 'photo';
          await send({ type: kind, media: { url: up.url, kind, w: up.w, h: up.h, name: f.name, size: f.size } });
        } else if (f.type.startsWith('video/')) {
          const m = await videoMeta(f);
          const up = await st.uploads(f, f.name, m);
          await send({ type: 'video', media: { url: up.url, w: m.w, h: m.h, dur: Math.round(m.dur), name: f.name, size: f.size } });
        } else {
          const up = await st.uploads(f, f.name, {});
          const isAudio = f.type.startsWith('audio/');
          await send({ type: isAudio ? 'audio' : 'file', media: { url: up.url, name: f.name, size: f.size } });
        }
      } catch { st.pushToast({ kind: 'error', title: 'networkError' }); }
      setUploading(null);
      setAttachOpen(false);
    }} />
  );

  const sendLocation = () => {
    navigator.geolocation?.getCurrentPosition(async (pos) => {
      await send({ type: 'location', media: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
      setAttachOpen(false);
    }, () => st.pushToast({ kind: 'error', title: 'geolocDenied' }));
  };

  const loadScheduled = async () => {
    try { const list = await (await fetch(`/api/chats/${chatId}/scheduled`, { headers: { authorization: `Bearer ${localStorage.getItem('tg_token')}` } })).json(); setScheduled(list); } catch {}
  };

  return (
    <div className="composer glass">
      {/* reply / edit bar */}
      {st.replyTo && !st.editing && (
        <div className="reply-bar">
          <div className="reply-chip-bar" />
          <div className="grow">
            <b>{st.replyTo.sender === me.id ? t('you') : (st.userById(st.replyTo.sender ?? '')?.name ?? '')}</b>
            <span className="one-line">{st.replyTo.text || t(st.replyTo.type)}</span>
          </div>
          <button className="btn-icon sm" onClick={() => st.setReplyTo(null)}><Icon name="close" size={16} /></button>
        </div>
      )}
      {st.editing && (
        <div className="reply-bar edit">
          <Icon name="edit" size={16} />
          <div className="grow">
            <b>{t('editMsg')}</b>
            <span className="one-line">{st.editing.text}</span>
          </div>
          <button className="btn-icon sm" onClick={() => st.setEditing(null)}><Icon name="close" size={16} /></button>
        </div>
      )}

      {/* Загрузка */}
      {uploading && (
        <div className="upload-toast glass"><Icon name="arrowNext" size={14} className="spin" /> {t('loading')} {uploading}</div>
      )}

      <div className="composer-main">
        {canWrite && (
          <div className="attach-wrap">
            {pickFile('image/gif', 'gif') /* hidden inputs, triggered via label wrappers */}
            <button className="btn-icon" title={t('attach')} onClick={() => setAttachOpen(!attachOpen)}>
              <Icon name="attach" size={22} className={attachOpen ? 'toggled' : ''} />
            </button>
            {attachOpen && (
              <div className="attach-menu glass pop-in">
                <label className="attach-item" >
                  <Icon name="image" size={20} /> {t('photoVid')}
                  <input type="file" accept="image/*,video/*" hidden onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setUploading(f.name);
                    try {
                      if (f.type.startsWith('image/')) {
                        const { w, h } = await imageMeta(f);
                        const up = await st.uploads(f, f.name, { w, h });
                        const kind = f.type === 'image/gif' ? 'gif' : 'photo';
                        await send({ type: kind, media: { url: up.url, w: up.w, h: up.h, name: f.name, size: f.size } });
                      } else {
                        const m = await videoMeta(f);
                        const up = await st.uploads(f, f.name, m);
                        await send({ type: 'video', media: { url: up.url, w: m.w, h: m.h, dur: Math.round(m.dur), name: f.name, size: f.size } });
                      }
                    } catch {}
                    setUploading(null); setAttachOpen(false);
                  }} />
                </label>
                <label className="attach-item"><Icon name="doc" size={20} /> {t('document')}
                  <input type="file" hidden onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setUploading(f.name);
                    try {
                      const isAudio = f.type.startsWith('audio/');
                      const up = await st.uploads(f, f.name, {});
                      await send({ type: isAudio ? 'audio' : 'file', media: { url: up.url, name: f.name, size: f.size } });
                    } catch {}
                    setUploading(null); setAttachOpen(false);
                  }} />
                </label>
                <button className="attach-item" onClick={() => { setRoundOpen(true); setAttachOpen(false); }}><Icon name="camera" size={20} /> {t('roundVideo')}</button>
                <button className="attach-item" onClick={() => { st.openModal('poll-create', { chatId }); setAttachOpen(false); }}><Icon name="poll" size={20} /> {t('poll')}</button>
                <button className="attach-item" onClick={sendLocation}><Icon name="location" size={20} /> {t('locationMsg')}</button>
                <button className="attach-item" onClick={() => { setScheduleOpen(true); setAttachOpen(false); loadScheduled(); }}><Icon name="clock" size={20} /> {t('scheduleMsg')}</button>
              </div>
            )}
          </div>
        )}

        <button className="btn-icon" onClick={() => setEmojiTab(emojiTab === null ? 'emoji' : null)}><Icon name="emoji" size={22} className={emojiTab ? 'toggled' : ''} /></button>

        <textarea
          ref={ta} rows={1} dir="auto" maxLength={4096}
          value={st.editing ? editingText : text}
          onChange={(e) => { st.editing ? setEditingText(e.target.value) : setText(e.target.value); onInput(); }}
          onPaste={async (e) => {
            const f = e.clipboardData.files?.[0];
            if (f && f.type.startsWith('image/')) {
              e.preventDefault();
              const { w, h } = await imageMeta(f);
              const up = await st.uploads(f, f.name || 'paste.png', { w, h });
              await send({ type: 'photo', media: { url: up.url, w: up.w, h: up.h, name: f.name || 'image.png', size: f.size } });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 900) {
              e.preventDefault();
              send();
            } else if (e.key === 'Escape') { st.setEditing(null); st.setReplyTo(null); }
          }}
          placeholder={st.editing ? t('editMsg') : t('newMessage')}
        />

        {canWrite && (
          <>
            <button className="btn-icon" title={t('roundVideo')} onClick={() => setRoundOpen(true)}><Icon name="camera" size={21} /></button>
            <VoiceButton chatId={chatId} onSent={() => setText('')} />
          </>
        )}
        {((st.editing ? editingText.trim() : text.trim())) && (
          <button className="btn-icon send-ico" title={st.editing ? t('save') : undefined} onClick={() => send()}>
            <Icon name="send" size={22} fill />
          </button>
        )}
      </div>

      {/* Эмодзи/стикеры */}
      {emojiTab && (
        <EmojiPlusStickers
          tab={emojiTab} setTab={setEmojiTab}
          onEmoji={(e) => { const el = st.editing ? editingText + e : text + e; st.editing ? setEditingText(el) : setText(el); setTimeout(autoSize, 0); }}
          onSticker={(e) => { st.sendMsg(chatId, { type: 'sticker', text: e, media: { emoji: e } }); setEmojiTab(null); }}
        />
      )}

      {/* Отложенные */}
      {scheduleOpen && (
        <Modal title={t('scheduleMsg')} onClose={() => setScheduleOpen(false)} width={380}>
          <input type="datetime-local" className="inp" value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)} />
          <button className="btn primary" disabled={!scheduleAt}
            onClick={() => {
              const at = new Date(scheduleAt).getTime();
              st.sendMsg(chatId, { type: 'text', text, scheduleAt: at });
              setText(''); setScheduleOpen(false); setScheduleAt('');
            }}>{t('send')}</button>
          <div className="small dim" style={{ marginTop: 8 }}>
            <RichText text={t('msgFormatHint')} t={(k) => t(k)} />
          </div>
          {scheduled.length > 0 && (
            <>
              <div className="rp-section-title">{t('scheduled')} ({scheduled.length})</div>
              {scheduled.map((s) => (
                <div key={s.id} className="sched-row">
                  <span className="mono small">{new Date(s.sendAt!).toLocaleString()}</span>
                  <span className="grow one-line small">{s.text}</span>
                  <button className="btn-icon sm" onClick={async () => { await st.deleteMsg(s.id, true); setScheduled(scheduled.filter((x) => x.id !== s.id)); }}>
                    <Icon name="trash" size={15} className="danger" />
                  </button>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}

      {roundOpen && <RoundRecorder chatId={chatId} text={text} onClose={() => setRoundOpen(false)} onSent={() => setText('')} />}
    </div>
  );
}

/* ================= эмодзи + стикеры ================= */
function EmojiPlusStickers({ tab, setTab, onEmoji, onSticker }: {
  tab: 'emoji' | 'stickers'; setTab: (v: 'emoji' | 'stickers' | null) => void;
  onEmoji: (e: string) => void; onSticker: (e: string) => void;
}) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [cat, setCat] = useState(0);
  return (
    <div className="emoji-panel glass pop-in">
      <div className="emoji-tabs">
        <button className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>😀 {t('emoji') ?? 'Эмодзи'}</button>
        <button className={tab === 'stickers' ? 'on' : ''} onClick={() => setTab('stickers')}>🎟 {t('sticker')}</button>
        <button className="btn-icon sm push-end" onClick={() => setTab(null)}><Icon name="close" size={15} /></button>
      </div>
      {tab === 'emoji' ? (
        <>
          <div className="emoji-cats">
            {EMOJI_CATEGORIES.map((c, i) => (
              <button key={i} className={cat === i ? 'on' : ''} onClick={() => setCat(i)}>{c.icon}</button>
            ))}
          </div>
          <div className="emoji-grid">
            {EMOJI_CATEGORIES[cat].emojis.map((e, i) => <button key={i} onClick={() => onEmoji(e)}>{e}</button>)}
          </div>
        </>
      ) : (
        <div className="emoji-grid stickers">
          {STICKERS.map((e, i) => <button key={i} className="sticker-btn" onClick={() => onSticker(e)}>{e}</button>)}
        </div>
      )}
    </div>
  );
}

/* ================= голосовое сообщение ================= */
function VoiceButton({ chatId, onSent }: { chatId: string; onSent: () => void }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [recState, setRecState] = useState<null | { rec: MediaRecorder; chunks: Blob[]; startedAt: number; stream: MediaStream }>(null);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const durRef = useRef(0);
  const pausedAtRef = useRef(0);
  const totalPausedRef = useRef(0);
  const waveRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<{ analyser: AudioAnalyserLike } | null>(null);
  const waveformCache = useRef<number[]>([]);

  useEffect(() => {
    if (!recState) return;
    const iv = setInterval(() => {
      if (!paused) {
        const d = (Date.now() - recState.startedAt - totalPausedRef.current) / 1000;
        durRef.current = d;
        setDuration(d);
      }
    }, 200);
    return () => clearInterval(iv);
  }, [recState, paused]);

  const pickMime = () => {
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (MediaRecorder.isTypeSupported?.(m)) return m;
    }
    return '';
  };

  const start = async () => {
    try {
      st.sendTyping(chatId, 'voice');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.start(250);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      setRecState({ rec, chunks, startedAt: Date.now(), stream });
      analyserRef.current = { analyser: an };
      waveformCache.current = [];
    } catch {
      st.pushToast({ kind: 'error', title: 'error', text: '🎤' });
    }
  };

  const stop = async (discard?: boolean) => {
    st.sendTyping(chatId, null);
    const r = recState;
    if (!r) return;
    const finalDur = Math.max(durRef.current, 0);
    const wave = waveformCache.current.filter((_, i) => i % Math.ceil(1) === 0).slice(-160);
    r.rec.onstop = async () => {
      r.stream.getTracks().forEach((tr) => tr.stop());
      analyserRef.current = null;
      setRecState(null); setDuration(0); setPaused(false);
      durRef.current = 0; pausedAtRef.current = 0; totalPausedRef.current = 0;
      if (discard || finalDur < 0.7) return;
      const blob = new Blob(r.chunks, { type: r.chunks[0]?.type || 'audio/webm' });
      try {
        const up = await st.uploads(blob, 'voice.webm', { dur: Math.round(finalDur) });
        await st.sendMsg(chatId, { type: 'voice', text: '', media: { kind: 'voice', url: up.url, dur: finalDur, size: blob.size, waveform: wave } });
        onSent();
      } catch { st.pushToast({ kind: 'error', title: 'networkError' }); }
    };
    r.rec.stop();
  };

  // отрисовка волны в реальном времени
  useEffect(() => {
    if (!analyserRef.current || !waveRef.current || !recState) return;
    const an = analyserRef.current.analyser;
    const data = new Uint8Array(an.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      if (!paused) {
        an.getByteFrequencyData(data as any);
        let sum = 0;
        for (let i = 0; i < 40; i++) sum += data[i];
        const v = Math.min(1, (sum / (40 * 255)) * 2.4);
        waveformCache.current.push(v);
        if (waveformCache.current.length > 1800) waveformCache.current.splice(0, 600);
      }
      const el = waveRef.current!;
      el.innerHTML = '';
      const bars = waveformCache.current.slice(-64);
      for (const h of bars) {
        const i = document.createElement('i');
        i.style.height = Math.max(10, h * 100) + '%';
        el.appendChild(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recState, paused]);

  if (!recState) {
    return <button className="btn-icon mic-btn" title={t('recordVoice')} onClick={() => start()}>
      <Icon name="mic" size={21} />
    </button>;
  }

  return (
    <div className="voice-recording" onClick={(e) => e.stopPropagation()}>
      <div className="live-wave" ref={waveRef} />
      <span className="mono rec-dur">{paused ? '⏸' : '●'} {fmtDur(duration)}</span>
      <button className="btn-icon sm" title={paused ? t('resumeRecord') : t('pauseRecord')} onClick={() => {
        if (paused) {
          totalPausedRef.current += Date.now() - pausedAtRef.current;
          recState.rec.resume();
          setPaused(false);
        } else {
          pausedAtRef.current = Date.now();
          recState.rec.pause();
          setPaused(true);
        }
      }}>{paused ? <Icon name="play" size={16} fill /> : <Icon name="pause" size={16} />}</button>
      <button className="btn-icon sm" title={t('cancelVoice')} onClick={() => stop(true)}><Icon name="trash" size={17} className="danger" /></button>
      <button className="btn primary sm" onClick={() => stop(false)}><Icon name="send" size={15} /> {t('sendVoice')}</button>
    </div>
  );
}

interface AudioAnalyserLike { frequencyBinCount: number; getByteFrequencyData(arr: Uint8Array): void }

/* ================= круглый видеорепорт ================= */
function RoundRecorder({ chatId, text, onClose, onSent }: { chatId: string; text: string; onClose: () => void; onSent?: () => void }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [dur, setDur] = useState(0);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState('');

  const open = async (facingMode = facing) => {
    try {
      streamRef.current?.getTracks().forEach((x) => x.stop());
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 480 }, height: { ideal: 480 } }, audio: true });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play().catch(() => {});
      }
    } catch {
      setErr('📷 ' + t('error'));
    }
  };

  useEffect(() => { open(); return () => { streamRef.current?.getTracks().forEach((x) => x.stop()); }; }, [facing]);

  const start = () => {
    const mime = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
    const r = new MediaRecorder(streamRef.current!, { mimeType: mime || undefined, videoBitsPerSecond: 1_200_000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      const b = new Blob(chunks, { type: mime || 'video/webm' });
      videoMeta(b).then((m) => { setDur(Math.min(m.dur, 90)); setUrl(URL.createObjectURL(b)); });
      setBlob(b);
    };
    r.start(300);
    recRef.current = r;
    setRecording(true);
  };

  const stop = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  const send = async () => {
    if (!blob) return;
    setBusy(true);
    try {
      const meta = await videoMeta(blob);
      const up = await st.uploads(blob, `round.${(blob.type.split('/')[1] ?? 'webm').split(';')[0]}`, { w: meta.w, h: meta.h, dur: Math.round(meta.dur) });
      await st.sendMsg(chatId, { type: 'round', text, media: { url: up.url, dur: Math.round(meta.dur), w: up.w, h: up.h, size: blob.size } });
      onSent?.();
      onClose();
    } catch { st.pushToast({ kind: 'error', title: 'networkError' }); }
    setBusy(false);
  };

  return (
    <Modal title={t('roundVideo')} onClose={onClose} width={380} className="round-modal">
      {err && <div className="auth-error">{err}</div>}
      <div className="round-preview">
        {blob ? (
          <video src={url} loop autoPlay muted playsInline className="round-video" />
        ) : (
          <video ref={videoRef} muted playsInline className="round-video" style={{ transform: facing === 'user' ? 'none' : 'none' }} />
        )}
        {recording && <div className="rec-dot">● {fmtDur(dur)}</div>}
      </div>
      <div className="round-actions">
        {!blob && (
          <>
            <button className="btn-icon" title={t('flipCamera')} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}><Icon name="flip" size={20} /></button>
            <button className={`big-red ${recording ? 'rec' : ''}`} onClick={() => recording ? stop() : start()}>
              {recording ? <Icon name="pause" size={22} fill /> : <Icon name="camera" size={22} />}
            </button>
            <div style={{ width: 40 }} />
          </>
        )}
        {blob && (
          <>
            <button className="btn sec" onClick={() => { setBlob(null); setUrl(''); if (recRef.current) recRef.current = null; }}><Icon name="back" size={16} /> {t('retake')}</button>
            <button className="btn primary" disabled={busy} onClick={send}>{busy ? t('loading') : t('sendRound')}</button>
          </>
        )}
      </div>
    </Modal>
  );
}
