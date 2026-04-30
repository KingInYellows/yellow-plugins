---
"yellow-core": patch
"yellow-review": patch
---

Update CHANGELOG migration text to runtime-current 3-segment subagent_type
form + document non-interactive cache-refresh workaround

Two small docs/maintenance fixes:

1. **CHANGELOG migration text:** `plugins/yellow-core/CHANGELOG.md` and
   `plugins/yellow-review/CHANGELOG.md` had migration notes citing the
   legacy 2-segment `subagent_type: "yellow-review:code-reviewer"` form.
   The repo's runtime expects 3-segment as of PRs #288/#290. The
   validator's INFO note flagged these for future hard-fail. Updated both
   migration snippets to the 3-segment form
   (`yellow-review:review:code-reviewer`) so the migration text stays
   accurate and the INFO warnings clear.

2. **CONTRIBUTING.md cache-refresh note:** added a "Manual cache refresh
   for non-interactive sessions" subsection covering the rsync workaround
   when `/plugin marketplace update` (TUI-only) isn't available — e.g.,
   background agents or Remote Control sessions verifying a freshly-merged
   `chore: version packages` release. The loop hardens against
   path-traversal via plugin name and version (allowlist regex), uses
   `sort -V` instead of lexicographic `ls | tail -1` so `1.10.x` is
   correctly preferred over `1.9.x`, requires `set -euo pipefail` plus
   `command -v` prereq checks, and surfaces `cp` failures rather than
   silently skipping rsync.

No code changes; documentation-only patches.
