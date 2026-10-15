# Plan

Written by the factory from Beads Rust. Do not edit.

## Asked for

Keep all of this in one ticket. Reliable playback is the most important priority.

## Register

- ytdlp-plays-youtube-audio-here [fact, current, owner planner]: yt-dlp plays YouTube audio here without the IFrame, including the video that failed to embed
- codex-call-latency [fact, current, owner planner]: A Codex call takes about 30 s on the default model, about 6 s on gpt-6-luna at low effort
- radio-stream-probe [fact, current, owner planner]: About 25 of 36 candidate radio streams delivered audio from this host
- youtube-audio-through-server [decision B, resolved, owner planner]: YouTube plays as audio streamed through the server, with no IFrame fallback
- ytdlp-managed-install [decision B, resolved, owner planner]: The server installs yt-dlp into the data directory and keeps it updated
- dj-names-tracks-server-finds-them [decision B, resolved, owner planner]: The DJ names tracks; the server finds and checks them on YouTube
- codex-two-jobs-and-dislike-filter [decision B, resolved, owner planner]: Codex runs two jobs at once, and a dislike during picking filters instead of failing
- m4a-plays-in-audio-element [hypothesis, confirmed, owner planner]: Chromium plays YouTube's DASH m4a audio through a plain audio element
- tabs-dj-and-player-kept-apart [decision B, resolved, owner planner]: Source tabs never stop the music; YouTube and collection only change where the DJ picks
- conversation-steers-and-dislike-skips [decision B, resolved, owner planner]: The DJ conversation can change the music, and Not for me now skips the playing track
- new-stations-checked-in-chromium [fact, current, owner planner]: 12 new stations play in Chromium; SomaFM Drone Zone does not and was dropped
- main-tsx-still-holds-listening-state [debt, open, owner planner]: main.tsx still holds all listening state in one component
