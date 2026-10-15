The factory ran 3 checks in parallel in 58s: 1 passed, 2 failed.

### build: passed in 58s

Command: `taiga runner build`
Full log: /tmp/gate-checks-h84br06e/build.log

````text
Running `build` · output: /home/jp/.local/state/taiga/evidence/1-4aabd9d8/runner/2026-10-15T12-06-04-744702-build-8a59008edf5547138acf831215622544/output.log
`build` passed after 54 s. Output: /home/jp/.local/state/taiga/evidence/1-4aabd9d8/runner/2026-10-15T12-06-04-744702-build-8a59008edf5547138acf831215622544/output.log
````

### security: failed with exit status 1 after 19s

Command: `taiga static-checks`
Full log: /tmp/gate-checks-h84br06e/security.log

````text
# Static security checks

Scope: branch; 14 files.
Base: origin/main; merge base: a2ab964be8de80f1d0c6714b4bcd18116e31d64f.

| Scanner | Status | Open | Ignored |
| --- | --- | ---: | ---: |
| gitleaks | completed | 0 | 0 |
| bandit | skipped | 0 | 0 |
| gosec | skipped | 0 | 0 |
| devskim | completed | 4 | 0 |
| pmd | skipped | 0 | 0 |
| psalm | skipped | 0 | 0 |
| checkov | completed | 0 | 0 |
| trivy | skipped | 0 | 0 |
| zizmor | skipped | 0 | 0 |

## Model report

## Security scan summary

**4 open, low-severity findings**, all from DevSkim. No ignored findings were reported, and no findings were omitted from the input.

### Findings

- **DevSkim `DS172411` — review `setTimeout` use with potentially untrusted data**
  - `apps/server/src/codex.ts:242, 265` (2 findings)
  - `apps/web/src/playback.ts:295, 386` (2 findings)
  - **Assessment:** These are review prompts, not proof of a vulnerability. They may be false positives if the timeout arguments are fixed or otherwise trusted; they may be a real problem if untrusted input can affect what is scheduled or executed. Check how each timeout is constructed and whether its inputs are validated or constrained.

### Coverage and status

Gitleaks and Checkov completed with no open findings. Bandit, Gosec, PMD, Psalm, Trivy, and Zizmor were **skipped because no applicable files were in scope**; these are coverage gaps, not clean results.

## Open findings

- 5cf8ff7cbd35 · low · devskim DS172411 · apps/server/src/codex.ts:242: Review setTimeout for untrusted data
- 3c2fee6fbeb7 · low · devskim DS172411 · apps/server/src/codex.ts:265: Review setTimeout for untrusted data
- 75e088288033 · low · devskim DS172411 · apps/web/src/playback.ts:295: Review setTimeout for untrusted data
- 75e088288033 · low · devskim DS172411 · apps/web/src/playback.ts:386: Review setTimeout for untrusted data

## Scanner notes

- bandit: No applicable files in scope
- gosec: No applicable files in scope
- pmd: No applicable files in scope
- psalm: No applicable files in scope
- trivy: No applicable files in scope
- zizmor: No applicable files in scope

## Next step

Open findings: 4. Fix each one. When a finding is a false positive, mark it with the reason it is safe, and later scans skip it:

    taiga static-checks --ignore ID [--ignore ID ...] --reason "why it is safe"

Commit .taiga/static-checks-ignore.toml with the change, then run the check again.

Results: /home/jp/.local/state/taiga/static-checks/a5cb6543a0664697a781bfed9aa24027
````

### review_ranking: failed with exit status 1 after 28s

Command: `taiga review --branch --quiet`
Full log: /tmp/gate-checks-h84br06e/review_ranking.log

````text
Branch HEAD ed09edc02e8a since merge base a2ab964be8de with refs/remotes/origin/main

Review priority: unknown risk first, then change risk descending; smell count breaks ties.
In uncommitted mode, files changed in both index and working copy appear twice.
Risk is a model estimate from 0 to 100, independent of file smells.
Smells are counted and listed only when probability > 0.8.

| rank | file | version | change | risk / 100 | smells |
|---|---|---|---|---|---|
| 1 | "apps/web/src/main.tsx" | committed | modified | unknown | 0 |
| 2 | "apps/server/src/codex.ts" | committed | modified | 38.0 | 0 |
| 3 | "apps/web/src/playback.ts" | committed | modified | 22.1 | 0 |
| 4 | "apps/server/test/codex-startup.test.mjs" | committed | modified | 20.5 | 0 |
| 5 | "apps/web/src/style.css" | committed | modified | 20.0 | 0 |
| 6 | "apps/web/index.html" | committed | modified | 19.6 | 0 |
| 7 | "README.md" | committed | modified | 9.9 | 0 |

1. "apps/web/src/main.tsx" (committed)
   Incomplete: "Risk assessment failed: Diff is unavailable or exceeds the 60,000 character risk-analysis limit."

2. "apps/server/src/codex.ts" (committed)
   Risk criteria (0-4): Behavior 1.89, Interfaces 1.71, Security 1.46, Data 0.22, Verification gaps 1.91

3. "apps/web/src/playback.ts" (committed)
   Risk criteria (0-4): Behavior 1.71, Interfaces 0.50, Security 0.13, Data 0.08, Verification gaps 1.47

4. "apps/server/test/codex-startup.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.33, Interfaces 0.78, Security 0.41, Data 0.14, Verification gaps 0.96

5. "apps/web/src/style.css" (committed)
   Risk criteria (0-4): Behavior 1.07, Interfaces 1.31, Security 0.14, Data 0.09, Verification gaps 1.20

6. "apps/web/index.html" (committed)
   Risk criteria (0-4): Behavior 1.04, Interfaces 0.75, Security 0.63, Data 0.35, Verification gaps 0.92

7. "README.md" (committed)
   Risk criteria (0-4): Behavior 0.36, Interfaces 0.47, Security 0.56, Data 0.07, Verification gaps 0.53
   No smell rules applied to this source.

Risk weights: Behavior 35%, Interfaces 20%, Security 20%, Data 15%, Verification gaps 10%.
Analysis is incomplete; inspect the flagged files manually. Exit status: 1.
````
