# `have_X` + `run_X` Helper Pair for Multi-Variant Tool Detection

## Summary

Shell scripts that probe for a tool with multiple acceptable invocations
(`python3 -m pip` vs `pip3` vs `pip`; `gnu-sed` vs `sed`; `gtar` vs `tar`)
often duplicate the detection logic at every call site. A common refactor
exposes a function that emits the chosen command tokens for callers to
read into a bash array — `mapfile -t cmd < <(detect_tool)` followed by
`"${cmd[@]}" args...`. This works but propagates an array protocol to
every caller; each call site must know to use `mapfile` and to dereference
the array correctly.

The cleaner refactor is a pair of helpers: a predicate `have_X()` that sets
a script-level variable describing the chosen variant, plus a dispatcher
`run_X()` that does the actual invocation. Callers use plain function-call
syntax. The variant string is available for user-facing messages without
re-detecting.

## Anti-Pattern (Before)

```bash
# Duplicated at every call site:
if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then
  pip_cmd=(python3 -m pip)
elif command -v pip3 >/dev/null 2>&1; then
  pip_cmd=(pip3)
else
  pip_cmd=(pip)
fi
printf 'Upgrading via %s...\n' "${pip_cmd[*]}"
"${pip_cmd[@]}" install --upgrade pkg
```

```bash
# After first refactor — token-array protocol exposed to callers:
detect_pip_cmd() {
  if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then
    printf 'python3\n-m\npip\n'
  elif ...
}

# Every call site:
if mapfile -t pip_cmd < <(detect_pip_cmd) && [ "${#pip_cmd[@]}" -gt 0 ]; then
  printf 'Upgrading via %s...\n' "${pip_cmd[*]}"
  "${pip_cmd[@]}" install --upgrade pkg
fi
```

The token-array form is correct but ceremonial: the multi-line
`mapfile`/length-check/dereference pattern is repeated and the array
itself never escapes the caller.

## Pattern

Two helpers; one variable for messages:

```bash
PIP_CMD_USED=""

# Predicate. Sets PIP_CMD_USED for messages. Returns 1 if no pip available.
have_pip() {
  if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then
    PIP_CMD_USED="python3 -m pip"
    return 0
  elif command -v pip3 >/dev/null 2>&1; then
    PIP_CMD_USED="pip3"
    return 0
  elif command -v pip >/dev/null 2>&1; then
    PIP_CMD_USED="pip"
    return 0
  fi
  return 1
}

# Dispatcher. Routes to the variant chosen by have_pip.
run_pip() {
  case "$PIP_CMD_USED" in
    "python3 -m pip") python3 -m pip "$@" ;;
    pip3) pip3 "$@" ;;
    pip)  pip "$@" ;;
    *) return 1 ;;
  esac
}

# Caller — plain function-call syntax, no array ceremony:
if have_pip; then
  printf 'Upgrading via %s...\n' "$PIP_CMD_USED"
  run_pip install --upgrade pkg
fi
```

## When to Use

- Tool has 2+ valid invocations and the script calls it from 2+ locations.
- The chosen variant is needed for user-facing messages (not just internal
  dispatch).
- The script is bash (not POSIX sh) — the `case` dispatcher uses bash-style
  pattern matching but is portable to any POSIX-ish shell with light edits.

## When Not to Use

- Single call site: inline the detection.
- Pure POSIX scripts where you cannot rely on `case` pattern matching with
  spaces in patterns — fall back to `eval` carefully or split into separate
  predicates per variant.
- The chosen tokens vary in number across variants AND callers need
  programmatic access to the token list (rare; usually messages suffice).

## Detection

```bash
# Find scripts with duplicated tool-detection blocks:
rg -A6 "command -v python3 .*pip --version" plugins/*/scripts/
# If the same 5-7 line block appears 2+ times, candidate for the helper pair.
```

## Origin

PR #248 (yellow-mempalace plugin) install-mempalace.sh. Duplicate
pip-detection blocks (12 lines × 2) flagged by code-simplicity-reviewer;
initial fix used token-array protocol; pass-2 simplifier flagged the
mapfile ceremony at call sites; final fix used `have_pip` + `run_pip`
pair, removed ~10 lines net.

## See Also

- MEMORY.md "Bash Hook & Validation Patterns" — `validate_X` shared lib
  pattern is conceptually similar (extract to `lib/validate.sh`).
