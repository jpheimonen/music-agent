# music-agent: Codex sandbox and DJ UI testing gotchas

Environment: Ubuntu host, music-agent with a web UI (`apps/web/dist`) and a Codex-based DJ.

## Codex bubblewrap sandbox is blocked on this host
- On this Ubuntu host the Codex bubblewrap sandbox cannot start: `kernel.apparmor_restrict_unprivileged_userns=1` and there is no `bwrap` AppArmor profile.
- Consequence: the startup boundary check reports `codex_sandbox_blocked`, and the real Codex DJ cannot be tested end to end without the user applying the `sudo` AppArmor fix described in the README.
- `features.use_legacy_landlock` does not help — it panics with read-restricted profiles. Don't reach for it as a workaround.

## Testing the DJ UI without the real Codex
- To exercise the DJ UI while Codex is blocked, use a throwaway Node mock that serves `apps/web/dist` and fakes `/api/v1/capabilities`, `/dj/recommendations`, and `/jobs/:id`. This lets the UI be driven without a working Codex backend.

## Browser color-scheme emulation
- The runner browser's `prefers-color-scheme` emulation may not actually apply unless you explicitly request CDP `Emulation.setEmulatedMedia` and then verify with `matchMedia`. Assuming it applied silently gives wrong results.

## Shared data lock collisions
- Another server instance may already hold `data/.taste.lock`. Start your own instance with `MUSIC_DATA_DIR` and `MUSIC_PORT` overrides to avoid contending for the existing lock.
