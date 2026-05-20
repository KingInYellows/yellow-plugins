---
title: 'Machine-generated text foot-guns: empty-pattern grep and YAML apostrophe escaping'
date: 2026-05-20
category: logic-errors
track: bug
problem: 'grep -F "" matches every line, turning idempotency checks into false-positive skips; single-quoted YAML scalars with embedded apostrophes produce silent parse truncation in machine-generated frontmatter'
tags:
  - grep
  - empty-pattern
  - idempotency
  - yaml
  - frontmatter
  - escaping
  - machine-generated
  - pipeline
components:
  - plugins/yellow-core/agents/workflow/staging-reviewer.md
  - plugins/yellow-core/agents/workflow/staging-promoter.md
---

# Machine-generated text foot-guns: empty-pattern grep and YAML apostrophe escaping

Two distinct bugs that surface specifically in pipelines that **generate** text
programmatically rather than hardcode it. Each is a silent failure: no error is
raised, the wrong result is returned, and forward progress is silently
corrupted.

---

## 1. Empty-pattern grep false positive in idempotency checks

### Problem

An idempotency guard checks whether a solution path is already recorded in
MEMORY.md before appending:

```bash
REL_SOLUTION_PATH="${SOLUTION_PATH#$GIT_ROOT/}"
if grep -qF "$REL_SOLUTION_PATH" "$MEMORY_PATH"; then
  log "already recorded, skipping"
  return 0
fi
append_memory_entry
```

If `$SOLUTION_PATH` is empty (e.g., a bug causes the variable to not be set),
then `$REL_SOLUTION_PATH` is also empty. `grep -F ""` matches **every line** of
the file. The idempotency guard fires unconditionally — `"already recorded,
skipping"` — and the MEMORY.md append is silently skipped for every subsequent
entry.

This is especially dangerous because it looks like correct behavior: the
guard logs a plausible message, no error is raised, and the pipeline
continues. The corruption (missing entries) is only visible when someone
notices the MEMORY.md index is out of date.

### Fix

Guard every derived grep pattern with a fail-loud empty check immediately after
derivation:

```bash
REL_SOLUTION_PATH="${SOLUTION_PATH#$GIT_ROOT/}"
[ -z "$REL_SOLUTION_PATH" ] && {
  printf '[knowledge-compounder] BUG: REL_SOLUTION_PATH is empty (SOLUTION_PATH=%s, GIT_ROOT=%s)\n' \
    "$SOLUTION_PATH" "$GIT_ROOT" >&2
  exit 1
}
if grep -qF "$REL_SOLUTION_PATH" "$MEMORY_PATH"; then
  log "already recorded, skipping"
  return 0
fi
```

### General rule

> `grep -F ""` matches every line. Any code path that constructs a grep pattern
> from a derived variable must either:
> 1. Guarantee the variable is non-empty by construction, or
> 2. Guard with `[ -z "$VAR" ]` and fail loud before the grep call.
>
> Option (3) — `grep -F -e "$VAR"` — does NOT help; empty `-e ""` still matches
> everything. The guard is the only fix.

### Where this pattern is most dangerous

Idempotency checks are the highest-risk location because:

- An empty pattern causes the check to always return "already done."
- The pipeline silently skips work rather than crashing.
- The corruption accumulates over multiple runs before anyone notices.

Other grep uses (counting, filtering, searching) fail more obviously when the
pattern is empty. Prioritize auditing idempotency and "already done" guards
first.

### Detection

```bash
# Find grep calls that use a shell variable as the pattern
# (candidates for the empty-pattern foot-gun)
rg 'grep.*\$[A-Z_]+' plugins/ scripts/ --include='*.sh' --include='*.md'
# Then audit each: is the variable guaranteed non-empty before this line?
```

---

## 2. YAML apostrophe escaping in machine-generated frontmatter

### Problem

A pipeline generates YAML frontmatter by interpolating user-captured or
model-generated text into single-quoted scalar values:

```bash
printf -- '---\ntitle: '\''%s'\''\n---\n' "$TITLE"
```

If `$TITLE` contains an apostrophe — e.g., `"don't break idempotency"` — the
output is:

```yaml
---
title: 'don't break idempotency'
---
```

This is **invalid YAML**. Single-quoted scalars use `''` (doubled single quote)
to escape an embedded apostrophe. If an apostrophe is not escaped, the
single-quoted scalar terminates early, and compliant YAML 1.2 parsers should
fail with a parse error (instead of accepting a truncated value). Common
English words that trigger this: `don't`, `won't`, `can't`, `it's`, `there's`,
`you're`.

### Fix

Before interpolating any user/captured string into a single-quoted YAML scalar,
double all apostrophes:

```bash
# Escape for single-quoted YAML scalar: ' → ''
yaml_escape_single() {
  printf '%s' "$1" | sed "s/'/''/g"
}

TITLE_ESCAPED=$(yaml_escape_single "$TITLE")
printf -- "---\ntitle: '%s'\n---\n" "$TITLE_ESCAPED"
```

Output for `"don't break idempotency"`:

```yaml
---
title: 'don''t break idempotency'
---
```

This is valid YAML. A parser reading it returns the string `don't break
idempotency` with a single apostrophe.

### Alternative: double-quoted scalars

Double-quoted YAML scalars are also valid and use `\"` and `\\` as escapes:

```bash
# Escape for double-quoted YAML scalar: " → \", \ → \\
yaml_escape_double() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

TITLE_ESCAPED=$(yaml_escape_double "$TITLE")
printf -- '---\ntitle: "%s"\n---\n' "$TITLE_ESCAPED"
```

Pick one quoting strategy and document it. Mixing strategies per-field is a
maintenance hazard.

### What about `printf '%s' "$VAR" | python3 -c 'import yaml,sys; ...'`?

If the pipeline already has Python available, letting a YAML serializer handle
escaping is more robust than manual sed. But for shell scripts that deliberately
avoid Python dependencies, the sed approach is sufficient and portable.

### Detection

```bash
# Find shell scripts that write YAML frontmatter using single-quoted printf
rg "printf.*title.*'%s'" plugins/ scripts/ --include='*.sh' --include='*.md'
# Audit: is the interpolated value apostrophe-escaped before this call?
```

---

## Combined prevention checklist

For any pipeline that generates YAML frontmatter or uses grep with
programmatically derived patterns:

- [ ] Every grep idempotency guard checks `[ -z "$PATTERN_VAR" ]` fail-loud
      immediately before the `grep` call.
- [ ] Machine-generated YAML single-quoted scalars pass through an apostrophe
      doubler (`sed "s/'/''/g"`) before interpolation.
- [ ] One YAML quoting strategy (single or double) is chosen per file and
      documented in a comment near the write function.
- [ ] The quoting escape helper is defined once and reused — not inlined per
      field.

## Sources

- PR #543 review rounds 1–2, compound-staging stack
- `plugins/yellow-core/agents/workflow/staging-reviewer.md`
- `plugins/yellow-core/agents/workflow/staging-promoter.md`
