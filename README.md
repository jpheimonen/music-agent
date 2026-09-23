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

## Media setup

Set `MUSIC_LIBRARY_ROOT` to an absolute readable MP3 directory. POST `/api/v1/library/scans` with `{}` to build the catalog; poll `/api/v1/jobs/:id`. Pass `{ "full": true }` to rehash every file. `GET /api/v1/library/tracks?q=&cursor=&limit=` returns bounded pages. Indexed files use full content SHA-256 identities and support GET/HEAD byte ranges at `/api/v1/media/local/:id`. The catalog under `MUSIC_DATA_DIR` is rebuildable. Changing tags changes identity.

For YouTube discovery, enable YouTube Data API v3 in a Google Cloud project and set `YOUTUBE_DATA_API_KEY` in the server environment. Direct video URL/ID resolution works without a key; search returns `setup_required` without one. Search results are embeddable candidates, not a playback guarantee. Provider authentication, quota, and availability failures are reported separately. The key stays server-side.

`GET /api/v1/stations` lists the three configured modes; `POST /api/v1/stations/:id/resolve` selects the current direct browser URL without a network health check. KEXP and Radio Helsinki URLs came from official station pages. Yle Radio 1's HLS URL came from a third-party directory and played in a managed browser probe. Its long-term stability and human audibility are unverified. Optional overrides must be credential-free HTTPS.
