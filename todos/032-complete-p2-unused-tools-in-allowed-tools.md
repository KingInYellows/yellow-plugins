---
status: complete
priority: p2
issue_id: '032'
tags: [code-review, security, least-privilege]
dependencies: []
---

# unused tools in allowed-tools

## Problem Statement

The app-discoverer agent lists Bash in its allowed-tools, but all its
instructions are read-only operations (Read, Grep, Glob). Bash access is
unnecessary and increases attack surface by granting execution capabilities that
aren't needed for the agent's function.

## Findings

- **File affected**: `agents/testing/app-discoverer.md`
- **Current allowed-tools**: Includes Bash
- **Actual tool usage**: Only Read, Grep, Glob used in agent instructions
- **Security principle**: Least privilege - agents should only have tools they
  actually need
- **Impact**: Unnecessary attack surface if agent is compromised or confused

## Proposed Solutions

### Option A: Remove Bash from allowed-tools (Recommended)

Simply remove Bash from the allowed-tools list:

```markdown
Allowed Tools: Read, Grep, Glob
```

Simplest and most secure. If Bash is truly unused, removal has no functional
impact.

### Option B: Document which commands require Bash (if any)

If there are edge cases requiring Bash:

- Identify specific commands that need Bash
- Document in agent instructions why Bash is needed
- Consider if those commands can be replaced with read-only alternatives
- Keep Bash only if truly necessary

## Recommended Action

Implement Option A unless investigation reveals actual Bash usage. Review
app-discoverer instructions:

1. Check if any workflow step requires command execution
2. Verify all file operations use Read, not Bash + cat/grep
3. If no Bash usage found: remove from allowed-tools
4. If Bash usage found: document specific use case in agent description

Principle: Grant only the minimum tools needed for agent function.

## Technical Details

- **Location to modify**: `agents/testing/app-discoverer.md` (allowed-tools
  list)
- **Investigation**: Search agent file for Bash-specific patterns (pipes,
  command substitution)
- **Validation**: Ensure all file reads use Read tool, searches use Grep/Glob
- **Alternative tools**: Read replaces `cat`, Grep replaces `bash -c grep`, Glob
  replaces `find`

## Acceptance Criteria

- [ ] Review app-discoverer agent instructions for actual Bash usage
- [ ] Document findings: list of Bash commands found (if any)
- [ ] If no Bash usage: remove Bash from allowed-tools
- [ ] If Bash usage found: document specific use case and consider alternatives
- [ ] Update plugin.json if needed (command allowed-tools)
- [ ] Manual test: verify app-discoverer functions without Bash access
- [ ] Security review: confirm no execution capability needed for discovery

## Work Log

| Date       | Action                          | Learnings                                                                                                        |
| ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | Least-privilege principle: agents should only have tools they actually use; unused tools increase attack surface |

## Resources

- PR: #11 (yellow-browser-test code review)
- Related: Agent workflow security patterns from PR #9
- Principle: Minimize agent capabilities to minimum necessary for function
