import React from "react";
import { stationCatalog, type Capabilities, type MediaItem, type StationId } from "@music/contracts";
import type { RadioMetadata } from "./radio-metadata";
import { artistOf, stationLabel, stationNote, stations, type Entry } from "./model";

export function QueuePanel(props: {
  queue: Entry[];
  dj: boolean;
  djPending: boolean;
  onPlay: (entry: Entry) => void;
  onDislike: (entry: Entry) => void;
  onRemove: (entry: Entry) => void;
}) {
  return (
    <section className="card" aria-labelledby="queue-heading">
      <div className="section-label">UP NEXT</div>
      <h2 id="queue-heading" className="sr-only">
        Up next
      </h2>
      {!props.queue.length ? (
        <p className="empty-state">
          {props.djPending ? "The DJ's picks will appear here." : props.dj ? "The DJ adds more as the music plays." : "Start the DJ and its picks line up here, each with a note on why."}
        </p>
      ) : (
        <ol className="queue-list">
          {props.queue.map((entry) => (
            <li key={entry.media.id}>
              <div>
                <strong>{entry.media.title}</strong>
                <span>
                  {artistOf(entry.media)}
                  {entry.origin === "You" ? " · Added by you" : ""}
                </span>
                {entry.reason && <small>{entry.reason}</small>}
              </div>
              <div className="row-actions">
                <button className="inline-button" onClick={() => props.onPlay(entry)}>
                  Play now
                </button>
                <button
                  className="thumb-down"
                  aria-label={`Not for me: remove ${entry.media.title} and tell the DJ you dislike it`}
                  title="Not for me: remove it and tell the DJ you dislike it"
                  onClick={() => props.onDislike(entry)}
                >
                  <span aria-hidden="true">👎</span>
                </button>
                <button className="inline-button" aria-label={`Remove ${entry.media.title} from Up next`} onClick={() => props.onRemove(entry)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function CollectionPanel(props: {
  cap: Capabilities | null;
  tracks: MediaItem[];
  query: string;
  hasMore: boolean;
  error: string;
  scanStatus: string;
  onQuery: (query: string) => void;
  onScan: () => void;
  onMore: () => void;
  onPlay: (item: MediaItem) => void;
  onAdd: (item: MediaItem) => void;
}) {
  const state = props.cap?.library.state;
  return (
    <section className="card collection" aria-labelledby="collection-heading">
      <div className="section-label">YOUR COLLECTION</div>
      <h2 id="collection-heading" className="sr-only">
        Browse your collection
      </h2>
      <div className="chooser-tools">
        <label htmlFor="search" className="sr-only">
          Search your collection
        </label>
        <input id="search" value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Search by title or artist" />
        <button className="secondary-button" disabled={state === "not_configured"} onClick={props.onScan}>
          Rescan
        </button>
      </div>
      {props.scanStatus && <p role="status">{props.scanStatus}</p>}
      {props.error && (
        <p className="error-text" role="alert">
          {props.error}
        </p>
      )}
      {!props.tracks.length && !props.error && (
        <p className="empty-state">
          {state === "not_configured"
            ? "Set MUSIC_LIBRARY_ROOT to your MP3 folder and restart the server. Setup shows how."
            : !props.cap
              ? "Checking your collection…"
              : state === "ready" || state === "scanning"
                ? "No MP3s found. Rescan your folder or check Setup."
                : "Your collection isn't available. Check Setup."}
        </p>
      )}
      {props.tracks.length > 0 && (
        <ul className="catalog-list">
          {props.tracks.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.artist?.displayName || "Artist unknown"}
                  {item.availability === "unavailable" ? " · Unavailable" : ""}
                </span>
              </div>
              <div className="row-actions">
                <button className="inline-button" disabled={item.availability !== "available"} onClick={() => props.onPlay(item)}>
                  Play now
                </button>
                <button className="inline-button" disabled={item.availability !== "available"} onClick={() => props.onAdd(item)}>
                  Add to Up next
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {props.hasMore && (
        <button className="secondary-button more-button" onClick={props.onMore}>
          Load more
        </button>
      )}
    </section>
  );
}

export function RadioPanel(props: {
  selected: StationId;
  onAir: StationId | null;
  live: boolean;
  playing: boolean;
  metadata: RadioMetadata | null;
  error: string;
  dj: boolean;
  onTune: (id: StationId) => void;
  onRetry: () => void;
}) {
  const reported = props.metadata?.status === "current" ? props.metadata : null;
  return (
    <section className="card radio" aria-labelledby="radio-heading">
      <div className="section-label">LIVE RADIO</div>
      <h2 id="radio-heading" className="radio-heading">
        Tune in <em>live</em>
      </h2>
      <p className="subtle">
        Real stations, real hosts. Pick one and it starts playing.
        {props.dj ? " The DJ keeps your queue and waits until you come back." : ""}
      </p>
      {props.onAir && (
        <div className="radio-metadata" aria-live="polite" aria-atomic="true">
          {reported ? (
            <>
              <p className="metadata-label">{reported.kind === "programme" ? `On air on ${stationLabel(props.onAir)} · programme` : `Latest track reported by ${stationLabel(props.onAir)}`}</p>
              <p className="metadata-title">{reported.title}</p>
              {reported.artist && <p className="metadata-artist">{reported.artist}</p>}
              <p className="metadata-note">
                <a href={reported.sourceUrl || stationCatalog[props.onAir].website} target="_blank" rel="noreferrer">
                  {stationLabel(props.onAir)} playlist
                </a>
                {" · "}Station information may differ slightly from the audio.
              </p>
            </>
          ) : (
            <p className="metadata-note">
              {!props.live
                ? "Track information appears while you listen."
                : !props.metadata || props.metadata.status === "loading"
                  ? "Checking what’s on air…"
                  : props.metadata.status === "unsupported"
                    ? "Live track information isn’t provided for this stream."
                    : props.metadata.status === "stale"
                      ? "The station’s last update has expired. Checking again shortly."
                      : "Live track information is unavailable right now."}{" "}
              <a href={stationCatalog[props.onAir].website} target="_blank" rel="noreferrer">
                Visit {stationLabel(props.onAir)}
              </a>
            </p>
          )}
        </div>
      )}
      {props.error && props.onAir && (
        <p className="error-text" role="alert">
          Couldn’t connect to {stationLabel(props.onAir)}: {props.error}{" "}
          <button className="inline-button" onClick={props.onRetry}>
            Retry
          </button>
        </p>
      )}
      <div className="station-list">
        {stations.map((id, index) => {
          const tuned = props.onAir === id && props.live;
          const onAir = tuned && props.playing;
          return (
            <button key={id} className={`station ${onAir ? "on-air" : ""}`} aria-pressed={props.onAir === id || (!props.onAir && props.selected === id)} onClick={() => props.onTune(id)}>
              <span className="station-preset" aria-hidden="true">
                Preset {String(index + 1).padStart(2, "0")}
              </span>
              <strong>{stationLabel(id)}</strong>
              <span className="station-note">{stationNote(id)}</span>
              {tuned && (
                <span className="station-live">
                  {onAir && (
                    <span className="eq" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  {onAir ? "On air" : "Tuning in…"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
