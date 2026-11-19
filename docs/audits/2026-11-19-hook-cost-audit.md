# Hook cost audit (2026-11-19)

Roadmap item R7.2 (CLAUDE-313). It measures the wall-clock latency and the
injected context of every command hook the marketplace ships, sets a budget per
hook type, and links a follow-up ticket for each hook over budget.

## Budgets

| Hook type                                   | Latency budget | Model-context budget                                                    | Why                                                                                                                      |
| ------------------------------------------- | -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PreToolUse / PostToolUse (per Bash or Edit) | p95 ≤ 100 ms   | 0 bytes when the call passes; ≤ 512 B for a once-per-session suggestion | Fires 50-300 times a session; 100 ms × 200 calls is 20 s of waiting.                                                     |
| SessionStart                                | p95 ≤ 500 ms   | ≤ 2 KB per hook                                                         | Hooks run in parallel, so the slowest one delays every session. Context is paid on every turn until the next compaction. |
| Stop                                        | p95 ≤ 200 ms   | 0 bytes                                                                 | Fires after every turn. Real work belongs in a disowned subshell.                                                        |
| PreCompact                                  | p95 ≤ 200 ms   | ≤ 2 KB                                                                  | Its stdout is appended to the compaction prompt.                                                                         |

"Model context" counts `hookSpecificOutput.additionalContext`, plain stdout from
SessionStart and PreCompact, and the stderr Claude reads when a hook blocks a
call. `systemMessage` is shown to the user and costs no model tokens, so it is
listed separately.

## Results

20 measured runs per hook after 2 warm-up runs, serially, on a 4-core claude.ai
cloud container (Node 22.23). `first` is the first warm-up run. Bytes are from
the last run.

