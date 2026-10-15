The factory ran 2 checks in parallel in 2m05s: 1 passed, 1 failed.

### security: failed with exit status 1 after 2m05s

Command: `taiga static-checks`
Full log: /tmp/gate-checks-gcxr7s1x/security.log

````text
# Static security checks

Scope: branch; 8 files.
Base: origin/main; merge base: 2247e0ba8d0d52942f698be57f6e35e6db011413.

| Scanner | Status | Open | Ignored |
| --- | --- | ---: | ---: |
| gitleaks | completed | 0 | 0 |
| bandit | skipped | 0 | 0 |
| gosec | skipped | 0 | 0 |
| devskim | completed | 1 | 0 |
| pmd | skipped | 0 | 0 |
| psalm | skipped | 0 | 0 |
| checkov | completed | 0 | 0 |
| trivy | completed | 0 | 0 |
| zizmor | skipped | 0 | 0 |

## Model report

## Security report

One open finding was reported across 8 files:

- **Low — DevSkim `DS162092`** at `apps/web/package.json:1`: debug code may be present in production. **Likely a real issue to check**, though the finding alone does not confirm runtime behavior. Review the package configuration and build/release scripts to determine whether debug code ships in production. Fix it, or mark it as a false positive with a reason.

**Coverage:** Gitleaks, Checkov, and Trivy completed with no open findings. Bandit, Gosec, PMD, Psalm, and Zizmor were skipped because no applicable files were in scope; these are coverage gaps, not clean results. No findings were omitted from this report.

## Open findings

- 723fb247070d · low · devskim DS162092 · apps/web/package.json:1: Do not leave debug code in production

## Scanner notes

- bandit: No applicable files in scope
- gosec: No applicable files in scope
- pmd: No applicable files in scope
- psalm: No applicable files in scope
- zizmor: No applicable files in scope

## Next step

Open findings: 1. Fix each one. When a finding is a false positive, mark it with the reason it is safe, and later scans skip it:

    taiga static-checks --ignore ID [--ignore ID ...] --reason "why it is safe"

Commit .taiga/static-checks-ignore.toml with the change, then run the check again.

Results: /home/jp/.local/state/taiga/static-checks/2b02cefbf506420986d2367ac8b76991
````

### review_ranking: passed in 2s

Command: `taiga review --branch --quiet`
Full log: /tmp/gate-checks-gcxr7s1x/review_ranking.log

````text
Branch HEAD 2247e0ba8d0d since merge base 2247e0ba8d0d with refs/remotes/origin/main
No changed files to review.
````
