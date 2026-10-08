# Local Scripts for the Resolve Write Phase

Local (non-GraphQL) scripts used by `/review:resolve` Steps 5–7 and the
callers that walk several PRs. Exit codes and markers are defined in
`references/resolve/dispositions.md`.

- **commit-resolve-fixes** `--provider graphite|github --pr <N> --message
  <msg> [--unattended] [--allow-credential-shaped] [--files-from <f>]
  [-- <files...>]` — Stage, new commit, submit, verify remote head; never
  runs a push itself
- **run-verify-command** — prints `{result, patch, log, treeClean}` plus a
  `reason` that is non-empty when something was skipped or only partly
  reverted:
  - `--pr <N> --timeout <s> --command-file <f> --trusted [--unattended]
    --ignored-since <marker> [--files-from <f>]` runs
    `resolve_pr.verify_command`; `--ignored-since` is required for every run
    (the revert modes ignore it); on failure it saves a patch, reverts the
    files and reports whether the tree is clean
  - `--pr <N> --revert-only [--files-from <f>] [-- <files...>]` saves a
    patch and reverts the listed files without running anything
  - `--pr <N> --check-ignored --ignored-since <marker>` runs only the
    gitignored-file guard (no command, no revert); `/review:resolve` uses it
    when there is no verify command
  - `--pr <N> --revert-dirty` does the same for every change in the tree
    (no file list); `/review:resolve-stack` runs it after a dirty resolve
    through `references/review-resolve-stack/dirty-tree-cleanup.md` and
    `/review:sweep-all` through `references/review-sweep-all/dirty-tree-cleanup.md`
  - `--pr <N> --revert-denied` reverts only dirty paths on the resolver deny
    list (no file list; other dirty paths stay) and reports `deniedClean`,
    `reverted` and `revertedCount`; nothing to revert is `result: "noop"`.
    Give exactly one of the revert flags and `--check-ignored`; a second one
    exits 2
- **guard-local-config** `snapshot` | `check <snap-dir> <digest>` | `clear <snap-dir>` —
  Snapshot the ignored `yellow-plugins.local.md` (prints the path, then
  `digest=<hex>` for the caller to hold), then detect a resolver
  edit to it and put it back; exit 0 unchanged, 3 changed and restored, 4
  snapshot validation or digest failure (live config untouched) or a failed
  restore (the change may still be live); a symlinked
  config is refused at snapshot (exit 2).
  `/review:resolve-stack` and `/review:sweep` run `clear` only after exit 0
  or 3; on exit 4 they keep the snapshot and print its path, since it may
  hold the only intact copy of the config.
  `/review:resolve-stack` runs it around the walk
- **check-resolve-text** `<file>...` — Exits 6 when text looks like a
  credential, an image, an `@` mention or a foreign URL (or the scan did not
  run), and 2 for a usage error or an unreadable file; run it on text posted
  outside the resolve scripts (for example a Linear issue)
