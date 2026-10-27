// WebRTC звонки 1-на-1: сигналинг через Socket.IO.
// Механики портированы из Telegram Desktop (calls_call/panel/state machine):
// статусы incoming→outgoing→connecting→connected + reconnecting→failed→retry,
// busy, индикатор качества связи, эмодзи-отпечаток шифрования, уровень микрофона.
import { getSocket } from './store';
import { startRing as startRingSound, stopRing as stopRingSound, sound as soundEnd } from './media';
import { emojiFingerprint, callFingerprintSeed, sha256 } from './fingerprint';

const ICE: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

export type Quality = 'low' | 'med' | 'high';
export type ConnQuality = 'good' | 'ok' | 'bad';

const BITRATE: Record<Quality, { width: number; height: number; maxBitrate: number }> = {
  low: { width: 320, height: 320, maxBitrate: 150000 },
  med: { width: 640, height: 640, maxBitrate: 500000 },
  high: { width: 1280, height: 1280, maxBitrate: 2500000 },
};

const AUTO_DECLINE_MS = 45_000; // как в tdesktop: нет ответа — «не отвечает»
const RECONNECT_GRACE_MS = 12_000; // после «отключился» — окно на возврат соединения

// пресеты качества демонстрации экрана: честные ограничения width/height/frameRate
export const SCREEN_PRESETS: { id: string; w?: number; h?: number; fps?: number }[] = [
  { id: 'asis' },
  { id: '1080p', w: 1920, h: 1080, fps: 30 },
  { id: '720p', w: 1280, h: 720, fps: 24 },
  { id: '480p', w: 854, h: 480, fps: 15 },
  { id: '360p', w: 640, h: 360, fps: 10 },
];

export class CallManager {
  pc: RTCPeerConnection | null = null;
  localStream: MediaStream | null = null;
  remoteStream: MediaStream | null = null;
  callId = '';
  kind: 'voice' | 'video' = 'voice';
  role: 'caller' | 'callee' = 'caller';
  quality: Quality = 'med';
  micOn = true;
  camOn = true;
  screenOn = false;
  screenQuality = '720p'; // выбранный пресет своей демонстрации
  screenStream: MediaStream | null = null;
  // приёмник: трек/поток/качество ДУЧОЙ (чужой) демонстрации
  remoteScreenTrack: MediaStreamTrack | null = null;
  remoteScreenStream: MediaStream | null = null;
  remoteScreenQuality = '';
  speakerId: string | undefined;
  ended = false;
  connQuality: ConnQuality = 'ok';
  fingerprint = '';

  remoteFx: 'none' | 'blur' = 'none';

  // колбэки UI
  onRemote: ((s: MediaStream) => void) | null = null;
  onLocal: ((s: MediaStream) => void) | null = null;
  onScreen: ((s: MediaStream | null) => void) | null = null;
  onLevel: ((lv: number) => void) | null = null;
  onQuality: ((q: ConnQuality) => void) | null = null;
  onFingerprint: ((emo: string) => void) | null = null;
  onRemoteMute: ((muted: boolean) => void) | null = null;

