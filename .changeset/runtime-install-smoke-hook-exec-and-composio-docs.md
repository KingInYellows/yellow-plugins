---
"yellow-core": patch
"yellow-composio": patch
"yellow-research": patch
---

Make hook scripts executable and correct stale yellow-composio setup docs.

- chmod +x the SessionStart/Stop hook scripts in yellow-core
  (`hooks/scripts/stop.sh`, `hooks/scripts/session-start.sh`), yellow-composio
  (`hooks/check-mcp-url.sh`), and yellow-research
  (`hooks/write-credential-status.sh`). This clears the `claude plugin validate`
  "not executable" warnings and aligns these four with every other hook script
  in the repo (all already executable). The hooks are registered as
  `bash ${CLAUDE_PLUGIN_ROOT}/...sh`, so they already ran regardless — this is a
  warning/consistency cleanup, not a behavior change.
- yellow-composio: fix `commands/composio/setup.md`, which still claimed the
  `userConfig` fields were `required: true`. They are not (the flag was removed
  per claude-code#39827, which does not block install/enable). The
  `bin/start-composio.sh` wrapper's non-zero exit on empty values is the actual
  safeguard. The troubleshooting prose now matches the plugin manifest and
  CLAUDE.md.
