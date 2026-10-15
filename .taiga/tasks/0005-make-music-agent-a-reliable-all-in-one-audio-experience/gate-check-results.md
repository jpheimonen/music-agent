The factory ran 2 checks in parallel in 1m02s: 0 passed, 2 failed.

### security: failed with exit status 1 after 10s

Command: `taiga static-checks`
Full log: /tmp/gate-checks-tzgoe4ah/security.log

````text
...

| Scanner | Status | Open | Ignored |
| --- | --- | ---: | ---: |
| gitleaks | completed | 0 | 0 |
| bandit | skipped | 0 | 0 |
| gosec | skipped | 0 | 0 |
| devskim | completed | 3 | 5 |
| pmd | skipped | 0 | 0 |
| psalm | skipped | 0 | 0 |
| checkov | completed | 0 | 0 |
| trivy | skipped | 0 | 0 |
| zizmor | skipped | 0 | 0 |

## Model report

## Security scan summary

**3 open findings** from DevSkim, all low severity and matching rule `DS172411` (“Review setTimeout for untrusted data”):

- `apps/server/src/codex.ts:214`
- `apps/web/src/main.tsx:369`
- `apps/web/src/main.tsx:383`

These are review prompts, not proof of a vulnerability. Each may be a real issue if untrusted input controls the timer delay or callback behavior; check the values passed to `setTimeout` and how they are validated or bounded. Otherwise, document why the finding is a false positive. All three findings remain open.

**Coverage and other results:** Gitleaks and Checkov completed with no open findings. Bandit, Gosec, PMD, Psalm, Trivy, and Zizmor were skipped because no applicable files were in scope; these are not clean results. Five DevSkim findings were ignored, and their details were not provided. No findings were omitted from the input.

## Open findings

- 580f29b1dd57 · low · devskim DS172411 · apps/server/src/codex.ts:214: Review setTimeout for untrusted data
- 7c385c27f86c · low · devskim DS172411 · apps/web/src/main.tsx:369: Review setTimeout for untrusted data
- eb7cdf9c9563 · low · devskim DS172411 · apps/web/src/main.tsx:383: Review setTimeout for untrusted data

## Ignored findings

Count, rule, who ignored it and why:

- 2 · devskim DS162092 · .taiga/static-checks-ignore.toml: This is a local desktop music app: index.ts rejects non-loopback Host headers and binds the server to the loopback interface intentionally. These are access restrictions, not debug code.
- 3 · devskim DS172411 · .taiga/static-checks-ignore.toml: Each setTimeout receives an arrow-function callback and a fixed numeric delay, never a string, so no untrusted data can be evaluated.

## Scanner notes

- bandit: No applicable files in scope
- gosec: No applicable files in scope
- pmd: No applicable files in scope
- psalm: No applicable files in scope
- trivy: No applicable files in scope
- zizmor: No applicable files in scope

Omitted 4 deleted or non-regular paths; see results.json.

## Next step

Open findings: 3. Fix each one. When a finding is a false positive, mark it with the reason it is safe, and later scans skip it:

    taiga static-checks --ignore ID [--ignore ID ...] --reason "why it is safe"

Commit .taiga/static-checks-ignore.toml with the change, then run the check again.

Results: /home/jp/.local/state/taiga/static-checks/16e68598c796466aac62af100f0c7550
````

### review_ranking: failed with exit status 1 after 1m02s

Command: `taiga review --branch --quiet`
Full log: /tmp/gate-checks-tzgoe4ah/review_ranking.log

````text
...
17. "apps/server/src/search-evidence.d.mts" (committed)
   Smells describe the deleted file's previous contents.
   Risk criteria (0-4): Behavior 1.34, Interfaces 2.17, Security 0.23, Data 0.27, Verification gaps 1.23

18. "apps/server/test/dj.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.68, Interfaces 1.27, Security 0.11, Data 0.68, Verification gaps 1.09

19. "apps/web/src/playback.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.81, Interfaces 1.39, Security 0.12, Data 0.11, Verification gaps 1.18

20. "apps/web/src/player-bar.tsx" (committed)
   Risk criteria (0-4): Behavior 1.63, Interfaces 1.24, Security 0.16, Data 0.12, Verification gaps 1.71

21. "apps/server/test/search-evidence.test.mjs" (committed)
   Smells describe the deleted file's previous contents.
   Risk criteria (0-4): Behavior 0.84, Interfaces 0.79, Security 1.35, Data 0.13, Verification gaps 2.14

22. "apps/web/src/panels.tsx" (committed)
   Risk criteria (0-4): Behavior 1.38, Interfaces 1.16, Security 0.29, Data 0.13, Verification gaps 1.47

23. "apps/web/src/style.css" (committed)
   Risk criteria (0-4): Behavior 1.37, Interfaces 1.39, Security 0.10, Data 0.09, Verification gaps 1.43

24. "apps/server/src/stations.ts" (committed)
   Risk criteria (0-4): Behavior 1.13, Interfaces 1.43, Security 0.23, Data 0.20, Verification gaps 1.34

25. "apps/server/src/config.ts" (committed)
   Risk criteria (0-4): Behavior 0.94, Interfaces 1.26, Security 0.89, Data 0.15, Verification gaps 1.09

26. "apps/server/test/youtube-keyless.test.mjs" (committed)
   Smells describe the deleted file's previous contents.
   Risk criteria (0-4): Behavior 0.82, Interfaces 0.72, Security 1.16, Data 0.12, Verification gaps 1.92

27. "apps/server/test/codex-cancellation.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.82, Interfaces 0.32, Security 0.08, Data 0.09, Verification gaps 1.22

28. "apps/web/src/dialogs.tsx" (committed)
   Risk criteria (0-4): Behavior 1.17, Interfaces 0.95, Security 0.37, Data 0.27, Verification gaps 1.20

29. "apps/server/package.json" (committed)
   Risk criteria (0-4): Behavior 1.32, Interfaces 0.87, Security 0.21, Data 0.13, Verification gaps 1.05
   No smell rules applied to this source.

30. "apps/server/test/stations.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.36, Interfaces 0.67, Security 0.18, Data 0.11, Verification gaps 0.95

31. "apps/server/test/ytdlp.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.14, Interfaces 0.45, Security 0.79, Data 0.12, Verification gaps 0.74

32. "apps/server/test/memory.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.08, Interfaces 0.24, Security 0.15, Data 0.74, Verification gaps 0.67

33. "apps/server/test/codex-startup.test.mjs" (committed)
   Risk criteria (0-4): Behavior 0.89, Interfaces 0.76, Security 0.09, Data 0.09, Verification gaps 0.81

34. "apps/server/test/youtube.test.mjs" (committed)
   Risk criteria (0-4): Behavior 1.10, Interfaces 0.32, Security 0.20, Data 0.08, Verification gaps 0.77

Risk weights: Behavior 35%, Interfaces 20%, Security 20%, Data 15%, Verification gaps 10%.
Analysis is incomplete; inspect the flagged files manually. Exit status: 1.
````
