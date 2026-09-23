import type Hls from "hls.js";
import type { MediaItem, StationResolution } from "@music/contracts";

export type PlaybackStatus =
  | "stopped"
  | "loading"
  | "playing"
  | "paused"
  | "needsGesture"
  | "failed"
  | "ended";
export type PlaybackState = {
  status: PlaybackStatus;
  elapsed: number;
  duration: number | null;
  volume: number;
  muted: boolean;
  error?: string;
  epoch: number;
};
type Listener = (state: PlaybackState) => void;
type YoutubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  destroy(): void;
  setVolume(value: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(value: number, allowSeekAhead: boolean): void;
};
type YoutubeApi = {
  Player: new (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => YoutubePlayer;
};
declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeReady: Promise<YoutubeApi> | undefined;
function loadYoutube(): Promise<YoutubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeReady)
    youtubeReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () =>
        reject(new Error("YouTube player could not load."));
      window.onYouTubeIframeAPIReady = () =>
        window.YT
          ? resolve(window.YT)
          : reject(new Error("YouTube player could not load."));
      document.head.append(script);
    });
  return youtubeReady;
}

export class PlaybackController {
  private state: PlaybackState = {
    status: "stopped",
    elapsed: 0,
    duration: null,
    volume: 0.8,
    muted: false,
    epoch: 0,
  };
  private listeners = new Set<Listener>();
  private audio: HTMLAudioElement | null = null;
  private hls: Hls | null = null;
  private youtube: YoutubePlayer | null = null;
  private youtubeHost: HTMLElement | null = null;
  private pendingVideo: string | null = null;
  private timer: number | null = null;
  private timeout: number | null = null;
  private onEnded: (() => void) | null = null;
  private activeKind: "audio" | "youtube" | null = null;
  private lockRelease: (() => void) | null = null;
  private lockHeld = false;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  setEndedHandler(handler: () => void) {
    this.onEnded = handler;
  }
  snapshot() {
    return this.state;
  }
  private update(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }
  private valid(epoch: number) {
    return epoch === this.state.epoch;
  }
  private async ownPlayback(epoch: number): Promise<boolean> {
    if (this.lockHeld || !navigator.locks) return true;
    let settled = false;
    return new Promise((resolve) => {
      void navigator.locks
        .request("music-agent-playback", { ifAvailable: true }, (lock) => {
          if (!lock || !this.valid(epoch)) {
            resolve(false);
            return;
          }
          this.lockHeld = true;
          settled = true;
          resolve(true);
          return new Promise<void>((done) => {
            this.lockRelease = () => {
              this.lockHeld = false;
              this.lockRelease = null;
              done();
            };
          });
        })
        .catch(() => {
          if (!settled) resolve(false);
        });
    });
  }
  stop() {
    const epoch = this.state.epoch + 1;
    if (this.timeout !== null) window.clearTimeout(this.timeout);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timeout = this.timer = null;
    this.pendingVideo = null;
    this.youtube?.stopVideo();
    this.youtube?.destroy();
    this.youtube = null;
    this.hls?.stopLoad();
    this.hls?.destroy();
    this.hls = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    this.lockRelease?.();
    this.activeKind = null;
    this.update({
      epoch,
      status: "stopped",
      elapsed: 0,
      duration: null,
      error: undefined,
    });
    return epoch;
  }
  setYoutubeHost(host: HTMLElement | null) {
    this.youtubeHost = host;
    if (host && this.pendingVideo)
      void this.mountYoutube(this.pendingVideo, this.state.epoch);
  }
  private audioEvents(audio: HTMLAudioElement, epoch: number) {
    audio.addEventListener("playing", () => {
      if (this.valid(epoch) && this.state.status !== "failed") {
        if (this.timeout !== null) window.clearTimeout(this.timeout);
        this.update({ status: "playing", error: undefined });
      }
    });
    audio.addEventListener("pause", () => {
      if (this.valid(epoch) && this.state.status === "playing")
        this.update({ status: "paused" });
    });
    audio.addEventListener("timeupdate", () => {
      if (this.valid(epoch)) this.update({ elapsed: audio.currentTime || 0 });
    });
    audio.addEventListener("durationchange", () => {
      if (this.valid(epoch))
        this.update({
          duration: Number.isFinite(audio.duration) ? audio.duration : null,
        });
    });
    audio.addEventListener("ended", () => {
      if (this.valid(epoch)) {
        this.update({ status: "ended" });
        this.onEnded?.();
      }
    });
    audio.addEventListener("error", () => {
      if (this.valid(epoch))
        this.update({
          status: "failed",
          error:
            "This audio could not be played. Choose another item or try again.",
        });
    });
  }
  async playLocal(item: MediaItem) {
    const epoch = this.stop();
    if (!(await this.ownPlayback(epoch)) || !this.valid(epoch)) {
      if (this.valid(epoch))
        this.update({
          status: "failed",
          error: "Another tab is playing. Stop it before playing here.",
        });
      return;
    }
    const audio = new Audio(
      `/api/v1/media/local/${encodeURIComponent(item.id)}`,
    );
    this.audio = audio;
    this.activeKind = "audio";
    audio.volume = this.state.volume;
    audio.muted = this.state.muted;
    this.audioEvents(audio, epoch);
    this.update({ status: "loading" });
    await this.playAudio(audio, epoch);
  }
  async playStation(resolution: StationResolution) {
    const epoch = this.stop();
    if (!(await this.ownPlayback(epoch)) || !this.valid(epoch)) {
      if (this.valid(epoch))
        this.update({
          status: "failed",
          error: "Another tab is playing. Stop it before listening here.",
        });
      return;
    }
    const audio = new Audio();
    this.audio = audio;
    this.activeKind = "audio";
    audio.volume = this.state.volume;
    audio.muted = this.state.muted;
    this.audioEvents(audio, epoch);
    this.update({ status: "loading" });
    if (resolution.playbackKind === "hls") {
      try {
        const { default: HlsRuntime } = await import("hls.js");
        if (!this.valid(epoch)) return;
        if (HlsRuntime.isSupported()) {
          const hls = new HlsRuntime({ maxBufferLength: 30 });
          this.hls = hls;
          hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
            if (data.fatal && this.valid(epoch))
              this.update({
                status: "failed",
                error: "The live stream stopped. Try Listen live again.",
              });
          });
          hls.loadSource(resolution.url);
          hls.attachMedia(audio);
          hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
            if (this.valid(epoch) && this.state.status === "loading")
              void this.playAudio(audio, epoch);
          });
        } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
          audio.src = resolution.url;
          await this.playAudio(audio, epoch);
        } else {
          this.update({
            status: "failed",
            error: "This browser cannot play the station’s HLS stream.",
          });
        }
      } catch {
        if (this.valid(epoch))
          this.update({
            status: "failed",
            error: "The live player could not load. Try again.",
          });
      }
    } else if (
      resolution.playbackKind === "direct-audio" ||
      audio.canPlayType("application/vnd.apple.mpegurl")
    ) {
      audio.src = resolution.url;
      await this.playAudio(audio, epoch);
    } else
      this.update({
        status: "failed",
        error: "This browser cannot play the station’s HLS stream.",
      });
    this.timeout = window.setTimeout(() => {
      if (this.valid(epoch) && this.state.status === "loading") {
        this.hls?.stopLoad();
        audio.pause();
        this.update({
          status: "failed",
          error: "The station did not connect. Try again.",
        });
      }
    }, 20000);
  }
  private async playAudio(audio: HTMLAudioElement, epoch: number) {
    try {
      await audio.play();
    } catch (error) {
      if (!this.valid(epoch)) return;
      this.update({
        status:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "needsGesture"
            : "failed",
        error:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Press Play to start listening."
            : "Playback could not start. Try again.",
      });
    }
  }
  async playYoutube(item: MediaItem) {
    const epoch = this.stop();
    if (!(await this.ownPlayback(epoch)) || !this.valid(epoch)) {
      if (this.valid(epoch))
        this.update({
          status: "failed",
          error: "Another tab is playing. Stop it before playing here.",
        });
      return;
    }
    this.activeKind = "youtube";
    this.pendingVideo = item.id.slice(8);
    this.update({ status: "loading" });
    if (this.youtubeHost) await this.mountYoutube(this.pendingVideo, epoch);
  }
  private async mountYoutube(videoId: string, epoch: number) {
    const host = this.youtubeHost;
    if (!host) return;
    try {
      const YT = await loadYoutube();
      if (!this.valid(epoch) || host !== this.youtubeHost) return;
      host.replaceChildren();
      const target = document.createElement("div");
      host.append(target);
      this.youtube = new YT.Player(target, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { controls: 1, playsinline: 1, origin: location.origin },
        events: {
          onReady: () => {
            if (!this.valid(epoch)) return;
            this.youtube?.setVolume(Math.round(this.state.volume * 100));
            if (this.state.muted) this.youtube?.mute();
            this.youtube?.playVideo();
            this.timer = window.setInterval(() => {
              if (this.valid(epoch) && this.youtube)
                this.update({
                  elapsed: this.youtube.getCurrentTime() || 0,
                  duration: this.youtube.getDuration() || null,
                });
            }, 1000);
          },
          onStateChange: (event: { data: number }) => {
            if (!this.valid(epoch)) return;
            if (event.data === 1)
              this.update({ status: "playing", error: undefined });
            if (event.data === 2) this.update({ status: "paused" });
            if (event.data === 0) {
              this.update({ status: "ended" });
              this.onEnded?.();
            }
          },
          onError: () => {
            if (this.valid(epoch))
              this.update({
                status: "failed",
                error: "This video cannot be played here. Choose another.",
              });
          },
        },
      });
      this.timeout = window.setTimeout(() => {
        if (this.valid(epoch) && this.state.status === "loading")
          this.update({
            status: "needsGesture",
            error: "Press Play in the video or below to start.",
          });
      }, 12000);
    } catch (error) {
      if (this.valid(epoch))
        this.update({
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "YouTube player could not load.",
        });
    }
  }
  async resume() {
    const epoch = this.state.epoch;
    if (this.activeKind === "audio" && this.audio) {
      this.update({ status: "loading" });
      await this.playAudio(this.audio, epoch);
    }
    if (this.activeKind === "youtube" && this.youtube) {
      this.youtube.playVideo();
      this.update({ status: "loading" });
    }
  }
  pause() {
    if (this.activeKind === "audio") this.audio?.pause();
    else this.youtube?.pauseVideo();
  }
  seek(seconds: number) {
    if (this.audio && Number.isFinite(this.audio.duration))
      this.audio.currentTime = seconds;
    else this.youtube?.seekTo(seconds, true);
  }
  setVolume(value: number) {
    this.audio && (this.audio.volume = value);
    this.youtube?.setVolume(Math.round(value * 100));
    this.update({ volume: value });
  }
  toggleMute() {
    const muted = !this.state.muted;
    if (this.audio) this.audio.muted = muted;
    if (muted) this.youtube?.mute();
    else this.youtube?.unMute();
    this.update({ muted });
  }
  dispose() {
    this.stop();
    this.listeners.clear();
  }
}
