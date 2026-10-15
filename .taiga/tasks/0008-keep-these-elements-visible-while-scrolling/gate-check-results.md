The factory ran 1 check in parallel in 1m09s: 1 passed, 0 failed.

### smoke: passed in 1m09s

Command: `taiga runner browser "Hard reload http://127.0.0.1:50581. At 800x800, scroll the page down 1200px and report whether the 01 YouTube, 02 Your collection and 03 Live radio buttons stay at the top of the viewport, with content passing cleanly underneath and nothing overlapping them. Then switch the app to its light theme and repeat this at 800x800 and at desktop 1280x800, where the right-hand stage area is what scrolls. Take a screenshot of each case."`
Full log: /tmp/gate-checks-pw15jac3/smoke.log

````text
## Report

Captured all three cases after scrolling 1200px:

- **800×800, system theme:** Buttons stay at viewport top (`top: 2px`).
- **800×800, light theme:** Same behavior.
- **1280×800, light theme:** Buttons stay at the stage top (`top: 168px`; stage scroll: 1200px).

Nothing covers the buttons, but content remains visible beside the button row and above its desktop edge, so the area beneath is not completely clean.

Screenshots are in that order.

## Captures

1. [capture-f5657834f2b44c30a2f3a1e50cf5bf56.png](/home/jp/.local/state/taiga/evidence/2-e4e9b07c/runner-browser/2026-10-15T19-52-52-032022-hard-reload-http-127-0-0-1-50581-at-800x-ea31f5987eed42389fd4d08fde5a1759/attempts/5bfe70b9ee4a48859effa17d272cec46/outputs/capture-f5657834f2b44c30a2f3a1e50cf5bf56.png) of http://127.0.0.1:50581/
2. [capture-443588f27cad469699838228e8b5a905.png](/home/jp/.local/state/taiga/evidence/2-e4e9b07c/runner-browser/2026-10-15T19-52-52-032022-hard-reload-http-127-0-0-1-50581-at-800x-ea31f5987eed42389fd4d08fde5a1759/attempts/5bfe70b9ee4a48859effa17d272cec46/outputs/capture-443588f27cad469699838228e8b5a905.png) of http://127.0.0.1:50581/
3. [capture-1920067a0f2240d394a2983aa0680425.png](/home/jp/.local/state/taiga/evidence/2-e4e9b07c/runner-browser/2026-10-15T19-52-52-032022-hard-reload-http-127-0-0-1-50581-at-800x-ea31f5987eed42389fd4d08fde5a1759/attempts/5bfe70b9ee4a48859effa17d272cec46/outputs/capture-1920067a0f2240d394a2983aa0680425.png) of http://127.0.0.1:50581/

Details: /home/jp/.local/state/taiga/evidence/2-e4e9b07c/runner-browser/2026-10-15T19-52-52-032022-hard-reload-http-127-0-0-1-50581-at-800x-ea31f5987eed42389fd4d08fde5a1759
````
