# music-agent: sandbox, build, and testing gotchas

Environment: Ubuntu host, music-agent with a web UI (`apps/web/dist`) and a Codex-based DJ.

## Codex bubblewrap sandbox is blocked on this host
- On this Ubuntu host the Codex bubblewrap sandbox cannot start: `kernel.apparmor_restrict_unprivileged_userns=1` and there is no `bwrap` AppArmor profile.
- Since commit cffe7a4, by the owner's choice, music jobs run Codex with `danger-full-access` and the startup sandbox check is gone, so the real DJ works here without any sudo or AppArmor fix. Don't reintroduce a sandbox probe or the `music_agent` permission profile.
- `features.use_legacy_landlock` does not help — it panics with read-restricted profiles.

## Contracts build ordering
- When changing `@music/contracts`, build contracts before running server tests or workspace typecheck; those resolve its built `dist` declarations and can initially report missing exports until the build refreshes them.

## Testing the DJ UI without the real Codex
- To exercise the DJ UI while Codex is blocked, use a throwaway Node mock that serves `apps/web/dist` and fakes `/api/v1/capabilities`, `/dj/recommendations`, and `/jobs/:id`. This lets the UI be driven without a working Codex backend.

## Testing the real Codex DJ from a separate server instance
- To exercise the real Codex DJ from a second server instance, start it with `MUSIC_CODEX_BIN=<checkout>/node_modules/@openai/codex/bin/codex.js`, `MUSIC_DATA_DIR=<temp dir>`, and `MUSIC_PORT=8795`.
- The server pins Codex 0.156.1; a newer `codex` on PATH (0.162) makes capabilities report `unsupported_codex_version`, so point `MUSIC_CODEX_BIN` at the checkout's pinned binary rather than the PATH one.
- Driving `/api/v1/dj/messages`, `/dj/recommendations`, and `/artists/:key/info` with a small Node fetch script and polling `/jobs/:id` is a quick, silent way to check prompt tone without playing audio.
- A "taiga runner request" to start this service once hung for 15 minutes; launching node in the background with `setsid nohup` worked instead.

## Mock DJ playback is audible — avoid triggering it
- The saved `music-mock` service returns canned mainstream pop picks (Alan Walker, Despacito and similar), and clicking "Start the DJ" on it makes the YouTube embed actually play with sound, which the user hates.
- When driving the app with the taiga runner browser, instruct the browser agent not to press Play, Start the DJ, Listen live, or station tiles unless a check needs playback; mute first when it does, and navigate to `about:blank` or stop the browser right after.
- Radio playback can be confirmed silently: the "Now playing" state line only says `LIVE` after the audio element's `playing` event.

## Radio metadata verification
- NTS live metadata caches its schedule for 15 minutes (`Cache-Control max-age=900`), so use programme start/end intervals rather than rejecting an otherwise-current schedule based only on HTTP `Age`.
- During radio checks Python/managed page retrieval failed for Radio Helsinki, but the running Node app successfully fetched its current-song HTML fields; verify the app's actual fetch path before concluding that station metadata is inaccessible.

## Browser color-scheme emulation
- The runner browser's `prefers-color-scheme` emulation may not actually apply unless you explicitly request CDP `Emulation.setEmulatedMedia` and then verify with `matchMedia`. Assuming it applied silently gives wrong results.

## Custom clock timer receiver gotcha (radio metadata polling)
- Storing native `setTimeout`/`clearTimeout` on a custom clock object and invoking `clock.clearTimeout()` raises `Illegal invocation` in Chromium and can crash React effect cleanup.
- Injected fake-clock unit tests miss this because they never exercise the native receiver; wrap default timers in arrow functions so native calls keep their normal receiver, and add a default-clock receiver regression plus a managed browser stop/retune check.

## Shared data lock collisions
- Another server instance may already hold `data/.taste.lock`. Start your own instance with `MUSIC_DATA_DIR` and `MUSIC_PORT` overrides to avoid contending for the existing lock.