| Plugin           | Event        | Matcher                    | Script                     | Scenario                 | Timeout | first ms | p50 ms | p95 ms | Context B | systemMessage B | Verdict                              |
| ---------------- | ------------ | -------------------------- | -------------------------- | ------------------------ | ------- | -------- | ------ | ------ | --------- | --------------- | ------------------------------------ |
| github-workflow  | PreToolUse   | Bash                       | check-git-push             | `ls -la`                 | 5 s     | 35       | 35     | 43     | 0         | 0               | pass                                 |
| github-workflow  | PreToolUse   | Bash                       | check-git-push             | `git push` (denied)      | 5 s     | 36       | 37     | 47     | 242 ¹     | 0               | pass                                 |
| github-workflow  | PreToolUse   | Bash                       | check-git-push             | 4 KB command             | 5 s     | 35       | 40     | 47     | 0         | 0               | pass                                 |
| github-workflow  | PostToolUse  | Bash                       | check-commit-message       | 1 KB output              | 5 s     | 38       | 34     | 48     | 0         | 0               | pass                                 |
| github-workflow  | PostToolUse  | Bash                       | check-commit-message       | `git commit`             | 5 s     | 34       | 35     | 47     | 0         | 0 ²             | pass                                 |
| github-workflow  | PostToolUse  | Bash                       | check-commit-message       | 60 KB output             | 5 s     | 33       | 35     | 46     | 0         | 0               | pass                                 |
| gt-workflow      | PreToolUse   | Bash                       | check-git-push             | `ls -la`                 | 5 s     | 48       | 43     | 48     | 0         | 0               | pass                                 |
| gt-workflow      | PreToolUse   | Bash                       | check-git-push             | `git push` (denied)      | 5 s     | 46       | 38     | 48     | 217 ¹     | 0               | pass                                 |
| gt-workflow      | PreToolUse   | Bash                       | check-git-push             | 4 KB command             | 5 s     | 36       | 40     | 53     | 0         | 0               | pass                                 |
| gt-workflow      | PostToolUse  | Bash                       | check-commit-message       | 1 KB output              | 5 s     | 44       | 34     | 38     | 0         | 0               | pass                                 |
| gt-workflow      | PostToolUse  | Bash                       | check-commit-message       | `git commit`             | 5 s     | 39       | 34     | 48     | 0         | 0               | pass                                 |
| gt-workflow      | PostToolUse  | Bash                       | check-commit-message       | 60 KB output             | 5 s     | 33       | 34     | 42     | 0         | 0               | pass                                 |
| yellow-ruvector  | PreToolUse   | Edit\|Write\|MultiEdit     | pre-tool-use.sh            | Edit, 3 known partners ³ | 1 s     | 69       | 74     | 83     | 318       | 0               | pass                                 |
| yellow-ruvector  | PostToolUse  | Edit\|Write\|MultiEdit     | post-tool-use.sh           | Edit, same file ³        | 1 s     | 72       | 74     | 84     | 0         | 0               | pass                                 |
| yellow-ruvector  | PostToolUse  | Edit\|Write\|MultiEdit     | post-tool-use.sh           | Edit, pairs recorded ³   | 1 s     | 58       | 100    | 121    | 0         | 0               | **over: CLAUDE-372**                 |
| yellow-ci        | SessionStart | \*                         | entrypoint-claude.js       | cache miss ⁴             | 3 s     | 45       | 46     | 55     | 0         | 0               | pass (was 1,200 / 1,465: CLAUDE-369) |
| yellow-ci        | SessionStart | \*                         | entrypoint-claude.js       | cache hit ⁴              | 3 s     | -        | 40     | 47     | 0         | 188             | pass (was 280 / 310)                 |
| yellow-core      | SessionStart | \*                         | session-start.sh           | no drain due             | 3 s     | 71       | 36     | 44     | 0         | 0               | pass                                 |
| yellow-core      | SessionStart | \*                         | session-start.sh           | drain dispatched ⁵       | 3 s     | -        | 47     | 49     | 0         | 0               | pass                                 |
| yellow-core      | Stop         | \*                         | stop.sh                    | 60-record transcript     | 5 s     | 23       | 35     | 45     | 0         | 0               | pass                                 |
| yellow-core      | PreCompact   | \*                         | pre-compact.sh             | auto                     | 3 s     | 7        | 7      | 9      | 958       | 0               | pass                                 |
| yellow-debt      | SessionStart | \*                         | session-start.sh           | 3 high findings          | 3 s     | 13       | 14     | 16     | 0         | 91              | pass                                 |
| yellow-morph     | SessionStart | \*                         | prewarm-morph.sh           | installed                | 5 s     | 16       | 13     | 15     | 0         | 0               | pass                                 |
| yellow-morph     | SessionStart | \*                         | prewarm-morph.sh           | install running ⁶        | 5 s     | -        | 2,027  | 2,030  | 0         | 0               | **over: CLAUDE-370**                 |
| yellow-research  | SessionStart | \*                         | write-credential-status.sh | startup                  | 3 s     | 49       | 49     | 55     | 0         | 0               | pass                                 |
| yellow-review    | SessionStart | \*                         | session-start.sh           | empty ledger ⁷           | 3 s     | 7        | 8      | 10     | 0         | 0               | pass                                 |
| yellow-ruvector  | SessionStart | \*                         | prewarm.sh                 | installed                | 5 s     | 131      | 130    | 149    | 0         | 0               | pass                                 |
| yellow-ruvector  | SessionStart | \*                         | session-start.sh           | 30-memory store          | 6 s     | 1,499    | 1,373  | 1,608  | 2,057 ⁸   | 0               | **over: CLAUDE-368**                 |
| yellow-semgrep   | SessionStart | \*                         | write-credential-status.sh | startup                  | 3 s     | 33       | 30     | 34     | 0         | 0               | pass                                 |
| yellow-claudemod | mod module   | session.start, agent.spawn | register.ts                | not measured ⁹           | -       | -        | -      | -      | 0         | 0               | n/a                                  |

1. Stderr from the exit-2 deny, which Claude reads. Only on a blocked push.
2. github-workflow adds a 121-byte `systemMessage` when a `git commit -m`
   message is not a conventional commit.
3. 60 runs, after an untimed seed of three sessions. "Same file" edits README.md
   repeatedly in one session, so no pair is recorded. "Pairs recorded"
   alternates README.md with a partner, so every timed run writes a co-edit pair
   to `.ruvector/coedit.json`; the first edit of each new session id records no
   pair, so the bench runs it but does not time it. "3 known partners" starts a
   new session each run, so the once-per-file suggestion is injected every time.
   Two consecutive invocations gave the same 318 bytes.
4. Re-measured after CLAUDE-369 with the "startup, cache miss" and "startup"
   scenarios. The hook no longer calls `gh` in the foreground: a miss shows the
   routing summary only and starts a detached refresh (`gh auth status` +
   `gh run list`, about 1.2 s) that fills the cache for the next session start.
   The miss cost is the cache read plus that spawn. The bench waits for the
   previous run's refresh to finish (untimed) before clearing the cache, so
   every timed run is a miss and no refreshes overlap. Results are shown for 10
   minutes, shown and refreshed up to 1 hour, then only refreshed. Cloud
   `gh auth status` fails here (the `GH_TOKEN` is a proxy placeholder), so a
   shim reported success after making the real call; without it the refresh
   writes nothing and the hook shows routing only. Before the fix: miss 1,200 ms
   p50 / 1,465 ms p95 (1,025 / 1,168 on re-measure), hit 280 / 310 ms, 60 s TTL.
