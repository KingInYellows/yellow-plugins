---
name: claudemod:setup
description: "Check that Claude Code can load the yellow-claudemod hooks module and show how to turn the downshift on. Use after installing the plugin or when /claudemod-status is missing."
argument-hint: ''
allowed-tools:
  - Bash
---

# Set Up yellow-claudemod

yellow-claudemod is a Claude Code mod: a TypeScript hooks module that Claude
Code loads in-process. It needs Claude Code 2.1.301 or later, where
`agent.spawn` fires for Agent-tool subagents. This command only reads; it writes
no files.

## Workflow

### Step 1: Check Prerequisites

Run a single Bash call:

```bash
printf '=== Claude Code ===\n'
if command -v claude >/dev/null 2>&1; then
  ver=$(claude --version 2>/dev/null | awk '{print $1}')
  printf 'version:   %s\n' "${ver:-unknown}"
  lowest=$(printf '%s\n%s\n' "${ver:-0}" 2.1.301 | sort -V | head -n 1)
  if [ "$lowest" = "2.1.301" ]; then
    printf 'minimum:   ok\n'
  else
    printf 'minimum:   TOO OLD (need 2.1.301 or later)\n'
  fi
else
  printf 'version:   NOT FOUND (claude not on PATH)\n'
fi

printf '\n=== Plugin ===\n'
if command -v claude >/dev/null 2>&1; then
  if claude plugin list --json 2>/dev/null | grep -q '"yellow-claudemod@'; then
    printf 'installed: yes\n'
  else
    printf 'installed: not listed by claude plugin list\n'
  fi
fi
```

### Step 2: Interpret Results

1. **Version too old or `claude` missing:** stop and say "yellow-claudemod needs
   Claude Code 2.1.301 or later; update with `claude update`."
2. **Not listed:** say the plugin is not installed for this scope and give
   `/plugin install yellow-claudemod@yellow-plugins`.
3. **Ready:** report these facts:
   - Run `/claudemod-status` in a session to see the usage windows, the
     downshift setting and recent subagent spawns. If that command is missing,
     the hooks module did not load: check `claude --debug` for a
     `yellow-claudemod:` line. Managed settings with `allowManagedHooksOnly`
     skip a user plugin's hooks module.
   - The downshift is off by default. Turn it on with the plugin's config
     (`/plugin`, select yellow-claudemod, set "Downshift Opus reviewers near a
     usage limit"), and adjust the threshold there (default 80%).
   - The ledger records every subagent spawn either way.
