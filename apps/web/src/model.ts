import { mediaItem, stationCatalog, stationId, type MediaItem, type StationId } from "@music/contracts";
import { ApiFailure } from "./api";

// The tab you look at. YouTube and Your collection also set where the DJ picks from.
export type Tab = "youtube" | "local" | "radio";
export type DjSource = "youtube" | "local";
export type Entry = { media: MediaItem; origin: "You" | "DJ pick"; reason?: string };
// What the player has loaded: a track, a live station, or nothing yet.
export type Now =
  | { kind: "track"; media: MediaItem; origin: Entry["origin"]; reason: string }
  | { kind: "station"; stationId: StationId }
  | null;
export type Reaction = "like" | "dislike" | "neutral";
export type Toast = { text: string; action?: { label: string; run: () => void } };

export const stations = stationId.options;
export const stationLabel = (id: StationId) => stationCatalog[id].label;
export const stationNote = (id: StationId) => stationCatalog[id].note;
export const sourceLabel: Record<DjSource, string> = { youtube: "YouTube", local: "your collection" };
export const artistOf = (media: MediaItem) => media.artist?.displayName || media.attribution || "Artist unknown";

// Server and job errors arrive as stable codes. People see a sentence.
const reasonText: Record<string, string> = {
  setup_required: "The DJ needs your Codex login. Sign in with your usual Codex CLI, then restart the server.",
  provider_auth_failed: "Your Codex login has expired. Sign in again with the Codex CLI, then restart the server.",
  provider_quota_exceeded: "Your Codex usage limit is reached. The DJ can pick again when it resets.",
  provider_unavailable: "Codex didn't answer. Try again in a moment.",
  unsupported_codex_version: "The server found a Codex version other than the pinned 0.156.1. Start the app with npm start.",
  codex_runtime_missing: "The pinned Codex runtime is missing. Run npm ci, then restart the server.",
  unsupported_codex_platform: "Codex doesn't support this platform.",
  codex_config_incompatible: "Your Codex config.toml has settings the DJ can't safely override for its jobs.",
  codex_models_unavailable: "Codex couldn't list the models it supports.",
  codex_cleanup_failed: "A previous Codex job couldn't be stopped. Restart the server.",
  ytdlp_starting: "YouTube is getting ready. Try again in a moment.",
  ytdlp_installing: "The app is installing yt-dlp, which plays YouTube. This takes a few seconds on first start.",
  ytdlp_install_failed: "The app couldn't download yt-dlp from GitHub. Check your connection and restart the server.",
  ytdlp_checksum_mismatch: "The downloaded yt-dlp didn't match its published checksum, so it wasn't installed. Restart the server to try again.",
  ytdlp_needs_python: "yt-dlp needs Python 3.10 or newer. Install python3, or set MUSIC_YTDLP_BIN to a standalone yt-dlp, then restart the server.",
  ytdlp_unavailable: "yt-dlp isn't working. Restart the server, or set MUSIC_YTDLP_BIN to your own yt-dlp.",
  ytdlp_failed: "yt-dlp couldn't reach YouTube. Try again in a moment.",
  youtube_bot_check: "YouTube asked to confirm you're not a bot. Wait a while, then try again.",
  youtube_stream_unavailable: "YouTube refused the audio stream. Try again.",
  deadline_exceeded: "The DJ took too long. Try again.",
  invalid_agent_output: "The DJ's answer didn't make sense. Try again.",
  revision_conflict: "Your likes changed at the same moment. Try again.",
  library_unavailable: "Your collection isn't available. Check Setup.",
  job_failed: "The DJ ran into a problem. Try again.",
};
export const describe = (error: unknown) => {
  if (error instanceof ApiFailure) return reasonText[error.message] || reasonText[error.code] || error.message;
  if (error instanceof Error) return reasonText[error.message] || error.message;
  return "Please try again.";
};
export const describeReason = (reason?: string) => (reason ? reasonText[reason] || reason : "");
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Listening keeps working when browser storage is disabled.
  }
}

// After a reload the app shows the last tab, station and track, without playing.
export function restoreListening(): { tab: Tab; djSource: DjSource; station: StationId; last: Now } {
  // Older versions kept the source, or the selected station, under one key.
  const legacy = stored("listening-source");
  const isStation = (value: string | null): value is StationId => Boolean(value && stations.includes(value as StationId));
  const savedTab = stored("listening-tab");
  const tab: Tab = savedTab === "youtube" || savedTab === "local" || savedTab === "radio" ? savedTab : legacy === "local" ? "local" : isStation(legacy) ? "radio" : "youtube";
  const savedSource = stored("dj-source");
  const djSource: DjSource = savedSource === "youtube" || savedSource === "local" ? savedSource : legacy === "local" ? "local" : "youtube";
  const savedStation = stored("listening-station") ?? legacy;
  let last: Now = null;
  try {
    const value = JSON.parse(stored("last-track") || "null");
    const media = mediaItem.safeParse(value?.media);
    if (media.success)
      last = { kind: "track", media: media.data, origin: value.origin === "You" ? "You" : "DJ pick", reason: typeof value.reason === "string" ? value.reason.slice(0, 300) : "" };
  } catch {
    // Nothing to restore.
  }
  return { tab, djSource, station: isStation(savedStation) ? savedStation : "kexp", last };
}
