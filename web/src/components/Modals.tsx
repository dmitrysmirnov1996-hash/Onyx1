import React, { useState, useEffect } from 'react';
import { useStore, messageLabelOf } from '../lib/store';
import { tFor } from '../lib/i18n';
import { Modal, Avatar, Icon, InfoRow } from './common';
import { api } from '../lib/api';
import { fmtLastSeen, fmtTime } from '../lib/media';
import { ProfileHero } from './ProfileEdit';

/* ============ Поиск пользователей + создание чата/группы/канала ============ */
export function UserPicker({ mode }: { mode: 'private' | 'group' | 'channel' | 'contacts-pick' }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 1) { setFound([]); return; }
    let cancel = false;
    api.searchUsers(q).then((r) => { if (!cancel) setFound(r); }).catch(() => {});
    return () => { cancel = true; };
  }, [q]);

  const targetChatId = (st.modals[st.modals.length - 1]?.params as any)?.chatId;
  const target = (st.modals[st.modals.length - 1]?.params as any)?.type;

  const done = async () => {
    setBusy(true);
    try {
      if (targetChatId) {
        await st.addChatMembers(targetChatId, [...selected]);
        st.pushToast({ kind: 'ok', title: 'saved' });
        st.closeModal();
      } else {
        const chat = await st.createChat((target as any) ?? mode, [...selected], title || undefined);
        st.openChat(chat.id);
        st.closeModal();
      }
    } catch { st.pushToast({ kind: 'error', title: 'error' }); }
    setBusy(false);
  };

  return (
    <Modal title={targetChatId ? t('addMembers') : mode === 'group' ? t('createGroup') : mode === 'channel' ? t('createChannel') : t('startChat')}
      onClose={st.closeModal} width={430}>
      {(mode === 'group' || mode === 'channel') && !targetChatId && (
        <label className="field"><span>{t('title')}</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={64} />
        </label>
      )}
      <div className="search-wrap full">
        <Icon name="search" size={17} className="search-ico" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchChats')} autoFocus={!!targetChatId} />
      </div>
      <div className="found-list">
        {found.map((u) => (
          <div key={u.id} className={`chat-row picker ${selected.has(u.id) ? 'selected' : ''}`}
            onClick={() => {
              if (st.me?.id === u.id) return;
              if (mode === 'private' && !targetChatId) {
                st.createChat('private', [u.id]).then((chat) => { st.openChat(chat.id); st.closeModal(); });
                return;
              }
              const ns = new Set(selected);
              if (ns.has(u.id)) { ns.delete(u.id); } else { ns.add(u.id); }
              setSelected(ns);
            }}>
            <Avatar user={u} size={44} />
            <div className="chat-row-main">
              <b>{u.name}{st.me?.id === u.id && ` (${t('you')})`}</b>
              <span>@{u.username}</span>
            </div>
            {selected.has(u.id) && <Icon name="check" size={18} className="accent" />}
          </div>
        ))}
        {q.length > 0 && !found.length && <div className="empty-list">{t('notFound')}</div>}
      </div>
      {(selected.size > 0 || (title && selected.size > 0)) && (
        <button className="btn primary big" disabled={busy} onClick={done}>
          {busy ? t('loading') : `${t('createGroup')} (${selected.size})`}
        </button>
      )}
    </Modal>
  );
}

// чтобы TS не ругался: быстрый доступ-холдер
const joinOverrideChatId = undefined;

/* ============ Пересылка сообщений ============ */
export function ForwardModal({ ids }: { ids: number[] }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`${t('forwardTo')} (${ids.length})`} onClose={st.closeModal} width={420}>
      <div className="found-list">
        {st.chats.map((c) => {
          const canWrite = c.type !== 'channel' || (st.activeChat?.members?.find((m) => m.userId === st.me?.id)?.role ?? 'member') !== 'member';
          return (
            <div key={c.id} className={`chat-row picker ${selected.has(c.id) ? 'selected' : ''}`}
              onClick={() => {
                if (!canWrite) return;
                const ns = new Set(selected);
                ns.has(c.id) ? ns.delete(c.id) : ns.add(c.id);
                setSelected(ns);
              }}>
              <Avatar user={c.type === 'private' ? st.peerOf(c) : null} avatar={st.chatAvatar(c)} size={44} title={c.title} />
              <div className="chat-row-main"><b>{st.chatTitle(c)}</b><span>{messageLabelPreview(c)}</span></div>
              {selected.has(c.id) && <Icon name="check" size={18} className="accent" />}
            </div>
          );
        })}
      </div>
      <button className="btn primary big" disabled={!selected.size || busy} onClick={async () => {
        setBusy(true);
        await st.forwardMsgs(ids, [...selected]);
        setBusy(false);
        st.pushToast({ kind: 'ok', title: 'saved' });
        st.closeModal();
      }}>{busy ? t('loading') : `${t('forward')} → ${selected.size}`}</button>
    </Modal>
  );
}

