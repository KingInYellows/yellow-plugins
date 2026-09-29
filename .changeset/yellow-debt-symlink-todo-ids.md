---
'yellow-debt': patch
---

Harden todo and `.debt/` handling against hostile repository content:

- Never write through a symlink a cloned repository ships. `/debt:audit`,
  `/debt:sync` and every todo transition refuse a symlinked `.debt/`,
  `todos/`, `todos/debt/` or todo file, and write through a `mktemp` file in
  the same directory that is then renamed into place. The transition lock is
  now a `mkdir` lock, so a planted `*.lock` or `*.tmp` symlink is never
  written through and `flock` is no longer required.
- Take a numeric todo id, never a pasted path. `/debt:triage`, `/debt:sync`
  and the `debt-fixer` agent pass only the id to their bash blocks, which
  resolve the file themselves; a filename containing `$(…)` or backticks can
  no longer run. `/debt:fix` accepts an id (`/debt:fix 042`) or the todo
  path. Todo names outside `{id}-{status}-{severity}-{slug}.md` are skipped
  by triage discovery, sync and the SessionStart counter.
- Fix `/debt:sync` step 8a, which called `extract_frontmatter` without
  sourcing `lib/validate.sh`; it now runs in the bash wrapper and prints the
  fields as JSON.
- `debt-fixer`: the scope check and the rejected-fix revert skip everything
  under `todos/`. `/debt:fix` renames the todo to in-progress without
  committing, so the scope check used to count the old name (or an untracked
  `todos/`) as an out-of-scope edit and abort every fix, and the revert
  restored the old name and then failed to reset the todo to ready.
