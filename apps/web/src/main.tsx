import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  artistInfo,
  capabilities,
  djMemory,
  feedbackResponse,
  job,
  jobAccepted,
  recommendationResult,
  stationNowPlaying,
  stationResolution,
  taste,
  trackPage,
  type Capabilities,
  type DjMemory,
  type MediaItem,
  type StationId,
} from "@music/contracts";
import { api, json } from "./api";
import { PlaybackController, trackFailed, type PlaybackState } from "./playback";
import { watchStationMetadata, type RadioMetadata } from "./radio-metadata";
import {
  artistOf,
  describe,
  describeReason,
  restoreListening,
  stationLabel,
  stationNote,
  store,
  stored,
  type DjSource,
  type Entry,
  type Now,
  type Reaction,
  type Tab,
  type Toast,
} from "./model";
import { PlayerBar } from "./player-bar";
import { DjPanel } from "./dj-panel";
import { ArtistNotes, CollectionPanel, QueuePanel, RadioPanel } from "./panels";
import { SetupContent, TasteContent } from "./dialogs";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/archivo/wdth-italic.css";
import "@fontsource/silkscreen/latin-400.css";
import "./style.css";

type Theme = "system" | "light" | "dark";
const picksFailed = "Several picks couldn't play. Skip ahead or ask the DJ for something else.";
const tabs: { id: Tab; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "local", label: "Your collection" },
  { id: "radio", label: "Live radio" },
];
function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new Error("Cancelled"));
    }, { once: true });
  });

