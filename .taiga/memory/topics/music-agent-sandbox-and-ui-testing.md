# music-agent: Codex sandbox and DJ UI testing gotchas

Environment: Ubuntu host, music-agent with a web UI (`apps/web/dist`) and a Codex-based DJ.

## Codex bubblewrap sandbox is blocked on this host
- On this Ubuntu host the Codex bubblewrap sandbox cannot start: `kernel.apparmor_restrict_unprivileged_userns=1` and there is no `bwrap` AppArmor profile.
- Consequence: the startup boundary check reports `codex_sandbox_blocked`, and the real Codex DJ cannot be tested end to end without the user applying the `sudo` AppArmor fix described in the README.
- `features.use_legacy_landlock` does not help — it panics with read-restricted profiles. Don't reach for it as a workaround.

## Testing the DJ UI without the real Codex
- To exercise the DJ UI while Codex is blocked, use a throwaway Node mock that serves `apps/web/dist` and fakes `/api/v1/capabilities`, `/dj/recommendations`, and `/jobs/:id`. This lets the UI be driven without a working Codex backend.

## Mock DJ playback is audible — avoid triggering it
- The saved `music-mock` service returns canned mainstream pop picks (Alan Walker, Despacito and similar), and clicking "Start the DJ" on it makes the YouTube embed actually play with sound, which the user hates.
- When driving the app with the taiga runner browser, instruct the browser agent not to press Play, Start the DJ, Listen live, or station tiles unless a check needs playback; mute first when it does, and navigate to `about:blank` or stop the browser right after.
- Radio playback can be confirmed silently: the "Now playing" state line only says `LIVE` after the audio element's `playing` event.

## Browser color-scheme emulation
- The runner browser's `prefers-color-scheme` emulation may not actually apply unless you explicitly request CDP `Emulation.setEmulatedMedia` and then verify with `matchMedia`. Assuming it applied silently gives wrong results.

## Shared data lock collisions
- Another server instance may already hold `data/.taste.lock`. Start your own instance with `MUSIC_DATA_DIR` and `MUSIC_PORT` overrides to avoid contending for the existing lock.
