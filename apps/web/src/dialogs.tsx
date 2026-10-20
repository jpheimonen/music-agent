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

export function TasteContent(props: {
  taste: Taste | null;
  memory: DjMemory | null;
  codexReady: boolean;
  onForget: (id: string) => void;
  onSetup: () => void;
  onImport: (contents: unknown) => Promise<string>;
}) {
  const { taste, memory } = props;
  const picker = React.useRef<HTMLInputElement>(null);
  // A chosen file waits here until you confirm that it replaces your taste.
  const [chosen, setChosen] = React.useState<{ name: string; contents: unknown } | null>(null);
  const [importStatus, setImportStatus] = React.useState({ text: "", failed: false, busy: false });
  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setChosen({ name: file.name, contents: JSON.parse(await file.text()) });
      setImportStatus({ text: "", failed: false, busy: false });
    } catch {
      setChosen(null);
      setImportStatus({ text: "That file isn’t a taste export. Choose the .json file you exported.", failed: true, busy: false });
    }
  };
  const confirmImport = async () => {
    if (!chosen) return;
    setImportStatus({ text: "Importing…", failed: false, busy: true });
    try {
      setImportStatus({ text: await props.onImport(chosen.contents), failed: false, busy: false });
    } catch (error) {
      setImportStatus({ text: error instanceof Error ? error.message : String(error), failed: true, busy: false });
    }
    setChosen(null);
  };
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
      <h3>Move your taste to another machine</h3>
      <p className="subtle">
        Export saves your likes, dislikes, taste notes and what you told the DJ in one file. Import that file on the other machine to replace its taste with yours.
      </p>
      <div className="taste-transfer">
        <a className="secondary-button" href="/api/v1/taste/export" download>
          Export taste
        </a>
        <button className="secondary-button" disabled={importStatus.busy} onClick={() => picker.current?.click()}>
          Import taste…
        </button>
        <input ref={picker} type="file" accept=".json,application/json" hidden onChange={(event) => void chooseFile(event)} />
      </div>
      {chosen && (
        <div className="taste-confirm">
          <p>
            Replace your likes, dislikes, taste notes and what you told the DJ with the ones in <strong>{chosen.name}</strong>?
          </p>
          <div className="taste-transfer">
            <button className="primary-button" disabled={importStatus.busy} onClick={() => void confirmImport()}>
              Replace my taste
            </button>
            <button className="secondary-button" disabled={importStatus.busy} onClick={() => setChosen(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {importStatus.text && (
        <p role="status" className={importStatus.failed ? "error-text" : "ok-text"}>
          {importStatus.text}
        </p>
      )}
    </div>
  );
}
