import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useStore } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Modal, Slider, Toggle, Icon } from './common';
import { GRADIENT_PRESETS, patternURI, effectiveDark } from '../lib/theme';
import { imageMeta, videoMeta } from '../lib/media';
import type { Wallpaper } from '../lib/types';

/* ============ Слой фона чата (в ChatView) ============ */
export function WallpaperLayer({ chatId }: { chatId: string }) {
  const st = useStore();
  const dark = effectiveDark(st.me!.settings);
  const chat = st.chats.find((c) => c.id === chatId);
  const wp: Wallpaper | null =
    chat?.member?.wallpaper || chat?.wallpaper || st.me!.settings.wallpaper || null;
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const onMove = (e: React.MouseEvent) => {
    if (!wp?.parallax) return;
    const nx = (e.clientX / window.innerWidth - 0.5) * 2;
    const ny = (e.clientY / window.innerHeight - 0.5) * 2;
    setParallax({ x: nx * (wp.parallax ?? 0), y: ny * (wp.parallax ?? 0) });
  };

  const uri = useMemo(() => patternURI(dark), [dark]);

  /* явный «Узор» — прежнее поведение с объектами */
  if (wp?.mode === 'pattern') {
    return <div className="wallpaper" style={{ backgroundImage: uri, backgroundSize: '420px', transition: 'background .3s' }} />;
  }
  /* дефолт (обои не выбраны или пустой объект) — ровный тёмный фон БЕЗ объектов */
  if (!wp || (!wp.url && !wp.gradient)) {
    return <div className="wallpaper" style={{ background: dark ? 'linear-gradient(180deg,#17212b,#0e1621)' : 'linear-gradient(180deg,#ffffff,#e8edf1)', transition: 'background .3s' }} />;
  }

  const filter = `brightness(${wp.brightness ?? 100}%) blur(${wp.blur ?? 0}px) saturate(${wp.saturate ?? 100}%)`;
  const transform = `scale(${(wp.zoom ?? 100) / 100}) translate(${parallax.x}px, ${parallax.y}px)`;
  const pos = { center: '50% 50%', top: '50% 0%', bottom: '50% 100%', left: '0% 50%', right: '100% 50%' } as any;
  const isVideo = wp.kind === 'video' && wp.url;

  return (
    <div className="wallpaper" onMouseMove={onMove}>
      {wp.mode === 'gradient' && wp.gradient ? (
        <div className={`wp-gradient ${wp.gradientAnim ? 'anim' : ''}`} style={{ background: wp.gradient, animationDuration: wp.gradientAnim ? `${80 / (wp.speed ?? 1)}s` : undefined }} />
      ) : (
        <>
          {isVideo ? (
            <WallpaperVideo url={wp.url!} style={{ objectPosition: pos[wp.position ?? 'center'], transform }} filter={filter} />
          ) : wp.fill === 'tile' && wp.url ? (
            <div className="wp-media" aria-hidden
              style={{ backgroundImage: `url(${wp.url})`, backgroundRepeat: 'repeat', backgroundSize: 'auto', backgroundPosition: pos[wp.position ?? 'center'], transform, filter }} />
          ) : (
            <img src={wp.url} alt="" className="wp-media" draggable={false}
              style={{ objectFit: wp.fill === 'contain' ? 'contain' : 'cover', objectPosition: pos[wp.position ?? 'center'], transform, filter }} />
          )}
        </>
      )}
      <div className="wp-overlay" style={{ background: `rgba(0,0,0,${(wp.overlay ?? 0) / 100})` }} />
    </div>
  );
}

