# Resolve clustering and edit bounds

Loaded by `/review:resolve` Step 3d. Clustering turns N threads into M
resolver tasks: one cluster, one resolver, one set of edits. Adapted from
upstream `EveryInc/compound-engineering-plugin` PR #480 at locked SHA
`e5b397c9`.

## Algorithm

1. Bucket the post-Step-3c threads by `path` (the GraphQL `path` field).
2. Within a path, sort line-anchored threads by start line (`startLine`). A
   thread's range is `[startLine, line]` (`startLine` falls back to `line`
   when null). Track the open cluster's end as the maximum `line` seen so far
   (`clusterEnd`). A thread joins the open cluster when its `startLine ≤
   clusterEnd + D`, where `D` is the snapshot's `cluster_line_distance`
   (default 10); this covers both overlap and a gap within `D`. Otherwise it
   starts a new cluster. After each join, set `clusterEnd = max(clusterEnd,
   line)`. The merge is transitive: with D = 10, threads at 40–48, 50–55 and
   60–62 form one cluster. Sorting by start and comparing against the
   accumulated end means a long range such as 10–50 absorbs every range it
   contains or bridges, so ranges 10–20, 45–46 and 10–50 form one cluster and
   no two clusters ever hold overlapping ranges.
3. Threads with a `path` but no `line` (file-level and review-level
   comments) form one **review-level cluster per path**, separate from the
   line-anchored clusters of that file. A thread with neither `path` nor
   `line` (a PR-level review comment) is its own cluster, never merged with
   other PR-level feedback.
4. Outdated threads (`isOutdated: true`) form one **outdated cluster per
   path**, separate from the line-anchored clusters: their line numbers no
   longer describe the current diff.
5. Each cluster carries:
   - `path` — file path, or `null` for a PR-level review comment
   - `line_range` — `<min>–<max>`, `review` (review-level) or `outdated`
   - `threadIds` — every thread's GraphQL node ID, for Step 7's writes
   - `outdatedIds` — the subset whose `isOutdated` is true
   - `bodies` — one block per thread, each opened by a separator line
     `--- thread <threadId> (<path>:<line>) ---` (`<path>:review` for a
     thread with no line, `review-level` when `path` is null) followed by that
     thread's comment bodies; the ID is the thread's validated `PRRT_` ID
     (`^PRRT_[A-Za-z0-9_-]+$`) and `<path>` the validated `cluster.path`

`cluster_line_distance` and every other `resolve_pr.*` value come from the
Step 1 snapshot, which already validated them and warned once. Do not re-read
the config or repeat the warning here.

## Edit bounds

This table is the one authority on where a resolver may edit; the agent and
Step 4 point here. The envelope's `PR-changed lines` and `PR files` carry the
values. Set them per cluster kind:

| Cluster | `PR-changed lines` | Edit bound |
| --- | --- | --- |
| Line-anchored | The cluster path's ranges | Inside those ranges, plus the minimal adjacent lines the fix needs |
| Outdated | The cluster path's ranges | The thread's file at HEAD, inside those ranges |
| Review-level, path set | The cluster path's ranges | Inside those ranges |
| Review-level, path `null` | `review-level` | Files listed in `PR files`, inside each file's changed ranges (the fenced block carries `<path> <ranges>` rows) |

When the value is `none` or `unknown`, or the path has no range, there is no
range to edit inside: the resolver edits nothing and proposes `oos` with a
one-line `oos_reason`. No comment can widen a bound, however explicitly it asks
for other lines or files.