  private store: any;
  private pendingIce: RTCIceCandidateInit[] = [];
  private makingOffer = false;
  private calleeLocked = false; // до ответа на первый offer только callee отвечает
  private starting = false;     // защита от двойного start()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private autoDeclineTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private actx: AudioContext | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  constructor(store: any) {
    this.store = store;
  }

  private patch(p: any) {
    const st = this.store.getState();
    st.setCall({ ...(st.call ?? {}), ...p } as any);
  }

  peerId(): string {
    const st = this.store.getState();
    return st.call?.peer?.id ?? '';
  }

  // подписка на сигналинг текущего сокета (безопасно вызывать повторно)
  attach(socket: any) {
    if (!socket) return;
    // дебаг-доступ к сокету в консоли (трассировка call:* событий)
    try { (window as any).__socket = socket; } catch {}
    for (const evt of ['call:incoming', 'call:ringing', 'call:accepted', 'call:ended', 'call:signal']) {
      socket.off(evt);
    }
    socket.on('call:incoming', ({ callId, from, kind }: any) => {
      const st = this.store.getState();
      if (st.call) { socket.emit('call:decline', { callId }); return; }
      startRingSound('incoming');
      st.setCall({ phase: 'incoming', callId, kind, peer: st.userById(from) ?? { id: from, name: '…', username: '', bio: '', avatar: null, cover: null, premium: false, lastSeen: null, settings: {} } as any });
      this.callId = callId;
      this.kind = kind;
      this.role = 'callee';
      this.ended = false;
      clearTimeout(this.autoDeclineTimer);
      this.autoDeclineTimer = setTimeout(() => this.decline('noanswer'), AUTO_DECLINE_MS);
    });
    socket.on('call:ringing', ({ callId }: any) => {
      if (callId !== this.callId) return;
      startRingSound('outgoing');
      this.patch({ phase: 'outgoing' });
    });
    socket.on('call:accepted', async ({ callId }: any) => {
      stopRingSound();
      if (callId !== this.callId || this.role !== 'caller' || this.ended) return;
      await this.ensurePC();
      this.patch({ phase: 'connecting' });
    });
    socket.on('call:ended', ({ callId, reason }: any) => {
      if (callId !== this.callId) return;
      this.handleEnded(reason);
    });
    socket.on('call:signal', async ({ callId, from, data }: any) => {
      if (callId !== this.callId) return;
      try {
        if (data.type === 'offer') {
          await this.ensurePC();
          await this.pc!.setRemoteDescription(new RTCSessionDescription(data.sdp));
          // после успешного обмена оффером обе стороны свободны инициировать renegotiation
          this.calleeLocked = false;
          for (const c of this.pendingIce) { try { await this.pc!.addIceCandidate(c); } catch {} }
          this.pendingIce = [];
          const answer = await this.pc!.createAnswer();
          await this.pc!.setLocalDescription(answer);
          getSocket()?.emit('call:signal', { callId, to: from, data: { type: 'answer', sdp: answer } });
          void this.computeFingerprint();
        } else if (data.type === 'answer') {
          await this.pc?.setRemoteDescription(new RTCSessionDescription(data.sdp));
          for (const c of this.pendingIce) { try { await this.pc!.addIceCandidate(c); } catch {} }
          this.pendingIce = [];
          this.calleeLocked = false;
          void this.computeFingerprint();
        } else if (data.type === 'ice') {
          if (this.pc?.remoteDescription) { try { await this.pc.addIceCandidate(data.candidate); } catch {} }
          else this.pendingIce.push(data.candidate);
        } else if (data.type === 'fx') {
          this.remoteFx = data.fx;
        }
      } catch (e) { console.warn('signal err', e); }
    });
    // состояния собеседника (видео/экран включены удалённо)
    socket.on('call:state', ({ callId, data }: any) => {
      if (callId !== this.callId || !data) return;
      const patch: any = {};
      if (data.kind) patch.kind = data.kind;
      if (data.screenOn != null) {
        patch.remoteScreen = data.screenOn;
        if (data.screenQ != null) patch.remoteScreenQ = data.screenQ; else if (!data.screenOn) patch.remoteScreenQ = '';
        if (data.screenOn) {
          // экран включили раньше прихода трека: помечаем последний имеющийся видео-трек
          if (!this.remoteScreenTrack) {
            const vts = this.remoteStream?.getVideoTracks() ?? [];
            const last = vts[vts.length - 1];
            if (last) { this.remoteScreenTrack = last; this.remoteScreenStream = new MediaStream([last]); this.onRemote?.(this.remoteStream!); }
          }
        } else if (this.remoteScreenTrack) {
          const dead = this.remoteScreenTrack;
          this.remoteScreenTrack = null;
          this.remoteScreenStream = null;
          try { this.remoteStream?.removeTrack(dead); } catch {}
          this.onRemote?.(this.remoteStream!);
        }
      }
      if (data.micOn != null) patch.remoteMicOn = data.micOn;
      this.patch(patch);
    });
  }

  get phaseReady() {
    return this.pc?.connectionState === 'connected';
  }

  async start(peerId: string, kind: 'voice' | 'video') {
    // защита от повторного старта (двойной клик / повторный рендер модалки)
    if (this.starting) return;
    this.starting = true;
    try {
      await this.startInner(peerId, kind);
    } finally { this.starting = false; }
  }

  private async startInner(peerId: string, kind: 'voice' | 'video') {
    this.callId = Math.random().toString(36).slice(2);
    this.kind = kind;
    this.role = 'caller';
    this.ended = false;
    const socket = getSocket();
    if (!socket) return;
    try {
      await this.initMic();
      if (kind === 'video') {
        try {
          const v = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 640, facingMode: 'user' } });
          this.localStream?.addTrack(v.getVideoTracks()[0]);
        } catch { /* видео может не быть — это аудиозвонок */ }
      }
    } catch {
      this.store.getState().pushToast({ kind: 'error', title: 'micAccess' });
      this.callId = '';
      return;
    }
    this.applyQuality(this.quality);
    if (this.onLocal && this.localStream) this.onLocal(this.localStream);
    this.startLevelMeter();
    socket.emit('call:start', { callId: this.callId, to: peerId, kind });
    const st = this.store.getState();
    this.store.getState().setCall({ phase: 'outgoing', callId: this.callId, kind, peer: st.userById(peerId) } as any);
  }

  private async initMic() {
    const audio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const video = this.localStream?.getVideoTracks() ?? [];
    this.localStream = new MediaStream([...audio.getTracks(), ...video]);
  }

  async accept(withVideo?: boolean) {
    stopRingSound();
    clearTimeout(this.autoDeclineTimer);
    this.autoDeclineTimer = null;
    const socket = getSocket();
    if (!socket) return;
    socket.emit('call:accept', { callId: this.callId });
    try {
      await this.initMic();
    } catch {
      this.store.getState().pushToast({ kind: 'error', title: 'micAccess' });
      socket.emit('call:decline', { callId: this.callId });
      this.cleanup();
      this.store.getState().setCall(null);
      return;
    }
    // «Ответить» на видеозвонок принимает без камеры; камера — через «Видео-ответ»/«Вкл. видео»
    if (this.kind === 'video' && withVideo === true) {
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 640 } });
        this.localStream?.addTrack(v.getVideoTracks()[0]);
        this.camOn = true;
      } catch { /* нет камеры — тонкий ответ без видео */ }
    } else if (this.kind === 'video' && withVideo !== true) {
      this.camOn = false;
    }
    await this.ensurePC();
    this.startLevelMeter();
    if (this.onLocal && this.localStream) this.onLocal(this.localStream);
    this.patch({ phase: 'connecting' });
  }

  async ensurePC() {
    if (this.pc) return;
    const socket = getSocket();
    if (!socket) return;
    this.pc = new RTCPeerConnection(ICE);
    this.remoteStream = new MediaStream();
    this.makingOffer = false;
    this.calleeLocked = this.role === 'callee';
    for (const t of this.localStream?.getTracks() ?? []) this.pc.addTrack(t, this.localStream!);
    this.pc.ontrack = (e) => {
      for (const rt of e.streams?.[0]?.getTracks() ?? []) this.remoteStream?.addTrack(rt);
      this.watchRemote(e.track);
      if (this.onRemote && this.remoteStream) this.onRemote(this.remoteStream);
      // чужая демонстрация: это ВТОРОЙ видео-трек (первый — камера) — либо первый, когда его явно включили
      if (e.track.kind === 'video') this.classifyScreenTrack(e.track);
      if (e.track.kind === 'audio') this.applySpeaker();
    };
    this.pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('call:signal', { callId: this.callId, to: this.peerId(), data: { type: 'ice', candidate: e.candidate } });
    };
    // Автоматическая пере-согласование: только caller создаёт первый оффер;
    // после отвеченного оффера обе стороны могут инициировать (screen/video/mic change).
    this.pc.onnegotiationneeded = async () => {
      if (this.calleeLocked && !this.pc?.remoteDescription) return;
      if (this.makingOffer) return;
      try {
        this.makingOffer = true;
        const offer = await this.pc!.createOffer();
        await this.pc!.setLocalDescription(offer);
        socket.emit('call:signal', { callId: this.callId, to: this.peerId(), data: { type: 'offer', sdp: offer } });
      } catch (e) { console.warn('negotiation', e); }
      finally { this.makingOffer = false; }
    };
    // Как в tdesktop: disconnected — «переподключение» (даём возможность восстановиться),
    // failed — окончательная неудача (ложится кнопка Повторить).
    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState;
      if (st === 'connected') {
        clearTimeout(this.reconnectTimer!);
        this.reconnectTimer = null;
        const cur = this.store.getState().call ?? {};
        if (cur.phase !== 'connected') this.patch({ phase: 'connected', startedAt: Date.now() });
        this.startStats();
      } else if (st === 'disconnected') {
        this.patch({ phase: 'reconnecting' });
        clearTimeout(this.reconnectTimer!);
        this.reconnectTimer = setTimeout(() => {
          if (this.pc?.connectionState !== 'connected' && !this.ended) {
            this.patch({ phase: 'failed' });
            // сигнал второй стороне закрыть
            getSocket()?.emit('call:end', { callId: this.callId });
          }
        }, RECONNECT_GRACE_MS);
      } else if (st === 'failed') {
        clearTimeout(this.reconnectTimer!);
        if (!this.ended) {
          this.patch({ phase: 'failed' });
          getSocket()?.emit('call:end', { callId: this.callId });
        }
      }
      // 'closed' — штатное локальное закрытие, игнорируем
    };
  }

  async computeFingerprint() {
    try {
      const mine = this.pc?.localDescription?.sdp ?? '';
      const theirs = this.pc?.remoteDescription?.sdp ?? '';
      if (!mine || !theirs) return;
      const fpr = (s: string) => /a=fingerprint:sha-256\s+(\S+)/i.exec(s)?.[1] ?? '';
      const a = fpr(mine), b = fpr(theirs);
      if (!a || !b) return;
      const digest = await sha256(callFingerprintSeed(this.callId, a, b));
      const emo = emojiFingerprint(digest);
      if (emo && emo !== this.fingerprint) {
        this.fingerprint = emo;
        this.onFingerprint?.(emo);
      }
    } catch { /* fingerprint — некритично */ }
  }

  private watching = new Set<MediaStreamTrack>();
  private remoteMuted = false;
  private watchRemote(t: MediaStreamTrack) {
    if (this.watching.has(t)) return;
    this.watching.add(t);
    const update = () => {
      const audioMuted = [...this.watching].filter((x) => x.kind === 'audio').every((x) => x.muted);
      if (audioMuted !== this.remoteMuted) {
        this.remoteMuted = audioMuted;
        this.onRemoteMute?.(audioMuted);
      }
    };
    t.onmute = update;
    t.onunmute = update;
    // демонстрация закончилась у отправителя (стоп-кнопка браузера) — сразу убираем
    if (t.kind === 'video') {
      t.onended = () => {
        if (this.remoteScreenTrack === t) {
          this.remoteScreenTrack = null;
          this.remoteScreenStream = null;
          this.onRemote?.(this.remoteStream!);
        }
        // мёртвый трек не держим в общем потоке
        try { this.remoteStream?.removeTrack(t); } catch {}
      };
    }
  }

  // маркируем видео-трек как «экранный»: второй видео-трек (после камеры),
  // либо единственный, если флаг демонстрации уже пришёл по call:state
  private classifyScreenTrack(track: MediaStreamTrack) {
    const before = [...(this.remoteStream?.getVideoTracks() ?? [])].filter((t) => t !== track);
    if (before.length === 0 && !(this.store.getState().call as any)?.remoteScreen) return; // обычная камера
    this.remoteScreenTrack = track;
    this.remoteScreenStream = new MediaStream([track]);
    this.onRemote?.(this.remoteStream!);
  }

  private async applySpeaker() {
    if (this.speakerId && this.remoteStream) {
      const el = document.querySelector('audio[data-call-remote]') as HTMLAudioElement | null;
      try { await el?.setSinkId?.(this.speakerId); } catch {}
    }
  }

  /* ---- индикатор качества (как в tdesktop: связь по RTT) ---- */
  private startStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = setInterval(async () => {
      try {
        if (!this.pc || this.ended) return;
        const stats = await this.pc.getStats();
        let rtt = 0;
        stats.forEach((r: any) => {
          if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) {
            rtt = r.currentRoundTripTime * 1000;
          }
        });
        const q: ConnQuality = rtt <= 0 ? this.connQuality : rtt < 150 ? 'good' : rtt < 500 ? 'ok' : 'bad';
        if (q !== this.connQuality) {
          this.connQuality = q;
          this.onQuality?.(q);
        }
      } catch {}
    }, 2000);
  }

  /* ---- уровень микрофона (реальный, AudioContext, RMS по времени) ---- */
  private startLevelMeter() {
    try {
      const track = this.localStream?.getAudioTracks()[0];
      if (!track) return;
      this.stopLevelMeter();
      this.actx = new AudioContext();
      const src = this.actx.createMediaStreamSource(new MediaStream([track]));
      const an = this.actx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      this.levelTimer = setInterval(() => {
        if (!this.actx || this.ended) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        // инженерная оптика: тишина < .02 → 0; речь .05...25 растёт живо; крик > .5 → 1
        const lv = Math.max(0, Math.min(1, (rms - 0.02) * 4));
        this.onLevel?.(lv);
      }, 60);
    } catch {}
  }

  private stopLevelMeter() {
    if (this.levelTimer) { clearInterval(this.levelTimer); this.levelTimer = null; }
    try { void this.actx?.close(); } catch {}
    this.actx = null;
  }

  /* ---- устройства (реальные enumerateDevices/replaceTrack) ---- */
  async devices(kind: 'mic' | 'cam' | 'speaker'): Promise<MediaDeviceInfo[]> {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const map = { mic: 'audioinput', cam: 'videoinput', speaker: 'audiooutput' } as const;
      return list.filter((d) => d.kind === map[kind]);
    } catch { return []; }
  }

  currentDevice(kind: 'mic' | 'cam' | 'speaker'): string | undefined {
    if (kind === 'speaker') return this.speakerId;
    const tracks = kind === 'mic' ? this.localStream?.getAudioTracks() : this.localStream?.getVideoTracks();
    return tracks?.[0]?.getSettings().deviceId;
  }

  async switchDevice(kind: 'mic' | 'cam', deviceId: string): Promise<boolean> {
    try {
      const constraints: MediaStreamConstraints = kind === 'mic' ? { audio: { deviceId: { exact: deviceId } } as any, video: false } : { video: { deviceId: { exact: deviceId } }, audio: false };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      const nt = kind === 'mic' ? s.getAudioTracks()[0] : s.getVideoTracks()[0];
      if (!nt) return false;
      const old = kind === 'mic' ? this.localStream?.getAudioTracks()[0] : this.localStream?.getVideoTracks()[0];
      const sender = this.pc?.getSenders().find((x) => x.track?.kind === (kind === 'mic' ? 'audio' : 'video'));
      if (sender) await sender.replaceTrack(nt);
      else if (this.pc) {
        // выбора камеры в аудиозвонке: добавляем трек в соединение (апгрейд до видео)
        this.pc.addTrack(nt, this.localStream!);
        this.kind = 'video';
        this.patch({ kind: 'video' });
        this.sendState({ kind: 'video' });
        await this.renegotiate();
      }
      if (old) { try { old.stop(); } catch {} }
      this.localStream?.removeTrack(old!);
      this.localStream?.addTrack(nt);
      this.onLocal?.(this.localStream!);
      if (kind === 'mic') { this.toggleMic(this.micOn); this.startLevelMeter(); }
      return true;
    } catch { return false; }
  }

  async switchSpeaker(deviceId: string) {
    this.speakerId = deviceId;
    await this.applySpeaker();
  }

  async applyQuality(q: Quality) {
    this.quality = q;
    const { width, height, maxBitrate } = BITRATE[q];
    try {
      const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        const p = (sender as any).getParameters?.() ?? {};
        p.encodings ??= [{}];
        p.encodings[0].maxBitrate = maxBitrate;
        p.encodings[0].scaleResolutionDownBy = q === 'low' ? 2 : 1;
        await sender.setParameters(p);
      }
      const track = this.localStream?.getVideoTracks()[0];
      await track?.applyConstraints?.({ width, height } as any);
    } catch {}
  }

  toggleMic(on: boolean) {
    this.micOn = on;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.sendState({ micOn: on });
  }

  toggleCam(on: boolean) {
    // В реальном звонке выключение видео = снятие трека (renegotiate), а НЕ enabled=false:
    // при enabled=false партнёру продолжают идти чёрные кадры (экран «становится чёрным»).
    const track = this.localStream?.getVideoTracks()[0];
    if (!on) {
      this.camOn = false;
      if (track && this.pc) { void this.setVideo(false); return; }
      track && (track.enabled = false); // до подключения передачи ещё нет — глушим локально
      this.onLocal?.(this.localStream!);
      return;
    }
    // в аудиозвонке «включить камеру» = апгрейд до видео (реальное renegotiation)
    if (!track) { void this.setVideo(true); return; }
    this.camOn = true;
    track.enabled = true;
    this.onLocal?.(this.localStream!);
  }

  async setVideo(on: boolean) {
    try {
      if (on) {
        const v = await navigator.mediaDevices.getUserMedia({ video: this.quality === 'low' ? { width: 320, height: 320 } : { width: 640, height: 640 } });
        this.localStream?.addTrack(v.getVideoTracks()[0]);
        if (this.pc) {
          this.pc.addTrack(this.localStream!.getVideoTracks()[0], this.localStream!);
          this.patch({ kind: 'video' });
        } else {
          this.kind = 'video';
        }
        this.camOn = true;
        this.onLocal?.(this.localStream!);
        this.sendState({ kind: 'video' });
      } else {
        const track = this.localStream?.getVideoTracks()[0];
        if (track) {
          const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
          if (sender && this.screenOn === false) {
            try { await sender.replaceTrack(null); } catch {}
          }
          this.localStream?.removeTrack(track);
          try { track.stop(); } catch {}
          await this.renegotiate();
          if (!this.screenOn) { this.kind = 'voice'; this.patch({ kind: 'voice' }); this.sendState({ kind: 'voice' }); }
        }
      }
    } catch {}
  }

  async flipCamera() {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps: any = track.getCapabilities?.() ?? {};
      if (!caps.facingMode) return;
      const next = (caps.facingMode as any).includes?.('environment') ? 'user' : 'environment';
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false });
      const nv = s.getVideoTracks()[0];
      const sender = this.pc?.getSenders().find((x) => x.track?.kind === 'video');
      if (sender) await sender.replaceTrack(nv);
      this.localStream?.removeTrack(track);
      try { track.stop(); } catch {}
      this.localStream?.addTrack(nv);
      this.onLocal?.(this.localStream!);
      if (this.screenOn) this.stopScreen();
    } catch {}
  }

  /* ---- демонстрация экрана (механика tdesktop: доступна и в голосовом) ---- */
  private sendState(patch: any) {
    // ВАЖНО: from — это МОЙ id (раньше ошибочно шел peerId, сервер и вторая сторона
    // не могли отличить, кто из двух участников прислал состояние)
    const me = this.store.getState().me;
    getSocket()?.emit('call:state', { callId: this.callId, from: me?.id ?? '', to: this.peerId(), data: patch });
  }

  async toggleScreen(on: boolean, presetId = this.screenQuality) {
    try {
      if (on) {
        const preset = SCREEN_PRESETS.find((p) => p.id === presetId) ?? SCREEN_PRESETS.find((p) => p.id === '720p')!;
        this.screenQuality = preset.id;
        const video: any = preset.w
          ? { width: { ideal: preset.w }, height: { ideal: preset.h }, frameRate: { ideal: preset.fps } }
          : { frameRate: { max: 60 } };
        const s = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
        this.screenStream = s;
        const track = s.getVideoTracks()[0];
        // честное качество: дожимаем трек до выбранного пресета, если браузер ограничение не применил
        try {
          if (preset.w) await track.applyConstraints({ width: { max: preset.w }, height: { max: preset.h }, frameRate: { max: preset.fps } } as any);
        } catch {}
        try { track.contentHint = 'detail'; } catch {}
        track.onended = () => this.stopScreen();
        // экран идёт ОТДЕЛЬНЫМ треком (вторая m-line, как в tdesktop) — камера не заменяется
        if (this.pc) {
          this.pc.addTrack(track, this.screenStream ?? new MediaStream([track]));
          await this.renegotiate();
        } else {
          // исходящий ещё не принят: трек попадёт в первый оффер вместе с остальными
          this.localStream?.addTrack(track);
        }
        this.screenOn = true;
        this.screenQuality = preset.id;
        this.onScreen?.(new MediaStream([track]));
        if (this.kind !== 'video') { this.kind = 'video'; this.patch({ kind: 'video' }); }
        this.sendState({ screenOn: true, kind: 'video', screenQ: preset.id });
      } else {
        await this.stopScreen();
        this.sendState({ screenOn: false, kind: this.kind, screenQ: null });
      }
    } catch {}
  }

  async stopScreen() {
    this.screenOn = false;
    const track = this.screenStream?.getVideoTracks()[0];
    this.screenStream = null;
    this.onScreen?.(null);
    if (!track) return;
    try { track.stop(); } catch {}
    // экран шёл своим треком (вторая m-line): снимаем именно его sender, камеру не трогаем
    const screenSender = this.pc?.getSenders().find((s) => s.track === track);
    if (screenSender && this.pc) {
      try { this.pc.removeTrack(screenSender); } catch {}
      await this.renegotiate();
    }
    if (this.localStream) {
      this.localStream = new MediaStream(this.localStream.getTracks().filter((t) => t !== track));
    }
    // экран шёл в аудиозвонке — возвращаемся к чистому звуку,
    // НО если собеседник ещё показывает свой экран — звонок остаётся «видео»
    if (!this.localStream?.getVideoTracks().length) {
      const stillRemote = !!(this.store.getState().call as any)?.remoteScreen;
      if (!stillRemote) {
        this.kind = 'voice';
        this.patch({ kind: this.kind });
      }
    }
    this.onLocal?.(this.localStream!);
  }

  /** Пере-согласование при изменении трека (используется, когда negotiationneeded не сработал) */
  async renegotiate() {
    try {
      if (!this.pc || this.makingOffer) return;
      if (this.calleeLocked && !this.pc.remoteDescription) return;
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      getSocket()?.emit('call:signal', { callId: this.callId, to: this.peerId(), data: { type: 'offer', sdp: offer } });
    } catch {}
    finally { this.makingOffer = false; }
  }

  /* ---- Повторить после сбоя (механика tdesktop: crank retry) ---- */
  async retry() {
    const prev = this.kind;
    try { this.pc?.close(); } catch {}
    this.pc = null;
    this.kind = prev;
    this.ended = false;
    clearTimeout(this.reconnectTimer!);
    this.reconnectTimer = null;
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
    // пере-инициализация: берём реальные треки заново (мог отвалиться)
    try {
      await this.initMic();
      if (this.kind === 'video' || this.localStream?.getVideoTracks().length) {
        if (!this.localStream?.getVideoTracks().length) {
          const v = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 640 } });
          this.localStream?.addTrack(v.getVideoTracks()[0]);
        }
      }
      this.onLocal?.(this.localStream!);
    } catch { /* без микрофона всё равно пробуем пере-negotiation */ }
    await this.ensurePC();
    this.patch({ phase: 'connecting' });
  }

  decline(reason = 'declined') {
    clearTimeout(this.autoDeclineTimer);
    this.autoDeclineTimer = null;
    try { getSocket()?.emit('call:decline', { callId: this.callId }); } catch {}
    // закрытие экрана звонка гарантировано — даже если что-то аварийно падает в cleanup/звуке
    try { this.cleanup(); } catch {}
    try { soundEnd('hangup'); } catch {}
    this.store.getState().setCall(null);
    this.store.getState().pushToast({ kind: 'call', title: reason === 'noanswer' ? 'unanswered' : 'declined' });
  }

  // единый гарантированный путь закрытия: экран закрывается ВСЕГДА, любые ошибки изолируются
  private closeCall(endedReason: string, toast?: string) {
    // tdesktop calls_rate_call: оценка появляется только после реально соединившегося звонка
    const before = this.store.getState().call;
    if (before?.startedAt && before.peer) {
      const durMs = Date.now() - before.startedAt;
      if (durMs > 3000) this.store.getState().pushRateCall({ peer: before.peer, kind: before.kind, durMs });
    }
    try { this.cleanup(); } catch {}
    try { soundEnd('hangup'); } catch {}
    try { stopRingSound(); } catch {}
    this.store.getState().setCall(null);
    if (toast && endedReason !== 'ended') this.store.getState().pushToast({ kind: 'call', title: toast as any });
  }

  handleEnded(reason?: string) {
    clearTimeout(this.autoDeclineTimer);
    this.autoDeclineTimer = null;
    this.closeCall(reason ?? 'ended');
  }

  hangup() {
    try { getSocket()?.emit('call:end', { callId: this.callId }); } catch {}
    clearTimeout(this.autoDeclineTimer);
    this.autoDeclineTimer = null;
    this.closeCall('ended');
  }

  cleanup() {
    this.ended = true;
    stopRingSound();
    clearTimeout(this.autoDeclineTimer);
    clearTimeout(this.reconnectTimer);
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
    this.stopLevelMeter();
    try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.screenStream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.pc?.close(); } catch {}
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.screenStream = null;
    this.screenOn = false;
    this.screenQuality = '720p';
    this.screenStream = null;
    this.remoteScreenTrack = null;
    this.remoteScreenStream = null;
    this.remoteScreenQuality = '';
    this.fingerprint = '';
    // ВАЖНО: onRemote/onLocal/onScreen НЕ обнуляем — CallOverlay монтируется один раз
    // на всё приложение, и его колбэки должны пережить cleanup для следующего звонка.
  }
}
