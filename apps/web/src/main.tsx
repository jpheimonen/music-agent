import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  capabilities,
  trackPage,
  mediaItem,
  stationResolution,
  jobAccepted,
  job,
  recommendationResult,
  taste,
  feedbackResponse,
  artistInfo,
  type MediaItem,
  type Capabilities,
} from "@music/contracts";
import { api, json, ApiFailure } from "./api";
import { PlaybackController, type PlaybackState } from "./playback";
import "./style.css";

type Source = "local" | "youtube" | "kexp" | "yle1" | "radio-helsinki";
type Station = Exclude<Source, "local" | "youtube">;
type Entry = { media: MediaItem; origin: "You" | "DJ pick"; reason?: string };
type Theme = "system" | "light" | "dark";
const labels: Record<Source, string> = {
  local: "Your collection",
  youtube: "YouTube",
  kexp: "KEXP",
  yle1: "Yle Radio 1",
  "radio-helsinki": "Radio Helsinki",
};
const stationNotes: Record<Station, string> = {
  kexp: "Seattle · independent and eclectic",
  yle1: "Helsinki · classical, jazz and culture",
  "radio-helsinki": "Helsinki · alternative and local",
};
const stations: Station[] = ["kexp", "yle1", "radio-helsinki"];
const sources: Source[] = ["youtube", "local", ...stations];
const isRadio = (source: Source): source is Station =>
  source !== "local" && source !== "youtube";
const suggestions = [
  "Surprise me",
  "Something calm to focus to",
  "More energy",
  "Songs I haven't heard yet",
];

// Server and job errors arrive as stable codes. People see a sentence.
const reasonText: Record<string, string> = {
  codex_sandbox_blocked:
    "This computer blocks the sandbox Codex runs in, so the DJ is switched off to keep your files private. A one-time setup step fixes it.",
  codex_boundary_allowed_failed:
    "Codex's sandbox check failed, so the DJ is switched off to keep your files private.",
  codex_boundary_forbidden_failed:
    "Codex's sandbox let a test read a file it shouldn't, so the DJ is switched off to keep your files private.",
  setup_required:
    "The DJ needs your Codex login. Sign in with your usual Codex CLI, then restart the server.",
  provider_auth_failed:
    "Your Codex login has expired. Sign in again with the Codex CLI, then restart the server.",
  provider_quota_exceeded:
    "Your Codex usage limit is reached. The DJ can pick again when it resets.",
  provider_unavailable: "Codex didn't answer. Try again in a moment.",
  unsupported_codex_version:
    "The server found a Codex version other than the pinned 0.156.1. Start the app with npm start.",
  codex_runtime_missing:
    "The pinned Codex runtime is missing. Run npm ci, then restart the server.",
  unsupported_codex_platform: "Codex doesn't support this platform.",
  codex_config_incompatible:
    "Your Codex config.toml has settings the DJ can't safely override for its jobs.",
  codex_models_unavailable: "Codex couldn't list the models it supports.",
  codex_cleanup_failed:
    "A previous Codex job couldn't be stopped. Restart the server.",
  unsupported_search_runtime:
    "This Codex version can't search YouTube for the DJ.",
  search_provenance_unavailable:
    "The DJ's YouTube search returned results it couldn't verify. Try again.",
  deadline_exceeded: "The DJ took too long to choose. Try again.",
  invalid_agent_output: "The DJ's answer didn't make sense. Try again.",
  revision_conflict:
    "Your likes changed while the DJ was choosing. Ask again for fresh picks.",
  library_unavailable: "Your collection isn't available. Check Setup.",
  job_failed: "The DJ ran into a problem. Try again.",
};
const picksFailed =
  "Several picks couldn't play. Skip ahead or ask the DJ for something else.";
const describe = (error: unknown) => {
  if (error instanceof ApiFailure)
    return reasonText[error.message] || reasonText[error.code] || error.message;
  if (error instanceof Error) return reasonText[error.message] || error.message;
  return "Please try again.";
};
const describeReason = (reason?: string) =>
  reason ? reasonText[reason] || reason : "";