function messageLabelPreview(c: any): string {
  const last = c.lastMessage;
  if (!last) return '';
  if (last.type === 'text') return last.text?.slice(0, 40) ?? '';
  switch (last.type) {
    case 'photo': return '📷';
    case 'video': return '🎞';
    case 'gif': return 'GIF';
    case 'voice': return '🎤';
    case 'round': return '📹';
    case 'file': return '📄';
    case 'poll': return '📊';
    case 'sticker': return last.media?.emoji ?? '🎟';
    default: return '💬';
  }
}

/* ============ Главное меню ============ */
export function MainMenu({ x, y }: { x: number; y: number }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const me = st.me!;
  const items: any[] = [
    { label: t('newGroup'), icon: 'group', onClick: () => st.openModal('user-picker', { type: 'group' }) },
    { label: t('newChannel'), icon: 'channel', onClick: () => st.openModal('user-picker', { type: 'channel' }) },
    { label: t('startChat'), icon: 'user', onClick: () => st.openModal('user-picker', { type: 'private' }) },
    { label: t('publishStory'), icon: 'story', onClick: () => st.openModal('story-publish') },
    { label: t('archive'), icon: 'archive', onClick: () => st.openModal('story-archive') },
    { label: t('callHistory'), icon: 'callHistory', onClick: () => st.openModal('call-history') },
    { label: t('settings'), icon: 'settings', onClick: () => st.openModal('settings') },
    { label: t('logout'), icon: 'logout', danger: true, onClick: () => st.logout() },
  ];
  const cx = Math.min(x, window.innerWidth - 210);
  const cy = Math.min(y, window.innerHeight - items.length * 42 - 20);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.ctx-menu')) st.closeModal();
    };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="ctx-menu glass pop-in" style={{ left: cx, top: cy, position: 'fixed' }}>
      {items.map((it, i) => (
        <button key={i} className={`ctx-item ${it.danger ? 'danger' : ''}`}
          onClick={() => { st.closeModal(); it.onClick(); }}>
          <Icon name={it.icon} size={17} />
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ============ Карточка пользователя (из группы / из чата) ============ */
export function UserCard({ userId }: { userId: string }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const user = st.userById(userId);
  if (!user) return null;
  const isMe = user.id === st.me?.id;
  const blockedIds: string[] = st.me?.settings?.blocked ?? [];
  const isBlocked = blockedIds.includes(user.id);
  return (
    <Modal title={t('profile')} onClose={st.closeModal} width={380} className="user-card-modal">
      <div className="user-card flat">
        <ProfileHero
          user={user}
          avatarSize={88}
          onEdit={isMe ? () => st.openModal('info-sheet') : undefined}
          onClickAvatar={(e) => {
            e.stopPropagation();
            if (user.avatar?.url) st.openModal('avatar-view', { url: user.avatar.url, kind: user.avatar.kind });
          }}
        />
        <div className="user-info-rows">
          <InfoRow icon="user" accent value={<span className="mono">@{user.username}</span>} label={t('username')} />
          {user.createdAt && (
            <InfoRow icon="clock" accent value={new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} label={t('registered')} />
          )}
        </div>
        <div className="rp-actions center">
          {isMe && (
            <button className="btn primary" onClick={() => st.openModal('info-sheet')}>
              <Icon name="edit" size={16} /> {t('edit')} {t('profile')}
            </button>
          )}
          {!isMe && (
            <>
              <button className="btn primary"
                onClick={() => st.createChat('private', [user.id]).then((chat: any) => { st.openChat(chat.id); st.closeModal(); })}>
                <Icon name="message" size={16} fill className="wIcon" /> {t('startChat')}
              </button>
              <button className="btn sec" onClick={() => st.openModal('call-dial', { kind: 'voice', peerId: user.id })}>
                <Icon name="phone" size={16} /> {t('voiceCall')}
              </button>
              <button className={`btn ${isBlocked ? 'primary' : 'sec'}`} title={isBlocked ? t('unblockUser') : t('blockUser')}
                onClick={() => {
                  st.patchSettings({ blocked: isBlocked ? blockedIds.filter((x) => x !== user.id) : [...blockedIds, user.id] });
                  st.pushToast({ kind: 'ok', title: isBlocked ? 'userUnblocked' : 'userBlocked' });
                }}>
                <Icon name="block" size={16} /> {isBlocked ? t('unblockUser') : t('blockUser')}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ============ Просмотр аватарки на весь экран ============ */
export function AvatarView({ url, kind }: { url?: string; kind?: string }) {
  const st = useStore();
  if (!url) return null;
  return (
    <div className="media-viewer full" onClick={st.closeModal}>
      {kind === 'video' ? <video src={url} autoPlay loop muted playsInline controls /> : <img src={url} />}
      <button className="btn-icon big-x" onClick={st.closeModal}><Icon name="close" size={20} /></button>
    </div>
  );
}

/* ============ Опрос: создание ============ */
export function PollCreate({ chatId }: { chatId: string }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const canSend = question.trim() && options.filter((o) => o.trim()).length >= 2;
  return (
    <Modal title={t('poll')} onClose={st.closeModal} width={430}>
      <input className="inp" placeholder={t('pollQuestion')} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={100} autoFocus />
      {options.map((o, i) => (
        <div key={i} className="row-gap opt-row">
          <input className="inp grow" placeholder={`${t('pollOptions')} ${i + 1}`} value={o}
            onChange={(e) => setOptions(options.map((x, j) => j === i ? e.target.value : x))} maxLength={64} />
          {i > 1 && <button className="btn-icon" onClick={() => setOptions(options.filter((_, j) => j !== i))}><Icon name="close" size={15} /></button>}
        </div>
      ))}
      <button className="btn sec sm" onClick={() => setOptions([...options, ''])}><Icon name="plus" size={15} /> {t('addOpt')}</button>
      <button className="btn primary big" disabled={!canSend || busy} onClick={async () => {
        setBusy(true);
        await st.sendMsg(chatId, { type: 'poll', text: '', media: { question, options: options.filter((o) => o.trim()) } });
        setBusy(false);
        st.closeModal();
      }}>{busy ? t('loading') : t('send')}</button>
    </Modal>
  );
}

/* ============ История редактирования ============ */
export function EditHistory({ msg }: { msg: any }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  return (
    <Modal title={t('editHistory')} onClose={st.closeModal} width={430}>
      {(msg.edits ?? []).map((e: any, i: number) => (
        <div key={i} className="edit-hist-row">
          <span className="mono small dim">{new Date(e.at).toLocaleString()}</span>
          <p>{e.text}</p>
        </div>
      ))}
      <div className="edit-hist-row current">
        <span className="mono small dim">{t('you')}</span>
        <p><b>{msg.text}</b></p>
      </div>
    </Modal>
  );
}

/* ============ Редактирование чата (группа/канал) ============ */
export function ChatEdit({ chatId }: { chatId: string }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const chat = st.chatOf(chatId);
  const [title, setTitle] = useState(chat?.title ?? '');
  const [about, setAbout] = useState(chat?.about ?? '');
  const [busy, setBusy] = useState(false);
  if (!chat) return null;
  return (
    <Modal title={t('edit')} onClose={st.closeModal} width={430}>
      <div className="row-gap">
        <Avatar avatar={chat.avatar} size={64} onClick={() => st.openModal('chat-avatar-editor', { chatId })} />
        <label className="grow field"><span>{t('renamePh')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={64} />
        </label>
      </div>
      <label className="field"><span>{t('bio')}</span>
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={2} maxLength={256} />
      </label>
      <div className="row-between">
        <button className="btn sec" onClick={async () => {
          await navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/join/${chatId}`).catch?.(() => {});
          st.pushToast({ kind: 'ok', title: 'linkCopied' });
        }}><Icon name="link" size={16} /> {t('inviteLink')}</button>
        <button className="btn primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await st.patchChat(chatId, { title, about });
            st.closeModal();
            st.pushToast({ kind: 'ok', title: 'saved' });
          } catch {}
          setBusy(false);
        }}>{busy ? t('loading') : t('save')}</button>
      </div>
    </Modal>
  );
}

/* ============ Загрузка аватара чата ============ */
export function ChatAvatarEditor({ chatId }: { chatId: string }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const chat = st.chatOf(chatId);
  const [busy, setBusy] = useState(false);
  if (!chat) return null;
  return (
    <Modal title={t('settings')} onClose={st.closeModal} width={420}>
      <div className="story-pick">
        <Avatar avatar={chat.avatar} size={96} />
        <label className="btn primary"><Icon name="image" size={17} /> {t('avatarPhoto')}
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try { const up = await st.uploads(f, f.name, {}); await st.patchChat(chatId, { avatar: { kind: f.type === 'image/gif' ? 'gif' : 'photo', url: up.url } }); } catch {}
            setBusy(false);
            st.closeModal();
          }} />
        </label>
        <label className="btn sec"><Icon name="video" size={17} /> {t('avatarVideo')}
          <input type="file" accept="video/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try { const up = await st.uploads(f, f.name, {}); await st.patchChat(chatId, { avatar: { kind: 'video', url: up.url } }); } catch {}
            setBusy(false);
            st.closeModal();
          }} />
        </label>
      </div>
    </Modal>
  );
}

/* ============ История звонков ============ */
export function CallHistory() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.calls().then(setRows).catch(() => {}); }, []);
  return (
    <Modal title={t('callHistory')} onClose={st.closeModal} width={440}>
      <div className="found-list">
        {rows.map((c) => {
          const u = st.userById(c.withUser);
          const out = c.a === st.me?.id;
          return (
            <div key={c.id} className="chat-row" onClick={() => { if (u) { st.createChat('private', [u.id]).then((ch) => st.openChat(ch.id)); st.closeModal(); } }}>
              <Avatar user={u} size={42} />
              <div className="chat-row-main">
                <b>{u?.name ?? '…'}</b>
                <span className={c.status === 'missed' || c.status === 'declined' ? 'danger' : ''}
                  style={{ color: c.status === 'missed' || c.status === 'declined' ? 'var(--danger)' : undefined }}>
                  {c.kind === 'video' ? '📹' : '📞'} {c.status} {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <span className="mono small dim">{c.duration ? c.duration + 'с' : ''}</span>
            </div>
          );
        })}
        {!rows.length && <div className="empty-list">{t('callHistory')} — 0</div>}
      </div>
      <div className="small dim">{t('groupCallsSoon')}</div>
    </Modal>
  );
}

/* ============ Просмотр медиа (фото/видео/GIF) ============ */
export function MediaViewer({ url, kind, round }: { url: string; kind: 'photo' | 'gif' | 'video'; round?: boolean }) {
  const st = useStore();
  const [zoom, setZoom] = useState(1);
  try {
    return (
      <div className={`media-viewer ${url ? '' : 'empty'}`} onClick={st.closeModal}
        onWheel={(e) => { if (!e.deltaY) return; setZoom(Math.min(3, Math.max(0.4, zoom - Math.sign(e.deltaY) * 0.1))); }}>
        {kind === 'video' ? (
          <video src={url} autoPlay loop controls playsInline onClick={(e) => e.stopPropagation()} style={{ width: 'min(90vw, 1000px)', borderRadius: round ? '50%' : 10, aspectRatio: '1/1', objectFit: 'cover' }} />
        ) : (
          <img src={url} onClick={(e) => e.stopPropagation()} style={{ transform: `scale(${zoom})`, transition: 'transform .15s', maxHeight: '88vh', borderRadius: 8 }} draggable={false} />
        )}
        <a className="btn-icon download" href={url} download target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          <Icon name="download" size={20} />
        </a>
        <button className="btn-icon big-x" onClick={st.closeModal}><Icon name="close" size={20} /></button>
      </div>
    );
  } catch {
    return null;
  }
}

