The factory ran 1 check in parallel in 12s: 1 passed, 0 failed.

### review_ranking: passed in 12s

Command: `taiga review --branch --quiet`
Full log: /tmp/gate-checks-nssr_bqq/review_ranking.log

````text
Branch HEAD cffe7a4856e9 since merge base 6a0357faf36a with refs/remotes/origin/main

Review priority: unknown risk first, then change risk descending; smell count breaks ties.
In uncommitted mode, files changed in both index and working copy appear twice.
Risk is a model estimate from 0 to 100, independent of file smells.
Smells are counted and listed only when probability > 0.8.

| rank | file | version | change | risk / 100 | smells |
|---|---|---|---|---|---|
| 1 | "apps/server/src/codex.ts" | committed | modified | 45.8 | 0 |
| 2 | "apps/server/src/codex-worker.mjs" | committed | modified | 37.8 | 0 |
| 3 | "apps/server/test/codex-startup.test.mjs" | committed | modified | 29.8 | 0 |
| 4 | "README.md" | committed | modified | 26.7 | 0 |
| 5 | "apps/web/src/main.tsx" | committed | modified | 17.8 | 0 |
| 6 | "apps/server/test/codex-cancellation.test.mjs" | committed | modified | 15.7 | 0 |

1. "apps/server/src/codex.ts" (committed)
   Risk criteria (0-4): Behavior 2.16, Interfaces 1.76, Security 2.37, Data 0.24, Verification gaps 2.13

2. "apps/server/src/codex-worker.mjs" (committed)
   Risk criteria (0-4): Behavior 1.82, Interfaces 1.09, Security 2.36, Data 0.14, Verification gaps 1.60

3. "apps/server/test/codex-startup.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.56, Interfaces 1.57, Security 0.80, Data 0.12, Verification gaps 1.53

4. "README.md" (committed)
   Risk criteria (0-4): Behavior 1.18, Interfaces 0.78, Security 1.95, Data 0.09, Verification gaps 0.97
   No smell rules applied to this source.

5. "apps/web/src/main.tsx" (committed)
   Risk criteria (0-4): Behavior 0.90, Interfaces 0.89, Security 0.59, Data 0.08, Verification gaps 0.87

6. "apps/server/test/codex-cancellation.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.05, Interfaces 0.58, Security 0.10, Data 0.10, Verification gaps 1.07

Risk weights: Behavior 35%, Interfaces 20%, Security 20%, Data 15%, Verification gaps 10%.
````
