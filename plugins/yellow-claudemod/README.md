# yellow-claudemod

A Claude Code mod (experimental). It records which model every subagent runs on,
and can move listed Opus-tier reviewers to Sonnet when a Max usage window is
nearly spent.

Claude Code only, 2.1.301 or later. Codex, Cursor and Jules builds have no
equivalent, so nothing else in the marketplace depends on it.

## Install

```text
/plugin install yellow-claudemod@yellow-plugins
```

Then run `/claudemod:setup` to check the Claude Code version.

## What it does

- **Spawn ledger (always on).** Each Agent-tool or workflow subagent spawn is
  recorded: agent, plugin, the model the caller asked for, the model it ran on,
  the parent's model and the fullest usage window at that moment. Each session
  keeps its last 500 rows under its own key in the mod's store, so concurrent
  sessions never overwrite each other; the eight most recent sessions are kept.
- **Usage downshift (off by default).** With `downshift_enabled` on, these
  agents run on Sonnet once the fullest rate-limit window (`five_hour` or
  `seven_day`) reaches `downshift_threshold` percent (default 80):
  - yellow-core: architecture-strategist, performance-oracle
  - yellow-review: adversarial-reviewer, agent-cli-readiness-reviewer,
    agent-native-reviewer, thermonuclear-reviewer
  - yellow-debt: audit-synthesizer
  - yellow-research: research-conductor

  security-sentinel is never downshifted. Neither is a fork, a resumed agent, or
  a call that names its own model. Effort stays at the agent's frontmatter
  value. The first downshift in a session shows a toast.

- **`/claudemod-status [rows]`** prints the usage windows, the downshift
  setting, model counts across the ledger and its last rows (default 10). It
  also says when the session's last ledger write failed or timed out.

Change the two settings with `/plugin` (select yellow-claudemod).

## Notes

- The mod runs in-process and unsandboxed, like any Claude Code mod. Managed
  settings with `allowManagedHooksOnly` skip it.
- Usage windows come from the last API response. Off a subscription there are
  none, so the downshift never triggers.
- The mod API is early access and changes between Claude Code releases.
