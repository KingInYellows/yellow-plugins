---
'yellow-core': patch
'yellow-review': patch
---

Security hardening follow-ups to PR #257:

- yellow-review/commands/review/review-pr.md: pr-context fence now requires literal-delimiter substitution (`[ESCAPED] begin/end pr-context`) BEFORE XML metacharacter escaping. Prevents fence-breakout when a PR diff contains the closing delimiter on its own line (PR #254 pattern).
- yellow-review/commands/review/resolve-pr.md: cluster-comments fence requires the same literal-delimiter substitution for `--- pr context begin/end`, `--- cluster comments begin/end`, and `--- next thread ---`. Prevents fence-breakout from raw GitHub thread text.
- yellow-core/skills/security-fencing/SKILL.md: new "Orchestrator-level fence sanitization" section documents the canonical 2-step sanitization (literal-delimiter substitution → XML escape) for any command that interpolates untrusted external content into a fenced region.
- scripts/validate-plugin.js: validatePathFile and validatePathOrPathsDir now use fs.lstatSync and reject symlinks outright at the top level. Recursive .md counting goes through countMarkdownRecursive (a manual stack walk that skips symlinks at every depth), avoiding fs.readdirSync({ recursive: true }) — which silently follows directory symlinks and would otherwise let .md files inside a symlinked subdirectory slip past the plugin boundary.
- schemas/plugin.schema.json: userConfigEntry.default is now type-constrained via allOf+if/then to match the entry's `type` field. monitor.command description strengthened to require quoting `${user_config.KEY}` substitutions.
- examples/plugin-extended.example.json: monitor command rewritten to drop unsafe `'${user_config.KEY}'` shell interpolation; description teaches the env-var pattern via `${CLAUDE_PLUGIN_OPTION_<KEY>}` and explicitly calls out the unsafe form.
