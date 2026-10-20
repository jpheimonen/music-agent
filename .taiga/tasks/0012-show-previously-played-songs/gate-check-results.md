The factory ran 1 check in parallel in 24s: 1 passed, 0 failed.

### review_ranking: passed in 24s

Command: `taiga review --branch --include-uncommitted --quiet`
Full log: /tmp/gate-checks-s03x80v6/review_ranking.log

````text
Branch HEAD 8cb777bf0265 since merge base 8cb777bf0265 with refs/remotes/origin/main; Uncommitted changes (HEAD to index, index to working copy, and untracked)

Review priority: unknown risk first, then change risk descending; smell count breaks ties.
Each changed version (committed, staged, unstaged, untracked) is ranked separately.
Risk is a model estimate from 0 to 100, independent of file smells.
Smells are counted and listed only when probability > 0.8.

| rank | file | version | change | risk / 100 | smells |
|---|---|---|---|---|---|
| 1 | "apps/web/src/main.tsx" | unstaged | modified | 20.3 | 1 |
| 2 | "apps/server/src/index.ts" | unstaged | modified | 19.8 | 0 |
| 3 | "packages/contracts/src/index.ts" | unstaged | modified | 18.6 | 0 |
| 4 | "apps/web/src/panels.tsx" | unstaged | modified | 16.5 | 0 |
| 5 | "README.md" | unstaged | modified | 14.5 | 0 |
| 6 | "apps/web/src/style.css" | unstaged | modified | 7.2 | 0 |

1. "apps/web/src/main.tsx" (unstaged)
   Risk criteria (0-4): Behavior 1.25, Interfaces 0.89, Security 0.14, Data 0.28, Verification gaps 1.24
   - "File too long for its role" (file_too_long_for_role, medium, probability 0.82)

2. "apps/server/src/index.ts" (unstaged)
   Risk criteria (0-4): Behavior 0.87, Interfaces 1.13, Security 0.51, Data 0.33, Verification gaps 1.11

3. "packages/contracts/src/index.ts" (unstaged)
   Risk criteria (0-4): Behavior 0.68, Interfaces 1.43, Security 0.20, Data 0.55, Verification gaps 0.94

4. "apps/web/src/panels.tsx" (unstaged)
   Risk criteria (0-4): Behavior 0.93, Interfaces 0.80, Security 0.22, Data 0.15, Verification gaps 1.08

5. "README.md" (unstaged)
   Risk criteria (0-4): Behavior 0.72, Interfaces 0.98, Security 0.11, Data 0.22, Verification gaps 0.76
   No smell rules applied to this source.

6. "apps/web/src/style.css" (unstaged)
   Risk criteria (0-4): Behavior 0.36, Interfaces 0.42, Security 0.08, Data 0.06, Verification gaps 0.50

Risk weights: Behavior 35%, Interfaces 20%, Security 20%, Data 15%, Verification gaps 10%.
````
