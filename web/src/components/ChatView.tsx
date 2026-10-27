import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore, peerIdOfChat, isFavChat, messageLabelOf } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Avatar, Icon, ContextMenu, InfoRow, OnyxMark, type MenuItem } from './common';
import { fmtTime, fmtDateFull, fmtDateSep, dayKey, fmtDur, QUICK_REACTIONS } from '../lib/media';

/* медиа, у которых tdesktop рисует баббл без хвоста (skipBubbleTail) */
const MEDIA_NO_TAIL = new Set(['photo', 'video', 'gif', 'round', 'sticker']);
import { WallpaperLayer } from './Wallpaper';
import { api } from '../lib/api';
import { MessageMedia, PollView, RichText, lastSeenText } from './Message';
import { ProfileHero } from './ProfileEdit';
import { Composer } from './Composer';
import type { Message } from '../lib/types';

export default function ChatView() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const chatId = st.activeChatId!;
  const chat = st.activeChat;
  const messages = st.messages[chatId] ?? [];
  const [ctx, setCtx] = useState<{ x: number; y: number; msg: Message } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<Message[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const peer = st.chatOf(chatId) ? st.peerOf(st.chatOf(chatId)!) : null;
  const typing = Object.values(st.typing[chatId] ?? {});
  const meRole = chat?.members?.find((m) => m.userId === st.me?.id)?.role ?? 'member';
  const canWrite = chat?.type !== 'channel' || meRole !== 'member' || !chat.members;

  // закрепление вниз при новых сообщениях
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const prevCount = useRef(messages.length);
  const loadLock = useRef(false);

  useEffect(() => {
    stickBottom.current = true;
  }, [chatId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickBottom.current && messages.length > prevCount.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevCount.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [chatId, st.msgsLoaded[chatId]]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 400 && !loadLock.current) {
      const c = useStore.getState();
      const ids = (c.messages[chatId] ?? []).map((m) => m.id);
      loadLock.current = true;
      const prevH = el.scrollHeight;
      c.loadMoreMessages().then(() => {
        requestAnimationFrame(() => {
          const d = scrollRef.current?.scrollHeight ?? prevH;
          if (scrollRef.current) scrollRef.current.scrollTop += d - prevH;
          loadLock.current = false;
        });
      });
    }
  }, []);

  // прочитка при скролле вниз и фокусе
  useEffect(() => {
    const h = () => {
      if (document.hasFocus()) {
        const c = useStore.getState();
        const list = c.messages[chatId];
        const last = list?.[list.length - 1];
        if (last) c.markRead(chatId, last.id);
      }
    };
    window.addEventListener('focus', h);
    return () => window.removeEventListener('focus', h);
  }, [chatId]);

  const runSearch = async (q: string) => {
    setSearchQ(q);
    if (q.trim().length < 1) return setSearchHits([]);
    const hits = await st.searchMessages(chatId, q);
    setSearchHits(hits);
  };

  const chatCtxItems = (): MenuItem[] => [
    { label: t('searchInChat'), icon: 'search', onClick: () => setSearchOpen(true) },
    { label: st.chats.find((c) => c.id === chatId)?.member?.muted ? t('soundsToggle') : t('muted'), icon: 'bell', onClick: () => st.patchChatMember(chatId, { muted: !st.chats.find((c) => c.id === chatId)?.member?.muted }) },
    { label: t('wallpapers'), icon: 'wallpaper', onClick: () => st.openModal('wallpaper-editor', { chatId }) },
    { label: chat?.type === 'private' ? t('deleteChat') : t('leave'), icon: 'logout', danger: true, onClick: () => st.leaveChat(chatId) },
  ];

  return (
    <section className="chat-view">
      <WallpaperLayer chatId={chatId} />

      <header className="chat-head glass" onContextMenu={(e) => { e.preventDefault(); setCtx(null); }}>
        <button className="btn-icon back-btn" onClick={() => st.closeChat()}><Icon name="back" size={22} /></button>
        <div className="chat-head-user" onClick={() => setInfoOpen(!infoOpen)}>
          {chat?.type === 'private' ? (
            isFavChat(chat, st.me?.id ?? '') ? (
              <div className="fav-ava head"><Icon name="bookmark" size={19} /></div>
            ) : (
              <Avatar user={peer} size={40} story={peer?.stories?.length ? (peer.stories.some((s) => !s.viewed) ? 'unseen' : 'seen') : undefined} />
            )
          ) : <Avatar avatar={chat?.avatar} size={40} title={chat?.title} />}
          <div className="chat-head-titles">
            <b>{chat ? st.chatTitle(chat) : '…'}{chat?.type === 'group' && <span className="dim small"> · {chat.members?.length} {t('members')}</span>}{chat?.type === 'channel' && <span className="dim small"> · {chat.members?.length} {t('subscribers')}</span>}</b>
            <span className="chat-head-sub">
              {typing.length > 0 ? (
                typing[0].kind === 'text' ? (chat?.type === 'private' ? t('typingText') : `${typing[0].name ?? ''} ${t('typingText')}`) :
                typing[0].kind === 'voice' ? t('typingVoice') : t('typingFile')
              ) : chat?.type === 'private' ? (isFavChat(chat, st.me?.id ?? '') ? t('savedSub') : (st.online.has(peer?.id ?? '') ? t('online') : lastSeenText(peer, t))) :
                (chat?.type === 'group' ? `${chat.members?.length} ${t('members')}` : `${chat?.members?.length} ${t('subscribers')}`)}
            </span>
          </div>
        </div>
        <div className="chat-head-actions">
          {chat?.type === 'private' && peer && !isFavChat(chat, st.me?.id ?? '') && (
            <>
              <button className="btn-icon" title={t('videoCall')} onClick={() => st.openModal('call-dial', { kind: 'video', peerId: peer.id })}><Icon name="video" size={21} /></button>
              <button className="btn-icon" title={t('voiceCall')} onClick={() => st.openModal('call-dial', { kind: 'voice', peerId: peer.id })}><Icon name="phone" size={20} /></button>
            </>
          )}
          <button className="btn-icon" title={t('wallpapers')} onClick={() => st.openModal('wallpaper-editor', { chatId })}><Icon name="wallpaper" size={20} /></button>
          <button className={`btn-icon ${searchOpen ? 'toggled' : ''}`} title={t('searchInChat')} onClick={() => setSearchOpen(!searchOpen)}><Icon name="search" size={20} /></button>
          <button className={`btn-icon ${infoOpen ? 'toggled' : ''}`} title={t('profile')} onClick={() => setInfoOpen(!infoOpen)}><Icon name="more" size={20} /></button>
        </div>
      </header>

      {/* Закреплённое сообщение */}
      {chat?.pinnedMessage && (
        <div className="pinned-bar glass" onClick={() => scrollToMsg(scrollRef, chat.pinnedMessage.id, st.messages[chatId])}>
          <Icon name="pin" size={15} />
          <div className="pinned-txt">
            <b>{t('pinBar')}</b>
            <span>{chat.pinnedMessage.deleted ? t('deletedMsg') : (chat.pinnedMessage.text
              ? <RichText text={chat.pinnedMessage.text} t={(k) => t(k)} oneLine />
              : messageLabelOf({ ...({ id: chat.pinnedMessage.id, type: chat.pinnedMessage.type } as any), text: chat.pinnedMessage.text } as Message))}</span>
          </div>
          <button className="btn-icon sm" onClick={(e) => { e.stopPropagation(); st.pinMsg(chat.pinnedMessage!.id, false); }}><Icon name="close" size={16} /></button>
        </div>
      )}

      {/* Поиск по чату */}
      {searchOpen && (
        <div className="chat-search glass">
          <Icon name="search" size={16} />
          <input autoFocus value={searchQ} onChange={(e) => runSearch(e.target.value)} placeholder={t('searchInChat')} />
          {searchHits.length > 0 && <span className="search-count">{searchHits.length}</span>}
          <button className="btn-icon sm" onClick={() => { setSearchOpen(false); setSearchQ(''); setSearchHits([]); }}><Icon name="close" size={15} /></button>
        </div>
      )}

      {/* Панель выделения */}
      {st.selection && (
        <div className="selection-bar glass">
          <button className="btn-icon" onClick={() => st.setSelection(null)}><Icon name="close" size={18} /></button>
          <b>{t('selectedN', { n: st.selection.length })}</b>
          <button className="btn-icon" title={t('forwardMsg')} onClick={() => st.openModal('forward', { ids: st.selection })}><Icon name="forward" size={19} /></button>
          <button className="btn-icon" title={t('deleteForAll')} onClick={async () => { for (const id of st.selection) await st.deleteMsg(id, true); st.setSelection(null); }}><Icon name="trash" size={19} className="danger" /></button>
        </div>
      )}

      <div className="messages-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="messages-inner">
          {st.msgsLoaded[chatId] === false && <div className="loader">{t('loading')}</div>}
          {searchOpen && searchHits.length > 0 && (
            <div className="search-hits glass">
              {searchHits.slice(0, 12).map((h) => (
                <div key={h.id} className="search-hit" onClick={() => scrollToMsg(scrollRef, h.id, st.messages[chatId])}>
                  <span className="mono small">{fmtTime(h.createdAt)}</span>
                  <span>{h.text.slice(0, 60) || messageLabelOf(h)}</span>
                </div>
              ))}
            </div>
          )}
          {/* удалённые «у всех» сообщения в ленте не показываем */}
          {messages.filter((m) => !m.deleted).map((m, i, arr) => {
            const prev = arr[i - 1];
            const next = arr[i + 1];
            const showDate = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const showTime = (m.createdAt - (prev?.createdAt ?? 0)) > 30 * 60 * 1000;
            const own = m.sender === st.me?.id;
            // «хвост» и группировка как в tdesktop: последняя в серии одинаковых отправителей без разрыва во времени
            const chainNext = next && next.sender === m.sender && next.type !== 'system' && m.type !== 'system'
              && dayKey(next.createdAt) === dayKey(m.createdAt)
              && (next.createdAt - m.createdAt) <= 5 * 60 * 1000;
            const chainPrev = prev && prev.sender === m.sender && prev.type !== 'system' && m.type !== 'system'
              && dayKey(prev.createdAt) === dayKey(m.createdAt)
              && (m.createdAt - prev.createdAt) <= 5 * 60 * 1000;
            const showAv = own ? false : !chainPrev;

            const isSel = st.selection?.includes(m.id);
            const canDelete = m.sender === st.me?.id;
            return (
              <React.Fragment key={m.id}>
                {showDate && (
                  <div className="date-sep"><span>{fmtDateSep(m.createdAt)}</span></div>
                )}
                <MessageRow msg={m} chatId={chatId} own={own} showAvInGroup={showAv}
                  grouped={!!chainPrev} tail={!chainNext}
                  selected={isSel} onSelectToggle={() => {
                    const cur = st.selection ?? [];
                    st.setSelection(cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id]);
                  }}
                  onContext={(e) => { setCtx({ x: e.clientX, y: e.clientY, msg: m }); }}
                  isChannel={chat?.type === 'channel'}
                  showTicks={chat?.type === 'private' && own}
                  peerRead={(st.chats.find((c) => c.id === chatId) as any)?.peerLastRead ?? 0}
                />
              </React.Fragment>
            );
          })}
          {typing.map((tp, i) => (
            <div className={`msg-row typing-row`} key={`tp${i}`}>
              <div className="bubble in">
                <span className="dots"><i /><i /><i /></span>
                <span className="small dim">{tp.kind === 'text' ? t('typing') : tp.kind === 'voice' ? t('recording') : t('sending')}</span>
              </div>
            </div>
          ))}
          {messages.length === 0 && st.msgsLoaded[chatId] && (
            <EmptyState chatId={chatId} canWrite={canWrite} />
          )}
        </div>
      </div>

      {canWrite ? (
        <Composer chatId={chatId} />
      ) : (
        <div className="composer-locked glass"><Icon name="lock" size={18} /> {t('channelLocked')}</div>
      )}
      <RightInfo open={infoOpen} onClose={() => setInfoOpen(false)} chatId={chatId} />

      {ctx && (
        <MsgMenu ctx={ctx} scrollRef={scrollRef} onClose={() => setCtx(null)} />
      )}
    </section>
  );
}

