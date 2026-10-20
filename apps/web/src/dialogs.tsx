import React from "react";
import type { Capabilities, DjMemory } from "@music/contracts";
import { describeReason, stationLabel, stations } from "./model";

export function SetupContent(props: { cap: Capabilities | null; onRefresh: () => void }) {
  const { cap } = props;
  return (
    <div className="setup-content">
      <h3>The DJ (Codex)</h3>
      <p className={cap?.codex.state === "ready" ? "ok-text" : ""}>
        {cap?.codex.state === "ready" ? "Ready. The DJ uses your existing Codex login." : describeReason(cap?.codex.reason) || "Checking Codex…"}
      </p>
      <p className="subtle">
        Uses the Codex login in <code>{cap?.codex.authHomeSource === "user_home" ? "~/.codex" : cap?.codex.authHomeSource || "your Codex home"}</code>. Your likes,
        notes and recent listening are sent to Codex when the DJ picks or talks; your plan's usage limits apply.
      </p>
      <h3>YouTube</h3>
      <p className={cap?.youtubePlayback.state === "ready" ? "ok-text" : ""}>
        {cap?.youtubePlayback.state === "ready"
          ? `Ready. YouTube plays as audio through yt-dlp ${cap.youtubePlayback.version ?? ""}, which the app keeps up to date. No API key needed.`
          : describeReason(cap?.youtubePlayback.reason) || "Checking yt-dlp…"}
      </p>
      <h3>Your collection</h3>
      <p>
        {cap?.library.state === "ready" ? "Ready." : cap?.library.state === "not_configured" ? "Not set up." : cap?.library.state || "Checking…"} Set{" "}
        <code>MUSIC_LIBRARY_ROOT</code> to your MP3 folder, restart the server, then use Rescan under Your collection.{" "}
        {cap?.library.state !== "not_configured" && cap?.library.reason}
      </p>
      <h3>Live radio</h3>
      {stations.map((id) => (
        <p key={id}>
          <strong>{stationLabel(id)}:</strong> {cap?.stations[id].state || "unknown"} {cap?.stations[id].reason}
        </p>
      ))}
      <button className="secondary-button" onClick={props.onRefresh}>
        Check again
      </button>
    </div>
  );
}

type Taste = { summaryStatus: string; summaryMarkdown: string | null; feedback: Record<string, string> };

export function TasteContent(props: { taste: Taste | null; memory: DjMemory | null; codexReady: boolean; onForget: (id: string) => void; onSetup: () => void }) {
  const { taste, memory } = props;
  const reactions = Object.values(taste?.feedback ?? {});
  const waiting = taste?.summaryStatus === "pending" && !props.codexReady;
  return (
    <div className="setup-content">
      <h3>What you told the DJ</h3>
      {!memory ? (
        <p>Loading…</p>
      ) : memory.notes.length ? (
        <ul className="note-list">
          {memory.notes.map((note) => (
            <li key={note.id}>
              <span>{note.text}</span>
              <button className="inline-button" aria-label={`Forget: ${note.text}`} onClick={() => props.onForget(note.id)}>
                Forget
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>Nothing yet. Talk to the DJ, or let it interview you about your taste.</p>
      )}
      <h3>What the DJ learned from your reactions</h3>
      <p className="subtle">
        {reactions.filter((value) => value === "like").length} liked · {reactions.filter((value) => value === "dislike").length} disliked. Like, Not for me and 👎 in Up next
        save reactions; skips count too. Press Like again to undo it.
      </p>
      {!taste ? (
        <p>Your taste data is unavailable. Check that the server is running.</p>
      ) : (
        <>
          {waiting ? (
            <p>
              Your reactions are saved. The DJ writes your taste notes once Codex is available. See{" "}
              <button className="inline-button" onClick={props.onSetup}>
                Setup
              </button>
              .
            </p>
          ) : (
            taste.summaryStatus === "pending" && <p>Reactions saved. The DJ is updating your taste notes.</p>
          )}
          {taste.summaryStatus === "failed" && <p className="error-text">Updating your taste notes failed. Your reactions are still saved.</p>}
          {taste.summaryMarkdown ? <div className="taste-summary">{taste.summaryMarkdown}</div> : <p>No taste notes yet. Like a few tracks to get started.</p>}
        </>
      )}
    </div>
  );
}

// Who is playing, opened from the player bar: the cover big, the song, and the DJ's notes on the artist.
export type ArtistSubject = {
  key: string | null;
  name: string;
  song: string;
  album?: string;
  reason?: string;
  context: string;
  artwork?: string;
  largeArtwork?: string;
  link?: { href: string; label: string };
};
type ArtistNotes = { status: string; introduction?: string; text?: string; generatedAt?: string } | null;

export function ArtistContent(props: { subject: ArtistSubject; notes: ArtistNotes; codexReady: boolean; onRetry: () => void }) {
  const { subject, notes } = props;
  const [art, setArt] = React.useState(subject.largeArtwork ?? subject.artwork);
  // YouTube answers a missing large thumbnail with a tiny placeholder, so fall back to the normal one.
  const fallBack = () => setArt((current) => (current !== subject.artwork ? subject.artwork : undefined));
  return (
    <div className="artist-sheet">
      {art ? (
        <img
          className="artist-cover"
          src={art}
          alt={`Cover for ${subject.song}`}
          onError={fallBack}
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth <= 120) fallBack();
          }}
        />
      ) : (
        <div className="disc artist-cover" aria-hidden="true" />
      )}
      <div className="artist-facts">
        <p className="section-label">{subject.context}</p>
        <p className="artist-name">{subject.name}</p>
        <p className="artist-song">
          {subject.song}
          {subject.album && <span> · {subject.album}</span>}
        </p>
        {subject.reason && <p className="artist-reason">“{subject.reason}”</p>}
        {subject.link && (
          <a className="inline-button" href={subject.link.href} target="_blank" rel="noreferrer">
            {subject.link.label}
          </a>
        )}
      </div>
      <div className="artist-notes">
        {!subject.key ? (
          <p className="subtle">There's no artist name for this one, so the DJ has nothing to tell about them.</p>
        ) : !notes || notes.status === "pending" ? (
          <p className="subtle">
            <span className="spinner" aria-hidden="true" /> The DJ is digging up the story…
          </p>
        ) : notes.status === "cached" ? (
          <>
            <p className="artist-intro">{notes.introduction}</p>
            {notes.text && <p className="long-copy">{notes.text}</p>}
            <p className="provenance">Written by AI · {notes.generatedAt ? new Date(notes.generatedAt).toLocaleDateString() : "recently"}</p>
          </>
        ) : notes.status === "unavailable" ? (
          <p className="subtle">{props.codexReady ? "No notes on this artist." : "Artist notes need the DJ's Codex login. Check Setup."}</p>
        ) : (
          <p className="subtle">
            Couldn't get the story on this one. The music keeps playing.{" "}
            <button className="inline-button" onClick={props.onRetry}>
              Retry
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
