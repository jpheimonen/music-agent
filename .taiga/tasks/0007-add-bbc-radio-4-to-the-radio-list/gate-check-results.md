The factory ran 1 check in parallel in 4m28s: 1 passed, 0 failed.

### smoke: passed in 4m28s

Command: `taiga runner browser "Start the web service (taiga runner web) if it is not running and open the app. Before pressing anything, mute the page by setting muted=true and volume=0 on every audio and video element, including any created later. Do not press Start the DJ or Play. Open Live radio, confirm a BBC Radio 4 tile appears, and click only that tile. Wait up to 20 seconds and report whether the Now playing state line says LIVE, which means the audio element fired its playing event. Also report any errors shown on the page or in the console, and what the now-playing area says. Take a screenshot, then go to about:blank so nothing keeps playing."`
Full log: /tmp/gate-checks-mybovkl3/smoke.log

````text
## Report

BBC Radio 4 appeared in Live radio. Clicking its tile reached **LIVE · BBC RADIO 4** within 20 seconds, confirming the playing event.

Now playing showed “BBC Radio 4” and “London · news, drama, documentaries and conversation.” The tile showed “ON AIR.” No page or console errors appeared.

Media muting was installed before any clicks. I never pressed Start the DJ or Play. Captured a full-page screenshot, then navigated to `about:blank` to stop playback.

## Captures

1. [capture-ab049d1c587f42f2a471e49c835340d6.png](/home/jp/.local/state/taiga/evidence/2-e4e9b07c/runner-browser/2026-10-15T19-28-06-801718-start-the-web-service-taiga-runner-web-i-8a0befef3a1540f2a8fa27df29ad59ea/attempts/e00f07128aea4f68bc850fd699a431bf/outputs/capture-ab049d1c587f42f2a471e49c835340d6.png) of http://127.0.0.1:35179/

Details: /home/jp/.local/state/taiga/evidence/2-e4e9b07c/runner-browser/2026-10-15T19-28-06-801718-start-the-web-service-taiga-runner-web-i-8a0befef3a1540f2a8fa27df29ad59ea
````