function App() {
  const player = useRef(new PlaybackController()).current;
  const [playback, setPlayback] = useState<PlaybackState>(player.snapshot());
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = stored("theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const restored = useRef(restoreListening()).current;
  // What you look at, where the DJ picks from and what plays are kept apart,
  // so switching tabs never stops the music or the DJ.
  const [tab, setTab] = useState<Tab>(restored.tab);
  const [djSource, setDjSource] = useState<DjSource>(restored.djSource);
  const djSourceRef = useRef(restored.djSource);
  const [station, setStation] = useState<StationId>(restored.station);
  const [now, setNowState] = useState<Now>(restored.last);
  const nowRef = useRef<Now>(restored.last);
  const [queue, setQueue] = useState<Entry[]>([]);
  const queueRef = useRef<Entry[]>([]);
  const [dj, setDj] = useState(false);
  const djRef = useRef(false);
  const [djPending, setDjPending] = useState(false);
  const [djError, setDjError] = useState("");
  const direction = useRef("");
  const [activeDirection, setActiveDirection] = useState("");
  const session = useRef(crypto.randomUUID());
  const epoch = useRef(0);
  // The DJ starts its next pick as soon as one is ready, even over the radio.
  const waitingForContinuation = useRef(false);
  // After steering, the first new pick replaces the track that is playing.
  const switchOnEpoch = useRef(-1);
  const played = useRef<MediaItem[]>([]);
  const failedCandidates = useRef(0);
  const handledFailureEpoch = useRef(-1);
  const jobAbort = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  const [cap, setCap] = useState<Capabilities | null>(null);
  const [capError, setCapError] = useState("");
  const [stationError, setStationError] = useState("");
  const [stationPending, setStationPending] = useState(false);
  const stationRequest = useRef(0);
  const [radioMetadata, setRadioMetadata] = useState<RadioMetadata | null>(null);
  const [tracks, setTracks] = useState<MediaItem[]>([]);
  const libraryRequest = useRef(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [scanStatus, setScanStatus] = useState("");
  const [tasteData, setTasteData] = useState<ReturnType<typeof taste.parse> | null>(null);
  const [memory, setMemory] = useState<DjMemory | null>(null);
  const [pendingReaction, setPendingReaction] = useState<{ id: string; value: Reaction } | null>(null);
  const reactions = useRef<Promise<unknown>>(Promise.resolve());
  const [toast, setToast] = useState<Toast | null>(null);
  const [artistData, setArtistData] = useState<ReturnType<typeof artistInfo.parse> | null>(null);
  const [artistExpanded, setArtistExpanded] = useState(false);
  const [panel, setPanel] = useState<"setup" | "taste" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dock = useRef<HTMLDivElement>(null);

  const playing = playback.status === "playing";
  const onAirStation = now?.kind === "station" ? now.stationId : null;
  const radioLive = onAirStation !== null && (stationPending || ["playing", "loading", "needsGesture"].includes(playback.status));
  const metadata = radioLive && radioMetadata?.stationId === onAirStation ? radioMetadata : null;
  const track = now?.kind === "track" ? now : null;

  useEffect(() => {
    applyTheme(theme);
    store("theme", theme);
  }, [theme]);
  // The page leaves exactly the player's height free at the bottom.
  useEffect(() => {
    const bar = dock.current?.querySelector<HTMLElement>(".player-bar");
    if (!bar) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--bar-space", `${Math.ceil(bar.getBoundingClientRect().height)}px`));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setRadioMetadata(null);
    if (!onAirStation || !radioLive) return;
    return watchStationMetadata(onAirStation, setRadioMetadata, (id, signal) => api(`/stations/${id}/now-playing`, stationNowPlaying, { signal }));
  }, [onAirStation, radioLive]);

  const setNow = useCallback((value: Now) => {
    nowRef.current = value;
    setNowState(value);
    if (value?.kind === "track") store("last-track", JSON.stringify(value));
  }, []);
  const updateQueue = useCallback((value: Entry[] | ((entries: Entry[]) => Entry[])) => {
    const next = typeof value === "function" ? value(queueRef.current) : value;
    queueRef.current = next;
    setQueue(next);
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
      /* The taste dialog shows unavailable. */
    }
  }, []);
  const loadTracks = useCallback(async (search: string, nextCursor: string | null = null) => {
    const request = ++libraryRequest.current;
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (nextCursor) params.set("cursor", nextCursor);
      const page = await api(`/library/tracks?${params}`, trackPage);
      if (request !== libraryRequest.current) return;
      setTracks((previous) => (nextCursor ? [...previous, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setLibraryError("");
    } catch (error) {
      if (request === libraryRequest.current) setLibraryError(describe(error));
    }
  }, []);
  const cancelJob = useCallback(() => {
    jobAbort.current?.abort();
    jobAbort.current = null;
    if (jobId.current) void fetch(`/api/v1/jobs/${jobId.current}`, { method: "DELETE" }).catch(() => {});
    jobId.current = null;
    setDjPending(false);
  }, []);

  // quick asks for a fast, smaller first batch when nothing is lined up yet.
  const requestPicks = useCallback(
    async (requestSession: string, requestEpoch: number, quick = false) => {
      if (jobAbort.current || !djRef.current) return;
      const source = djSourceRef.current;
      const abort = new AbortController();
      jobAbort.current = abort;
      setDjPending(true);
      setDjError("");
      const current = nowRef.current?.kind === "track" ? nowRef.current.media : null;
      try {
        const payload = {
          sessionId: requestSession,
          modeEpoch: requestEpoch,
          source,
          ...(current?.source === source ? { seedId: current.id } : {}),
          queuedIds: queueRef.current.map((entry) => entry.media.id).slice(0, 100),
          recentIds: current ? [current.id] : [],
          recentTracks: [...new Map([current, ...played.current, ...queueRef.current.map((entry) => entry.media)].filter((item): item is MediaItem => Boolean(item)).map((item) => [item.id, item])).values()]
            .slice(0, 30)
            .map((item) => ({ title: item.title.slice(0, 300), artist: item.artist?.displayName.slice(0, 200) ?? null })),
          ...(direction.current ? { direction: direction.current } : {}),
          ...(quick ? { quick: true } : {}),
        };
        const accepted = await api("/dj/recommendations", jobAccepted, { ...json(payload), signal: abort.signal });
        jobId.current = accepted.jobId;
        for (;;) {
          await pause(1300, abort.signal);
          const state = await api(`/jobs/${accepted.jobId}`, job, { signal: abort.signal });
          if (state.status === "failed" || state.status === "cancelled") throw new Error(state.error?.message || "The DJ couldn't find music this time.");
          if (state.status !== "succeeded") continue;
          const result = recommendationResult.parse(state.result);
          if (
            abort.signal.aborted ||
            !djRef.current ||
            epoch.current !== requestEpoch ||
            session.current !== requestSession ||
            result.sessionId !== requestSession ||
            result.modeEpoch !== requestEpoch ||
            result.source !== djSourceRef.current
          )
            return;
          const playingNow = nowRef.current?.kind === "track" ? nowRef.current.media.id : undefined;
          const known = new Set([playingNow, ...queueRef.current.map((entry) => entry.media.id)]);
          const picks = result.items.filter((item) => item.media.availability === "available" && !known.has(item.media.id));
          if (!picks.length) throw new Error("The DJ didn't find anything new this time. Try asking for something different.");
          updateQueue((entries) => [...entries, ...picks.map((item) => ({ media: item.media, origin: "DJ pick" as const, reason: item.reason }))]);
          setAnnouncement(`The DJ queued ${picks.length} pick${picks.length === 1 ? "" : "s"}`);
          if (switchOnEpoch.current === requestEpoch) {
            switchOnEpoch.current = -1;
            nextRef.current();
          }
          return;
        }
      } catch (error) {
        if (!abort.signal.aborted && epoch.current === requestEpoch) setDjError(describe(error));
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

  const choose = useCallback(
    (media: MediaItem, origin: Entry["origin"], reason = "", automatic = false) => {
      if (media.availability !== "available") return;
      stationRequest.current++;
      setStationPending(false);
      setStationError("");
      waitingForContinuation.current = false;
      if (!automatic) failedCandidates.current = 0;
      played.current = [media, ...played.current.filter((other) => other.id !== media.id)].slice(0, 20);
      setNow({ kind: "track", media, origin, reason });
      setAnnouncement(`Now playing ${media.title}`);
      void player.playTrack(media);
    },
    [player, setNow],
  );
  // Skips and finished tracks teach the DJ. A track that never started tells it nothing.
  const reportPlay = useCallback(
    (outcome: "finished" | "skipped") => {
      const current = nowRef.current;
      const { elapsed, duration, status } = player.snapshot();
      if (current?.kind !== "track" || (outcome === "skipped" && elapsed < 1 && status !== "playing")) return;
      void fetch("/api/v1/listening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media: current.media,
          outcome,
          listenedSeconds: Math.min(elapsed, 86_400),
          durationSeconds: duration && Number.isFinite(duration) ? Math.min(duration, 86_400) : null,
        }),
      }).catch(() => {});
    },
    [player],
  );
  const reportPlayRef = useRef(reportPlay);
  reportPlayRef.current = reportPlay;
  const next = useCallback(() => {
    if (!queueRef.current.length) {
      waitingForContinuation.current = djRef.current;
      if (nowRef.current?.kind === "track") player.stop();
      if (djRef.current && !jobAbort.current) void requestPicks(session.current, epoch.current, true);
      return;
    }
    const [first, ...rest] = queueRef.current;
    updateQueue(rest);
    choose(first.media, first.origin, first.reason, true);
    if (djRef.current && rest.length < 2 && !jobAbort.current) void requestPicks(session.current, epoch.current);
  }, [choose, player, requestPicks, updateQueue]);
  const nextRef = useRef(next);
  nextRef.current = next;
  const skip = () => {
    reportPlay("skipped");
    failedCandidates.current = 0;
    next();
  };

  useEffect(() => {
    const off = player.subscribe(setPlayback);
    player.setEndedHandler(() => {
      reportPlayRef.current("finished");
      nextRef.current();
    });
    return () => {
      off();
      player.dispose();
      cancelJob();
    };
  }, [player, cancelJob]);

  // A pick that can't be played is skipped, up to three in a row.
  useEffect(() => {
    if (playback.status === "playing") {
      failedCandidates.current = 0;
      setDjError((error) => (error === picksFailed ? "" : error));
      return;
    }
    if (playback.status !== "failed" || playback.error !== trackFailed || handledFailureEpoch.current === playback.epoch) return;
    if (!queue.length && !dj) return;
    handledFailureEpoch.current = playback.epoch;
    failedCandidates.current++;
    if (failedCandidates.current <= 3) {
      if (nowRef.current?.kind === "track") setToast({ text: `“${nowRef.current.media.title}” couldn't be played, so the DJ skipped it.` });
      nextRef.current();
    } else setDjError(picksFailed);
  }, [playback.status, playback.epoch, playback.error, dj, queue.length]);
  // Start the next pick when the DJ is waiting for one. Radio keeps playing until it is ready.
  useEffect(() => {
    if (!dj || !queue.length) return;
    const idle = playback.status !== "playing" && playback.status !== "loading";
    if (now?.kind === "station" ? waitingForContinuation.current : (waitingForContinuation.current || !now) && idle) nextRef.current();
  }, [dj, now, queue.length, playback.status]);

  useEffect(() => {
    void refreshCapabilities();
    void refreshTaste();
    void api("/dj/memory", djMemory)
      .then(setMemory)
      .catch(() => setMemory({ notes: [], conversation: [] }));
  }, [refreshCapabilities, refreshTaste]);
  // yt-dlp installs itself on first start; show YouTube as ready when it is.
  useEffect(() => {
    if (cap?.youtubePlayback.state !== "scanning") return;
    const timer = window.setTimeout(() => void refreshCapabilities(), 3000);
    return () => window.clearTimeout(timer);
  }, [cap, refreshCapabilities]);
  useEffect(() => {
    if (tab !== "local") return;
    if (cap?.library.state === "not_configured") {
      setTracks([]);
      setLibraryError("");
      return;
    }
    if (cap?.library.state === "ready" || cap?.library.state === "scanning") void loadTracks(query);
  }, [tab, query, loadTracks, cap?.library.state]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.action ? 10000 : 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Artist notes are written only for artists named in your files' tags.
  const notesArtist = track?.media.artist && track.media.artist.confidence !== "low" && track.media.artist.provenance === "id3" ? track.media.artist : null;
  useEffect(() => {
    setArtistData(null);
    setArtistExpanded(false);
    if (!notesArtist) return;
    let active = true;
    void api(`/artists/${encodeURIComponent(notesArtist.id)}/info`, artistInfo)
      .then((data) => {
        if (active && data.artistKey === notesArtist.id) setArtistData(data);
      })
      .catch(() => {
        if (active) setArtistData({ artistKey: notesArtist.id, status: "failed" });
      });
    return () => {
      active = false;
    };
  }, [notesArtist?.id]);
  useEffect(() => {
    if (artistData?.status !== "pending" || !artistData.jobId || !notesArtist) return;
    const key = notesArtist.id,
      id = artistData.jobId;
    let active = true;
    const timer = window.setInterval(() => {
      void api(`/jobs/${id}`, job)
        .then((state) => {
          if (!active || state.status === "queued" || state.status === "running") return;
          window.clearInterval(timer);
          if (state.status === "succeeded")
            void api(`/artists/${encodeURIComponent(key)}/info`, artistInfo).then((info) => {
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
  }, [artistData?.status, artistData?.jobId, notesArtist?.id]);
  const retryArtist = async () => {
    if (!notesArtist) return;
    try {
      const accepted = await api(`/artists/${encodeURIComponent(notesArtist.id)}/info/refresh`, jobAccepted, json({}));
      setArtistData({ artistKey: notesArtist.id, status: "pending", jobId: accepted.jobId });
    } catch {
      setArtistData({ artistKey: notesArtist.id, status: "failed" });
    }
  };

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
  const openPanel = (which: "setup" | "taste", event: React.MouseEvent<HTMLButtonElement>) => {
    invoker.current = event.currentTarget;
    setPanel(which);
    if (which === "taste") void refreshTaste();
    else void refreshCapabilities();
  };

  // The DJ picks from the YouTube or collection tab you chose last. Changing it
  // replaces the DJ's upcoming picks; the track that is playing carries on.
  const selectTab = (next: Tab) => {
    setTab(next);
    store("listening-tab", next);
    if (next === "radio" || next === djSourceRef.current) return;
    djSourceRef.current = next;
    setDjSource(next);
    store("dj-source", next);
    if (!djRef.current) return;
    cancelJob();
    epoch.current++;
    updateQueue((entries) => entries.filter((entry) => entry.origin === "You"));
    setAnnouncement(`The DJ now picks from ${next === "youtube" ? "YouTube" : "your collection"}`);
    void requestPicks(session.current, epoch.current, true);
  };
  // Starting or steering both send the request text and replace the DJ's
  // upcoming picks. Songs you queued yourself stay.
  const startDj = (text: string) => {
    const steering = text.trim().slice(0, 500);
    direction.current = steering;
    setActiveDirection(steering);
    cancelJob();
    epoch.current++;
    updateQueue((entries) => entries.filter((entry) => entry.origin === "You"));
    if (!djRef.current) {
      djRef.current = true;
      setDj(true);
      session.current = crypto.randomUUID();
      const current = nowRef.current;
      waitingForContinuation.current = current?.kind === "station" || !["playing", "loading"].includes(player.snapshot().status);
      if (tab === "radio") {
        setTab(djSourceRef.current);
        store("listening-tab", djSourceRef.current);
      }
    } else if (nowRef.current?.kind === "track" && ["playing", "loading", "paused"].includes(player.snapshot().status)) {
      // Steering changes the music now: the first new pick replaces this track.
      switchOnEpoch.current = epoch.current;
    } else {
      // Over the radio, or with nothing playing, the first new pick starts when it is ready.
      waitingForContinuation.current = true;
    }
    void requestPicks(session.current, epoch.current, true);
  };
  const stopDj = () => {
    djRef.current = false;
    waitingForContinuation.current = false;
    switchOnEpoch.current = -1;
    direction.current = "";
    setDj(false);
    setDjError("");
    setActiveDirection("");
    cancelJob();
    updateQueue((entries) => entries.filter((entry) => entry.origin === "You"));
  };

  const listenRadio = async (id: StationId) => {
    const request = ++stationRequest.current;
    waitingForContinuation.current = false;
    switchOnEpoch.current = -1;
    setNow({ kind: "station", stationId: id });
    setStationPending(true);
    setStationError("");
    player.stop();
    try {
      const stream = await api(`/stations/${id}/resolve`, stationResolution, json({}));
      if (request === stationRequest.current) await player.playStation(stream);
    } catch (error) {
      if (request === stationRequest.current) setStationError(describe(error));
    } finally {
      if (request === stationRequest.current) setStationPending(false);
    }
  };
  // Picking a station starts it. Picking the one already on air leaves it playing.
  const tuneIn = (id: StationId) => {
    setStation(id);
    store("listening-station", id);
    const current = nowRef.current;
    if (current?.kind === "station" && current.stationId === id && (stationPending || ["playing", "loading"].includes(player.snapshot().status))) return;
    void listenRadio(id);
  };
  const stopRadio = () => {
    stationRequest.current++;
    setStationPending(false);
    player.stop();
  };
  const backToDj = () => {
    if (!djRef.current) return;
    if (queueRef.current.length) {
      next();
      return;
    }
    waitingForContinuation.current = true;
    if (!jobAbort.current) void requestPicks(session.current, epoch.current, true);
  };
  const togglePlay = () => {
    const current = nowRef.current;
    if (!current) return;
    if (current.kind === "station") {
      if (radioLive) stopRadio();
      else if (playback.status === "needsGesture") void player.resume();
      else void listenRadio(current.stationId);
    } else if (playing) player.pause();
    else void player.playOrResume(current.media);
  };

  // Reactions are saved one at a time, because each write needs the latest revision.
  const saveReaction = (item: MediaItem, intended: Reaction, key = crypto.randomUUID()): Promise<boolean> => {
    setPendingReaction({ id: item.id, value: intended });
    const work = reactions.current.then(async () => {
      try {
        const revision = (await api("/taste", taste)).feedbackRevision;
        const saved = await api(`/feedback/${encodeURIComponent(item.id)}`, feedbackResponse, {
          method: "PUT",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({ reaction: intended, expectedRevision: revision, media: item }),
        });
        setTasteData((previous) => (previous ? { ...previous, feedbackRevision: saved.feedbackRevision, feedback: { ...previous.feedback, [item.id]: saved.reaction } } : previous));
        return true;
      } catch (error) {
        setToast({ text: `Your reaction to “${item.title}” wasn’t saved: ${describe(error)}`, action: { label: "Retry", run: () => void saveReaction(item, intended, key) } });
        return false;
      } finally {
        setPendingReaction((current) => (current?.id === item.id ? null : current));
      }
    });
    reactions.current = work;
    void work.then(() => refreshTaste());
    return work;
  };
  const reaction: Reaction = track ? (pendingReaction?.id === track.media.id ? pendingReaction.value : tasteData?.feedback[track.media.id] || "neutral") : "neutral";
  const toggleLike = async () => {
    if (!track) return;
    const liked = reaction === "like";
    if (await saveReaction(track.media, liked ? "neutral" : "like"))
      setToast({ text: liked ? `Removed your like from “${track.media.title}”.` : `Liked “${track.media.title}”. The DJ will remember.` });
  };
  const undoDislike = (item: MediaItem, restore?: () => void) => () => {
    restore?.();
    void saveReaction(item, "neutral").then((saved) => saved && setToast({ text: `“${item.title}” is no longer disliked.` }));
  };
  // Not for me moves on at once, and the dislike can be undone.
  const notForMe = async () => {
    if (!track) return;
    const item = track.media;
    skip();
    if (await saveReaction(item, "dislike")) setToast({ text: `Disliked “${item.title}”. The DJ won’t pick it again.`, action: { label: "Undo", run: undoDislike(item) } });
  };
  const refillIfLow = () => {
    if (djRef.current && queueRef.current.length < 2 && !jobAbort.current && nowRef.current?.kind !== "station") void requestPicks(session.current, epoch.current);
  };
  const dislikeQueued = async (entry: Entry) => {
    const index = queueRef.current.findIndex((other) => other.media.id === entry.media.id);
    updateQueue((entries) => entries.filter((other) => other.media.id !== entry.media.id));
    refillIfLow();
    const putBack = () =>
      updateQueue((entries) => (entries.some((other) => other.media.id === entry.media.id) ? entries : [...entries.slice(0, index), entry, ...entries.slice(index)]));
    if (await saveReaction(entry.media, "dislike"))
      setToast({ text: `Disliked “${entry.media.title}” and took it off Up next.`, action: { label: "Undo", run: undoDislike(entry.media, putBack) } });
  };
  const removeQueued = (entry: Entry) => {
    updateQueue((entries) => entries.filter((other) => other.media.id !== entry.media.id));
    refillIfLow();
  };
  const playQueued = (entry: Entry) => {
    updateQueue((entries) => entries.filter((other) => other.media.id !== entry.media.id));
    choose(entry.media, entry.origin, entry.reason);
    refillIfLow();
  };
  const addQueue = (item: MediaItem) => {
    if (queueRef.current.some((entry) => entry.media.id === item.id)) return;
    updateQueue((entries) => [...entries.filter((entry) => entry.origin === "You"), { media: item, origin: "You" }, ...entries.filter((entry) => entry.origin === "DJ pick")]);
    setAnnouncement(`${item.title} added to Up next`);
  };
  const scan = async () => {
    setScanStatus("Scanning your collection…");
    try {
      const accepted = await api("/library/scans", jobAccepted, json({}));
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const state = await api(`/jobs/${accepted.jobId}`, job);
        if (state.status === "failed") throw new Error(state.error?.message || "The scan failed.");
        if (state.status === "succeeded") break;
      }
      setScanStatus("Scan complete.");
      void loadTracks(query);
      void refreshCapabilities();
    } catch (error) {
      setScanStatus(describe(error));
    }
  };
  const forgetNote = async (id: string) => {
    try {
      setMemory(await api(`/dj/notes/${id}`, djMemory, { method: "DELETE" }));
    } catch (error) {
      setToast({ text: `That note wasn’t forgotten: ${describe(error)}` });
    }
  };

  // Media keys and the system's media controls.
  const controls = useRef({ togglePlay, skip });
  controls.current = { togglePlay, skip };
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const title = track ? track.media.title : onAirStation ? (metadata?.status === "current" ? metadata.title : stationLabel(onAirStation)) : "";
    const artist = track ? artistOf(track.media) : onAirStation ? (metadata?.status === "current" ? metadata.artist || stationLabel(onAirStation) : stationNote(onAirStation)) : "";
    navigator.mediaSession.metadata = title ? new MediaMetadata({ title, artist, artwork: track?.media.artwork ? [{ src: track.media.artwork }] : [] }) : null;
  }, [track, onAirStation, metadata]);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ["play", () => controls.current.togglePlay()],
      ["pause", () => controls.current.togglePlay()],
      ["nexttrack", now?.kind === "track" ? () => controls.current.skip() : null],
    ];
    for (const [action, handler] of handlers)
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // This browser doesn't support that action.
      }
  }, [now?.kind]);

  const djBlocker = !cap
    ? ""
    : cap.codex.state !== "ready"
      ? describeReason(cap.codex.reason) || "The DJ needs your Codex login. Check Setup."
      : djSource === "youtube" && cap.youtubeDiscovery.state !== "ready"
        ? describeReason(cap.youtubeDiscovery.reason) || "YouTube isn't ready yet. Check Setup."
        : djSource === "local" && cap.library.state !== "ready"
          ? cap.library.state === "not_configured"
            ? "Point the server at your MP3 folder first. Setup shows how."
            : "Your collection isn't ready yet. Check Setup."
          : "";
  const chatBlocker = !cap || cap.codex.state === "ready" ? "" : describeReason(cap.codex.reason) || "The DJ needs your Codex login. Check Setup.";
  const playerMessage =
    onAirStation && stationError ? `Couldn’t connect to ${stationLabel(onAirStation)}: ${stationError}` : playback.error || (playback.status === "needsGesture" ? "Press Play to start listening." : "");
  // The ticker repeats what the page already says, so screen readers skip it.
  const ticker = onAirStation
    ? [playing ? "On air" : radioLive ? "Tuning in" : "Live radio", stationLabel(onAirStation), stationNote(onAirStation)]
    : track
      ? [playing ? "Now playing" : "Up now", track.media.title, artistOf(track.media)]
      : dj
        ? ["The DJ is on", "Picking your first track"]
        : ["Tell the DJ what you want", "YouTube", "Your collection", "Live radio"];

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand">
          <div className="wordmark">
            Listening <span>room</span>
            <sup aria-hidden="true">®</sup>
          </div>
          <p className="tagline" aria-hidden="true">
            AI DJ system // Series 2K
          </p>
        </div>
        <nav aria-label="App">
          <button className="text-button" onClick={(event) => openPanel("taste", event)}>
            Your taste
          </button>
          <button className="text-button" onClick={(event) => openPanel("setup", event)}>
            Setup
          </button>
          <label className="theme-picker">
            <span className="sr-only">Theme</span>
            <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
              <option value="system">System theme</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </nav>
      </header>
      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[0, 1].map((copy) => (
            <div className="ticker-copy" key={copy}>
              {[0, 1, 2].flatMap((round) => ticker.map((text, index) => <span key={`${round}-${index}`}>{text}</span>))}
            </div>
          ))}
        </div>
      </div>
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
        <DjPanel
          dj={dj}
          djSource={djSource}
          direction={activeDirection}
          pending={djPending}
          error={djError}
          blocker={djBlocker}
          chatBlocker={chatBlocker}
          memory={memory}
          nowPlaying={track ? { title: track.media.title, artist: track.media.artist?.displayName ?? null } : null}
          onMemory={setMemory}
          onStart={startDj}
          onFollow={startDj}
          onStop={stopDj}
          onRetry={() => void requestPicks(session.current, epoch.current, !queueRef.current.length)}
          onCancel={() => {
            cancelJob();
            setDjError("Request cancelled.");
          }}
          onSetup={(event) => openPanel("setup", event)}
        />
        <div className="stage">
          <div className="mode-switch" role="group" aria-label="Where the music comes from">
            {tabs.map((option, index) => (
              <button key={option.id} aria-pressed={tab === option.id} onClick={() => selectTab(option.id)}>
                <span className="mode-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {option.label}
              </button>
            ))}
          </div>
          {tab === "radio" ? (
            <RadioPanel
              selected={station}
              onAir={onAirStation}
              live={radioLive}
              playing={playing}
              metadata={metadata}
              error={stationError}
              dj={dj}
              onTune={tuneIn}
              onRetry={() => {
                if (onAirStation) void listenRadio(onAirStation);
              }}
            />
          ) : (
            <>
              <QueuePanel queue={queue} dj={dj} djPending={djPending} onPlay={playQueued} onDislike={(entry) => void dislikeQueued(entry)} onRemove={removeQueued} />
              {tab === "local" && (
                <CollectionPanel
                  cap={cap}
                  tracks={tracks}
                  query={query}
                  hasMore={Boolean(cursor)}
                  error={libraryError}
                  scanStatus={scanStatus}
                  onQuery={setQuery}
                  onScan={() => void scan()}
                  onMore={() => void loadTracks(query, cursor)}
                  onPlay={(item) => choose(item, "You")}
                  onAdd={addQueue}
                />
              )}
              {notesArtist && (
                <ArtistNotes name={notesArtist.displayName} data={artistData} expanded={artistExpanded} onExpand={() => setArtistExpanded((value) => !value)} onRetry={() => void retryArtist()} />
              )}
            </>
          )}
        </div>
      </main>
      {/* The player and its notices stay docked at the bottom of the window. */}
      <div className="dock" ref={dock}>
        {toast && (
          <div className="toast" role="status">
            <span>{toast.text}</span>
            {toast.action && (
              <button
                className="inline-button"
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
        <PlayerBar
          now={now}
          playback={playback}
          reaction={reaction}
          radioLive={radioLive}
          stationPending={stationPending}
          stationError={stationError}
          metadata={metadata}
          canSkip={Boolean(track) && (queue.length > 0 || dj)}
          canReturnToDj={dj}
          message={playerMessage}
          onToggle={togglePlay}
          onSkip={skip}
          onLike={() => void toggleLike()}
          onNotForMe={() => void notForMe()}
          onBackToDj={backToDj}
          onSeek={(seconds) => player.seek(seconds)}
          onVolume={(value) => player.setVolume(value)}
          onMute={() => player.toggleMute()}
        />
      </div>
      {panel && (
        <dialog ref={dialog} aria-label={panel === "setup" ? "Setup" : "Your taste"}>
          <div className="dialog-header">
            <h2>{panel === "setup" ? "Setup" : "Your taste"}</h2>
            <button className="text-button" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </div>
          {panel === "setup" ? (
            <SetupContent cap={cap} onRefresh={() => void refreshCapabilities()} />
          ) : (
            <TasteContent taste={tasteData} memory={memory} codexReady={cap?.codex.state === "ready"} onForget={(id) => void forgetNote(id)} onSetup={() => setPanel("setup")} />
          )}
        </dialog>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
