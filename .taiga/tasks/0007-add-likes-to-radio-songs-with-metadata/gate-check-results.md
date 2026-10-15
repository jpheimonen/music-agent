The factory ran 2 checks in parallel in 16s: 2 passed, 0 failed.

### security: passed in 7s

Command: `taiga static-checks`
Full log: /tmp/gate-checks-bs0l6e_0/security.log

````text
# Static security checks

Scope: branch; 9 files.
Base: origin/main; merge base: 46d0adec6357b98f00e3a030e6aa27ec942517f0.

| Scanner | Status | Open | Ignored |
| --- | --- | ---: | ---: |
| gitleaks | completed | 0 | 0 |
| bandit | skipped | 0 | 0 |
| gosec | skipped | 0 | 0 |
| devskim | completed | 0 | 6 |
| pmd | skipped | 0 | 0 |
| psalm | skipped | 0 | 0 |
| checkov | completed | 0 | 0 |
| trivy | skipped | 0 | 0 |
| zizmor | skipped | 0 | 0 |

## Model report

## Security scan summary

- **Open findings:** None were reported.
- **Completed scans:** Gitleaks and Checkov reported no open findings. DevSkim also reported no open findings; **6 findings were ignored** and are not detailed here.
- **Coverage gaps:** Bandit, Gosec, PMD, Psalm, Trivy, and Zizmor were skipped because no applicable files were in scope. These are not clean scan results.
- **Input completeness:** No findings were omitted from the provided results.

No finding details were provided to assess or verify. Review the six ignored DevSkim findings if their status needs reconsideration.

## Ignored findings

Count, rule, who ignored it and why:

- 2 · devskim DS162092 · .taiga/static-checks-ignore.toml: This is a local desktop music app: index.ts rejects non-loopback Host headers and binds the server to the loopback interface intentionally. These are access restrictions, not debug code.
- 3 · devskim DS172411 · .taiga/static-checks-ignore.toml: Each setTimeout gets an arrow-function callback and a fixed numeric delay (60/90 s Codex timeout, 3 s capability poll, 6/10 s toast), never a string or user-controlled value.
- 1 · devskim DS172411 · .taiga/static-checks-ignore.toml: Each setTimeout receives an arrow-function callback and a fixed numeric delay, never a string, so no untrusted data can be evaluated.

## Scanner notes

- bandit: No applicable files in scope
- gosec: No applicable files in scope
- pmd: No applicable files in scope
- psalm: No applicable files in scope
- trivy: No applicable files in scope
- zizmor: No applicable files in scope

## Next step

No open findings. Every finding is fixed or ignored with a reason.

Results: /home/jp/.local/state/taiga/static-checks/f41135073b0a4c6d95b0e039bda09e87
````

### review_ranking: passed in 15s

Command: `taiga review --branch --quiet`
Full log: /tmp/gate-checks-bs0l6e_0/review_ranking.log

````text
Branch HEAD 9228b37de544 since merge base 46d0adec6357 with refs/remotes/origin/main

Review priority: unknown risk first, then change risk descending; smell count breaks ties.
In uncommitted mode, files changed in both index and working copy appear twice.
Risk is a model estimate from 0 to 100, independent of file smells.
Smells are counted and listed only when probability > 0.8.

| rank | file | version | change | risk / 100 | smells |
|---|---|---|---|---|---|
| 1 | "apps/server/src/taste.ts" | committed | modified | 38.1 | 0 |
| 2 | "apps/server/src/index.ts" | committed | modified | 35.3 | 0 |
| 3 | "apps/web/src/main.tsx" | committed | modified | 32.6 | 1 |
| 4 | "packages/contracts/src/index.ts" | committed | modified | 32.3 | 0 |
| 5 | "apps/web/src/player-bar.tsx" | committed | modified | 23.5 | 0 |
| 6 | "apps/server/test/taste.test.mjs" | committed | added | 13.7 | 0 |
| 7 | "apps/server/src/codex.ts" | committed | modified | 8.6 | 0 |

1. "apps/server/src/taste.ts" (committed)
   Risk criteria (0-4): Behavior 1.74, Interfaces 1.75, Security 0.68, Data 1.64, Verification gaps 1.82

2. "apps/server/src/index.ts" (committed)
   Risk criteria (0-4): Behavior 1.60, Interfaces 1.78, Security 0.81, Data 1.14, Verification gaps 1.62

3. "apps/web/src/main.tsx" (committed)
   Risk criteria (0-4): Behavior 1.75, Interfaces 1.55, Security 0.15, Data 1.29, Verification gaps 1.59
   - "File too long for its role" (file_too_long_for_role, medium, probability 0.82)

4. "packages/contracts/src/index.ts" (committed)
   Risk criteria (0-4): Behavior 1.30, Interfaces 2.31, Security 0.34, Data 1.03, Verification gaps 1.53

5. "apps/web/src/player-bar.tsx" (committed)
   Risk criteria (0-4): Behavior 1.27, Interfaces 1.62, Security 0.14, Data 0.13, Verification gaps 1.22

6. "apps/server/test/taste.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.01, Interfaces 0.23, Security 0.15, Data 0.35, Verification gaps 0.64

7. "apps/server/src/codex.ts" (committed)
   Risk criteria (0-4): Behavior 0.44, Interfaces 0.31, Security 0.16, Data 0.16, Verification gaps 0.72

Risk weights: Behavior 35%, Interfaces 20%, Security 20%, Data 15%, Verification gaps 10%.
````
