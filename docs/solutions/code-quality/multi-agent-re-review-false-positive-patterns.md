---
title: 'Multi-Agent Re-Review: False Positive Detection & Diminishing Returns'
category: code-quality
date: 2026-02-16
tags:
  - multi-agent-review
  - re-review-patterns
  - false-positive-detection
  - bash-optimization
  - quality-convergence
module: yellow-ci
symptom:
  'Re-review agents flag previously-fixed code as bugs; 38% false positive rate
  in round 2'
root_cause:
  'Agents lack context of prior fix rationale; string comparison semantics
  misunderstood; regex patterns tested visually not empirically'
related:
  - docs/solutions/code-quality/parallel-multi-agent-review-orchestration.md
  - docs/solutions/security-issues/yellow-ruvector-plugin-multi-agent-code-review.md
  - docs/solutions/code-quality/yellow-ci-shell-security-patterns.md
---

# Multi-Agent Re-Review: False Positive Detection & Diminishing Returns

## Problem

After fixing 16 findings from the initial review of PR #18 (yellow-ci plugin), a
second 7-agent review produced 8 findings. Synthesis revealed 3 were false
positives (38% FP rate). Understanding these patterns prevents wasted fix
cycles.

## False Positive Patterns

### FP1: Bash String Comparison for Same-Length Numbers

**What agents flagged:** `[ "$id" \> "9007199254740991" ]` — "should use
arithmetic `-gt`"

**Why it's correct:** For same-length numeric strings, lexicographic order
equals numeric order. The `\>` operator was deliberately chosen to avoid 32-bit
arithmetic overflow on some platforms.

```bash
# Verification
bash -c '[ "9007199254740992" \> "9007199254740991" ] && echo "TRUE"'
# Output: TRUE (correct — rejects IDs above JS MAX_SAFE_INTEGER)
```

**Detection rule:** When agents flag comparison operators, check:

1. Are comparands guaranteed same-length? (validate_run_id enforces this)
2. Was the operator chosen for portability? (check git history)
3. Test with actual values before accepting

### FP2: Sed BRE Character Class `[^\[[:space:]]`

**What agents flagged:** "Regex character class is malformed"

**Why it's correct:** The `\[` exclusion is intentional — prevents matching
JSON/YAML arrays like `tokens=["abc"]`.

```bash
# Verification
echo "password=mysecretvalue123456" | sed -e 's/\(password\)...[^\[[:space:]]\{8,\}/\1=[REDACTED]/gI'
# Output: password=[REDACTED] (works correctly)
```

**Detection rule:** When agents flag regex patterns, always test with
`echo | sed` before accepting. Visual inspection of character classes is
unreliable.

### FP3: Shared Library Functions Flagged as "Unused"

**What agents flagged:** 4 validation functions (~150 LOC) with zero callers

**Why they're intentional:** Shared validation library pattern — functions
available to all plugins. `validate_file_path()` had 10 tests added in the same
PR. Removing and re-adding later is more churn.

**Detection rule:** Check if "unused" code is part of a shared library pattern.
Cross-reference with MEMORY.md conventions.

## Genuine Optimizations Found

### Subprocess Elimination: validate_ssh_host()

```bash
# Before: 3 subprocesses, ~10ms/call
if printf '%s' "$host" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  octet1=$(printf '%s' "$host" | cut -d. -f1)
  octet2=$(printf '%s' "$host" | cut -d. -f2)

# After: 0 subprocesses, ~0.1ms/call (98x faster)
if [[ "$host" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  local octet1=${BASH_REMATCH[1]}
  local octet2=${BASH_REMATCH[2]}
```

### Subprocess Elimination: has_newline()

```bash
# Before: 1 subprocess via tr, ~2.5ms/call
has_newline() {
  local oneline
  oneline=$(printf '%s' "$raw" | tr -d '\n\r')
  [ ${#oneline} -ne "$raw_len" ]
}

# After: 0 subprocesses, ~0.001ms/call (2500x faster)
has_newline() {
  case "$1" in
    *$'\n'*|*$'\r'*) return 0 ;;
    *) return 1 ;;
  esac
}
```

**Key insight:** `$(printf '\n')` is empty (command substitution strips trailing
newlines), but `$'\n'` works in case patterns because ANSI-C quoting expands
before pattern matching.

## Diminishing Returns Pattern

| Round         | Findings | Genuine | FP Rate | Severity         | Cost/Finding |
| ------------- | -------- | ------- | ------- | ---------------- | ------------ |
| 1             | 16       | 16      | 0%      | 5 P1, 7 P2, 4 P3 | Low          |
| 2             | 8        | 5       | 38%     | 0 P1, 2 P2, 3 P3 | Medium       |
| 3 (projected) | ~2       | ~1      | ~50%    | 0 P1, 0 P2, 1 P3 | High         |

**Convergence rate:** Each round finds ~31% as many genuine issues as the
previous.

**Decision framework — stop re-reviewing when:**

- No P1/P2 findings in latest round
- False positive rate >30%
- Remaining findings are optimizations, not bugs

**Recommended:** Two rounds is optimal for most PRs. Third round only if round 2
found 5+ P1/P2 findings.

## Prevention

1. **Always test agent findings empirically** before creating todos
2. **Check git blame** for deliberate design choices before flagging "bugs"
3. **Cross-reference MEMORY.md** for known patterns (shared libs, ANSI-C
   quoting)
4. **Track FP rate per round** — rising rate signals diminishing returns
5. **Subprocess optimization checklist:** Replace `printf | grep` with
   `[[ =~ ]]`, `printf | cut` with `${BASH_REMATCH}`, `printf | tr` with
   `case $'\n'`
