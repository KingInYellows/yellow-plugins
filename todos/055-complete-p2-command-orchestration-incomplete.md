---
status: complete
priority: p2
issue_id: "055"
tags: [code-review, implementation, incomplete]
dependencies: []
pr_number: 12
---

# 🟡 P2: Command Orchestration Prints Instructions Instead of Executing

## Problem Statement

The `/debt:audit` command declares `Task` in `allowed-tools` but doesn't actually invoke it. Instead, it prints manual instructions telling users to launch scanner agents themselves. This makes the command non-functional for automated execution.

## Findings

**Location**: `plugins/yellow-debt/commands/debt/audit.md:126-134`

**Current code**:
```bash
# Note: In actual implementation, we would use Task tool here to launch agents
# For now, display instructions for user to launch manually
printf '\nTo launch scanner agents, use:\n'
for scanner in "${SCANNERS[@]}"; do
  printf '  Task(subagent_type="%s-scanner"): "..."\n' "$scanner"
done
```

**Impact**:
- Command doesn't work as documented
- Users must manually launch 5+ agents
- No automation
- Poor UX

**Source**: Agent-Native Reviewer, Performance Oracle

## Proposed Solutions

### Solution 1: Implement Actual Task Tool Invocations

Replace placeholder with real Task tool calls:

```markdown
# Launch scanners in parallel via Task tool
for scanner in "${SCANNERS[@]}"; do
  Task(
    subagent_type="${scanner}-scanner",
    description="Scan for ${scanner} debt",
    prompt="Scan codebase from .debt/file-list.txt, write findings to .debt/scanner-output/${scanner}-scanner.json",
    run_in_background=true
  )
  scanner_status["$scanner"]="launched"
done

# Wait for all scanners to complete
# (Implementation details: poll .debt/scanner-output/ for completion)

# Launch synthesizer
Task(
  subagent_type="audit-synthesizer",
  description="Synthesize scanner outputs",
  prompt="Merge scanner outputs from .debt/scanner-output/, deduplicate, generate report and todos"
)
```

**Effort**: Medium (2-3 hours)
**Risk**: Low

## Recommended Action

Implement actual Task tool orchestration.

## Technical Details

**Challenge**: Commands are markdown files with bash code blocks. Task tool calls need to be invoked by Claude, not bash.

**Design Decision**: Command markdown should provide bash script that Claude executes, which then provides instructions for Claude to launch Task agents.

**Alternative**: Make commands pure bash with `claude-code task launch` CLI if available.

## Acceptance Criteria

- [ ] audit command actually launches scanner agents
- [ ] Scanners run in parallel
- [ ] Synthesizer launches after scanners complete
- [ ] Manual test: `/debt:audit` completes without user intervention
- [ ] Scanner status tracking works

## Resources

- Agent-native review: /tmp/claude-1000/.../aa022d3.output
- Performance review: /tmp/claude-1000/.../af1060d.output

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on
