import React from "react";
import type { PlaybackState } from "./playback";
import type { RadioMetadata } from "./radio-metadata";
import { artistOf, formatTime, stationLabel, stationNote, type Now, type Reaction } from "./model";

type Props = {
  now: Now;
  playback: PlaybackState;
  reaction: Reaction;
  canLike: boolean;
  radioLive: boolean;
  stationPending: boolean;
  stationError: string;
  metadata: RadioMetadata | null;
  canSkip: boolean;
  canReturnToDj: boolean;
  message: string;
  onToggle: () => void;
  onSkip: () => void;
  onLike: () => void;
  onNotForMe: () => void;
  onBackToDj: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (value: number) => void;
  onMute: () => void;
  onArtist: (event: React.MouseEvent<HTMLElement>) => void;
};

// The deck stays on screen at the bottom: what's on, and every control for it.
export function PlayerBar(props: Props) {
  const { now, playback, metadata } = props;
  const playing = playback.status === "playing";
  const track = now?.kind === "track" ? now : null;
  const station = now?.kind === "station" ? now.stationId : null;
  const onAir = metadata?.status === "current" ? metadata : null;
  const state = station
    ? playing ? "Live" : props.stationPending || playback.status === "loading" ? "Connecting" : props.stationError || playback.status === "failed" ? "Unavailable" : "Off air"
    : track
      ? playing ? "Now playing" : playback.status === "loading" ? "Loading" : playback.status === "paused" ? "Paused" : "Ready"
      : "Nothing playing";
  const toggleLabel = station
    ? props.radioLive ? "Stop" : playback.status === "needsGesture" ? "Play" : "Listen live"
    : playing ? "Pause" : "Play";
  const artistLine = track
    ? artistOf(track.media)
    : station
      ? onAir ? onAir.artist || (onAir.kind === "programme" ? "On air now" : stationLabel(station)) : stationNote(station)
      : "It starts here and keeps going.";
  // A track, or a song the station names, opens a window about who is playing.
  const aboutArtist = Boolean(track) || onAir?.kind === "track";
  const art = track?.media.artwork ? <img className="player-art" src={track.media.artwork} alt="" /> : <div className="disc player-art" aria-hidden="true" />;
  const duration = track && playback.duration && playback.duration > 0 ? playback.duration : null;

  return (
    <section className={`player-bar ${playing ? "is-playing" : ""}`} aria-label="Player">
      {props.message && (
        <p className="player-message" role="alert">
          {props.message}
        </p>
      )}
      <div className="player-inner">
        <div className="player-identity">
          {/* The cover opens the artist too; the artist name is the keyboard route. */}
          {aboutArtist ? (
            <button className="player-art-button" tabIndex={-1} aria-hidden="true" onClick={props.onArtist}>
              {art}
            </button>
          ) : (
            art
          )}
          <div className="player-text">
            <p className="player-state">
              <span className="eq" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              {state}
              {track && ` · ${track.origin === "You" ? "Added by you" : "DJ pick"}`}
              {station && ` · ${stationLabel(station)}`}
            </p>
            <p className="player-title">{track ? track.media.title : station ? onAir?.title || stationLabel(station) : "Ask the DJ for music"}</p>
            <p className="player-artist">
              {aboutArtist ? (
                <button className="player-artist-button" title={`More about ${artistLine}`} onClick={props.onArtist}>
                  {artistLine}
                </button>
              ) : (
                artistLine
              )}
            </p>
            {track?.reason && (
              <p className="player-reason" title={track.reason}>
                {track.reason}
              </p>
            )}
          </div>
        </div>
        <div className="player-controls">
          <div className="player-transport">
            <button className="primary-button" disabled={!now} onClick={props.onToggle}>
              {toggleLabel}
            </button>
            {station ? (
              props.canReturnToDj && (
                <button className="secondary-button" onClick={props.onBackToDj}>
                  Back to the DJ
                </button>
              )
            ) : (
              <button className="secondary-button" disabled={!props.canSkip} onClick={props.onSkip}>
                Skip
              </button>
            )}
            {props.canLike && (
              <button className={`reaction ${props.reaction === "like" ? "active" : ""}`} aria-pressed={props.reaction === "like"} onClick={props.onLike}>
                {props.reaction === "like" ? "♥" : "♡"} Like
              </button>
            )}
            {track && (
              <button className="reaction dislike" title="Skip this track and tell the DJ you dislike it" onClick={props.onNotForMe}>
                ✕ Not for me
              </button>
            )}
          </div>
          {duration !== null && (
            <div className="seek">
              <label htmlFor="seek" className="sr-only">
                Position
              </label>
              <span>{formatTime(playback.elapsed)}</span>
              <input
                id="seek"
                type="range"
                style={{ "--fill": `${(Math.min(playback.elapsed, duration) / duration) * 100}%` } as React.CSSProperties}
                min="0"
                max={duration}
                value={Math.min(playback.elapsed, duration)}
                onChange={(event) => props.onSeek(Number(event.target.value))}
              />
              <span>{formatTime(duration)}</span>
            </div>
          )}
        </div>
        <div className="volume">
          <button className="text-button" aria-label={playback.muted ? "Unmute" : "Mute"} onClick={props.onMute}>
            {playback.muted ? "Unmute" : "Mute"}
          </button>
          <label htmlFor="volume" className="sr-only">
            Volume
          </label>
          <input
            id="volume"
            type="range"
            style={{ "--fill": `${playback.volume * 100}%` } as React.CSSProperties}
            min="0"
            max="1"
            step="0.01"
            value={playback.volume}
            onChange={(event) => props.onVolume(Number(event.target.value))}
          />
        </div>
      </div>
    </section>
  );
}
