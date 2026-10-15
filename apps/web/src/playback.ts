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
// Collection files and YouTube audio both stream from the local server.
export const mediaUrl = (item: MediaItem) =>
  item.source === "youtube"
    ? `/api/v1/media/youtube/${encodeURIComponent(item.id.slice("youtube:".length))}`
    : `/api/v1/media/local/${encodeURIComponent(item.id)}`;
export const trackFailed = "This track couldn't be played.";

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
  private timeout: number | null = null;
  private onEnded: (() => void) | null = null;
  private activeItemId: string | null = null;
  private reconnects = 0;
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
      // stop() releases the lock just before the next item asks for it again,
      // and the release lands a moment later. Wait briefly so a track change
      // in this tab isn't mistaken for another tab playing.
      void navigator.locks
        .request(
          "music-agent-playback",
          { signal: AbortSignal.timeout(1000) },
          (lock) => {
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
          },
        )
        .catch(() => {
          if (!settled) resolve(false);
        });
    });
  }
  stop() {
    const epoch = this.state.epoch + 1;
    if (this.timeout !== null) window.clearTimeout(this.timeout);
    this.timeout = null;
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
    this.activeItemId = null;
    this.update({
      epoch,
      status: "stopped",
      elapsed: 0,
      duration: null,
      error: undefined,
    });
    return epoch;
  }
  private audioEvents(audio: HTMLAudioElement, epoch: number, trackUrl?: string) {
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
      if (!this.valid(epoch) || (trackUrl && this.reconnect(audio, epoch, trackUrl)))
        return;
      this.update({
        status: "failed",
        error: trackUrl
          ? trackFailed
          : "The live stream stopped. Try Listen live again.",
      });
    });
  }
  // A connection that drops mid-track reloads the stream where it stopped.
  private reconnect(audio: HTMLAudioElement, epoch: number, url: string) {
    const position = audio.currentTime;
    if (this.reconnects >= 2 || !position) return false;
    this.reconnects++;
    audio.addEventListener(
      "loadedmetadata",
      () => {
        if (this.valid(epoch)) audio.currentTime = position;
      },
      { once: true },
    );
    audio.src = url;
    this.update({ status: "loading", error: undefined });
    this.failIfStalled(audio, epoch);
    void this.playAudio(audio, epoch);
    return true;
  }
  private failIfStalled(audio: HTMLAudioElement, epoch: number) {
    if (this.timeout !== null) window.clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => {
      if (this.valid(epoch) && this.state.status === "loading") {
        audio.pause();
        this.update({ status: "failed", error: trackFailed });
      }
    }, 30000);
  }
  async playTrack(item: MediaItem) {
    const epoch = this.stop();
    if (!(await this.ownPlayback(epoch)) || !this.valid(epoch)) {
      if (this.valid(epoch))
        this.update({
          status: "failed",
          error: "Another tab is playing. Stop it before playing here.",
        });
      return;
    }
    const url = mediaUrl(item);
    const audio = new Audio(url);
    audio.preload = "auto";
    this.audio = audio;
    this.activeItemId = item.id;
    this.reconnects = 0;
    audio.volume = this.state.volume;
    audio.muted = this.state.muted;
    this.audioEvents(audio, epoch, url);
    this.update({ status: "loading", duration: item.durationSeconds ?? null });
    this.failIfStalled(audio, epoch);
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
  async resume() {
    if (!this.audio) return;
    this.update({ status: "loading" });
    await this.playAudio(this.audio, this.state.epoch);
  }
  async playOrResume(item: MediaItem) {
    const resumable =
      this.activeItemId === item.id &&
      this.audio &&
      (this.state.status === "paused" || this.state.status === "needsGesture");
    if (resumable) return this.resume();
    return this.playTrack(item);
  }
  pause() {
    this.audio?.pause();
  }
  seek(seconds: number) {
    if (this.audio && Number.isFinite(this.audio.duration))
      this.audio.currentTime = seconds;
  }
  setVolume(value: number) {
    if (this.audio) this.audio.volume = value;
    this.update({ volume: value });
  }
  toggleMute() {
    const muted = !this.state.muted;
    if (this.audio) this.audio.muted = muted;
    this.update({ muted });
  }
  dispose() {
    this.stop();
    this.listeners.clear();
  }
}
