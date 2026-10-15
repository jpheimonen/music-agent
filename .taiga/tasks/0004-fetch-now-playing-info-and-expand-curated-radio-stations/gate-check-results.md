The factory ran 3 checks in parallel in 10s: 2 passed, 1 failed.

### build: passed in 8s

Command: `taiga runner build`
Full log: /tmp/gate-checks-__qx3rg0/build.log

````text
Running `build` · output: /home/jp/.local/state/taiga/evidence/1-4aabd9d8/runner/2026-10-15T15-13-47-731714-build-7cc31e90d2c744b698a5f59ae50e62c9/output.log
`build` passed after 7 s. Output: /home/jp/.local/state/taiga/evidence/1-4aabd9d8/runner/2026-10-15T15-13-47-731714-build-7cc31e90d2c744b698a5f59ae50e62c9/output.log
````

### security: failed with exit status 1 after 10s

Command: `taiga static-checks`
Full log: /tmp/gate-checks-__qx3rg0/security.log

````text
...

Scope: branch; 18 files.
Base: origin/main; merge base: 579de4ba33108d4ca1d26409f52a27b7556adec6.

| Scanner | Status | Open | Ignored |
| --- | --- | ---: | ---: |
| gitleaks | completed | 0 | 0 |
| bandit | skipped | 0 | 0 |
| gosec | skipped | 0 | 0 |
| devskim | completed | 5 | 0 |
| pmd | skipped | 0 | 0 |
| psalm | skipped | 0 | 0 |
| checkov | completed | 0 | 0 |
| trivy | skipped | 0 | 0 |
| zizmor | skipped | 0 | 0 |

## Model report

## Security scan summary

**5 open, low-severity findings** from DevSkim; none were ignored. Findings are open and should be fixed or marked false positive with a reason.

- **Debug code in production — DevSkim `DS162092`**  
  `apps/server/src/index.ts:55`, `apps/server/src/index.ts:171`, and `apps/web/package.json:1`  
  These may be leftover debug code or configuration. **Likely worth checking;** inspect each location and confirm debug behavior is not enabled in production. The package-file finding may be a false positive depending on what DevSkim matched.

- **`setTimeout` and untrusted data — DevSkim `DS172411`**  
  `apps/web/src/radio-metadata.ts:30` and `apps/web/src/radio-metadata.ts:38`  
  **Needs review;** determine whether untrusted input can influence the callback or delay, and whether that could cause unexpected execution or resource use. This may be a false positive if inputs are validated or the calls use fixed, safe values.

## Coverage and scan status

Gitleaks and Checkov completed with no open findings. Bandit, Gosec, PMD, Psalm, Trivy, and Zizmor were skipped because no applicable files were in scope; these are **not clean scan results**. No scanner errors were reported. No findings were omitted from the input.

## Open findings

- 484ce99fd715 · low · devskim DS162092 · apps/server/src/index.ts:55: Do not leave debug code in production
- 168578cd6e27 · low · devskim DS162092 · apps/server/src/index.ts:171: Do not leave debug code in production
- 2815f30b91a9 · low · devskim DS162092 · apps/web/package.json:1: Do not leave debug code in production
- 67fdd7df291f · low · devskim DS172411 · apps/web/src/radio-metadata.ts:30: Review setTimeout for untrusted data
- 31e0fdad0641 · low · devskim DS172411 · apps/web/src/radio-metadata.ts:38: Review setTimeout for untrusted data

## Scanner notes

- bandit: No applicable files in scope
- gosec: No applicable files in scope
- pmd: No applicable files in scope
- psalm: No applicable files in scope
- trivy: No applicable files in scope
- zizmor: No applicable files in scope

## Next step

Open findings: 5. Fix each one. When a finding is a false positive, mark it with the reason it is safe, and later scans skip it:

    taiga static-checks --ignore ID [--ignore ID ...] --reason "why it is safe"

Commit .taiga/static-checks-ignore.toml with the change, then run the check again.

Results: /home/jp/.local/state/taiga/static-checks/d585a671a50349c483c5029e0e0aa281
````

### review_ranking: passed in 1s

Command: `taiga review --branch --quiet`
Full log: /tmp/gate-checks-__qx3rg0/review_ranking.log

````text
Branch HEAD 579de4ba3310 since merge base 579de4ba3310 with refs/remotes/origin/main
No changed files to review.
````
