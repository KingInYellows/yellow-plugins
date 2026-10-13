**4d. Match against the F01-F12 pattern library:**

| Code | Name                 | Key signals                                                                          | First fix                                                               |
| ---- | -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| F01  | Out of Memory        | `Killed`/`signal 9`, `ENOMEM`, `JavaScript heap out of memory`, exit 137             | Reduce parallelism; add swap; raise `NODE_OPTIONS=--max-old-space-size` |
| F02  | Disk Full            | `No space left on device`, `ENOSPC`                                                  | Free Docker/cache space on the runner; resize disk                      |
| F03  | Missing Dependencies | `command not found`, `not found in PATH`, `Module not found`                         | Install/pin the missing tool in a setup step                            |
| F04  | Docker Issues        | `Cannot connect to the Docker daemon`, `toomanyrequests`, `pull rate limit exceeded` | Restart Docker; authenticate/mirror Docker Hub                          |
| F05  | Network Issues       | `Could not resolve host`, `Connection timed out`, `ECONNREFUSED`                     | Check DNS/connectivity; add retry with backoff                          |
| F06  | Stale State          | `EEXIST`, `address already in use` (EADDRINUSE), leftover lockfiles                  | Add `clean: true`; clear caches; kill stale processes                   |
| F07  | Flaky Tests          | intermittent (passes on re-run), `ETIMEDOUT`, `socket hang up`                       | Identify the flaky test; add retry; fix the race                        |
| F08  | Permission Errors    | `Permission denied`, `EACCES`, `EPERM`                                               | Fix ownership/permissions; check Docker group membership                |
| F09  | Runner Agent         | `Runner.Listener` crash, heartbeat timeout, `Could not find a registered runner`     | Restart the runner service; re-check registration                       |
| F10  | Stale Cache          | `Error restoring cache`, `Cache not found`, `tar: Unexpected EOF`                    | Clear/rotate the cache key; migrate to `actions/cache@v4`               |
| F11  | Job Timeout          | `exceeded maximum execution time`                                                    | Raise `timeout-minutes`; parallelize/optimize slow steps                |
| F12  | Environment Leakage  | secrets visible in logs, `set -x` with credentials                                   | Remove `set -x` near secrets; `::add-mask::`; rotate exposed creds      |

**4e. Root-cause analysis.** Identify which job/step failed first (cascade
detection); note overlapping patterns (e.g. F02 disk-full triggering F04
Docker); distinguish transient from persistent failures. For runner-side
patterns (F02, F04, F09), correlate against runner health — a memory or disk
spike below threshold points to a transient failure; a persistent one needs a
deeper runner investigation (see Step 5).

**4f. Report.** Output structured markdown: run metadata, root cause (pattern
ID + name), affected jobs/steps, fenced log evidence, and suggested fixes
(immediate + long-term).

### Step 5: Deeper Investigation (host-specific delegation)

When the failure warrants deeper log analysis or a runner-side investigation
(F02, F04, F09), delegate rather than doing it all inline.

#### On Claude Code

Use the `Agent` tool to spawn the specialized CI failure-analyst sub-agent with
the run ID, URL, branch, and failed job names; for a suspected runner-side issue
it in turn delegates to a runner-diagnostics investigation. Synthesize its
diagnosis into the final report.

#### On Codex

> **Unverified — confirm before relying on this in production** (built-in-agent
> delegation syntax not yet confirmed against a live authenticated Codex
> session; see
> `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`).
> Delegate the deep analysis to a built-in `worker` agent (or an `explorer`
> agent for read-only runner investigation), passing the run ID, failed job
> names, and the redacted, fenced log excerpt.

### Error Handling

- **Rate limit (HTTP 429):** "GitHub API rate limited. Resets at [time from `gh
  api rate_limit`]. Wait or use a different token."
- **Auth error:** "GitHub CLI authentication expired. Run: `gh auth login`".
- **Run not found (404):** "Run $RUN_ID not found. Verify the ID by listing
  recent runs (ci-status skill) or check the GitHub Actions tab."
