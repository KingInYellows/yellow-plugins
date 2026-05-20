---
title: 'Three surprising bash/jq primitives in hook scripts: $$ vs $BASHPID, rmdir non-empty, jq null string'
date: 2026-05-20
category: logic-errors
track: bug
problem: '$$, rmdir, and jq -r .field each have non-obvious behaviors that silently corrupt PID files, leak locks, and pass "null" strings through -z guards in hook scripts'
tags:
  - bash
  - hooks
  - jq
  - pid
  - locking
  - null-guard
components:
  - plugins/yellow-core/hooks/scripts/session-start.sh
  - plugins/yellow-core/hooks/scripts/stop.sh
---

# Three surprising bash/jq primitives in hook scripts

Three independent findings from the compound-staging PR stack (#540, review
rounds 3 and 4) that each look like innocuous idioms but silently misbehave.
Grouped here because they all appeared in the same set of hook scripts and all
share the pattern of "the standard idiom produces the wrong value without
erroring."

---

## 1. `$$` in a subshell resolves to the PARENT process's PID

### Problem

When a lock-owning subshell writes its PID to a file for liveness checks:

```bash
(
  printf '%d' "$$" > "$LOCK_DIR/pid"   # WRONG — $$ is the parent's PID
  do_work
) &
```

`$$` expands to the PID of the **parent** shell, not the background subshell.
This is specified bash behavior: `$$` is set at shell startup and never updated
in subshells.

The downstream failure: a stale-lock reaper that does `kill -0 $(cat pid)` to
probe whether the lock owner is still alive probes the parent shell. If the
parent is still running (it usually is — it is the hook dispatcher itself), the
reaper concludes the lock is live and backs off. A crashed drain holds the lock
forever.

### Fix

Use `$BASHPID` (bash 4+, bash-specific):

```bash
(
  printf '%d' "$BASHPID" > "$LOCK_DIR/pid"   # correct — subshell's own PID
  do_work
) &
```

`$BASHPID` is re-evaluated in each subshell to reflect that process's actual
PID. It is bash-specific (not POSIX `sh`). Confirm bash is in use via the
shebang (`#!/bin/bash`) before relying on it.

### Detection

```bash
grep -rn '\$\$' plugins/*/hooks/scripts/*.sh | grep -v '# $$ is parent'
```

Any `$$` usage in a context that writes a PID to a file or uses the PID for
signal delivery should be replaced with `$BASHPID`.

---

## 2. `rmdir` refuses non-empty directories — sentinel files inside a lock dir must be cleaned up before `rmdir`

### Problem

The directory-as-lock pattern (`mkdir` to acquire, `rmdir` to release) breaks
as soon as any file is written inside the lock directory:

```bash
acquire_lock() { mkdir "$LOCK_DIR" 2>/dev/null; }
release_lock() { rmdir "$LOCK_DIR"; }   # fails silently if LOCK_DIR is non-empty
```

The compound-staging plan added a `pid` file inside `.drain-lock/` for liveness
checking. Every normal drain exit then silently failed at `rmdir` — the lock
directory persisted, blocking all subsequent drains.

`rmdir` does not error visibly in most EXIT trap contexts; the trap just
completes with a non-zero status that is discarded.

### Fix

The EXIT trap must remove any sentinel files before calling `rmdir`:

```bash
release_lock() {
  rm -f "$LOCK_DIR/pid"        # remove ALL files written inside the lock dir
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap release_lock EXIT
```

**Rule:** if you add any file inside a directory-as-lock, you own adding the
corresponding `rm -f` to the release function. Treat the lock directory as
owning exactly the files it creates — nothing more, nothing less.

Alternatively, use `rm -rf "$LOCK_DIR"` in the trap, but only if the lock
directory is guaranteed to contain only files written by this script (no
subdirectories, no user data).

### Detection

```bash
# Find rmdir usages on lock dirs, check for preceding rm -f of inner files
grep -rn 'rmdir' plugins/*/hooks/scripts/*.sh
```

For each `rmdir "$DIR"` in a trap or release function, verify there is a
corresponding `rm -f "$DIR/<sentinel>"` for every file that could exist inside.

---

## 3. `jq -r '.field'` emits the literal 4-char string `"null"` when the field is absent — not an empty string

### Problem

When parsing hook stdin with jq and guarding on emptiness:

```bash
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd')"
if [ -z "$CWD" ]; then
  json_exit "no cwd, skipping"   # WRONG — never fires when .cwd is absent
fi
```

If `.cwd` is not present in the JSON, `jq -r '.cwd'` emits the string `null`
(four characters: n, u, l, l). The `-z` test sees a non-empty four-character
string and falls through. Downstream code receives the literal string `"null"`
as a path component or comparison target.

This is distinct from the `eval "$(jq ... @sh)"` / `set -u` issue documented
elsewhere (which is about unset shell variables). This is about jq's output for
missing JSON keys when using raw mode.

### Fix

Use the `// ""` coalescing operator in every jq field extraction that will be
guarded with `-z`:

```bash
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // ""')"
if [ -z "$CWD" ]; then
  json_exit "no cwd, skipping"   # fires correctly when .cwd is absent or null
fi
```

`// ""` coalesces both JSON `null` and absent keys to the empty string, making
`-z` reliable.

**Apply to all fields that will be tested with `-z`, `[ -n ... ]`, `case`,
or string comparison.** Fields that are only passed to other jq expressions can
omit `// ""` since jq handles null propagation internally.

### Detection

```bash
# Find jq -r extractions without // "" coalescing that are then tested with -z/-n
grep -A2 'jq -r' plugins/*/hooks/scripts/*.sh | grep -B1 '\[ -[zn]'
```

Also audit any `case "$VAR"` or `[ "$VAR" = "something" ]` that is downstream
of a `jq -r` extraction — if `$VAR` could be `"null"`, the comparison silently
mismatch.

---

## Prevention checklist for hook scripts

For each new hook script, verify:

- [ ] Every PID written to a file uses `$BASHPID`, not `$$`
- [ ] Every `rmdir` on a lock directory is preceded by `rm -f` of all inner
      sentinel files
- [ ] Every `jq -r '.field'` extraction that is guarded with `-z` or compared
      as a string uses `// ""` coalescing

## Sources

- PR #540 review rounds 3 and 4, compound-staging stack
- `bash(1)` man page: `$$` — "Expands to the process ID of the shell. In a
  () subshell, it expands to the process ID of the invoking shell, not the
  subshell." `$BASHPID` — "Expands to the process ID of the current Bash
  process."
- `jq` manual: `Alternative operator //` — "produces its left operand if it is
  not false or null, otherwise produces its right operand"
