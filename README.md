# Music

Local TypeScript music app with a browser player, media and taste services, and a Codex DJ. The setup page and `/api/v1/capabilities` report unavailable features explicitly.

## Run

Requires Node.js 24 and npm 11. From the repository root:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8787. The server binds loopback only and serves the built frontend and API from one origin. For development, run `npm run dev`, then open http://127.0.0.1:5173; Vite proxies `/api` to the backend. `npm run typecheck` checks all workspaces.

Set environment values before starting. `.env.example` lists them without credentials. `MUSIC_LIBRARY_ROOT` must be absolute. `MUSIC_DATA_DIR` defaults to the repository's `data/` directory; relative `MUSIC_DATA_DIR` and `MUSIC_CODEX_HOME` overrides are resolved from the repository root even when npm starts the server in its workspace. Do not expose the data directory publicly. The YouTube key is read server-side only. Optional station endpoint overrides must be credential-free HTTPS.

The browser uses `/api/v1`. JSON API errors include a stable code and request ID. No CORS is enabled. Requests are limited to local Host and same-origin mutation Origin. Jobs are in-memory and cancellation is best effort; feature workers will attach bounded operations. A server restart does not resume a job.

## Media setup

Set `MUSIC_LIBRARY_ROOT` to an absolute readable MP3 directory. POST `/api/v1/library/scans` with `{}` to build the catalog; poll `/api/v1/jobs/:id`. Pass `{ "full": true }` to rehash every file. `GET /api/v1/library/tracks?q=&cursor=&limit=` returns bounded pages. Indexed files use full content SHA-256 identities and support GET/HEAD byte ranges at `/api/v1/media/local/:id`. The catalog under `MUSIC_DATA_DIR` is rebuildable. Changing tags changes identity.

For YouTube discovery, enable YouTube Data API v3 in a Google Cloud project and set `YOUTUBE_DATA_API_KEY` in the server environment. Direct video URL/ID resolution works without a key; search returns `setup_required` without one. Search results are embeddable candidates, not a playback guarantee. Provider authentication, quota, and availability failures are reported separately. The key stays server-side.

`GET /api/v1/stations` lists the three configured modes; `POST /api/v1/stations/:id/resolve` selects the current direct browser URL without a network health check. KEXP and Radio Helsinki URLs came from official station pages. Yle Radio 1's HLS URL came from a third-party directory and played in a managed browser probe. Its long-term stability and human audibility are unverified. Optional overrides must be credential-free HTTPS.

## Taste data

`MUSIC_DATA_DIR` (default repository-root `data/`) contains the authoritative `likes.csv`, `dislikes.csv`, and `musical_taste.md`. Keep this directory private and back it up as a unit. The CSV files are UTF-8 RFC4180 with header `schema_version,media_id,source,title,artist,recorded_at`, schema version `1`, one row per media ID, and UTC ISO8601 timestamps. A media ID appears in at most one file. `musical_taste.md` has YAML-like front matter with `schema_version`, `summary_revision`, `based_on_feedback_revision`, and `generated_at`. Its body is derived narrative; the CSVs are the explicit feedback facts.

The server also writes `taste-manifest.json` (revisions, hashes, retry receipts), `taste-pending.json` during a commit, and `.taste.lock` while running. Only one server process may use the directory. Reactions are immediately durable and increment the feedback revision; summary synthesis has a separate revision and can lag. The internal `TasteRepository.commitSummary` operation rejects generated text based on stale feedback or summary revisions. Codex must never write these files directly.

`PUT /api/v1/feedback/:mediaId` accepts JSON `{ "reaction": "like" | "dislike" | "neutral", "expectedRevision": number, "media"?: MediaItem }` and requires an `Idempotency-Key` header of 8–128 letters, digits, `_`, or `-`. A retry with the same key and request returns the original canonical result. A different request under that key or a stale revision returns `revision_conflict`. `GET /api/v1/taste?mediaIds=id1,id2` returns current feedback and the summary's separate `current`, `pending`, or `failed` status. The `media` field supplies display metadata when a reaction is first recorded; without it the media ID is used as the CSV title.

On startup, a valid pending journal is replayed before requests are served. A crash may leave `.taste.lock`; startup removes it only when its recorded PID no longer exists. Valid offline edits are imported on restart with a new feedback revision and a `taste-last-known-good` backup. Stop the server before editing; changes made while it runs produce `external_file_change` on the next write. If startup reports malformed data, incomplete files, or a conflicting journal, preserve the directory and restore a known-good copy or repair the named file before restarting. The server does not overwrite malformed existing taste files. Do not delete a pending journal to force startup; it may contain the only complete commit after-image.

## Codex DJ setup

`npm ci` installs the pinned `codex-cli 0.156.1` alongside `@openai/codex-sdk` 0.156.1; an external pinned CLI on `PATH` or an absolute `MUSIC_CODEX_BIN` path also works. The server resolves the native runtime behind the npm CLI shim and checks its version. It uses your existing Codex login: `MUSIC_CODEX_HOME` if set, otherwise the server's `CODEX_HOME`, otherwise the OS user's `~/.codex`. Relative `MUSIC_CODEX_HOME` and `CODEX_HOME` values resolve from the repository root. No second app login is needed. If the app reports `setup_required`, check that the selected home is the one your normal Codex CLI session uses and that the CLI is logged in there, then restart the server.

The app does not read or copy authentication tokens, modify your `config.toml`, or run login/logout. It passes the real user home and selected Codex home to the trusted CLI for file or OS-keyring credentials. Each music job applies its own restrictive permission profile and disables configured MCP servers, hooks, notifications, apps, plugins and shell tools for that invocation. A config that cannot be safely overlaid reports `codex_config_incompatible`; harmless personal settings remain valid. A ChatGPT account with Codex access, network connectivity, and available plan usage is required. Selected taste and media metadata are sent to the Codex inference service. The server excludes `YOUTUBE_DATA_API_KEY` and unrelated environment variables from the Codex child process.

At startup the server checks CLI version and runs a synthetic allowed/sibling file read against its restrictive permission profile. Failed checks disable AI routes while manual media and feedback remain usable. `GET /api/v1/capabilities` reports Codex and YouTube discovery separately. A later login expiry or usage limit may still fail a job. The profile check establishes only the tested filesystem boundary on this Linux host; it does not prove complete process confinement.

Feedback is saved immediately to the CSVs. When Codex is ready, a coalesced synthesis job updates `musical_taste.md`; `GET /api/v1/taste` reports its status. `POST /api/v1/dj/recommendations` starts a source-bound recommendation job and returns a `jobId` to poll at `GET /api/v1/jobs/:id`. `DELETE /api/v1/jobs/:id` cancels work. Local ranking uses indexed catalog candidates; YouTube discovery also needs `YOUTUBE_DATA_API_KEY`. Returned IDs are checked against the actual candidate set and current taste revision. Without AI or YouTube credentials the endpoint reports setup needed; it does not return fabricated picks. Known ID3 artist identities can generate cached information through `GET /api/v1/artists/:key/info` and `POST /api/v1/artists/:key/info/refresh`. Unknown artist identities do not trigger generation.