function WallpaperVideo({ url, style, filter }: { url: string; style: React.CSSProperties; filter: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const st = useStore();
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.play().catch(() => {});
    const onVis = () => {
      if (document.hidden) v.pause();
      else v.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [url]);

  // эконом-режим из настроек пользователя: снижаем fps через скорость
  void st;
  return (
    <video ref={ref} src={url} autoPlay loop muted playsInline
      className="wp-media wp-video" style={{ ...style, filter, transformOrigin: 'center' }}
      onError={() => {}} />
  );
}

/* ============ Редактор обоев (модалка) ============ */
const WP_EMPTY: Wallpaper = { mode: 'pattern' };

export default function WallpaperEditor({ chatId }: { chatId: string }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const chat = chatId ? st.chats.find((c) => c.id === chatId) : null;
  const [wp, setWp] = useState<Wallpaper>(() =>
    JSON.parse(JSON.stringify(chat?.member?.wallpaper || chat?.wallpaper || st.me!.settings.wallpaper || WP_EMPTY)));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'presets' | 'media' | 'adjust'>('presets');
  const wpRef = useRef(wp);
  wpRef.current = wp;
  const debounce = useRef<any>(null);
  useEffect(() => () => clearTimeout(debounce.current), []);

  /* Мгновенное применение выбранного фона — тг меняет фон сразу, без кнопки «сохранить» */
  const persist = async (w: Wallpaper) => {
    const value = (w.mode === 'pattern' || (!w.url && !w.gradient)) ? null : w;
    try {
      if (chatId) await st.patchChatMember(chatId, { wallpaper: value });
      else await st.patchSettings({ wallpaper: value } as any);
    } catch { st.pushToast({ kind: 'error', title: 'networkError' }); }
  };
  const applyNow = (patch: Partial<Wallpaper>) => {
    const next = { ...wpRef.current, ...patch };
    setWp(next);
    void persist(next);
  };
  const applySoon = (patch: Partial<Wallpaper>) => {
    const next = { ...wpRef.current, ...patch };
    setWp(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void persist(next), 450);
  };

  const upload = async (kind: 'photo' | 'video', file: File) => {
    setBusy(true);
    try {
      let meta: any = {};
      if (kind === 'photo') meta = await imageMeta(file);
      else meta = await videoMeta(file);
      const up = await st.uploads(file, file.name, meta);
      applyNow({ mode: 'media', url: up.url, kind: kind === 'photo' ? (file.type === 'image/gif' ? 'gif' : 'photo') : 'video', loop: true, muted: true });
      setTab('adjust');
    } catch {
      st.pushToast({ kind: 'error', title: 'networkError' });
    }
    setBusy(false);
  };

  return (
    <Modal title={`${t('wallpapers')}${chat ? ` — ${st.chatTitle(chat)}` : ''}`} onClose={() => st.closeModal()} width={560}>
      {/* Превью */}
      <div className="wp-preview">
        {wp.mode === 'pattern' || (!wp.url && !wp.gradient) ? (
          <div style={{ position: 'absolute', inset: 0, background: effectiveDark(st.me!.settings) ? 'linear-gradient(180deg,#17212b,#0e1621)' : 'linear-gradient(180deg,#ffffff,#e8edf1)' }} />
        ) : wp.mode === 'gradient' && wp.gradient ? (
          <div className={`wp-gradient ${wp.gradientAnim ? 'anim' : ''}`} style={{ background: wp.gradient, animationDuration: wp.gradientAnim ? `${80 / (wp.speed ?? 1)}s` : undefined }} />
        ) : wp.kind === 'video' ? (
          <video src={wp.url} autoPlay loop muted playsInline className="wp-media" style={{ filter: `brightness(${wp.brightness ?? 100}%) blur(${wp.blur ?? 0}px) saturate(${wp.saturate ?? 100}%)`, transform: `scale(${(wp.zoom ?? 100) / 100})`, objectPosition: 'center' }} />
        ) : (
          <img src={wp.url} className="wp-media" style={{ filter: `brightness(${wp.brightness ?? 100}%) blur(${wp.blur ?? 0}px) saturate(${wp.saturate ?? 100}%)`, transform: `scale(${(wp.zoom ?? 100) / 100})`, objectFit: 'cover' }} />
        )}
        <div className="wp-overlay" style={{ background: `rgba(0,0,0,${(wp.overlay ?? 0) / 100})` }} />
        <div className="wp-sample-bubbles">
          <div className="wp-sample-bubble in">Hi! 👋</div>
          <div className="wp-sample-bubble out">Hello there! This is a preview</div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'presets' ? 'on' : ''} onClick={() => setTab('presets')}>{t('wpPresets')}</button>
        <button className={tab === 'media' ? 'on' : ''} onClick={() => setTab('media')}>{t('wpUpload')}</button>
        <button className={tab === 'adjust' ? 'on' : ''} onClick={() => setTab('adjust')}>{t('edit')}</button>
      </div>

      {tab === 'presets' && (
        <>
          <div className="wp-grid">
            <button className={`wp-tile pattern ${wp.mode === 'pattern' ? 'sel' : ''}`} onClick={() => applyNow({ mode: 'pattern', url: undefined, gradient: undefined, gradientAnim: false })}>
              <span>{t('wpPattern')}</span>
            </button>
            {GRADIENT_PRESETS.map((g) => (
              <button key={g.id} className={`wp-tile ${wp.mode === 'gradient' && wp.gradient === g.css ? 'sel' : ''}`}
                style={{ background: g.css }}
                onClick={() => applyNow({ mode: 'gradient', gradient: g.css, url: undefined, gradientAnim: false })} />
            ))}
          </div>
          <div className="row-between" style={{ marginTop: 8 }}>
            <span>{t('gradientAnim')}</span>
            <Toggle value={!!wp.gradientAnim} onChange={(v) => applySoon({ gradientAnim: v })} />
          </div>
          {wp.gradientAnim && (
            <Slider label={t('speed')} value={wp.speed ?? 1} min={0.3} max={3} step={0.1} onChange={(v) => applySoon({ speed: v })} />
          )}
        </>
      )}

      {tab === 'media' && (
        <div className="wp-upload-row">
          {busy ? <div>{t('loading')}</div> : (
            <>
              <label className="btn sec"><Icon name="image" size={17} /> {t('wpMedia')}
                <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload('photo', f); }} />
              </label>
              <label className="btn sec"><Icon name="video" size={17} /> {t('wpVideo')}
                <input type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload('video', f); }} />
              </label>
              {wp.url && (
                <button className="btn sec" onClick={() => applyNow({ url: undefined, kind: undefined, mode: 'pattern' })}><Icon name="close" size={16} /> {t('removeBgMedia')}</button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'adjust' && (wp.url || wp.gradient) && (
        <div className="wp-adjust">
          <Slider label={t('brightness')} value={wp.brightness ?? 100} min={20} max={160} onChange={(v) => applySoon({ brightness: v })} />
          <Slider label={t('blurLabel')} value={wp.blur ?? 0} min={0} max={40} onChange={(v) => applySoon({ blur: v })} />
          <Slider label={t('saturation')} value={wp.saturate ?? 100} min={0} max={200} onChange={(v) => applySoon({ saturate: v })} />
          <Slider label={t('darken')} value={wp.overlay ?? 0} min={0} max={90} onChange={(v) => applySoon({ overlay: v })} />
          {wp.url && (
            <>
              <Slider label={t('zoomLabel')} value={wp.zoom ?? 100} min={100} max={300} onChange={(v) => applySoon({ zoom: v })} />
              <div className="row-between"><span>{t('position')}</span>
                <div className="pos-picker">
                  {(['top', 'center', 'bottom'] as const).map((p) => (
                    <button key={p} className={wp.position === p ? 'on' : ''} onClick={() => applySoon({ position: p })}>{p === 'top' ? '↑' : p === 'center' ? '•' : '↓'}</button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="row-between">
            <span>{t('parallax')}</span>
            <Toggle value={!!wp.parallax} onChange={(v) => applySoon({ parallax: v ? 12 : 0 })} />
          </div>
          {!!wp.parallax && (
            <Slider label={t('parallaxStrength')} value={wp.parallax} min={4} max={30} onChange={(v) => applySoon({ parallax: v })} />
          )}
        </div>
      )}

      {chatId && chat?.member?.wallpaper && (
        <div className="wp-override-note">{t('wpOverrideNote')}</div>
      )}
      <div className="modal-foot row-between">
        <div className="row-gap">
          <button className="btn sec" onClick={() => applyNow({ ...WP_EMPTY })}>{t('resetBg')}</button>
          {chatId && (
            <button className="btn sec" onClick={() => {
              const value = (wpRef.current.mode === 'pattern' || (!wpRef.current.url && !wpRef.current.gradient)) ? null : wpRef.current;
              if (chatId) st.patchChatMember(chatId, { wallpaper: null });
              void st.patchSettings({ wallpaper: value } as any);
            }}>{t('wpGlobal')}</button>
          )}
        </div>
        <button className="btn" onClick={st.closeModal}>{t('done') || 'Готово'}</button>
      </div>
    </Modal>
  );
}
