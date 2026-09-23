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
