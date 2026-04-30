---
"yellow-review": minor
---

`/review:resolve` — drop non-actionable threads and cluster same-region comments
before resolver dispatch (W3.3)

**Step 3c — Actionability filter (CE PR #461 parity).** Threads whose entire
concatenated body matches a non-actionable pattern are dropped before resolver
dispatch:

| Pattern (case-insensitive)                                  |
| ----------------------------------------------------------- |
| `^lgtm[!.]?$`                                               |
| `^thanks?[!.]?$` / `^thank\s+you[!.]?$`                     |
| `^(?:👍\|✅\|🎉)\s*[!.]?$`                                   |
| `^\+1\s*[!.]?$`                                             |
| `^looks?\s+good[!.]?$`                                      |
| `^nice(?:\s+catch)?[!.]?$`                                  |
| `^nit:?[!.]?$` (bare `nit` or `nit:` with no content)       |

Threads with one of these patterns followed by a substantive paragraph (e.g.,
`LGTM, but consider X for the retry path`) are kept — the substantive body is
what matters. The dropped count and IDs are reported to the user before
dispatch and surfaced again in the Step 9 summary.

If all threads are dropped, the command exits successfully without any
resolver dispatch — saving a wasted `gt modify` + `gt submit` cycle.

**Step 3d — Cluster comments by file+region (CE PR #480 parity).** Adjacent
threads on the same file are merged into a single cluster when their line
numbers are within `≤ 10` lines of each other (transitive — T1 at 40, T2 at
48, T3 at 55 cluster together). Threads without a `line` field form one
review-level cluster per path. Each cluster carries `path`, `line_range`,
`threadIds[]`, and concatenated `bodies` separated by `--- next thread ---`.

The `≤ 10` line distance is tunable via `yellow-plugins.local.md`'s
`resolve_pr.cluster_line_distance: <N>` key (out-of-range or non-integer
values fall back to the default; do not error). Reduction ratio is reported
as e.g. `[cluster] 5 threads → 3 clusters across 2 files (Δ = 2 consolidated)`.

**Step 4 — Resolver dispatch operates on clusters, not raw threads.** Each
cluster spawns ONE `pr-comment-resolver` agent with all of its thread bodies
fenced in a single `--- cluster comments begin ---` block. The resolver
reconciles the cluster with **a single coherent edit** to the file region —
not N separate edits. If two comments in the same cluster contradict (e.g.,
one asks to rename, another asks to keep the name), the resolver reports the
conflict in its return summary and the user reconciles in Step 5.

**Step 7 — `resolve-pr-thread` iterates per cluster.** A cluster is "successfully
resolved" when its resolver returned without a contradiction-conflict report
and its edits applied without conflict. Only successfully-resolved clusters
have their `threadIds[]` marked resolved via the GraphQL mutation; conflicted
clusters remain open for human reconciliation. Per-threadId script failures
within a cluster are logged but do not abort the loop.

**Step 9 — Report includes drop and cluster counts.** New report fields:
`Dropped (non-actionable)`, `Clusters formed` with reduction ratio. Distinguishes
dropped (intentional) from failed (needs human attention).

**Acceptance criterion satisfied:** synthetic PR with 5 comments (2 actionable
on different file regions, 2 nit-prefixed, 1 LGTM) → 2 resolver tasks spawned
(one per actionable cluster, after dropping the 3 non-actionable threads).

**No new tools added** to `allowed-tools` — the filter and clustering use
existing string-matching capabilities. No changes to `pr-comment-resolver`
agent body — it already accepts a single fenced comment block; the dispatch
side now concatenates multiple bodies into that one block per cluster.
