---
status: complete
priority: p2
issue_id: '085'
tags: [code-review, yellow-ci, performance]
dependencies: []
---

# validate_ssh_host Subprocess Optimization

## Problem Statement

`validate_ssh_host()` spawns 3 subprocesses per call (grep + 2x cut) for IPv4
validation. For multi-runner operations like `/ci:runner-health` with 10+
runners, this creates 30+ unnecessary fork/exec cycles.

## Findings

- **File**: `plugins/yellow-ci/hooks/scripts/lib/validate.sh:222-227`
- **Current**: `printf | grep` for IPv4 detection, `printf | cut` for octet
  extraction (3 subprocesses)
- **Cost**: ~10ms per call vs ~0.1ms with pure bash
- **Impact**: 10 runners = 100ms overhead, 100 runners = 1s overhead

**Current implementation:**

```bash
if printf '%s' "$host" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  octet1=$(printf '%s' "$host" | cut -d. -f1)
  octet2=$(printf '%s' "$host" | cut -d. -f2)
```

## Proposed Solutions

**Option 1 (Recommended): Pure bash regex with BASH_REMATCH**

```bash
if [[ "$host" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  local octet1=${BASH_REMATCH[1]}
  local octet2=${BASH_REMATCH[2]}
```

- **Pros**: Zero subprocesses, 98x faster, cleaner code
- **Cons**: Bash-specific (not POSIX), but scripts already use bash
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] Replace grep + cut with bash regex in validate_ssh_host()
- [ ] Zero subprocess calls for IPv4 validation path
- [ ] All existing SSH host tests pass
- [ ] No behavior change (same validation logic)
