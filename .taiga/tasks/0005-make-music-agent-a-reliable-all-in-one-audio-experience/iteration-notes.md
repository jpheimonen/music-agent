# Iteration notes

Working notes for the fasttrack implementation. The register holds the decisions and facts.

## Roadmap

1. **Reliable YouTube playback.** yt-dlp install and updates, the DJ names tracks and the server finds them on YouTube, the audio proxy, playback through `<audio>`, contracts and tests. Changes to `main.tsx` are only what keeps the app working.
2. **All-in-one layout.** A fixed player bar, the DJ panel next to the source panel, tabs that never stop the DJ or the music, and radio that pauses the DJ until "Back to the DJ". Also queue thumbs-down plus Remove, "Not for me" that skips with Undo, listening history (skips and finishes) for the DJ, Media Session, and splitting `main.tsx` into components.
3. **Talk with the DJ.** Conversation and interview (fast Codex model), taste notes the person can delete, and notes in "Your taste".
4. **Radio.** More verified stations, an ICY now-playing reader, the README, and full journey checks.

## Testing rules

- Test servers use their own `MUSIC_PORT` and a copy of `data/` without `.taste.lock`. The user's own server runs on port 50013 against `data/`; leave it alone.
- Keep browser playback silent. Before any playback, patch `HTMLMediaElement.prototype.play` to set `this.muted = true`, then go to `about:blank` afterwards.
- Building replaces `apps/web/dist`, which the user's running server also serves. Tell the user to restart it at the end.

## Iteration 1 results

- yt-dlp 2026.08.19 installed itself into the test data copy and both YouTube capabilities reported ready.
- The proxy served the embed-blocked QOTSA video as ranged `audio/mp4`: 4.3 s on the first request (extraction), 0.05 s once the URL was cached. An unavailable ID returns 404 `youtube_video_unavailable`.
- Real DJ jobs: a quick start batch took 19.4 s for 3 playable picks (25.5 s before raising concurrency); a refill took 64 s for 5 picks (74.5 s before). Picks were deep cuts, mostly official "Artist - Topic" uploads.
- Muted Chromium check: the DASH m4a plays through `<audio>` (readyState 4, duration 253 s), time advances, seeking to 120 s works, and Skip starts the next track. No console errors.
- The test server runs as the runner's `web` service on port 33551 with `MUSIC_DATA_DIR=/tmp/music-agent-it1-data`.

## Iterations 2–4 results

- The layout has the DJ panel on the left and source tabs with Up next, Your collection or the stations on the right. The player is docked at the bottom. On wide screens the room fits the window and each column scrolls on its own. The page reserves the player's measured height.
- Muted journey with real picks: the DJ started Finnish psych (Haikara, Jukka Tolonen, Circle). 👎 removed a queued song with an Undo notice. Switching to Live radio kept the track playing. "Back to the DJ" resumed the queue. "Not for me" skipped with an Undo notice. No console errors.
- Interview with real Codex: one question at a time, answers saved as notes ("Loves Finnish psych rock, especially Circle and Kingston Wall", "Never wants mainstream chart pop"), shown in chat and under "Your taste" with Forget.
- Stations: 12 added (21 in total), each played muted in Chromium. SomaFM Drone Zone failed there with MEDIA_ERR_SRC_NOT_SUPPORTED on both relays, so it was dropped. ICY now-playing works for Radio Meuh, Intergalactic FM, Radio Swiss Jazz (tracks) and dublab, Refuge Worldwide, Radio 80000, Noods Radio, Resonance (shows). Ö1's stream title was a service phone line, so it has no adapter.
- The host rebooted at 21:15 and wiped `/tmp`. The test data copy was reseeded from `data/`. The user's own server on port 50013 restarted from this checkout after the reboot. It runs a server build from before the station changes, so it needs a restart.
