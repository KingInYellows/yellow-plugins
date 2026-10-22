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
  # Installed is not enough: a disabled plugin's hooks module never loads.
  # Project and local rows count only for this repository, and the most
  # specific applicable scope decides (as /setup:all reads the same list).
  repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
  state=$(claude plugin list --json 2>/dev/null | PROJECT_PATH="$repo_top" node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let rows;
      try { rows = JSON.parse(raw); } catch { rows = null; }
      if (!Array.isArray(rows)) { process.stdout.write("unknown"); return; }
      const projectPath = process.env.PROJECT_PATH || "";
      const scopeRank = { local: 0, project: 1, user: 2, managed: 3 };
      const mine = rows
        .filter((r) =>
          r?.id === "yellow-claudemod@yellow-plugins" &&
          ((r.scope !== "project" && r.scope !== "local") ||
            (projectPath.length > 0 && r.projectPath === projectPath)))
        .sort((a, b) => (scopeRank[a.scope] ?? 9) - (scopeRank[b.scope] ?? 9));
      process.stdout.write(mine.length === 0 ? "absent" : mine[0].enabled === true ? "enabled" : "disabled");
    });
  ' 2>/dev/null)
  case "$state" in
    enabled)  printf 'installed: yes (enabled)\n' ;;
    disabled) printf 'installed: yes, but DISABLED\n' ;;
    absent)   printf 'installed: not listed by claude plugin list\n' ;;
    *)        printf 'installed: UNKNOWN (could not read claude plugin list --json)\n' ;;
  esac
fi
```

### Step 2: Interpret Results

1. **Version too old or `claude` missing:** stop and say "yellow-claudemod needs
   Claude Code 2.1.301 or later; update with `claude update`."
2. **Not listed:** say the plugin is not installed for this scope and give
   `/plugin install yellow-claudemod@yellow-plugins`.
3. **Disabled:** say the hooks module does not load while the plugin is
   disabled and give `claude plugin enable yellow-claudemod@yellow-plugins`.
4. **Unknown:** say the plugin state could not be read (`node` missing or
   `claude plugin list --json` failed) and continue with the Ready facts.
5. **Ready:** report these facts:
   - Run `/claudemod-status` in a session to see the usage windows, the
     downshift setting and recent subagent spawns. If that command is missing,
     the hooks module did not load: check `claude --debug` for a
     `yellow-claudemod:` line. Managed settings with `allowManagedHooksOnly`
     skip a user plugin's hooks module.
   - The downshift is off by default. Turn it on with the plugin's config
     (`/plugin`, select yellow-claudemod, set "Downshift Opus reviewers near a
     usage limit"), and adjust the threshold there (default 80%).
   - The ledger records every subagent spawn either way.
