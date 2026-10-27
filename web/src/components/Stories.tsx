import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Modal, Avatar, Icon } from './common';
import { cropToBlob, imageMeta, type CropState } from '../lib/media';
import { api } from '../lib/api';
import { sound } from '../lib/media';

/* ============ Публикация истории ============ */
export function StoryPublish() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'photo' | 'video' | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const choose = async (f: File) => {
    setFile(f);
    const isVid = f.type.startsWith('video/');
    setKind(isVid ? 'video' : 'photo');
    setPreviewUrl(URL.createObjectURL(f));
    if (!isVid) {
      const i = new Image();
      i.src = URL.createObjectURL(f);
      i.onload = () => setImg(i);
    }
  };

  const reset = () => { setFile(null); setKind(null); setPreviewUrl(''); setImg(null); setCaption(''); setCrop({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 }); };
  const save = async () => {
    if (!file || !kind) return;
    setBusy(true);
    try {
      let blob: Blob = file;
      if (kind === 'photo' && img) {
        blob = await cropToBlob(img, 9 / 16, crop, 1080, 'image/jpeg');
      }
      const up = await st.uploads(blob, kind === 'video' ? 'story.mp4' : 'story.jpg', kind === 'video' ? {} : {});
      await st.postStory(kind === 'photo' ? (file.type === 'image/gif' ? 'gif' : 'photo') : 'video', up.url, caption);
      st.pushToast({ kind: 'ok', title: 'saved' });
      reset();
      st.closeModal();
    } catch { st.pushToast({ kind: 'error', title: 'networkError' }); }
    setBusy(false);
  };

  const move = (e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    setCrop((c) => ({ ...c, offsetX: c.offsetX - e.movementX, offsetY: c.offsetY - e.movementY }));
  };

  return (
    <Modal title={t('publishStory')} onClose={() => { st.closeModal(); reset(); }} width={430} className="story-publish">
      {!file ? (
        <div className="story-pick">
          <label className="btn primary big"><Icon name="image" size={22} /> {t('storyPhoto')}
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); }} />
          </label>
          <label className="btn sec big"><Icon name="video" size={22} /> {t('storyVideo')}
            <input type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); }} />
          </label>
          <div className="small dim">{t('wpUpload')} · до 100 МБ</div>
        </div>
      ) : (
        <>
          <div className="story-canvas" onMouseMove={move} onMouseDown={() => {}}>
            <div className="story-crop" style={{ background: '#000', overflow: 'hidden' }}>
              {kind === 'photo' && img && (
                <div style={{ transform: `translate(${crop.offsetX}px, ${crop.offsetY}px) rotate(${crop.rotation}deg)` }}>
                  <img src={previewUrl} style={{ maxHeight: 420 }} draggable={false} />
                </div>
              )}
              {kind === 'video' && <video src={previewUrl} autoPlay loop muted playsInline style={{ maxHeight: 420 }} />}
            </div>
          </div>
          {kind === 'photo' && (
            <div className="row-between">
              <button className="btn-icon" onClick={() => setCrop((c) => ({ ...c, rotation: c.rotation - 90 }))}><Icon name="flip" size={18} /></button>
              <input type="range" className="slider" style={{ flex: 1 }} min={1} max={3} step={0.02} value={crop.zoom}
                onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))} />
            </div>
          )}
          <input className="inp" placeholder={t('storyCaption')} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={140} />
          <div className="row-between">
            <button className="btn sec" onClick={reset}>{t('cancel')}</button>
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? t('loading') : t('share')}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ============ Просмотр историй ============ */
export function StoryViewer({ userId, startId }: { userId: string; startId?: string }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const user = st.userById(userId);
  const own = userId === st.me?.id;

  const [stories, setStories] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewers, setViewers] = useState<any[] | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    api.userStories(userId).then((list) => {
      const active = list.filter((s: any) => !s.archived || own);
      setStories(active);
      setIdx(active.findIndex((s: any) => s.id === startId) >= 0 ? active.findIndex((s: any) => s.id === startId) : 0);
    });
  }, [userId]);

  const cur: any | null = stories[idx] ?? null;

  // прогресс + автопереход
  useEffect(() => {
    if (!cur) return;
    setProgress(0);
    setViewers(null);
    let raf = 0;
    const dur = cur.kind === 'video' ? 15000 : 6000;
    const t0 = performance.now();
    let elapsedPause = 0;
    let pauseStart = 0;
    const tick = (now: number) => {
      if (paused || document.hidden) {
        if (!pauseStart) pauseStart = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      if (pauseStart) { elapsedPause += now - pauseStart; pauseStart = 0; }
      const p = Math.min(1, (now - t0 - elapsedPause) / dur);
      setProgress(p);
      if (p >= 1) { next(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cur?.id, paused]);

  useEffect(() => {
    if (cur && !own && !cur.viewed) {
      api.viewStory(cur.id).then(() => {
        cur.viewed = true;
        st.refreshStories();
      });
    }
  }, [cur?.id]);

  if (!cur) return (
    <Modal title={t('stories')} onClose={st.closeModal} width={360}>
      <div className="empty-list">{t('noStories')}</div>
    </Modal>
  );
  void user;

  const next = () => {
    if (idx < stories.length - 1) setIdx(idx + 1);
    else st.closeModal();
  };
  const prev = () => { if (idx > 0) setIdx(idx - 1); };

  return (
    <div className="story-overlay" onClick={st.closeModal}>
      <div className="story-stage" onClick={(e) => e.stopPropagation()}>
        <div className="story-progress">
          {stories.map((s, i) => (
            <div key={s.id} className="story-progress-track">
              <div className="story-progress-fill" style={{ width: i < idx ? '100%' : i === idx ? `${progress * 100}%` : '0%' }} />
            </div>
          ))}
        </div>
        <div className="story-head">
          <Avatar user={st.userById(cur.userId)} size={36} />
          <b>{own ? t('you') : (st.userById(cur.userId)?.name ?? '')}</b>
          <span className="dim small">{new Date(cur.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button className={`btn-icon ${paused ? 'toggled' : ''}`} onClick={() => setPaused(!paused)}>
            <Icon name={paused ? 'play' : 'pause'} size={16} fill />
          </button>
          {own && (
            <>
              <button className="btn-icon" title={t('viewers')} onClick={() => api.storyViews(cur.id).then(setViewers)}><Icon name="eye" size={17} /></button>
              <button className="btn-icon" title={t('pinStory')} onClick={async () => { await api.pinStory(cur.id); st.refreshStories(); }}><Icon name="pin" size={16} /></button>
              <button className="btn-icon" title={t('archive')} onClick={async () => { await api.archiveStory(cur.id); st.refreshStories(); st.closeModal(); }}><Icon name="archive" size={16} /></button>
              <button className="btn-icon" title={t('deleteStory')} onClick={async () => { await st.deleteStory(cur.id); st.closeModal(); }}><Icon name="trash" size={16} className="danger" /></button>
            </>
          )}
          <button className="btn-icon push-end" onClick={st.closeModal}><Icon name="close" size={20} /></button>
        </div>
        <button className="story-nav left" onClick={prev}><Icon name="back" size={24} /></button>
        <div className="story-media">
          {cur.kind === 'video' ? (
            <video src={cur.url} autoPlay loop muted playsInline />
          ) : (
            <img src={cur.url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />
          )}
          {cur.caption && <div className="story-caption">{cur.caption}</div>}
        </div>
        <button className="story-nav right" onClick={next}><Icon name="arrowNext" size={24} /></button>

        {!own && (
          <div className="story-reactions" onClick={(e) => e.stopPropagation()}>
            {['❤️', '🔥', '😂', '😮', '👏'].map((e) => (
              <button key={e} className={cur.reaction === e ? 'on' : ''} onClick={async () => {
                await api.viewStory(cur.id, e);
                cur.reaction = e;
                st.refreshStories();
                sound('pop');
              }}>{e}</button>
            ))}
            <button className="btn sec sm" onClick={() => {
              st.createChat('private', [cur.userId]).then((chat) => {
                st.openChat(chat.id);
                st.closeModal();
                st.setReplyTo({ ...( { id: -1, chatId: chat.id, type: 'text', text: '', sender: null } as any), text: `↩ ${t('replyToStory')}: «${cur.caption || (cur.kind === 'video' ? 'видео' : 'фото')}»` } as any);
              });
            }}>↩ {t('replyToStory')}</button>
          </div>
        )}

        {viewers && (
          <div className="story-viewers glass" onClick={(e) => e.stopPropagation()}>
            <b>{t('viewedBy')} — {viewers.length}</b>
            <div className="story-viewers-list">
              {viewers.map((v) => (
                <div key={v.userId} className="story-viewer-row">
                  <Avatar user={{ id: v.userId, name: v.name, username: v.username, avatar: null } as any} size={30} />
                  <span className="grow">{v.name}</span>
                  <span>{v.reaction ?? ''}</span>
                </div>
              ))}
              {!viewers.length && <div className="small dim">—</div>}
            </div>
            <button className="btn sec sm" onClick={() => setViewers(null)}>{t('close')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ Архив историй ============ */
export function StoryArchive() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { api.myArchive().then(setList); }, []);
  return (
    <Modal title={`${t('archive')} — ${t('stories')}`} onClose={() => st.closeModal()} width={520}>
      <div className="archive-grid">
        {list.map((s) => (
          <div key={s.id} className="archive-tile">
            {s.kind === 'video' ? <video src={s.url} muted loop playsInline /> : <img src={s.url} />}
            <div className="archive-meta">
              <span className="small">{new Date(s.createdAt).toLocaleDateString()}</span>
              <div className="row-icons">
                <button className="btn-icon sm" title={s.pinned ? t('unpinStory') : t('pinStory')} onClick={async () => { await api.pinStory(s.id); setList(await api.myArchive()); }}>
                  <Icon name="pin" size={14} />
                </button>
                <button className="btn-icon sm" title={s.archived ? t('stories') : t('unarchive') || t('archive')} onClick={async () => { await api.archiveStory(s.id); setList(await api.myArchive()); }}>
                  <Icon name="archive" size={14} />
                </button>
                <button className="btn-icon sm" title={t('deleteStory')} onClick={async () => { await st.deleteStory(s.id); setList(await api.myArchive()); }}>
                  <Icon name="trash" size={14} className="danger" />
                </button>
              </div>
            </div>
            {s.pinned && <span className="pin-flag"><Icon name="pin" size={12} /></span>}
          </div>
        ))}
        {!list.length && <div className="empty-list">{t('noStories')}</div>}
      </div>
    </Modal>
  );
}
