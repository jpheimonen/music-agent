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