const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Listening keeps working when browser storage is disabled.
  }
}
function rememberedItems(): Partial<Record<"local" | "youtube", MediaItem>> {
  try {
    const value = JSON.parse(stored("listening-items") || "{}");
    const result: Partial<Record<"local" | "youtube", MediaItem>> = {};
    for (const source of ["local", "youtube"] as const) {
      const parsed = mediaItem.safeParse(value[source]);
      if (parsed.success && parsed.data.source === source)
        result[source] = parsed.data;
    }
    return result;
  } catch {
    return {};
  }
}
function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function App() {
  const player = useRef(new PlaybackController()).current;
  const [playback, setPlayback] = useState<PlaybackState>(player.snapshot());
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = stored("theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [source, setSource] = useState<Source>(() => {
    const saved = stored("listening-source");
    return sources.includes(saved as Source) ? (saved as Source) : "youtube";
  });
  const sourceRef = useRef(source);
  const lastStation = useRef<Station>(isRadio(source) ? source : "kexp");
  const epoch = useRef(0);
  const retained = useRef(rememberedItems());
  const [current, setCurrent] = useState<MediaItem | null>(
    source === "local" || source === "youtube"
      ? retained.current[source] || null
      : null,
  );
  const currentRef = useRef<MediaItem | null>(current);
  const [currentReason, setCurrentReason] = useState("");
  const [queue, setQueue] = useState<Entry[]>([]);
  const queueRef = useRef<Entry[]>([]);
  const [dj, setDj] = useState(false);
  const djRef = useRef(false);
  const [djPending, setDjPending] = useState(false);
  const [djError, setDjError] = useState("");
  const [request, setRequest] = useState("");
  const direction = useRef("");
  const [activeDirection, setActiveDirection] = useState("");
  const session = useRef(crypto.randomUUID());
  const waitingForContinuation = useRef(false);
  const failedCandidates = useRef(0);
  const handledFailureEpoch = useRef(-1);
  const jobAbort = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  const [cap, setCap] = useState<Capabilities | null>(null);
  const [capError, setCapError] = useState("");
  const [stationError, setStationError] = useState("");
  const [stationPending, setStationPending] = useState(false);
  const stationRequest = useRef(0);
  const [tracks, setTracks] = useState<MediaItem[]>([]);
  const libraryRequest = useRef(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [scanStatus, setScanStatus] = useState("");
  const [tasteData, setTasteData] = useState<ReturnType<
    typeof taste.parse
  > | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [pendingReaction, setPendingReaction] = useState<{
    id: string;
    value: "like" | "dislike" | "neutral";
  } | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{
    title: string;
    text: string;
    retry?: () => void;
  } | null>(null);
  const [artistData, setArtistData] = useState<ReturnType<
    typeof artistInfo.parse
  > | null>(null);
  const [artistExpanded, setArtistExpanded] = useState(false);
  const [panel, setPanel] = useState<"setup" | "taste" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const videoHost = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    applyTheme(theme);
    store("theme", theme);
  }, [theme]);

  const updateQueue = useCallback(
    (value: Entry[] | ((entries: Entry[]) => Entry[])) => {
      const next =
        typeof value === "function" ? value(queueRef.current) : value;
      queueRef.current = next;
      setQueue(next);
    },
    [],
  );
  const updateCurrent = useCallback((item: MediaItem | null) => {
    currentRef.current = item;
    setCurrent(item);
  }, []);
  const refreshCapabilities = useCallback(async () => {
    try {
      setCap(await api("/capabilities", capabilities));
      setCapError("");
    } catch (error) {
      setCapError(describe(error));
    }
  }, []);
  const refreshTaste = useCallback(async () => {
    try {
      setTasteData(await api("/taste", taste));
    } catch {
      /* The panel shows unavailable. */
    }
  }, []);
  const loadTracks = useCallback(
    async (search: string, nextCursor: string | null = null) => {
      const request = ++libraryRequest.current;
      try {
        const params = new URLSearchParams();
        if (search) params.set("q", search);
        if (nextCursor) params.set("cursor", nextCursor);
        const page = await api(`/library/tracks?${params}`, trackPage);
        if (request !== libraryRequest.current) return;
        setTracks((previous) =>
          nextCursor ? [...previous, ...page.items] : page.items,
        );
        setCursor(page.nextCursor);
        setLibraryError("");
      } catch (error) {
        if (request === libraryRequest.current)
          setLibraryError(describe(error));
      }
    },
    [],
  );
  const cancelJob = useCallback(() => {
    jobAbort.current?.abort();
    jobAbort.current = null;
    if (jobId.current)
      void fetch(`/api/v1/jobs/${jobId.current}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    jobId.current = null;
    setDjPending(false);
  }, []);
  const changeSource = (next: Source) => {
    if (next === sourceRef.current) return;
    cancelJob();
    epoch.current++;
    waitingForContinuation.current = false;
    stationRequest.current++;
    setStationPending(false);
    setStationError("");
    djRef.current = false;
    setDj(false);
    setDjError("");
    setActiveDirection("");
    player.stop();
    sourceRef.current = next;
    if (isRadio(next)) lastStation.current = next;
    setSource(next);
    store("listening-source", next);
    updateCurrent(
      next === "local" || next === "youtube"
        ? retained.current[next] || null
        : null,
    );
    setCurrentReason("");
    updateQueue([]);
    setAnnouncement(`${labels[next]} selected`);
  };
  const requestPicks = useCallback(
    async (requestSession: string, requestEpoch: number) => {
      if (jobAbort.current || !djRef.current || isRadio(sourceRef.current))
        return;
      const abort = new AbortController();
      jobAbort.current = abort;
      setDjPending(true);
      setDjError("");
      const steering = direction.current;
      try {
        const payload = {
          sessionId: requestSession,
          modeEpoch: requestEpoch,
          source: sourceRef.current,
          seedId: currentRef.current?.id,
          queuedIds: queueRef.current.map((item) => item.media.id),
          recentIds: currentRef.current ? [currentRef.current.id] : [],
          ...(steering ? { direction: steering } : {}),
        };
        const accepted = await api("/dj/recommendations", jobAccepted, {
          ...json(payload),
          signal: abort.signal,
        });
        jobId.current = accepted.jobId;
        for (;;) {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, 1300);
            abort.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new Error("Cancelled"));
              },
              { once: true },
            );
          });
          const state = await api(`/jobs/${accepted.jobId}`, job, {
            signal: abort.signal,
          });
          if (state.status === "failed" || state.status === "cancelled")
            throw new Error(
              state.error?.message || "The DJ couldn't find music this time.",
            );
          if (state.status !== "succeeded") continue;
          const result = recommendationResult.parse(state.result);
          if (
            abort.signal.aborted ||
            !djRef.current ||
            epoch.current !== requestEpoch ||
            session.current !== requestSession ||
            result.sessionId !== requestSession ||
            result.modeEpoch !== requestEpoch ||
            result.source !== sourceRef.current
          )
            return;
          const known = new Set([
            currentRef.current?.id,
            ...queueRef.current.map((entry) => entry.media.id),
          ]);
          const picks = result.items.filter(
            (item) =>
              item.media.source === sourceRef.current &&
              item.media.availability === "available" &&
              !known.has(item.media.id),
          );
          if (!picks.length)
            throw new Error(
              "The DJ didn't find anything new this time. Try asking for something different.",
            );
          updateQueue((entries) => [
            ...entries,
            ...picks.map((item) => ({
              media: item.media,
              origin: "DJ pick" as const,
              reason: item.reason,
            })),
          ]);
          setAnnouncement(
            `The DJ queued ${picks.length} pick${picks.length === 1 ? "" : "s"}`,
          );
          return;
        }
      } catch (error) {
        if (!abort.signal.aborted && epoch.current === requestEpoch)
          setDjError(describe(error));
      } finally {
        if (jobAbort.current === abort) {
          jobAbort.current = null;
          jobId.current = null;
          setDjPending(false);
        }
      }
    },
    [updateQueue],
  );
  // Starting or steering both send the request text and replace the DJ's
  // upcoming picks. Songs you queued yourself stay.
  const askDj = (text: string) => {
    const steering = text.trim().slice(0, 500);
    direction.current = steering;
    setActiveDirection(steering);
    setRequest("");
    cancelJob();
    updateQueue((entries) => entries.filter((entry) => entry.origin === "You"));
    if (!djRef.current) {
      djRef.current = true;
      setDj(true);
      session.current = crypto.randomUUID();
      waitingForContinuation.current =
        playback.status !== "playing" && playback.status !== "loading";
    }
    void requestPicks(session.current, epoch.current);
  };
  const stopDj = () => {
    djRef.current = false;
    waitingForContinuation.current = false;
    setDj(false);
    setDjError("");
    setActiveDirection("");
    cancelJob();
    updateQueue((entries) => entries.filter((entry) => entry.origin === "You"));
  };
  const choose = useCallback(
    (item: MediaItem, automatic = false, reason = "") => {
      if (
        item.source !== sourceRef.current ||
        item.availability !== "available"
      )
        return;
      waitingForContinuation.current = false;
      if (!automatic) failedCandidates.current = 0;
      retained.current[item.source] = item;
      store("listening-items", JSON.stringify(retained.current));
      updateCurrent(item);
      setCurrentReason(reason);
      setAnnouncement(`Now playing ${item.title}`);
      if (item.source === "local") void player.playLocal(item);
      else void player.playYoutube(item);
    },
    [player, updateCurrent],
  );
  const next = useCallback(() => {
    if (!queueRef.current.length) {
      waitingForContinuation.current = djRef.current;
      player.stop();
      if (djRef.current && !jobAbort.current)
        void requestPicks(session.current, epoch.current);
      return;
    }
    const [first, ...rest] = queueRef.current;
    updateQueue(rest);
    choose(first.media, true, first.reason);
    if (djRef.current && rest.length < 2 && !jobAbort.current)
      void requestPicks(session.current, epoch.current);
  }, [choose, player, requestPicks, updateQueue]);
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (playback.status === "playing") {
      failedCandidates.current = 0;
      setDjError((error) => (error === picksFailed ? "" : error));
      return;
    }
    if (
      playback.status !== "failed" ||
      !dj ||
      !queue.length ||
      handledFailureEpoch.current === playback.epoch
    )
      return;
    if (
      !playback.error?.startsWith("This audio") &&
      !playback.error?.startsWith("This video")
    )
      return;
    handledFailureEpoch.current = playback.epoch;
    failedCandidates.current++;
    if (failedCandidates.current <= 3) nextRef.current();
    else setDjError(picksFailed);
  }, [playback.status, playback.epoch, playback.error, dj, queue.length]);

  useEffect(() => {
    const off = player.subscribe(setPlayback);
    player.setEndedHandler(() => nextRef.current());
    return () => {
      off();
      player.dispose();
      cancelJob();
    };
  }, [player, cancelJob]);
  useEffect(() => {
    void refreshCapabilities();
    void refreshTaste();
  }, [refreshCapabilities, refreshTaste]);
  useEffect(() => {
    if (source !== "local") return;
    if (cap?.library.state === "not_configured") {
      setTracks([]);
      setLibraryError("");
      return;
    }
    if (cap?.library.state === "ready" || cap?.library.state === "scanning")
      void loadTracks(query);
  }, [source, query, loadTracks, cap?.library.state]);
  useEffect(() => {
    if (
      dj &&
      (waitingForContinuation.current || !current) &&
      queue.length &&
      playback.status !== "playing" &&
      playback.status !== "loading"
    )
      nextRef.current();
  }, [dj, current, queue.length, playback.status]);
  useEffect(() => {
    player.setYoutubeHost(source === "youtube" ? videoHost.current : null);
  }, [player, source, current]);
  useEffect(() => {
    const artist = current?.artist;
    setArtistData(null);
    setArtistExpanded(false);
    if (!artist || artist.confidence === "low") return;
    let active = true;
    void api(`/artists/${encodeURIComponent(artist.id)}/info`, artistInfo)
      .then((data) => {
        if (active && data.artistKey === artist.id) setArtistData(data);
      })
      .catch(() => {
        if (active) setArtistData({ artistKey: artist.id, status: "failed" });
      });
    return () => {
      active = false;
    };
  }, [current?.id, current?.artist?.id]);
  useEffect(() => {
    if (
      artistData?.status !== "pending" ||
      !artistData.jobId ||
      !current?.artist
    )
      return;
    const key = current.artist.id,
      id = artistData.jobId;
    let active = true;
    const timer = window.setInterval(() => {
      void api(`/jobs/${id}`, job)
        .then((state) => {
          if (
            !active ||
            state.status === "queued" ||
            state.status === "running"
          )
            return;
          window.clearInterval(timer);
          if (state.status === "succeeded")
            void api(
              `/artists/${encodeURIComponent(key)}/info`,
              artistInfo,
            ).then((info) => {
              if (active && info.artistKey === key) setArtistData(info);
            });
          else setArtistData({ artistKey: key, status: "failed" });
        })
        .catch(() => {
          if (active) {
            window.clearInterval(timer);
            setArtistData({ artistKey: key, status: "failed" });
          }
        });
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [artistData?.status, artistData?.jobId, current?.artist?.id]);
  useEffect(() => {
    if (!panel || !dialog.current) return;
    const node = dialog.current;
    node.showModal();
    node.querySelector<HTMLElement>("button")?.focus();
    const close = () => {
      setPanel(null);
      invoker.current?.focus();
    };
    node.addEventListener("close", close);
    return () => {
      node.removeEventListener("close", close);
      if (node.open) node.close();
    };
  }, [panel]);
  const openPanel = (
    which: "setup" | "taste",
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    invoker.current = event.currentTarget;
    setPanel(which);
    if (which === "taste") void refreshTaste();
    else void refreshCapabilities();
  };
  const listenRadio = async () => {
    const selected = sourceRef.current,
      requestEpoch = epoch.current;
    if (!isRadio(selected)) return;
    const request = ++stationRequest.current;
    setStationPending(true);
    setStationError("");
    player.stop();
    try {
      const stream = await api(
        `/stations/${selected}/resolve`,
        stationResolution,
        json({}),
      );
      if (
        request === stationRequest.current &&
        requestEpoch === epoch.current &&
        sourceRef.current === selected
      )
        await player.playStation(stream);
    } catch (error) {
      if (request === stationRequest.current && requestEpoch === epoch.current)
        setStationError(describe(error));
    } finally {
      if (request === stationRequest.current) setStationPending(false);
    }
  };
  const stopRadio = () => {
    stationRequest.current++;
    setStationPending(false);
    player.stop();
  };
  const retryArtist = async () => {
    const artist = current?.artist;
    if (!artist || artist.confidence === "low") return;
    try {
      const accepted = await api(
        `/artists/${encodeURIComponent(artist.id)}/info/refresh`,
        jobAccepted,
        json({}),
      );
      if (currentRef.current?.artist?.id === artist.id)
        setArtistData({
          artistKey: artist.id,
          status: "pending",
          jobId: accepted.jobId,
        });
    } catch {
      if (currentRef.current?.artist?.id === artist.id)
        setArtistData({ artistKey: artist.id, status: "failed" });
    }
  };
  const scan = async () => {
    setScanStatus("Scanning your collection…");
    try {
      const accepted = await api("/library/scans", jobAccepted, json({}));
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const state = await api(`/jobs/${accepted.jobId}`, job);
        if (state.status === "failed")
          throw new Error(state.error?.message || "The scan failed.");
        if (state.status === "succeeded") break;
      }
      setScanStatus("Scan complete.");
      void loadTracks(query);
      void refreshCapabilities();
    } catch (error) {
      setScanStatus(describe(error));
    }
  };
  const saveReaction = async (
    item: MediaItem,
    intended: "like" | "dislike" | "neutral",
    key = crypto.randomUUID(),
  ) => {
    if (feedbackBusy) return;
    setFeedbackBusy(true);
    setPendingReaction({ id: item.id, value: intended });
    setFeedbackNotice({ title: item.title, text: "Saving…" });
    try {
      const revision = (await api("/taste", taste)).feedbackRevision;
      const saved = await api(
        `/feedback/${encodeURIComponent(item.id)}`,
        feedbackResponse,
        {
          method: "PUT",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({
            reaction: intended,
            expectedRevision: revision,
            media: item,
          }),
        },
      );
      setTasteData((previous) =>
        previous
          ? {
              ...previous,
              feedbackRevision: saved.feedbackRevision,
              feedback: { ...previous.feedback, [item.id]: saved.reaction },
            }
          : previous,
      );
      setFeedbackNotice({
        title: item.title,
        text:
          saved.reaction === "like"
            ? "Liked. The DJ will remember."
            : saved.reaction === "dislike"
              ? "Disliked. The DJ won't pick it again."
              : "Reaction removed.",
      });
      void refreshTaste();
    } catch (error) {
      setFeedbackNotice({
        title: item.title,
        text: `Your reaction wasn’t saved: ${describe(error)}`,
        retry: () => {
          void saveReaction(item, intended, key);
        },
      });
    } finally {
      setFeedbackBusy(false);
      setPendingReaction(null);
    }
  };
  const addQueue = (item: MediaItem) => {
    if (
      item.source !== source ||
      queueRef.current.some((entry) => entry.media.id === item.id)
    )
      return;
    updateQueue((entries) => [
      ...entries.filter((entry) => entry.origin === "You"),
      { media: item, origin: "You" },
      ...entries.filter((entry) => entry.origin === "DJ pick"),
    ]);
    setAnnouncement(`${item.title} added to Up next`);
  };

  const djBlocker =
    !cap || isRadio(source)
      ? ""
      : cap.codex.state !== "ready"
        ? describeReason(cap.codex.reason) ||
          "The DJ needs your Codex login. Check Setup."
        : source === "youtube" && cap.youtubeDiscovery.state !== "ready"
          ? describeReason(cap.youtubeDiscovery.reason) ||
            "The DJ can't search YouTube right now."
          : source === "local" && cap.library.state !== "ready"
            ? cap.library.state === "not_configured"
              ? "Point the server at your MP3 folder first. Setup shows how."
              : "Your collection isn't ready yet. Check Setup."
            : "";
  const reaction = current
    ? pendingReaction?.id === current.id
      ? pendingReaction.value
      : tasteData?.feedback[current.id] || "neutral"
    : "neutral";
  const summaryUnavailable =
    tasteData?.summaryStatus === "pending" && cap?.codex.state !== "ready";
  const playing = playback.status === "playing";
  const radioLive = stationPending || playing || playback.status === "loading";

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="wordmark">
          Listening room<span>.</span>
        </div>
        <nav aria-label="App">
          <button
            className="text-button"
            onClick={(event) => openPanel("taste", event)}
          >
            Your taste
          </button>
          <button
            className="text-button"
            onClick={(event) => openPanel("setup", event)}
          >
            Setup
          </button>
          <label className="theme-picker">
            <span className="sr-only">Theme</span>
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
            >
              <option value="system">System theme</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </nav>
      </header>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {capError && (
        <div className="notice" role="alert">
          {capError}{" "}
          <button
            className="inline-button"
            onClick={() => {
              setCapError("");
              void refreshCapabilities();
            }}
          >
            Retry
          </button>
        </div>
      )}
      <main className="layout">
        <div className="stage">
          <section className="booth card" aria-labelledby="booth-heading">
            <div className="booth-top">
              <div className="eyebrow">YOUR AI DJ</div>
              <div
                className="mode-switch"
                role="group"
                aria-label="Where the music comes from"
              >
                <button
                  aria-pressed={source === "youtube"}
                  onClick={() => changeSource("youtube")}
                >
                  YouTube
                </button>
                <button
                  aria-pressed={source === "local"}
                  onClick={() => changeSource("local")}
                >
                  Your collection
                </button>
                <button
                  aria-pressed={isRadio(source)}
                  onClick={() => changeSource(lastStation.current)}
                >
                  Live radio
                </button>
              </div>
            </div>
            {isRadio(source) ? (
              <>
                <h1 id="booth-heading" className="booth-heading">
                  Tune in live
                </h1>
                <p className="subtle">
                  Real stations, real hosts. The DJ takes a break while you
                  listen.
                </p>
                <div className="station-list">
                  {stations.map((id) => (
                    <button
                      key={id}
                      className="station"
                      aria-pressed={source === id}
                      onClick={() => changeSource(id)}
                    >
                      <strong>{labels[id]}</strong>
                      <span>{stationNotes[id]}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : dj ? (
              <>
                <h1 id="booth-heading" className="booth-heading">
                  <span className="live-dot" aria-hidden="true" />
                  The DJ is on
                </h1>
                <p className="subtle">
                  Picking from{" "}
                  {source === "youtube" ? "YouTube" : "your collection"}
                  {activeDirection ? (
                    <>
                      {" "}
                      · you asked for <q>{activeDirection}</q>
                    </>
                  ) : (
                    " · following your taste"
                  )}
                </p>
                <form
                  className="ask"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (request.trim()) askDj(request);
                  }}
                >
                  <label htmlFor="ask" className="sr-only">
                    Steer the DJ
                  </label>
                  <input
                    id="ask"
                    value={request}
                    maxLength={500}
                    onChange={(event) => setRequest(event.target.value)}
                    placeholder="Steer the DJ: calmer, more guitar, 90s…"
                  />
                  <button className="primary-button" disabled={!request.trim()}>
                    Steer
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={stopDj}
                  >
                    Stop DJ
                  </button>
                </form>
              </>
            ) : (
              <>
                <h1 id="booth-heading" className="booth-heading">
                  What should we listen to?
                </h1>
                <p className="subtle">
                  {source === "youtube"
                    ? "Tell the DJ a mood, an artist or a moment. It finds the music on YouTube and keeps it going, guided by your likes."
                    : "Tell the DJ a mood, an artist or a moment. It picks from your own MP3s and keeps it going, guided by your likes."}
                </p>
                <form
                  className="ask"
                  onSubmit={(event) => {
                    event.preventDefault();
                    askDj(request);
                  }}
                >
                  <label htmlFor="ask" className="sr-only">
                    What you'd like to hear
                  </label>
                  <input
                    id="ask"
                    value={request}
                    maxLength={500}
                    onChange={(event) => setRequest(event.target.value)}
                    placeholder="Late-night jazz, something like Khruangbin…"
                  />
                  <button
                    className="primary-button"
                    disabled={Boolean(djBlocker) || !cap}
                  >
                    Start the DJ
                  </button>
                </form>
                <div className="suggestions" aria-label="Ideas">
                  {suggestions.map((idea) => (
                    <button
                      key={idea}
                      className="chip"
                      disabled={Boolean(djBlocker) || !cap}
                      onClick={() => askDj(idea === "Surprise me" ? "" : idea)}
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </>
            )}
            {!isRadio(source) && djBlocker && (
              <div className="blocker" role="note">
                <p>{djBlocker}</p>
                <button
                  className="inline-button"
                  onClick={(event) => openPanel("setup", event)}
                >
                  How to fix this
                </button>
              </div>
            )}
            {djPending && (
              <p className="dj-status" role="status">
                <span className="spinner" aria-hidden="true" />
                {source === "youtube"
                  ? "The DJ is searching YouTube for your next picks…"
                  : "The DJ is choosing from your collection…"}{" "}
                <button
                  className="inline-button"
                  onClick={() => {
                    cancelJob();
                    setDjError("Request cancelled.");
                  }}
                >
                  Cancel
                </button>
              </p>
            )}
            {djError && (
              <p className="error-text" role="alert">
                {djError}{" "}
                {dj && !djPending && (
                  <button
                    className="inline-button"
                    onClick={() =>
                      void requestPicks(session.current, epoch.current)
                    }
                  >
                    Try again
                  </button>
                )}
              </p>
            )}
          </section>

          <section className="now-playing card" aria-labelledby="now-heading">
            <div className="section-label" id="now-heading">
              NOW PLAYING
            </div>
            {isRadio(source) ? (
              <div className="radio-now">
                <div className="track-identity">
                  <div
                    className={`artwork-fallback ${playing ? "on-air" : ""}`}
                    aria-hidden="true"
                  >
                    ◉
                  </div>
                  <div>
                    <p className="state-line">
                      {playing
                        ? "LIVE"
                        : stationPending || playback.status === "loading"
                          ? "CONNECTING"
                          : stationError || playback.status === "failed"
                            ? "UNAVAILABLE"
                            : "OFF AIR"}
                    </p>
                    <h2 className="track-title">{labels[source]}</h2>
                    <p className="artist-name">{stationNotes[source]}</p>
                  </div>
                </div>
                <div className="transport">
                  <button
                    className="primary-button"
                    onClick={() =>
                      radioLive
                        ? stopRadio()
                        : playback.status === "needsGesture"
                          ? void player.resume()
                          : void listenRadio()
                    }
                  >
                    {radioLive
                      ? "Stop"
                      : playback.status === "needsGesture"
                        ? "Play"
                        : "Listen live"}
                  </button>
                </div>
                {stationError && (
                  <p className="error-text" role="alert">
                    Couldn’t connect to {labels[source]}: {stationError}{" "}
                    <button
                      className="inline-button"
                      onClick={() => void listenRadio()}
                    >
                      Retry
                    </button>
                  </p>
                )}
              </div>
            ) : (
              <>
                {source === "youtube" && current && (
                  <div
                    className="video-frame"
                    ref={videoHost}
                    aria-label="YouTube player"
                  />
                )}
                <div className="track-identity">
                  {current?.artwork && source === "local" ? (
                    <img className="artwork" src={current.artwork} alt="" />
                  ) : (
                    <div className="artwork-fallback" aria-hidden="true">
                      ♪
                    </div>
                  )}
                  <div>
                    <h2 className="track-title">
                      {current?.title || "Nothing playing yet"}
                    </h2>
                    <p className="artist-name">
                      {current
                        ? current.artist?.displayName ||
                          current.attribution ||
                          "Artist unknown"
                        : dj
                          ? "Your first pick starts as soon as the DJ has it."
                          : "Ask the DJ above and it will start the music."}
                    </p>
                    {current?.album && (
                      <p className="subtle">{current.album}</p>
                    )}
                  </div>
                </div>
                {current && currentReason && (
                  <p className="dj-note">
                    <span>Why the DJ picked this</span>
                    {currentReason}
                  </p>
                )}
                {current && (
                  <div className="transport">
                    <button
                      className="primary-button"
                      onClick={() =>
                        playing
                          ? player.pause()
                          : void player.playOrResume(current)
                      }
                    >
                      {playing ? "Pause" : "Play"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={!queue.length && !dj}
                      onClick={() => {
                        failedCandidates.current = 0;
                        next();
                      }}
                    >
                      Skip
                    </button>
                    <button
                      className={`reaction ${reaction === "like" ? "active" : ""}`}
                      aria-pressed={reaction === "like"}
                      disabled={feedbackBusy}
                      onClick={() =>
                        void saveReaction(
                          current,
                          reaction === "like" ? "neutral" : "like",
                        )
                      }
                    >
                      {reaction === "like" ? "♥" : "♡"} Like
                    </button>
                    <button
                      className={`reaction ${reaction === "dislike" ? "active" : ""}`}
                      aria-pressed={reaction === "dislike"}
                      disabled={feedbackBusy}
                      onClick={() =>
                        void saveReaction(
                          current,
                          reaction === "dislike" ? "neutral" : "dislike",
                        )
                      }
                    >
                      {reaction === "dislike" ? "✕" : "○"} Not for me
                    </button>
                  </div>
                )}
                {playback.duration !== null && playback.duration > 0 && (
                  <div className="seek">
                    <label htmlFor="seek" className="sr-only">
                      Position
                    </label>
                    <span>{formatTime(playback.elapsed)}</span>
                    <input
                      id="seek"
                      type="range"
                      min="0"
                      max={playback.duration}
                      value={Math.min(playback.elapsed, playback.duration)}
                      onChange={(event) =>
                        player.seek(Number(event.target.value))
                      }
                    />
                    <span>{formatTime(playback.duration)}</span>
                  </div>
                )}
              </>
            )}
            {(playback.error || playback.status === "needsGesture") && (
              <p className="error-text" role="alert">
                {playback.error || "Press Play to start listening."}
              </p>
            )}
            {(current || isRadio(source)) && (
              <div className="volume">
                <button
                  className="text-button"
                  aria-label={playback.muted ? "Unmute" : "Mute"}
                  onClick={() => player.toggleMute()}
                >
                  {playback.muted ? "Unmute" : "Mute"}
                </button>
                <label htmlFor="volume" className="sr-only">
                  Volume
                </label>
                <input
                  id="volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={playback.volume}
                  onChange={(event) =>
                    player.setVolume(Number(event.target.value))
                  }
                />
              </div>
            )}
            {feedbackNotice && (
              <p className="feedback-note" role="status">
                {feedbackNotice.title}: {feedbackNotice.text}{" "}
                {feedbackNotice.retry && (
                  <button
                    className="inline-button"
                    onClick={feedbackNotice.retry}
                  >
                    Retry
                  </button>
                )}
              </p>
            )}
          </section>

          {!isRadio(source) && (
            <section className="card" aria-labelledby="queue-heading">
              <div className="section-label">UP NEXT</div>
              <h2 id="queue-heading" className="sr-only">
                Up next
              </h2>
              {!queue.length ? (
                <p className="empty-state">
                  {djPending
                    ? "The DJ's picks will appear here."
                    : dj
                      ? "The DJ adds more as the music plays."
                      : "Start the DJ and its picks line up here, each with a note on why."}
                </p>
              ) : (
                <ol className="queue-list">
                  {queue.map((entry) => (
                    <li key={entry.media.id}>
                      <div>
                        <strong>{entry.media.title}</strong>
                        <span>
                          {entry.media.artist?.displayName ||
                            entry.media.attribution ||
                            "Artist unknown"}
                          {entry.origin === "You" ? " · Added by you" : ""}
                        </span>
                        {entry.reason && <small>{entry.reason}</small>}
                      </div>
                      <div className="row-actions">
                        <button
                          className="inline-button"
                          onClick={() => {
                            updateQueue((entries) =>
                              entries.filter(
                                (other) => other.media.id !== entry.media.id,
                              ),
                            );
                            choose(entry.media, false, entry.reason);
                          }}
                        >
                          Play now
                        </button>
                        <button
                          className="inline-button"
                          aria-label={`Remove ${entry.media.title} from Up next`}
                          onClick={() =>
                            updateQueue((entries) =>
                              entries.filter(
                                (other) => other.media.id !== entry.media.id,
                              ),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {source === "local" && (
            <details className="card collection">
              <summary>Browse your collection yourself</summary>
              <div className="chooser-tools">
                <label htmlFor="search" className="sr-only">
                  Search your collection
                </label>
                <input
                  id="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by title or artist"
                />
                <button
                  className="secondary-button"
                  disabled={cap?.library.state === "not_configured"}
                  onClick={() => void scan()}
                >
                  Rescan
                </button>
              </div>
              {scanStatus && <p role="status">{scanStatus}</p>}
              {libraryError && (
                <p className="error-text" role="alert">
                  {libraryError}
                </p>
              )}
              {!tracks.length && !libraryError && (
                <p className="empty-state">
                  {cap?.library.state === "not_configured"
                    ? "Set MUSIC_LIBRARY_ROOT to your MP3 folder and restart the server. Setup shows how."
                    : !cap
                      ? "Checking your collection…"
                      : cap.library.state === "ready" ||
                          cap.library.state === "scanning"
                        ? "No MP3s found. Rescan your folder or check Setup."
                        : "Your collection isn't available. Check Setup."}
                </p>
              )}
              {!!tracks.length && (
                <ul className="catalog-list">
                  {tracks.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <span>
                          {item.artist?.displayName || "Artist unknown"}
                          {item.availability === "unavailable"
                            ? " · Unavailable"
                            : ""}
                        </span>
                      </div>
                      <div className="row-actions">
                        <button
                          className="inline-button"
                          disabled={item.availability !== "available"}
                          onClick={() => choose(item)}
                        >
                          Play now
                        </button>
                        <button
                          className="inline-button"
                          disabled={item.availability !== "available"}
                          onClick={() => addQueue(item)}
                        >
                          Add to Up next
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {cursor && (
                <button
                  className="secondary-button more-button"
                  onClick={() => void loadTracks(query, cursor)}
                >
                  Load more
                </button>
              )}
            </details>
          )}
        </div>

        <aside className="side">
          <section
            className="card artist-panel"
            aria-labelledby="artist-heading"
          >
            <div className="section-label">BEHIND THE MUSIC</div>
            <h2 id="artist-heading">
              {isRadio(source)
                ? labels[source]
                : current?.artist?.displayName || "Artist notes"}
            </h2>
            {isRadio(source) ? (
              <p>
                The station's hosts tell the story here. Enjoy the broadcast.
              </p>
            ) : !current ? (
              <p>Notes about the artist appear here while their music plays.</p>
            ) : !current.artist || current.artist.confidence === "low" ? (
              <p>
                {source === "youtube"
                  ? "Artist notes are written for tracks from your collection, where the artist is known from the file's tags."
                  : "This file doesn't name its artist, so there are no notes for it."}
              </p>
            ) : !artistData || artistData.status === "pending" ? (
              <p>Writing artist notes…</p>
            ) : artistData.status === "cached" ? (
              <>
                <p>{artistData.introduction}</p>
                {artistExpanded && artistData.text && (
                  <p className="long-copy">{artistData.text}</p>
                )}
                {artistData.text && (
                  <button
                    className="inline-button"
                    aria-expanded={artistExpanded}
                    onClick={() => setArtistExpanded((value) => !value)}
                  >
                    {artistExpanded ? "Read less" : "Read more"}
                  </button>
                )}
                <p className="provenance">
                  Written by AI ·{" "}
                  {artistData.generatedAt
                    ? new Date(artistData.generatedAt).toLocaleDateString()
                    : "recently"}
                </p>
              </>
            ) : artistData.status === "unavailable" ? (
              <p>Artist notes are unavailable for this artist.</p>
            ) : (
              <p>
                Artist notes couldn’t load. The music keeps playing.{" "}
                <button
                  className="inline-button"
                  onClick={() => void retryArtist()}
                >
                  Retry
                </button>
              </p>
            )}
          </section>
          <section className="card how-it-works" aria-labelledby="how-heading">
            <div className="section-label">HOW THE DJ LEARNS</div>
            <h2 id="how-heading">Like what you hear</h2>
            <p>
              Like or pass on anything that plays. The DJ remembers and uses
              your taste for every pick, on YouTube and in your collection.
            </p>
            <button
              className="inline-button"
              onClick={(event) => openPanel("taste", event)}
            >
              See what the DJ knows about your taste
            </button>
          </section>
        </aside>
      </main>
      {panel && (
        <dialog
          ref={dialog}
          aria-label={panel === "setup" ? "Setup" : "Your taste"}
        >
          <div className="dialog-header">
            <h2>{panel === "setup" ? "Setup" : "Your taste"}</h2>
            <button
              className="text-button"
              onClick={() => dialog.current?.close()}
            >
              Close
            </button>
          </div>
          {panel === "setup" ? (
            <div className="setup-content">
              <h3>The DJ (Codex)</h3>
              <p className={cap?.codex.state === "ready" ? "ok-text" : ""}>
                {cap?.codex.state === "ready"
                  ? "Ready. The DJ uses your existing Codex login."
                  : describeReason(cap?.codex.reason) || "Checking Codex…"}
              </p>
              {cap?.codex.reason === "codex_sandbox_blocked" && (
                <>
                  <p>
                    Ubuntu 24.04 and later block the user namespaces that
                    Codex's sandbox (bubblewrap) needs. Your own Codex CLI hits
                    the same limit. Load the bubblewrap AppArmor profile once,
                    as the Codex documentation recommends, then restart this
                    server:
                  </p>
                  <pre>
                    <code>
                      {`sudo apt install apparmor-profiles apparmor-utils
sudo install -m 0644 /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/bwrap-userns-restrict
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict`}
                    </code>
                  </pre>
                </>
              )}
              <p className="subtle">
                Uses the Codex login in{" "}
                <code>
                  {cap?.codex.authHomeSource === "user_home"
                    ? "~/.codex"
                    : cap?.codex.authHomeSource || "your Codex home"}
                </code>
                . Your likes and taste notes are sent to Codex when the DJ
                picks; your plan's usage limits apply.
              </p>
              <h3>YouTube</h3>
              <p>
                {cap?.youtubeDiscovery.state === "ready"
                  ? "Ready. The DJ searches YouTube for you. No API key needed."
                  : cap?.youtubeDiscovery.reason === cap?.codex.reason
                    ? "Works once the DJ above is ready. No API key needed."
                    : describeReason(cap?.youtubeDiscovery.reason) ||
                      "The DJ can't search YouTube yet."}
              </p>
              <h3>Your collection</h3>
              <p>
                {cap?.library.state === "ready"
                  ? "Ready."
                  : cap?.library.state === "not_configured"
                    ? "Not set up."
                    : cap?.library.state || "Checking…"}{" "}
                Set <code>MUSIC_LIBRARY_ROOT</code> to your MP3 folder, restart
                the server, then use Rescan under Your collection.{" "}
                {cap?.library.state !== "not_configured" && cap?.library.reason}
              </p>
              <h3>Live radio</h3>
              {stations.map((id) => (
                <p key={id}>
                  <strong>{labels[id]}:</strong>{" "}
                  {cap?.stations[id].state || "unknown"}{" "}
                  {cap?.stations[id].reason}
                </p>
              ))}
              <button
                className="secondary-button"
                onClick={() => void refreshCapabilities()}
              >
                Check again
              </button>
            </div>
          ) : (
            <div className="setup-content">
              <p>
                Like and Not for me save your reactions. The DJ uses them for
                every pick. Press a selected button again to undo it.
              </p>
              {tasteData ? (
                <>
                  <p className="subtle">
                    {Object.keys(tasteData.feedback).length} reactions saved ·
                    taste notes{" "}
                    {summaryUnavailable
                      ? "waiting for the DJ"
                      : tasteData.summaryStatus}
                  </p>
                  {summaryUnavailable ? (
                    <p>
                      Your reactions are saved. The DJ writes your taste notes
                      once Codex is available. See{" "}
                      <button
                        className="inline-button"
                        onClick={() => setPanel("setup")}
                      >
                        Setup
                      </button>
                      .
                    </p>
                  ) : (
                    tasteData.summaryStatus === "pending" && (
                      <p>
                        Reactions saved. The DJ is updating your taste notes.
                      </p>
                    )
                  )}
                  {tasteData.summaryStatus === "failed" && (
                    <p className="error-text">
                      Updating your taste notes failed. Your reactions are still
                      saved.
                    </p>
                  )}
                  {tasteData.summaryMarkdown ? (
                    <div className="taste-summary">
                      {tasteData.summaryMarkdown}
                    </div>
                  ) : (
                    <p>No taste notes yet. Like a few tracks to get started.</p>
                  )}
                </>
              ) : (
                <p>
                  Your taste data is unavailable. Check that the server is
                  running.
                </p>
              )}
            </div>
          )}
        </dialog>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
