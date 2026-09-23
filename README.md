# Music

Local TypeScript music app foundation. Feature modules for library, taste, Codex DJ, YouTube and radio are being integrated separately. The current setup page and `/api/v1/capabilities` report unavailable features explicitly.

## Run

Requires Node.js 24 and npm 11. From the repository root:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8787. The server binds loopback only and serves the built frontend and API from one origin. For development, run `npm run dev`, then open http://127.0.0.1:5173; Vite proxies `/api` to the backend. `npm run typecheck` checks all workspaces.

Set environment values before starting. `.env.example` lists them without credentials. `MUSIC_LIBRARY_ROOT` must be absolute. `MUSIC_DATA_DIR` defaults to `./data`; do not expose it publicly. The YouTube key is read server-side only. Optional station endpoint overrides must be credential-free HTTPS. The current foundation does not claim that configuration alone makes an adapter available.

The browser uses `/api/v1`. JSON API errors include a stable code and request ID. No CORS is enabled. Requests are limited to local Host and same-origin mutation Origin. Jobs are in-memory and cancellation is best effort; feature workers will attach bounded operations. A server restart does not resume a job.
# Taste data

`MUSIC_DATA_DIR` (default `./data`, resolved from the server working directory) contains the authoritative `likes.csv`, `dislikes.csv`, and `musical_taste.md`. Keep this directory private and back it up as a unit. The CSV files are UTF-8 RFC4180 with header `schema_version,media_id,source,title,artist,recorded_at`, schema version `1`, one row per media ID, and UTC ISO8601 timestamps. A media ID appears in at most one file. `musical_taste.md` has YAML-like front matter with `schema_version`, `summary_revision`, `based_on_feedback_revision`, and `generated_at`. Its body is derived narrative; the CSVs are the explicit feedback facts.

The server also writes `taste-manifest.json` (revisions, hashes, retry receipts), `taste-pending.json` during a commit, and `.taste.lock` while running. Only one server process may use the directory. Reactions are immediately durable and increment the feedback revision; summary synthesis has a separate revision and can lag. The internal `TasteRepository.commitSummary` operation rejects generated text based on stale feedback or summary revisions. Codex must never write these files directly.

`PUT /api/v1/feedback/:mediaId` accepts JSON `{ "reaction": "like" | "dislike" | "neutral", "expectedRevision": number, "media"?: MediaItem }` and requires an `Idempotency-Key` header of 8–128 letters, digits, `_`, or `-`. A retry with the same key and request returns the original canonical result. A different request under that key or a stale revision returns `revision_conflict`. `GET /api/v1/taste?mediaIds=id1,id2` returns current feedback and the summary's separate `current`, `pending`, or `failed` status. The `media` field supplies display metadata when a reaction is first recorded; without it the media ID is used as the CSV title.

On startup, a valid pending journal is replayed before requests are served. A crash may leave `.taste.lock`; startup removes it only when its recorded PID no longer exists. Valid offline edits are imported on restart with a new feedback revision and a `taste-last-known-good` backup. Stop the server before editing; changes made while it runs produce `external_file_change` on the next write. If startup reports malformed data, incomplete files, or a conflicting journal, preserve the directory and restore a known-good copy or repair the named file before restarting. The server does not overwrite malformed existing taste files. Do not delete a pending journal to force startup; it may contain the only complete commit after-image.
