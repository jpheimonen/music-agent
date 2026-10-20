The factory ran 1 check in parallel in 38s: 1 passed, 0 failed.

### review_ranking: passed in 38s

Command: `taiga review --branch --include-uncommitted --quiet`
Full log: /tmp/gate-checks-jvkv23hf/review_ranking.log

````text
Branch HEAD 7cb8a0d5e1c4 since merge base 6df40ba4be24 with refs/remotes/origin/main; Uncommitted changes (HEAD to index, index to working copy, and untracked)

Review priority: unknown risk first, then change risk descending; smell count breaks ties.
Each changed version (committed, staged, unstaged, untracked) is ranked separately.
Risk is a model estimate from 0 to 100, independent of file smells.
Smells are counted and listed only when probability > 0.8.

| rank | file | version | change | risk / 100 | smells |
|---|---|---|---|---|---|
| 1 | "apps/server/src/dj.ts" | committed | modified | 32.8 | 0 |
| 2 | "apps/web/src/main.tsx" | committed | modified | 31.8 | 0 |
| 3 | "apps/server/src/index.ts" | committed | modified | 30.2 | 0 |
| 4 | "packages/contracts/src/index.ts" | committed | modified | 23.0 | 0 |
| 5 | "apps/web/src/player-bar.tsx" | committed | modified | 22.4 | 0 |
| 6 | "apps/web/src/dialogs.tsx" | committed | modified | 22.1 | 0 |
| 7 | "apps/server/src/youtube.ts" | committed | modified | 21.9 | 0 |
| 8 | "apps/web/src/dj-panel.tsx" | committed | modified | 20.6 | 0 |
| 9 | "apps/web/src/style.css" | committed | modified | 16.9 | 0 |
| 10 | "apps/web/src/panels.tsx" | committed | modified | 16.5 | 0 |
| 11 | "apps/server/src/codex.ts" | committed | modified | 16.1 | 0 |
| 12 | "apps/server/test/dj.test.mjs" | committed | modified | 13.9 | 0 |

1. "apps/server/src/dj.ts" (committed)
   Risk criteria (0-4): Behavior 1.58, Interfaces 1.74, Security 0.65, Data 0.79, Verification gaps 1.64

2. "apps/web/src/main.tsx" (committed)
   Risk criteria (0-4): Behavior 1.94, Interfaces 1.55, Security 0.42, Data 0.22, Verification gaps 1.65

3. "apps/server/src/index.ts" (committed)
   Risk criteria (0-4): Behavior 1.54, Interfaces 1.59, Security 0.67, Data 0.37, Verification gaps 1.61

4. "packages/contracts/src/index.ts" (committed)
   Risk criteria (0-4): Behavior 1.19, Interfaces 1.39, Security 0.24, Data 0.28, Verification gaps 1.36

5. "apps/web/src/player-bar.tsx" (committed)
   Risk criteria (0-4): Behavior 1.28, Interfaces 1.39, Security 0.15, Data 0.10, Verification gaps 1.22

6. "apps/web/src/dialogs.tsx" (committed)
   Risk criteria (0-4): Behavior 1.28, Interfaces 1.08, Security 0.41, Data 0.12, Verification gaps 1.19

7. "apps/server/src/youtube.ts" (committed)
   Risk criteria (0-4): Behavior 1.04, Interfaces 1.50, Security 0.16, Data 0.31, Verification gaps 1.34

8. "apps/web/src/dj-panel.tsx" (committed)
   Risk criteria (0-4): Behavior 1.33, Interfaces 0.68, Security 0.12, Data 0.51, Verification gaps 1.22

9. "apps/web/src/style.css" (committed)
   Risk criteria (0-4): Behavior 0.96, Interfaces 1.05, Security 0.11, Data 0.09, Verification gaps 0.92

10. "apps/web/src/panels.tsx" (committed)
   Risk criteria (0-4): Behavior 0.72, Interfaces 1.40, Security 0.11, Data 0.09, Verification gaps 0.92

11. "apps/server/src/codex.ts" (committed)
   Risk criteria (0-4): Behavior 0.83, Interfaces 0.79, Security 0.36, Data 0.18, Verification gaps 0.98

12. "apps/server/test/dj.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.10, Interfaces 0.23, Security 0.10, Data 0.27, Verification gaps 0.65

Risk weights: Behavior 35%, Interfaces 20%, Security 20%, Data 15%, Verification gaps 10%.
````