function scrollToMsg(ref: React.RefObject<HTMLDivElement>, id: number, list?: Message[]) {
  const el = ref.current?.querySelector(`[data-mid="${id}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    (el as HTMLElement).classList.add('flash');
    setTimeout(() => (el as HTMLElement).classList.remove('flash'), 1400);
    ref.current.scrollTop -= 90;
  }
}

/* ---------- сообщение ---------- */
/* ===== приветственная карточка пустого чата (как в tdesktop), слайм-маскот ===== */
const DEF_EMPTY_STATE = { title: 'Здесь пока ничего нет…', text: 'Отправьте сообщение или нажмите на приветствие ниже.', greeting: '👋 Привет!' };

function EmptyState({ chatId, canWrite }: { chatId: string; canWrite: boolean }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const cfg = { ...DEF_EMPTY_STATE, ...(st.me?.settings?.emptyState ?? {}) } as typeof DEF_EMPTY_STATE;
  const sendGreeting = () => { if (canWrite) void st.sendMsg(chatId, { type: 'text', text: cfg.greeting }); };

  return (
    <div className="empty-hero">
      <div className="empty-title">{cfg.title}</div>
      <div className="empty-sub">{cfg.text}</div>
      <button className="empty-sticker" title={canWrite ? cfg.greeting : undefined} onClick={sendGreeting}>
        <OnyxMark size={72} />
      </button>
    </div>
  );
}

function MessageRow({
  msg, chatId, own, showAvInGroup, grouped, tail, selected, onSelectToggle, onContext, isChannel, showTicks, peerRead,
}: {
  msg: Message; chatId: string; own: boolean; showAvInGroup: boolean; grouped?: boolean; tail?: boolean; selected?: boolean;
  onSelectToggle: () => void; onContext: (e: React.MouseEvent) => void; isChannel: boolean; showTicks: boolean; peerRead: number;
}) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const sender = msg.sender ? st.userById(msg.sender) : null;
  const [inViewRef, inView] = useInViewSafe<HTMLDivElement>('300px');

  if (msg.type === 'system') {
    /* служебное сообщение о звонке, как в tdesktop: капсула [иконка][текст][длительность] + время.
       Сервер присылает текст с «📞»; пропущенные/отклонённые/занято — красный значок, состоявшиеся — зелёный.
       Прочие системные (канал создан, «X присоединился»...) — та же капсула, но без значка и времени */
    const raw = msg.text.replace(/^📞\s*/, '');
    const isCall = raw !== msg.text;
    if (!isCall) {
      if (!msg.text) return null;
      return (
        <div className="system-pill plain">
          <span className="svc-bubble"><span>{msg.text}</span></span>
        </div>
      );
    }
    const missLike = /Пропущен|отклонён|Занято|недоступен|Missed|Declined|Busy|unavailable/i.test(raw);
    const label = raw.split(' · ')[0];
    const dur = raw.includes(' · ') ? raw.split(' · ')[1] : '';
    if (!label) return null;
    return (
      <div className={`system-pill ${missLike ? 'miss' : 'ok'}`}>
        <span className="svc-bubble">
          <Icon name={missLike ? 'callMissed' : 'phone'} size={15} className="svc-ico" />
          <span>{label}</span>
          {dur && <span className="svc-dur">{dur}</span>}
        </span>
        <span className="svc-time">{fmtTime(msg.createdAt)}</span>
      </div>
    );
  }

  const reply = msg.replyPreview;

  return (
    <div ref={inViewRef} className={`msg-row ${own ? 'own' : ''} ${grouped ? 'grouped' : ''} msg-in-anim`}>
      {showAvInGroup && (
        <div className="msg-avatar-col">
          {sender && (sender.id === st.me?.id
            ? <Avatar user={sender} size={34} onClick={() => st.openModal('info-sheet')} />
            : <Avatar user={sender} size={34} onClick={() => st.openModal('user-card', { userId: sender.id })} />)}
        </div>
      )}
      <div data-mid={msg.id}
        className={`bubble ${own ? 'out' : 'in'} ${tail && !MEDIA_NO_TAIL.has(msg.type) ? 'tail' : ''} media-bubble msg-${msg.type} ${selected ? 'selected' : ''} msg-flash-target`}
        onContextMenu={(e) => { e.preventDefault(); onContext(e); }}
        onDoubleClick={() => st.setSelection([...(st.selection ?? []), msg.id])}>
        {msg.deleted ? (
          <div className="deleted-note"><Icon name="trash" size={14} /> {t('deletedMsg')}</div>
        ): (
          <>
            {st.chatOf(chatId)?.type !== 'private' && showAvInGroup && <div className="msg-author"><b>{sender?.name ?? ''}</b></div>}
            {reply && (
              <div className="reply-chip" onClick={() => {
                const el = document.querySelector(`[data-mid="${reply.id}"]`);
                if (el) { (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
              }}>
                <div className="reply-chip-bar" />
                <div>
                  <b>{reply.sender === st.me?.id ? t('you') : (st.userById(reply.sender ?? '')?.name ?? '')}</b>
                  <span>{reply.deleted ? t('deletedMsg') : (reply.text ? <RichText text={reply.text} t={t} oneLine /> : messageLabelOf({ ...({ type: reply.type } as any), text: '', media: reply.media } as Message))}</span>
                </div>
              </div>
            )}
            <MessageMedia msg={msg} own={own} inView={inView} />
            {msg.type === 'text' && <RichText text={msg.text} t={t} />}
            <div className="msg-meta">
              {msg.edits && msg.edits.length > 0 && <span className="msg-edited" title={msg.edits.map((e) => e.text).join(' → ')}>{t('edited')}</span>}
              {msg.media && msg.media.captionEdit && null}
              <span className="msg-time">{fmtTime(msg.createdAt)}</span>
              {own && showTicks && (
                <span className={`ticks ${(peerRead ?? 0) >= msg.id ? 'read' : ''}`}>
                  <Icon name={((peerRead ?? 0) >= msg.id) ? 'checks' : 'check'} size={15} />
                </span>
              )}
            </div>
            {msg.reactions && msg.reactions.length > 0 && (
              <div className="reactions-row">
                {msg.reactions.map((r) => (
                  <button key={r.emoji} className={`reaction-chip ${r.userIds.includes(st.me?.id ?? '') ? 'mine' : ''} pop-in`}
                    onClick={() => st.reactMsg(msg.id, r.emoji)}>
                    <span className="rx-emoji">{r.emoji}</span>
                    <span>{r.userIds.length}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {selected && <div className="sel-dot" />}
    </div>
  );
}

function useInViewSafe<T extends HTMLElement>(margin = '300px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((es) => setInView(es[0]?.isIntersecting ?? false), { rootMargin: margin });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, inView] as const;
}

/* ---------- контекстное меню сообщения ---------- */
function MsgMenu({ ctx, scrollRef, onClose }: { ctx: { x: number; y: number; msg: Message }; scrollRef: React.RefObject<HTMLDivElement>; onClose: () => void }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const m = ctx.msg;
  const own = m.sender === st.me?.id;
  const canPin = true;

  const items: MenuItem[] = [
    {
      label: t('reactions'), icon: 'emoji',
      sub: QUICK_REACTIONS.map((e) => ({ label: e, onClick: () => { st.reactMsg(m.id, e); } })),
    },
    { label: t('replyMsg'), icon: 'reply', hidden: m.deleted, onClick: () => st.setReplyTo(m) },
    { label: t('editMsg'), icon: 'edit', hidden: !(own && (m.type === 'text')), onClick: () => st.setEditing(m) },
    { label: t('copyText'), icon: 'doc', hidden: !m.text || m.deleted, onClick: () => { navigator.clipboard?.writeText(m.text).catch(() => {}); st.pushToast({ kind: 'ok', title: 'copied' }); } },
    { label: t('forwardMsg'), icon: 'forward', hidden: m.deleted, onClick: () => st.openModal('forward', { ids: [m.id] }) },
    { label: canPin && (st.activeChat?.pinnedMessage?.id === m.id ? t('unpin') : t('pin')), icon: 'pin', hidden: m.deleted || m.type === 'system', onClick: () => st.pinMsg(m.id, st.activeChat?.pinnedMessage?.id !== m.id) },
    { label: t('selectMsgs'), icon: 'check', onClick: () => st.setSelection([m.id]) },
    { label: t('msgInfo'), icon: 'history', hidden: !m.edits?.length, onClick: () => st.openModal('edit-history', { msg: m }) },
    {
      label: t('deleteMsg'), icon: 'trash', danger: true, hidden: !own,
      sub: [
        { label: t('deleteForMe'), danger: true, onClick: () => st.deleteMsg(m.id, false) },
        { label: t('deleteForAll'), danger: true, hidden: !own, onClick: () => st.deleteMsg(m.id, true) },
      ],
    },
  ].filter((x) => !x.hidden);

  return <ContextMenu x={ctx.x} y={ctx.y} items={items} onClose={onClose} />;
}

/* ---------- плавающий профиль-попап (как в tdesktop) ---------- */

function RightInfo({ open, onClose, chatId }: { open: boolean; onClose: () => void; chatId: string }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const chat = st.chatOf(chatId);
  if (!open || !chat) return null;
  const isGroup = chat.type !== 'private';
  const peer = st.peerOf(chat);
  const isFav = isFavChat(chat, st.me?.id ?? '');
  /* «Избранное» — показываем себя в шапке попапа */
  const ru = peer ?? (isFav ? st.me : null);
  const isMe = chat.type === 'private' && (isFav || peer?.id === st.me?.id);
  const meAdmin = chat.members?.find((m) => m.userId === st.me?.id)?.role !== 'member';
  const muted = !!chat.member?.muted;

  return (
    <aside className={`profile-pop ${open ? 'open' : ''}`}>
      <div className="rp-body">
        <ProfileHero
          user={ru ?? undefined}
          chat={isGroup ? chat : undefined}
          avatarSize={92}
          onClose={onClose}
          onEdit={
            chat.type === 'private'
              ? (isMe ? () => st.openModal('info-sheet') : undefined)
              : (meAdmin ? () => st.openModal('chat-edit', { chatId }) : undefined)
          }
          onClickAvatar={(e) => {
            e.stopPropagation();
            if (chat.type === 'private' && ru?.avatar?.url) {
              st.openModal('avatar-view', { url: ru.avatar.url, kind: ru.avatar.kind });
            } else if (isGroup && meAdmin) {
              st.openModal('chat-avatar-editor', { chatId });
            } else if (chat.avatar?.url) {
              st.openModal('avatar-view', { url: chat.avatar.url, kind: chat.avatar.kind });
            }
          }}
        />

        {chat.type === 'private' && ru && (
          <>
            <div className="pp-cards">
              {isMe ? (
                <button className="btn" onClick={() => st.openModal('info-sheet')}><Icon name="edit" size={18} /> {t('editShort')}</button>
              ) : (
                <>
                  <button className="btn" onClick={() => st.openModal('call-dial', { kind: 'video', peerId: peer.id })}><Icon name="video" size={18} /> {t('videoCall')}</button>
                  <button className="btn" onClick={() => st.openModal('call-dial', { kind: 'voice', peerId: peer.id })}><Icon name="phone" size={17} /> {t('voiceCall')}</button>
                  <button className={`btn ${muted ? 'muted-on' : ''}`} title={muted ? t('soundOn') : t('muteBtn')}
                    onClick={async () => { await st.patchChatMember(chatId, { muted: !muted }); }}>
                    <Icon name={muted ? 'volume' : 'mute'} size={18} /> {muted ? t('soundOn') : t('muteBtn')}
                  </button>
                </>
              )}
            </div>
            <UserBio user={ru} />
          </>
        )}

        {isGroup && (
          <>
            {chat.about && <InfoRow icon="doc" value={chat.about} label={t('bio')} />}
            {meAdmin && (
              <div className="pp-cards">
                <button className="btn" onClick={() => st.openModal('chat-edit', { chatId })}><Icon name="edit" size={17} /> {t('editShort')}</button>
                <button className="btn" onClick={() => st.openModal('contacts-pick', { chatId })}><Icon name="plus" size={17} /> {t('addMembers')}</button>
              </div>
            )}
            <div className="rp-section-title">{t('members')} · {chat.members?.length}</div>
            <div className="rp-members">
              {chat.members?.map((m) => (
                <div key={m.userId} className="rp-member">
                  <Avatar user={m.user} size={38} />
                  <div className="grow">
                    <b>{m.userId === st.me?.id ? t('you') : m.user.name}</b>
                    <span className="dim small">{t(m.role)}</span>
                  </div>
                  {m.userId !== st.me?.id && meAdmin && chat.type !== 'channel' && (
                    <MemberActions chatId={chatId} m={m} />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export function UserBio({ user }: { user: any }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [stories, setStories] = useState<any[]>([]);
  useEffect(() => {
    api.userStories(user.id).then(setStories).catch(() => {});
  }, [user.id]);
  const live = stories.filter((s) => s.pinned || (!s.archived && s.expiresAt > Date.now())).slice(0, 12);
  const archived = stories.filter((s) => s.archived).length;
  return (
    <>
      <InfoRow icon="user" accent onClick={() => {
        try { navigator.clipboard?.writeText('@' + user.username); } catch {}
      }} value={<span className="mono">@{user.username}</span>} label={t('username')} />
      {user.bio && <InfoRow icon="doc" value={user.bio} label={t('bio')} />}
      {user.createdAt ? (
        <InfoRow icon="clock" accent value={new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} label={t('registered')} />
      ) : null}
      {archived > 0 && (
        <InfoRow icon="archive" accent value={`${archived} ${t('stories')}`} label={t('archive')} onClick={() => st.openModal('story-viewer', { userId: user.id })} />
      )}
      {live.length > 0 && (
        <div className="rp-section-title">{t('stories')}</div>
      )}
      <div className="rp-stories-mini">
        {live.map((s) => (
          <div key={s.id} className="rp-story-mini" onClick={() => st.openModal('story-viewer', { userId: user.id, startId: s.id })}>
            {s.kind === 'video' ? <video src={s.url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
              <img src={s.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
        ))}
      </div>
    </>
  );
}

import { api } from '../lib/api';

function MemberActions({ chatId, m }: { chatId: string; m: any }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  return (
    <div className="row-icons">
      <button className="btn-icon sm" title={m.role === 'admin' ? t('demote') : t('promote')}
        onClick={() => st.setRole(chatId, m.userId, m.role === 'admin' ? 'member' : 'admin')}>
        <Icon name={m.role === 'admin' ? 'user' : 'star'} size={16} />
      </button>
      <button className="btn-icon sm" title={t('removeMember')} onClick={() => st.kickMember(chatId, m.userId)}>
        <Icon name="close" size={16} className="danger" />
      </button>
    </div>
  );
}