5. Six pending entries and a stub `claude`, so the timing covers lock and
   dispatch only. Reproduce with `BENCH_STUB_CLAUDE=1`, which puts a no-op
   `claude` written under `BENCH_HOME` on the hooks' `PATH`, after seeding six
   `*.jsonl` files in the scratch project's `compound-staging/pending/`. The
   real drain runs disowned on Haiku with a 3.00 USD API-equivalent cap (not a
   bill); it adds no foreground latency.
6. A second session starting while a background `npm ci` holds the install lock.
   In cloud sessions the install always fails, so this repeats.
7. With findings it adds at most about 400 bytes: counts plus up to 10 PR
   numbers per category, never ledger text.
8. The recall is capped at 7,000 characters, so the ceiling is about 7.3 KB.
9. An in-process TypeScript mod. It registers `/claudemod-status` at session
   start and writes one bounded (2 s) ledger row per subagent spawn. It has no
   tool-call events and injects nothing.

## Per-session totals

- **Every Bash call** pays one PreToolUse and one PostToolUse Node start from
  the enabled stack provider: about 75 ms (p50). If both gt-workflow and
  github-workflow are enabled, it doubles to about 150 ms. Only one provider
  should be enabled at a time.
- **Every Edit or Write** pays about 150-175 ms of yellow-ruvector hooks (p50),
  more as `.ruvector/coedit.json` grows. The first edit of a file with known
  partners adds about 318 bytes of context.
- **Session start** waits for the slowest hook: about 1.4 s today
  (yellow-ruvector recall; yellow-ci was 1.2-1.5 s on a cache miss before
  CLAUDE-369 and is now about 55 ms p95). In a cloud session that starts while
  yellow-morph's failing install holds its lock, it waits about 2.0 s. Every
  other SessionStart hook finishes in under 150 ms.
- **Model context** at session start is 2.1 KB from yellow-ruvector (up to 7.3
  KB) plus up to about 400 bytes from yellow-review. PreCompact adds 958 bytes
  per compaction. yellow-ruvector's co-edit suggestions add about 318 bytes per
  file, once per session. Nothing else injects model context.

## Over budget

| Ticket     | Hook                               | Problem                                                                                                          |
| ---------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CLAUDE-368 | yellow-ruvector `session-start.sh` | 1.4 s semantic recall; pretty-printed JSON with low-score (about 0.20) results; context ceiling 7.3 KB.          |
| CLAUDE-369 | yellow-ci SessionStart             | Fixed: `gh` moved to a detached refresh; cache read first; 10 min TTL. Was 1.2-1.5 s on a miss, now 55 ms p95.   |
| CLAUDE-370 | yellow-morph `prewarm-morph.sh`    | `env -i` drops `NODE_EXTRA_CA_CERTS` behind a TLS proxy, so every cloud install fails and later starts wait 2 s. |
| CLAUDE-372 | yellow-ruvector `post-tool-use.sh` | 121 ms p95 when an edit records a co-edit pair; grows with `.ruvector/coedit.json`.                              |

## Method

`scripts/hook-cost-bench.js` reads every command hook from
`catalog/plugins/*.json`, runs it with a representative stdin envelope, and
records wall-clock time with `process.hrtime`. It needs:

- the marketplace copied under a throwaway `HOME`
  (`$BENCH_HOME/.claude/plugins/marketplaces/yellow-plugins/`), because
  yellow-ruvector and yellow-morph refuse a `CLAUDE_PLUGIN_ROOT` outside `HOME`;
- a scratch clone as the session cwd, with its `origin` on GitHub for yellow-ci;
- `claude` off `PATH`, so the yellow-core SessionStart hook cannot start a paid
  drain. The script refuses to run while `claude` is on `PATH`.

It reports a `failed_runs` count per row (spawn errors, timeouts and exits other
than 0 or 2) and prints `FAILED` beside any row that has one. Untimed seed runs
that fail are counted in `seed_failed` and printed as `SEED FAILED`, since a
broken seed measures an unseeded store. yellow-ci also runs a "startup, cache
miss" scenario that deletes its result cache before every run; back-to-back
"startup" runs are cache hits.

For the loaded scenarios, seed the state first: install yellow-ruvector and
yellow-morph by running their prewarm hooks once, create `.ruvector/` in the
scratch project (the yellow-ruvector hooks skip a project without it), store
memories with `ruvector hooks remember --semantic`, and create
`todos/debt/000001-pending-high-<slug>.md` files. Numbers will differ on a local
machine: the cloud container routes `gh` and npm through a TLS proxy, which
inflates the network-bound rows (yellow-ci, installs).
