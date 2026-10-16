The factory ran 1 check in parallel in 5s: 1 passed, 0 failed.

### review_ranking: passed in 5s

Command: `taiga review --branch --include-uncommitted --quiet`
Full log: /tmp/gate-checks-tj9fs8ub/review_ranking.log

````text
Branch HEAD 649d5f3181cb since merge base 649d5f3181cb with refs/remotes/origin/main; Uncommitted changes (HEAD to index, index to working copy, and untracked)

Review priority: unknown risk first, then change risk descending; smell count breaks ties.
Each changed version (committed, staged, unstaged, untracked) is ranked separately.
Risk is a model estimate from 0 to 100, independent of file smells.
Smells are counted and listed only when probability > 0.8.

| rank | file | version | change | risk / 100 | smells |
|---|---|---|---|---|---|
| 1 | "apps/server/src/index.ts" | unstaged | modified | 20.5 | 0 |
| 2 | "apps/server/test/static.test.mjs" | untracked | added | 17.8 | 0 |

1. "apps/server/src/index.ts" (unstaged)
   Risk criteria (0-4): Behavior 1.16, Interfaces 0.70, Security 0.74, Data 0.08, Verification gaps 1.14

2. "apps/server/test/static.test.mjs" (untracked)
   Risk criteria (0-4): Behavior 1.30, Interfaces 0.26, Security 0.38, Data 0.18, Verification gaps 1.03

Risk weights: Behavior 35%, Interfaces 20%, Security 20%, Data 15%, Verification gaps 10%.
````
