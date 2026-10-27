// Общие типы приложения (совпадают с contract сервера)

export interface Avatar {
  kind: 'photo' | 'gif' | 'video' | null;
  url: string | null;
  offset?: number; // стартовая секунда для видео-аватарки
  color?: string;
}

export interface Wallpaper {
  mode: 'pattern' | 'gradient' | 'media';
  url?: string;
  kind?: 'photo' | 'gif' | 'video';
  gradient?: string; // css gradient string
  gradientAnim?: boolean;
  speed?: number; // 0.2..3 множитель анимации градиента
  brightness?: number; // 0..150 %
  blur?: number; // px
  saturate?: number;
  overlay?: number; // 0..100 затемнение
  zoom?: number; // 100..300 %
  position?: string; // center/top/bottom/left/right
  fill?: 'cover' | 'contain' | 'tile';
  parallax?: number; // 0..30 px сила сдвига
  loop?: boolean; // зацикливание видео
  muted?: boolean;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'auto';
  accent: string;
  language: 'ru' | 'en';
  fontSize: number; // масштаб шрифта сообщений
  uiScale: number; // 100..150
  animations: boolean;
  sounds: boolean;
  browserNotif: boolean;
  bubbleRadius: number;
  bubbleColorMine: string; // '' = авто
  avatarShape: 'circle' | 'squircle';
  avatarFrame: { style: 'none' | 'solid' | 'neon' | 'animated' | 'winter' | 'spring' | 'summer' | 'autumn' | 'halloween' | 'love' | 'galaxy' | 'ocean'; color: string };
  birthday?: string; // 'MM-DD' или 'YYYY-MM-DD' (год может быть скрыт)
  wallpaper: Wallpaper | null; // глобальные обои пользователя
  privacy: { lastSeen: 'all' | 'none'; online: boolean };
  notifSound: 'chime' | 'pop' | 'silent';
  colors: { bg: string; text: string; bubbleIn: string; bubbleOut: string };
  premium: boolean;
  customThemes: ThemePreset[];
  blocked?: string[]; // чёрный список (tdesktop privacy.blocked): список id, отправка в приват блокируется сервером
  emptyState?: { sticker: string; title: string; text: string; greeting: string; custom?: string[] }; // карточка «пустой чат»: стикер, тексты, приветствие по клику; custom — свои стикеры владельца
}

export interface ThemePreset {
  name: string;
  dark: boolean;
  accent: string;
  colors: { bg: string; text: string; bubbleIn: string; bubbleOut: string };
  bubbleRadius?: number;
}

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  bio: string;
  avatar: Avatar | null;
  cover: Avatar | null;
  premium: boolean;
  lastSeen: number | null;
  settings: Partial<UserSettings>;
  stories?: Story[];
  sessionsCount?: number;
  createdAt?: number;
}

export interface MeUser extends PublicUser {
  settings: UserSettings;
  twofa: boolean;
}

export interface Member {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  muted: boolean;
  pinned: boolean;
  notif: boolean;
  draft: string;
  wallpaper: Wallpaper | null; // переопределение обоев этого чата пользователем
  lastRead: number;
  user: PublicUser;
}

export interface Chat {
  id: string;
  type: 'private' | 'group' | 'channel';
  title: string | null;
  about: string;
  avatar: Avatar | null;
  wallpaper: Wallpaper | null;
  pinnedMsg: number | null;
  createdBy: string | null;
  createdAt: number;
  member?: Member;
  members?: Member[];
  lastMessage?: Message;
  unread: number;
  pinnedMessage?: { id: number; sender: string; type: string; text: string; deleted?: boolean } | null;
}

export interface Reaction { emoji: string; userIds: string[] }

export interface Message {
  id: number;
  chatId: string;
  sender: string | null;
  type: 'text' | 'photo' | 'video' | 'gif' | 'sticker' | 'file' | 'audio' | 'voice' | 'round' | 'poll' | 'location' | 'system' | 'story';
  text: string;
  media: any;
  replyTo: number | null;
  edits: { text: string; at: number }[] | null;
  deleted: boolean;
  pinned: boolean;
  createdAt: number;
  sendAt: number | null;
  sent: boolean;
  reactions?: Reaction[];
  poll?: { question: string; options: string[]; votes: { userId: string; choice: number }[] };
  replyPreview?: { id: number; sender: string | null; type: string; text: string; media: any; deleted?: boolean } | null;
  pending?: boolean;
}

export interface Story {
  id: string;
  userId: string;
  kind: 'photo' | 'gif' | 'video';
  url: string;
  caption: string;
  bg: string;
  createdAt: number;
  expiresAt: number;
  archived?: boolean;
  pinned?: boolean;
  viewed?: boolean;
  reaction?: string | null;
}

export interface CallRow {
  id: string; kind: 'voice' | 'video'; a: string; b: string; status: string;
  createdAt: number; endedAt?: number; duration?: number; withUser?: string;
}

export interface UploadResult {
  url: string; kind: 'photo' | 'gif' | 'video' | 'audio' | 'file';
  mime: string; name: string; size: number; w?: number; h?: number; dur?: number;
}

export interface Toast { id: number; title: string; text?: string; kind?: 'msg' | 'call' | 'error' | 'ok' }
