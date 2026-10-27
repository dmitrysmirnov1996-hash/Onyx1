import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useStore, peerIdOfChat, isFavChat, messageLabelOf } from '../lib/store';
import { tFor, type Lang } from '../lib/i18n';
import { Avatar, Icon, ContextMenu, Toggle, type MenuItem } from './common';
import { effectiveDark } from '../lib/theme';
import { fmtTime, fmtLastSeen } from '../lib/media';
import { api } from '../lib/api';

/* ---------- Меню гамбургера (выдвижная панель как в AyuGram) ---------- */
function MenuPanel({ onClose }: { onClose: () => void }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const me = st.me!;
  const dark = effectiveDark(me.settings);
  const ghost = me.settings.privacy?.online === false;
  const myStories = st.stories.filter((s) => s.userId === me.id);

  type Row =
    | { sep: true }
    | { icon: string; label: string; onClick: () => void; danger?: boolean }
    | { icon: string; label: string; toggle: boolean; onToggle: () => void };

  const rows: Row[] = [
    { icon: 'user', label: t('myProfile'), onClick: () => { onClose(); st.openModal('info-sheet'); } },
    { sep: true },
    { icon: 'group', label: t('newGroup'), onClick: () => { onClose(); st.openModal('user-picker', { type: 'group' }); } },
    { icon: 'channel', label: t('newChannel'), onClick: () => { onClose(); st.openModal('user-picker', { type: 'channel' }); } },
    { icon: 'user', label: t('contacts'), onClick: () => { onClose(); st.openModal('user-picker', { type: 'private' }); } },
    { icon: 'phone', label: t('callHistory'), onClick: () => { onClose(); st.openModal('call-history'); } },
    { icon: 'bookmark', label: t('favorites'), onClick: async () => { onClose(); await st.openFavorites(); } },
    { sep: true },
    { icon: 'mail', label: t('readAll'), onClick: () => { void st.readEverything(); onClose(); } },
    { icon: 'archive', label: t('archive'), onClick: () => { onClose(); st.openModal('story-archive'); } },
    { sep: true },
    { icon: 'settings', label: t('settings'), onClick: () => { onClose(); st.openModal('settings'); } },
    { icon: 'moon', label: t('nightMode'), toggle: dark, onToggle: () => void st.patchSettings({ theme: dark ? 'light' : 'dark' }) },
    { icon: 'ghost', label: t('ghostMode'), toggle: ghost, onToggle: () => void st.patchSettings({ privacy: { ...me.settings.privacy, lastSeen: me.settings.privacy?.lastSeen ?? 'all', online: !ghost } }) },
  ];

  return (
    <div className="menu-panel" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="menu-card">
        <div className="mp-cover" onClick={() => { onClose(); st.openModal('avatar-editor'); }}>
          <div className="mp-cover-ava">
            <Avatar user={me} size={48}
              story={myStories.some((s) => !s.viewed) ? 'unseen' : myStories.length ? 'seen' : undefined} onClick={(e) => { e.stopPropagation(); onClose(); st.openModal('info-sheet'); }} />
          </div>
          <div className="mp-cover-name">{me.name}</div>
          <div className="mp-cover-sub">{t('menuSub')}</div>
        </div>
        <div className="mp-items">
          {rows.map((r, i) => {
            if ('sep' in r) return <div key={i} className="mp-sep" />;
            if ('toggle' in r) return (
              <div key={i} className="mp-toggle-row" onClick={r.onToggle}>
                <span className="mp-ico"><Icon name={r.icon} size={20} /></span>
                <span className="grow">{r.label}</span>
                <Toggle value={r.toggle} onChange={(v) => r.onToggle()} />
              </div>
            );
            return (
              <button key={i} className={`mp-item ${r.danger ? 'danger' : ''}`} onClick={r.onClick}>
                <span className="mp-ico"><Icon name={r.icon} size={20} /></span>
                <span>{r.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mp-foot">
          <button className="btn-icon" title={t('closeMenu')} onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ onOpenProfile }: { onOpenProfile?: () => void }) {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<any[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; chatId: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /* три последних чата — быстрые аватарки справа от поиска (как в AyuGram) */
  const quickChats = useMemo(() => st.chats.slice(0, 3), [st.chats]);

  const [folder, setFolder] = useState(() => localStorage.getItem('tg_folder') || 'all');

  // клиентские папки-вкладки как в tdesktop (dialogsSearchTabs: высота 33px, слайдер 6/2)
  const chats = useMemo(() => {
    const base = st.chats;
    const filtered = folder === 'all' ? base
      : folder === 'archived' ? base.filter((c) => c.archived)
      : base.filter((c) => c.type === folder && !c.archived);
    if (!query) return filtered;
    const q = query.toLowerCase();
    return filtered.filter((c) => st.chatTitle(c).toLowerCase().includes(q) || (c.lastMessage?.text ?? '').toLowerCase().includes(q));
  }, [st.chats, query, st.users, folder]);

  useEffect(() => {
    if (!query || query.length < 2) { setFound([]); return; }
    let cancel = false;
    api.searchUsers(query).then((users) => { if (!cancel) setFound(users.filter((u: any) => !st.chats.some((c) => c.type === 'private' && peerIdOfChat(c, st.me?.id ?? '') === u.id))); });
    return () => { cancel = true; };
  }, [query, st.chats]);

  const openPrivate = (userId: string) => {
    st.createChat('private', [userId]).then((chat) => { st.openChat(chat.id); setQuery(''); setFound([]); });
  };

  const menuFor = (chatId: string): MenuItem[] => {
    const c = st.chats.find((x) => x.id === chatId);
    if (!c) return [];
    return [
      { label: c.member?.pinned ? t('unpin') : t('pin'), icon: 'pin', onClick: () => st.patchChatMember(chatId, { pinned: !c.member?.pinned }) },
      { label: c.member?.muted ? `🔔 ${t('soundsToggle')}` : `🔕 ${t('muted')}`, icon: 'bell', onClick: () => st.patchChatMember(chatId, { muted: !c.member?.muted }) },
      { label: t('wallpapers'), icon: 'wallpaper', onClick: () => st.openModal('wallpaper-editor', { chatId }) },
      { label: c.type === 'private' ? t('deleteChat') : t('leave'), icon: 'logout', danger: true, onClick: () => st.leaveChat(chatId) },
    ];
  };

  return (
    <aside className={`sidebar  ${st.activeChatId ? 'chat-open' : ''}`}>
      <div className="sidebar-top">
        <button className="btn-icon" title={t('openMenu')} onClick={() => setMenuOpen(true)}><Icon name="menu" size={22} /></button>
        <div className="search-wrap">
          <Icon name="search" size={17} className="search-ico" />
          <input ref={searchRef} value={query}
            onChange={(e) => {
              /* анти-автофилл: Chrome может вставить значение без фокуса (логин/пароль с других полей) — отбрасываем */
              if (document.activeElement !== e.target) { (e.target as HTMLInputElement).value = ''; setQuery(''); return; }
              setQuery(e.target.value);
            }}
            onFocus={(e) => { (e.target as HTMLInputElement).readOnly = false; }}
            readOnly
            placeholder={t('searchChats')}
            autoComplete="off" name="slime-chat-search" spellCheck={false} data-1p-ignore />
          {query && <button className="btn-icon sm" onClick={() => { setQuery(''); setFound([]); }}><Icon name="close" size={15} /></button>}
        </div>
        {!query && quickChats.length > 0 && (
          <div className="quick-stack" title={t('chats')}>
            {quickChats.map((c) => (
              <Avatar key={c.id} user={c.type === 'private' ? st.userById(peerIdOfChat(c, st.me?.id ?? '')) : undefined}
                avatar={st.chatAvatar(c)} size={28}
                title={c.type === 'private' ? st.chatTitle(c) : (c.title ?? '')}
                onClick={(e) => { e.stopPropagation(); st.openChat(c.id); }} />
            ))}
          </div>
        )}
      </div>

      {/* Истории */}
      {!query && <StoriesTray />}

      {/* Папки-вкладки (tdesktop SearchTabs 33px) */}
      {!query && (
        <div className="filter-tabs">
          {[['all', t('fAll')], ['private', t('fPrivate')], ['group', t('fGroups')], ['channel', t('fChannels')], ['archived', t('fArchived')]].map(([id, label]) => (
            <button key={id} className={`filter-tab ${folder === id ? 'active' : ''}`} onClick={() => { setFolder(id); localStorage.setItem('tg_folder', id); }}>{label}</button>
          ))}
        </div>
      )}

      <div className="chat-list">
        {query.length >= 2 && found.length > 0 && (
          <div className="found-users">
            <div className="list-title">{t('searchUsersGlob')}</div>
            {found.map((u) => (
              <div className="chat-row" key={u.id} onClick={() => openPrivate(u.id)}>
                <Avatar user={u} size={48} />
                <div className="chat-row-main">
                  <b>{u.name}</b>
                  <span>@{u.username}</span>
                </div>
                <button className="btn-icon sm add-user-ico"><Icon name="plus" size={16} /></button>
              </div>
            ))}
          </div>
        )}
        {query.length >= 2 && chats.length === 0 && found.length === 0 && (
          <div className="empty-list">{t('noUsersFound')}</div>
        )}
        {chats.length === 0 && query.length === 0 && (
          <div className="empty-list">{t('noChats')}</div>
        )}
        {chats.map((c) => {
          const peer = st.userById(c.type === 'private' ? peerIdOfChat(c, st.me?.id ?? '') : null);
          const unread = Number(c.unread) || 0;
          const last = c.lastMessage;
          const typing = Object.values(st.typing[c.id] ?? {})[0];
          return (
            <div key={c.id}
              className={`chat-row ${st.activeChatId === c.id ? 'active' : ''} ${c.member?.muted ? 'muted' : ''}`}
              onClick={() => st.openChat(c.id)}
              onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, chatId: c.id }); }}>
              {isFavChat(c, st.me?.id ?? '') ? (
                <div className="fav-ava"><Icon name="bookmark" size={22} /></div>
              ) : (
                <Avatar user={peer} avatar={st.chatAvatar(c)} size={48}
                  title={c.type === 'private' ? st.chatTitle(c) : (c.title ?? '')}
                  story={peer?.stories?.length ? (peer.stories.some((s) => !s.viewed) ? 'unseen' : 'seen') : undefined}
                  onClick={(e) => { if (peer?.stories?.length) { e.stopPropagation(); st.openModal('story-viewer', { userId: peer.id }); } }} />
              )}
              <div className="chat-row-main">
                <div className="chat-row-line">
                  <b>{c.type === 'private' ? st.chatTitle(c) : c.title ?? ''}{c.type === 'channel' && <i className="role-tag">{t('channel') ?? 'channel'}</i>}{c.type === 'group' && <Icon name="group" size={13} className="list-ico dim" />}</b>
                  <span className="time">{last ? fmtTime(last.createdAt) : ''}</span>
                </div>
                <div className="chat-row-line">
                  <span className={`last-msg ${unread ? 'unread' : ''}`}>
                    {typing ? (typing.kind === 'text' ? `${typing.name}: ${t('typingText')}` : typing.kind === 'voice' ? t('typingVoice') : t('typingFile')) :
                      last ? (last.sender === st.me?.id ? (c.type !== 'private' ? `${t('you')}: ` : '') + ' ' + (last.pending ? '⏳ ' : '') + messageLabelOf(last) : messageLabelOf(last)) :
                        st.chatTitle(c) === c.title ? (peer ? '@' + peer.username : '') : ''}
                  </span>
                  <span className="badges">
                    {c.member?.muted && <Icon name="mute" size={14} className="dim" />}
                    {c.member?.pinned && <Icon name="pin" size={14} className="dim" />}
                    {unread > 0 && <span className={`unread-badge ${c.member?.muted ? 'muted' : ''}`}>{unread > 99 ? '99+' : unread}</span>}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {menuOpen && <MenuPanel onClose={() => setMenuOpen(false)} />}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={menuFor(ctx.chatId)} onClose={() => setCtx(null)} />}
    </aside>
  );
}

/* ---------- Истрории-трей ---------- */
function StoriesTray() {
  const st = useStore();
  const t = tFor(st.me?.settings?.language ?? 'ru');
  const byUser = useMemo(() => {
    const map = new Map<string, { user: any; stories: any[]; unseen: number }>();
    for (const s of st.stories) {
      /* свои истории — только в ячейке «Мой стори», без дублей в общем списке */
      if (s.userId === st.me?.id) continue;
      const u = st.userById(s.userId);
      if (!u) continue;
      let e = map.get(s.userId);
      if (!e) { e = { user: u as any, stories: [], unseen: 0 }; map.set(s.userId, e); }
      e.stories.push(s);
      if (!s.viewed) e.unseen++;
    }
    return [...map.values()].filter((x) => x.stories.length);
  }, [st.stories, st.users]);

  const myStories = st.stories.filter((s) => s.userId === st.me?.id);

  return (
    <div className="stories-tray">
      <div className="story-item" onClick={() => st.openModal(myStories.length ? 'story-viewer' : 'story-publish', { userId: st.me?.id })}>
        <Avatar user={st.me as any} size={56} story={myStories.some((s) => !s.viewed) ? 'unseen' : myStories.length ? 'seen' : undefined} />
        <div className="story-add"><Icon name="plus" size={12} /></div>
        <span className="story-name">{t('myStory')}</span>
      </div>
      {byUser.map(({ user, unseen }) => (
        <div className="story-item" key={user.id} onClick={() => st.openModal('story-viewer', { userId: user.id })}>
          <Avatar user={user} size={56} story={unseen > 0 ? 'unseen' : 'seen'} />
          <span className="story-name">{user.name.split(' ')[0]}</span>
        </div>
      ))}
    </div>
  );
}
