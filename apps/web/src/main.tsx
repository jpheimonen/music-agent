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
import { api, json } from "./api";
import { PlaybackController, type PlaybackState } from "./playback";
import "./style.css";

type Source = "local" | "youtube" | "kexp" | "yle1" | "radio-helsinki";
type Entry = { media: MediaItem; origin: "You" | "DJ pick"; reason?: string };
const labels: Record<Source, string> = {
  local: "Local",
  youtube: "YouTube",
  kexp: "KEXP",
  yle1: "Yle Radio 1",
  "radio-helsinki": "Radio Helsinki",
};
const sources = Object.keys(labels) as Source[];
const isRadio = (source: Source) => source !== "local" && source !== "youtube";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";
const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function rememberedItems(): Partial<Record<"local" | "youtube", MediaItem>> {
  try {
    const value = JSON.parse(localStorage.getItem("listening-items") || "{}");
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

function App() {
  const player = useRef(new PlaybackController()).current;
  const [playback, setPlayback] = useState<PlaybackState>(player.snapshot());
  const [source, setSource] = useState<Source>(() => {
    const saved = localStorage.getItem("listening-source");
    return sources.includes(saved as Source) ? (saved as Source) : "local";
  });
  const sourceRef = useRef(source);
  const epoch = useRef(0);
  const retained = useRef(rememberedItems());
  const [current, setCurrent] = useState<MediaItem | null>(
    source === "local" || source === "youtube"
      ? retained.current[source] || null
      : null,
  );
  const currentRef = useRef<MediaItem | null>(current);
  const [queue, setQueue] = useState<Entry[]>([]);
  const queueRef = useRef<Entry[]>([]);
  const [dj, setDj] = useState(false);
  const djRef = useRef(false);
  const [djPending, setDjPending] = useState(false);
  const [djError, setDjError] = useState("");
  const [direction, setDirection] = useState("");
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
  const [youtubeInput, setYoutubeInput] = useState("");
  const videoRequest = useRef(0);
  const [resolved, setResolved] = useState<MediaItem | null>(null);
  const [resolveStatus, setResolveStatus] = useState("");
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
      setCapError(message(error));
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
        if (request === libraryRequest.current) setLibraryError(message(error));
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
    videoRequest.current++;
    setStationPending(false);
    setStationError("");
    djRef.current = false;
    setDj(false);
    setDjError("");
    player.stop();
    sourceRef.current = next;
    setSource(next);
    localStorage.setItem("listening-source", next);
    updateCurrent(
      next === "local" || next === "youtube"
        ? retained.current[next] || null
        : null,
    );
    updateQueue([]);
    setResolved(null);
    setAnnouncement(`${labels[next]} selected`);
  };
  const requestPicks = useCallback(
    async (requestSession: string, requestEpoch: number, steering: string) => {
      if (jobAbort.current || !djRef.current || isRadio(sourceRef.current))
        return;
      const abort = new AbortController();
      jobAbort.current = abort;
      setDjPending(true);
      setDjError("");
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
              state.error?.message || "The DJ could not find music.",
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
          updateQueue((entries) => {
            const known = new Set([
              currentRef.current?.id,
              ...entries.map((entry) => entry.media.id),
            ]);
            return [
              ...entries,
              ...result.items
                .filter(
                  (item) =>
                    item.media.source === sourceRef.current &&
                    item.media.availability === "available" &&
                    !known.has(item.media.id),
                )
                .map((item) => ({
                  media: item.media,
                  origin: "DJ pick" as const,
                  reason: item.reason,
                })),
            ];
          });
          return;
        }
      } catch (error) {
        if (!abort.signal.aborted && epoch.current === requestEpoch)
          setDjError(message(error));
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
  const toggleDj = () => {
    if (djRef.current) {
      djRef.current = false;
      waitingForContinuation.current = false;
      setDj(false);
      cancelJob();
      return;
    }
    djRef.current = true;
    waitingForContinuation.current =
      playback.status === "stopped" || playback.status === "ended";
    setDj(true);
    session.current = crypto.randomUUID();
    void requestPicks(session.current, epoch.current, direction.trim());
  };
  const choose = useCallback(
    (item: MediaItem, automatic = false) => {
      if (
        item.source !== sourceRef.current ||
        item.availability !== "available"
      )
        return;
      waitingForContinuation.current = false;
      if (!automatic) failedCandidates.current = 0;
      retained.current[item.source] = item;
      try {
        localStorage.setItem("listening-items", JSON.stringify(retained.current));
      } catch {
        // Playback remains usable when browser storage is disabled.
      }
      updateCurrent(item);
      setAnnouncement(`${item.title} selected`);
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
        void requestPicks(session.current, epoch.current, direction.trim());
      return;
    }
    const [first, ...rest] = queueRef.current;
    updateQueue(rest);
    choose(first.media, true);
    if (djRef.current && rest.length < 2 && !jobAbort.current)
      void requestPicks(session.current, epoch.current, direction.trim());
  }, [choose, direction, player, requestPicks, updateQueue]);
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (playback.status === "playing") {
      failedCandidates.current = 0;
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
    else
      setDjError(
        "Several picks could not play. Choose another item to continue.",
      );
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
      playback.status === "stopped"
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
        setStationError(message(error));
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
    setScanStatus("Scanning collection…");
    try {
      const accepted = await api("/library/scans", jobAccepted, json({}));
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const state = await api(`/jobs/${accepted.jobId}`, job);
        if (state.status === "failed")
          throw new Error(state.error?.message || "Scan failed.");
        if (state.status === "succeeded") break;
      }
      setScanStatus("Scan complete.");
      void loadTracks(query);
      void refreshCapabilities();
    } catch (error) {
      setScanStatus(message(error));
    }
  };
  const resolveVideo = async (event: React.FormEvent) => {
    event.preventDefault();
    const request = ++videoRequest.current;
    setResolveStatus("Resolving video…");
    setResolved(null);
    try {
      const item = await api(
        "/youtube/resolve",
        mediaItem,
        json({ input: youtubeInput.trim() }),
      );
      if (request === videoRequest.current) {
        setResolved(item);
        setResolveStatus("Video ready.");
      }
    } catch (error) {
      if (request === videoRequest.current) setResolveStatus(message(error));
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
      setFeedbackNotice({ title: item.title, text: "Saved" });
      void refreshTaste();
    } catch (error) {
      setFeedbackNotice({
        title: item.title,
        text: `Feedback wasn’t saved: ${message(error)}`,
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
  };
  const capability =
    source === "local"
      ? cap?.library
      : source === "youtube"
        ? cap?.youtubeEmbed
        : cap?.stations[source];
  const reaction = current
    ? pendingReaction?.id === current.id
      ? pendingReaction.value
      : tasteData?.feedback[current.id] || "neutral"
    : "neutral";
  const summaryUnavailable =
    tasteData?.summaryStatus === "pending" && cap?.codex.state !== "ready";

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
            Taste
          </button>
          <button
            className="text-button"
            onClick={(event) => openPanel("setup", event)}
          >
            Setup
          </button>
        </nav>
      </header>
      <section className="source-section" aria-label="Listening source">
        <div className="eyebrow">LISTENING SOURCE</div>
        <div className="source-list">
          {sources.map((value) => (
            <button
              key={value}
              className={`source-button ${source === value ? "selected" : ""}`}
              aria-pressed={source === value}
              onClick={() => changeSource(value)}
            >
              {labels[value]}
            </button>
          ))}
        </div>
      </section>
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
      <main>
        <div className="main-grid">
          <section className="now-playing" aria-labelledby="now-heading">
            <div className="section-label" id="now-heading">
              NOW PLAYING
            </div>
            {isRadio(source) ? (
              <>
                <p className="state-line">
                  {labels[source].toUpperCase()} ·{" "}
                  {playback.status === "playing"
                    ? "LIVE"
                    : stationPending || playback.status === "loading"
                      ? "CONNECTING"
                      : stationError || playback.status === "failed"
                        ? "UNAVAILABLE"
                        : "STOPPED"}
                </p>
                <h1 className="track-title">{labels[source]}</h1>
                <p className="subtle">
                  {stationPending || playback.status === "loading"
                    ? "Connecting to the live broadcast…"
                    : playback.status === "playing"
                      ? "Live radio"
                      : "Stopped · Listen live to rejoin the broadcast."}
                </p>
                <div className="transport">
                  <button
                    className="primary-button"
                    onClick={() =>
                      stationPending ||
                      playback.status === "playing" ||
                      playback.status === "loading"
                        ? stopRadio()
                        : playback.status === "needsGesture"
                          ? void player.resume()
                          : void listenRadio()
                    }
                  >
                    {stationPending ||
                    playback.status === "playing" ||
                    playback.status === "loading"
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
              </>
            ) : (
              <>
                <p className="state-line">
                  {labels[source].toUpperCase()} ·{" "}
                  {playback.status === "needsGesture"
                    ? "READY TO PLAY"
                    : playback.status.toUpperCase()}
                </p>
                {source === "youtube" && current && (
                  <div
                    className="video-frame"
                    ref={videoHost}
                    aria-label="YouTube player"
                  >
                    <span>Press Play to load the video.</span>
                  </div>
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
                    <h1 className="track-title">
                      {current?.title ||
                        (source === "local"
                          ? "Bring your collection"
                          : "Choose a video")}
                    </h1>
                    <p className="artist-name">
                      {current?.artist?.displayName ||
                        (current
                          ? "Artist unknown"
                          : source === "local"
                            ? "Your music, in one place."
                            : "Paste a video link below to begin.")}
                    </p>
                    {current?.album && (
                      <p className="subtle">{current.album}</p>
                    )}
                  </div>
                </div>
                <div className="transport">
                  <button
                    className="primary-button"
                    disabled={!current}
                    onClick={() =>
                      playback.status === "playing"
                        ? player.pause()
                        : current && void player.playOrResume(current)
                    }
                  >
                    {playback.status === "playing" ? "Pause" : "Play"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!queue.length}
                    onClick={() => {
                      failedCandidates.current = 0;
                      next();
                    }}
                  >
                    Next
                  </button>
                </div>
                {playback.duration !== null && playback.duration > 0 && (
                  <div className="seek">
                    <label htmlFor="seek">Position</label>
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
                    <span>
                      {formatTime(playback.elapsed)} /{" "}
                      {formatTime(playback.duration)}
                    </span>
                  </div>
                )}
                {current && (
                  <div className="reaction-row" aria-label="Your feedback">
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
                      {reaction === "like" ? "♥ " : "♡ "}Like
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
                      {reaction === "dislike" ? "✕ " : "○ "}Dislike
                    </button>
                  </div>
                )}
              </>
            )}
            {(playback.error || playback.status === "needsGesture") && (
              <p className="error-text" role="alert">
                {playback.error || "Press Play to start listening."}
              </p>
            )}
            {capability && capability.state !== "ready" && (
              <p className="capability-note">
                {capability.reason ||
                  `${labels[source]} is ${capability.state.replace("_", " ")}.`}{" "}
                {capability.state === "not_configured" && (
                  <button
                    className="inline-button"
                    onClick={(event) => openPanel("setup", event)}
                  >
                    Open setup
                  </button>
                )}
              </p>
            )}
            <div className="volume">
              <button
                className="text-button"
                aria-label={playback.muted ? "Unmute" : "Mute"}
                onClick={() => player.toggleMute()}
              >
                {playback.muted ? "Unmute" : "Mute"}
              </button>
              <label htmlFor="volume">Volume</label>
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
          <aside className="artist-panel" aria-labelledby="artist-heading">
            <div className="section-label">BEHIND THE MUSIC</div>
            <h2 id="artist-heading">
              {isRadio(source)
                ? labels[source]
                : current?.artist?.displayName || "An open page"}
            </h2>
            {isRadio(source) ? (
              <p>
                Current artist information isn’t available for this station.
              </p>
            ) : !current ? (
              <p>Artist notes will appear here when you play a track.</p>
            ) : !current.artist || current.artist.confidence === "low" ? (
              <p>
                Artist not identified. Notes are unavailable for this track.
              </p>
            ) : !artistData || artistData.status === "pending" ? (
              <p>Preparing artist notes…</p>
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
                  AI-generated · Generated{" "}
                  {artistData.generatedAt
                    ? new Date(artistData.generatedAt).toLocaleDateString()
                    : "recently"}{" "}
                  · Cached
                </p>
              </>
            ) : artistData.status === "unavailable" ? (
              <p>Artist notes are unavailable for this artist.</p>
            ) : (
              <p>
                Artist notes couldn’t load. Music is still available.{" "}
                <button className="inline-button" onClick={() => void retryArtist()}>
                  Retry
                </button>
              </p>
            )}
          </aside>
        </div>
        {!isRadio(source) && (
          <>
            <section className="queue-section" aria-labelledby="queue-heading">
              <div className="section-heading">
                <div>
                  <div className="section-label">YOUR LISTENING SESSION</div>
                  <h2 id="queue-heading">Up next</h2>
                </div>
                <button
                  className={dj ? "secondary-button" : "primary-button"}
                  onClick={toggleDj}
                >
                  {dj ? "Turn DJ off" : "Start DJ"}
                </button>
              </div>
              <p className="subtle">
                {dj
                  ? `DJ on · Continuing within ${labels[source]}`
                  : `Start a DJ session for automatic selections in ${labels[source]}.`}
              </p>
              {djPending && (
                <p role="status">
                  Finding your next picks…{" "}
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
                  {dj && (
                    <button
                      className="inline-button"
                      onClick={() =>
                        void requestPicks(
                          session.current,
                          epoch.current,
                          direction.trim(),
                        )
                      }
                    >
                      Retry
                    </button>
                  )}
                </p>
              )}
              {!queue.length && !djPending && (
                <p className="empty-state">
                  Nothing queued. Choose music below or start the DJ.
                </p>
              )}
              {!!queue.length && (
                <ol className="queue-list">
                  {queue.map((entry) => (
                    <li key={entry.media.id}>
                      <div>
                        <strong>{entry.media.title}</strong>
                        <span>
                          {entry.media.artist?.displayName || "Artist unknown"}{" "}
                          · {entry.origin}
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
                            choose(entry.media);
                          }}
                        >
                          Play now
                        </button>
                        <button
                          className="inline-button"
                          aria-label={`Remove ${entry.media.title} from queue`}
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
              <div className="direction">
                <label htmlFor="direction">For this session only</label>
                <div>
                  <input
                    id="direction"
                    value={direction}
                    maxLength={500}
                    onChange={(event) => setDirection(event.target.value)}
                    placeholder="A little calmer, more guitar…"
                  />
                  <button
                    className="secondary-button"
                    disabled={!dj || djPending}
                    onClick={() =>
                      void requestPicks(
                        session.current,
                        epoch.current,
                        direction.trim(),
                      )
                    }
                  >
                    Apply
                  </button>
                </div>
              </div>
            </section>
            <section className="chooser" aria-labelledby="choose-heading">
              <div className="section-label">CHOOSE YOURSELF</div>
              <h2 id="choose-heading">
                {source === "local"
                  ? "Your collection"
                  : "Play a YouTube video"}
              </h2>
              {source === "local" ? (
                <>
                  <div className="chooser-tools">
                    <label htmlFor="search">Search your collection</label>
                    <input
                      id="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Title or artist"
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
                        ? "Configure your MP3 folder in local settings, then scan it here."
                        : !cap
                          ? capError
                            ? "Collection unavailable until the local server starts."
                            : "Checking your collection…"
                          : cap.library.state === "ready" ||
                              cap.library.state === "scanning"
                            ? "No MP3s found. Rescan your configured folder or check Setup."
                            : "Collection unavailable. Check Setup for details."}
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
                              Add to queue
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
                </>
              ) : (
                <>
                  <p className="subtle">
                    Paste a YouTube URL or video ID. Discovery requires separate
                    setup; direct videos can still work.
                  </p>
                  <form className="youtube-form" onSubmit={resolveVideo}>
                    <label htmlFor="youtube-link">Video URL or ID</label>
                    <div>
                      <input
                        id="youtube-link"
                        value={youtubeInput}
                        onChange={(event) =>
                          setYoutubeInput(event.target.value)
                        }
                        required
                        placeholder="https://www.youtube.com/watch?v=…"
                      />
                      <button className="secondary-button">Find video</button>
                    </div>
                  </form>
                  {resolveStatus && <p role="status">{resolveStatus}</p>}
                  {resolved && (
                    <div className="resolved-item">
                      <div>
                        <strong>{resolved.title}</strong>
                        <span>
                          {resolved.artist?.displayName || "Artist unknown"}
                        </span>
                      </div>
                      <div className="row-actions">
                        <button
                          className="inline-button"
                          onClick={() => choose(resolved)}
                        >
                          Play now
                        </button>
                        <button
                          className="inline-button"
                          onClick={() => addQueue(resolved)}
                        >
                          Add to queue
                        </button>
                      </div>
                    </div>
                  )}
                  {cap?.youtubeDiscovery.state !== "ready" && (
                    <p className="capability-note">
                      DJ discovery:{" "}
                      {cap?.youtubeDiscovery.reason || "setup required"}. Direct
                      video entry remains available.
                    </p>
                  )}
                </>
              )}
            </section>
          </>
        )}
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
              <p>
                Run the local server, then configure sources in its environment.
                No collection upload is needed.
              </p>
              <h3>Local collection</h3>
              <p>
                Set <code>MUSIC_LIBRARY_ROOT</code> to your MP3 folder, restart
                the server, then use Rescan in Local. {cap?.library.reason}
              </p>
              <h3>Codex DJ and artist notes</h3>
              <p>
                Log in with the pinned Codex CLI using this app’s private
                <code> CODEX_HOME</code> under <code>MUSIC_DATA_DIR/codex-home</code>,
                then restart the server. See the README for the exact command.
                Selected taste and metadata are sent to the configured Codex
                service; account plan limits apply. {cap?.codex.reason}
              </p>
              <h3>YouTube</h3>
              <p>
                Set <code>YOUTUBE_DATA_API_KEY</code> for DJ discovery. Direct
                URL playback uses the visible YouTube player.{" "}
                {cap?.youtubeDiscovery.reason}
              </p>
              <h3>Stations</h3>
              {(["kexp", "yle1", "radio-helsinki"] as const).map((id) => (
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
                Like and Dislike save explicit track feedback. The DJ uses it in
                future selections. Undo either by pressing its selected button
                again.
              </p>
              {tasteData ? (
                <>
                  <p>
                    Feedback revision {tasteData.feedbackRevision} · Summary{" "}
                    {summaryUnavailable ? "unavailable" : tasteData.summaryStatus}
                  </p>
                  {summaryUnavailable ? (
                    <p>
                      Feedback is saved. Taste summary needs Codex to become
                      available. Configure it in{" "}
                      <button
                        className="inline-button"
                        onClick={() => setPanel("setup")}
                      >
                        Setup
                      </button>
                      , then check again.
                    </p>
                  ) : tasteData.summaryStatus === "pending" && (
                    <p>Feedback saved. Taste summary is updating.</p>
                  )}
                  {tasteData.summaryStatus === "failed" && (
                    <p className="error-text">
                      Taste summary update failed. Saved feedback remains
                      available.
                    </p>
                  )}
                  {tasteData.summaryMarkdown ? (
                    <div className="taste-summary">
                      {tasteData.summaryMarkdown}
                    </div>
                  ) : (
                    <p>No taste summary yet.</p>
                  )}
                </>
              ) : (
                <p>
                  Taste data is unavailable. Check the local server and Setup.
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
