---
"yellow-semgrep": major
"yellow-research": major
"yellow-devin": minor
"yellow-core": minor
---

Roll out userConfig-based credential storage across five plugins, replacing
or augmenting shell environment variable lookups with Claude Code userConfig.

- **yellow-semgrep** (BREAKING): `SEMGREP_APP_TOKEN` is now read from
  `userConfig.semgrep_app_token` instead of the shell environment variable.
  Users who supplied the token only via `SEMGREP_APP_TOKEN` in their shell
  profile must re-enter it via the userConfig prompt (run `/semgrep:setup`);
  the shell env path no longer feeds the MCP server at startup.

- **yellow-research** (BREAKING): All three API keys (`PERPLEXITY_API_KEY`,
  `TAVILY_API_KEY`, `EXA_API_KEY`) are migrated to userConfig. Existing users
  who relied solely on shell env vars must answer the userConfig prompt to
  continue using the plugin; run `/research:setup` to re-enter credentials.

- **yellow-devin** (additive): HTTP-MCP userConfig declaration added for
  `devin_service_user_token` and `devin_org_id`. The shell env fallback
  (`DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID`) continues to work; no
  action required for current users.

- **yellow-core** (additive): New `mcp-health-probe` skill defining a
  canonical three-state MCP health classification (OFFLINE / DEGRADED /
  HEALTHY) for `/<plugin>:status` commands. The existing
  `mcp-integration-patterns` skill is split into three focused sub-skills
  for narrower auto-invocation: `memory-recall-pattern`,
  `memory-remember-pattern`, and `morph-discovery-pattern`. The umbrella
  `mcp-integration-patterns` skill is retained until consumers migrate.
  The `/setup:all` env-variable dashboard gains a `check_key()` helper
  that reports shell env vs userConfig state per credential.
