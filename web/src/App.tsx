import React, { useEffect, useState } from 'react';
import { useStore, getSocket } from './lib/store';
import { tFor, useTLang } from './lib/i18n';
import { applyTheme, effectiveDark } from './lib/theme';
import { Toasts, Icon } from './components/common';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import { MobileNav, MobileFab } from './components/Sidebar';
import ChatView from './components/ChatView';
import CallOverlay, { callManager, RateCall } from './components/CallOverlay';
import { PasscodeGuard } from './components/Passcode';
import { OnyxMark } from './components/common';
import { SettingsModal } from './components/Settings';
import { ProfileEdit, AvatarEditor, CoverEditor, ProfilePreview, InfoSheet } from './components/ProfileEdit';
import WallpaperEditor from './components/Wallpaper';
import { StoryPublish, StoryViewer, StoryArchive } from './components/Stories';
import {
  UserPicker, ForwardModal, MainMenu, UserCard, AvatarView, PollCreate,
  EditHistory, ChatEdit, ChatAvatarEditor, CallHistory, MediaViewer,
} from './components/Modals';
import { sound } from './lib/media';

// «Позвонить» из UI: старт ровно один раз при открытии модалки, затем модалка закрывается.
// Раньше start() запускался прямо в renderModal на КАЖДОМ рендере — из-за этого страница
// замирала (бесконечный цикл рендеров с повторными вызовами start) и звонок было не завершить.
function CallDial({ peerId, kind }: { peerId?: string; kind?: 'voice' | 'video' }) {
  const st = useStore();
  const once = React.useRef(false);
  React.useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (peerId) callManager.start(peerId, kind ?? 'voice');
    st.closeModal();
  }, []);
  return null;
}

export default function App() {
  const st = useStore();
  const lang = (st.me?.settings?.language === 'en' ? 'en' : 'ru') as any;
  const t = tFor(lang);
  const [joinPendingId, setJoinPendingId] = useState<string | null>(null);

  useEffect(() => {
    const hash = location.hash;
    const m = hash.match(/#\/join\/([a-f0-9]+)/);
    if (m) setJoinPendingId(m[1]);
    st.boot();
  }, []);

  // тема
  useEffect(() => {
    if (st.me?.settings) {
      applyTheme(st.me.settings);
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const h = () => applyTheme(useStore.getState().me!.settings);
      mq.addEventListener?.('change', h);
      return () => mq.removeEventListener?.('change', h);
    }
  }, [st.me?.settings?.theme, st.me?.settings?.accent, st.me?.settings?.colors?.bg, st.me?.settings?.uiScale, st.me?.settings?.fontSize, st.me?.settings?.bubbleRadius, st.me?.id, st.me?.settings?.animations]);

  // соединение с call manager + joining link
  useEffect(() => {
    if (st.authed) {
      getSocket();
      if (joinPendingId) {
        st.joinByLink(joinPendingId).then(() => {
          setJoinPendingId(null);
          history.replaceState(null, '', location.pathname);
        });
      }
    }
  }, [st.authed, joinPendingId]);

  // звук входящего звонка CSS-loop
  const modal = st.modals[st.modals.length - 1];

  if (st.booting) return <div className="splash"><div className="splash-mark"><OnyxMark size={72} /></div><div className="splash-name">Onyx</div></div>;
  if (!st.authed || !st.me) return <><Auth lang={lang} /><Toasts toasts={st.toasts} onClose={st.dropToast} /></>;

  return (
    <div className={`app ${effectiveDark(st.me.settings) ? 'dark-ish' : 'light-ish'} ${st.activeChatId ? 'chat-opened' : ''}`}>
      <Sidebar />
      {st.activeChatId ? <ChatView /> : <EmptyState t={t} />}
      <MobileNav />
      <MobileFab />
      {st.modals.map((m, i) => (
        <ModalRouter key={i} name={m.name} params={m.params!} />
      ))}
      <CallOverlay />
      <RateCall />
      <PasscodeGuard />
      <Toasts toasts={st.toasts} onClose={st.dropToast} />
      {!st.connected && <div className="offline-pill glass"><span className="dot" /> {t('networkError')}</div>}
      {joinPendingId && <div className="join-notice glass">🔗 joining…</div>}
    </div>
  );
}

function EmptyState({ t }: { t: any }) {
  const st = useStore();
  return (
    <section className="empty-state">
      <div className="empty-inner">
        <div className="empty-mark"><OnyxMark size={96} /></div>
        <h2>{t('appName')}</h2>
        <p className="dim">{t('tagline')}</p>
        <div className="row-gap">
          <button className="btn primary" onClick={() => st.openModal('user-picker', { type: 'private' })}><Icon name="user" size={17} /> {t('startChat')}</button>
          <button className="btn sec" onClick={() => st.openModal('settings')}><Icon name="settings" size={17} /> {t('settings')}</button>
        </div>
      </div>
    </section>
  );
}

function ModalRouter({ name, params }: { name: string; params: any }) {
  const st = useStore();
  switch (name) {
    case 'settings': return <SettingsModal />;
    case 'profile-edit': return <ProfileEdit />;
    case 'info-sheet': return <InfoSheet />;
    case 'avatar-editor': return <AvatarEditor />;
    case 'cover-editor': return <CoverEditor />;
    case 'profile-preview': return <ProfilePreview />;
    case 'wallpaper-editor': return <WallpaperEditor chatId={params.chatId} />;
    case 'story-publish': return <StoryPublish />;
    case 'story-viewer': return <StoryViewer userId={params.userId!} startId={params.startId} />;
    case 'story-archive': return <StoryArchive />;
    case 'forward': return <ForwardModal ids={params.ids} />;
    case 'main-menu': return <MainMenu x={params.x ?? 20} y={params.y ?? 20} />;
    case 'user-card': return <UserCard userId={params.userId} />;
    case 'avatar-view': return <AvatarView url={params.url} kind={params.kind} />;
    case 'media-viewer': return <MediaViewer url={params.url} kind={params.kind} round={params.round} />;
    case 'user-picker': return <UserPicker mode={params.type ?? 'private'} />;
    case 'contacts-pick': return <UserPicker mode="contacts-pick" />;
    case 'poll-create': return <PollCreate chatId={params.chatId} />;
    case 'edit-history': return <EditHistory msg={params.msg} />;
    case 'chat-edit': return <ChatEdit chatId={params.chatId} />;
    case 'chat-avatar-editor': return <ChatAvatarEditor chatId={params.chatId} />;
    case 'call-history': return <CallHistory />;
    case 'call-dial': return <CallDial peerId={params.peerId} kind={params.kind} />;
    default: return null;
  }
}
