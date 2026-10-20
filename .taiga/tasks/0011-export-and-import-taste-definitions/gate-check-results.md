The factory ran 2 checks in parallel in 42s: 2 passed, 0 failed.

### security: passed in 11s

Command: `taiga static-checks`
Full log: /tmp/gate-checks-wq8wmt79/security.log

````text
# Static security checks

Scope: branch; 12 files.
Base: origin/main; merge base: cbbf4184d348dde247266cae710fa65be91bdcbb.

| Scanner | Status | Open | Ignored |
| --- | --- | ---: | ---: |
| gitleaks | completed | 0 | 0 |
| bandit | skipped | 0 | 0 |
| gosec | skipped | 0 | 0 |
| devskim | completed | 0 | 4 |
| pmd | skipped | 0 | 0 |
| psalm | skipped | 0 | 0 |
| checkov | completed | 0 | 0 |
| trivy | skipped | 0 | 0 |
| zizmor | skipped | 0 | 0 |

## Model report

## Security scan summary

No open findings were reported. Gitleaks, DevSkim, and Checkov completed with zero open findings.

Bandit, Gosec, PMD, Psalm, Trivy, and Zizmor were skipped because no applicable files were in scope; these are not clean scan results and provide no coverage for those tools’ checks. DevSkim has **4 ignored findings**, which were already accepted and are not included here.

No findings were omitted from the input.

## Ignored findings

Count, rule, who ignored it and why:

- 2 · devskim DS162092 · .taiga/static-checks-ignore.toml: This is a local desktop music app: index.ts rejects non-loopback Host headers and binds the server to the loopback interface intentionally. These are access restrictions, not debug code.
- 2 · devskim DS172411 · .taiga/static-checks-ignore.toml: Each setTimeout gets an arrow-function callback and a fixed numeric delay (60/90 s Codex timeout, 3 s capability poll, 6/10 s toast), never a string or user-controlled value.

## Scanner notes

- bandit: No applicable files in scope
- gosec: No applicable files in scope
- pmd: No applicable files in scope
- psalm: No applicable files in scope
- trivy: No applicable files in scope
- zizmor: No applicable files in scope

## Next step

No open findings. Every finding is fixed or ignored with a reason.

Results: /home/jp/.local/state/taiga/static-checks/6a12ab0ff2e74863b645ee33e220f179
````

### review_ranking: passed in 42s

Command: `taiga review --branch --include-uncommitted --quiet`
Full log: /tmp/gate-checks-wq8wmt79/review_ranking.log

````text
Branch HEAD 92719f560833 since merge base cbbf4184d348 with refs/remotes/origin/main; Uncommitted changes (HEAD to index, index to working copy, and untracked)

Review priority: unknown risk first, then change risk descending; smell count breaks ties.
Each changed version (committed, staged, unstaged, untracked) is ranked separately.
Risk is a model estimate from 0 to 100, independent of file smells.
Smells are counted and listed only when probability > 0.8.

| rank | file | version | change | risk / 100 | smells |
|---|---|---|---|---|---|
| 1 | "apps/server/src/index.ts" | committed | modified | 48.1 | 0 |
| 2 | "apps/server/src/taste.ts" | committed | modified | 47.3 | 0 |
| 3 | "apps/web/src/dialogs.tsx" | committed | modified | 41.8 | 0 |
| 4 | "apps/web/src/main.tsx" | committed | modified | 28.5 | 1 |
| 5 | "apps/server/src/memory.ts" | committed | modified | 24.1 | 0 |
| 6 | "packages/contracts/src/index.ts" | committed | modified | 23.8 | 0 |
| 7 | "README.md" | committed | modified | 22.0 | 0 |
| 8 | "apps/server/test/taste.test.mjs" | committed | modified | 16.1 | 0 |
| 9 | "apps/server/test/memory.test.mjs" | committed | modified | 15.0 | 0 |
| 10 | "apps/web/src/style.css" | committed | modified | 8.7 | 0 |

1. "apps/server/src/index.ts" (committed)
   Risk criteria (0-4): Behavior 2.25, Interfaces 1.67, Security 1.13, Data 2.49, Verification gaps 2.05

2. "apps/server/src/taste.ts" (committed)
   Risk criteria (0-4): Behavior 2.17, Interfaces 1.85, Security 1.00, Data 2.31, Verification gaps 2.16

3. "apps/web/src/dialogs.tsx" (committed)
   Risk criteria (0-4): Behavior 1.82, Interfaces 1.49, Security 1.25, Data 2.09, Verification gaps 1.75

4. "apps/web/src/main.tsx" (committed)
   Risk criteria (0-4): Behavior 1.42, Interfaces 1.12, Security 0.40, Data 1.36, Verification gaps 1.34
   - "File too long for its role" (file_too_long_for_role, medium, probability 0.83)

5. "apps/server/src/memory.ts" (committed)
   Risk criteria (0-4): Behavior 1.08, Interfaces 1.08, Security 0.19, Data 1.46, Verification gaps 1.10

6. "packages/contracts/src/index.ts" (committed)
   Risk criteria (0-4): Behavior 0.86, Interfaces 1.52, Security 0.52, Data 0.87, Verification gaps 1.11

7. "README.md" (committed)
   Risk criteria (0-4): Behavior 0.78, Interfaces 1.24, Security 0.57, Data 0.99, Verification gaps 0.95
   No smell rules applied to this source.

8. "apps/server/test/taste.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.23, Interfaces 0.21, Security 0.14, Data 0.51, Verification gaps 0.66

9. "apps/server/test/memory.test.mjs" (committed)
   Risk criteria (0-4): Behavior 0.99, Interfaces 0.21, Security 0.10, Data 0.85, Verification gaps 0.66

10. "apps/web/src/style.css" (committed)
   Risk criteria (0-4): Behavior 0.40, Interfaces 0.48, Security 0.16, Data 0.11, Verification gaps 0.60

Risk weights: Behavior 35%, Interfaces 20%, Security 20%, Data 15%, Verification gaps 10%.
````
