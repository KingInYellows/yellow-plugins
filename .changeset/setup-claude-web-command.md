---
'yellow-core': minor
---

feat(yellow-core): add `/setup:claude-web` command

Adds a new command at `plugins/yellow-core/commands/setup/claude-web.md`
that prepares a repository for Claude Code Web (`claude.ai/code`). The web
sandbox has no access to user-scope settings, `claude mcp add` entries, or
locally installed plugins — everything an agent uses must live in the
repository. This command audits and scaffolds the project-scope files
that make a repo cloud-ready.

The command runs in three tiers:

- **Tier 1 (auto-write):** appends missing patterns to `.gitattributes`
  (`* text=auto`, `*.sh eol=lf`) and `.gitignore` (`.env`, `.env.*`,
  `*.pem`, `*.key`, `.aws/`, `.ssh/`, `secrets/`, `credentials/`); fixes
  executable bits via `chmod +x` + `git update-index --chmod=+x` on
  bootstrap scripts referenced by hooks.
- **Tier 2 (AskUserQuestion gate):** scaffolds or merges into
  `.claude/settings.json` (Python-based atomic write mirroring
  `statusline/setup.md`); writes `scripts/install_pkgs.sh` from a
  detected lockfile (pnpm > yarn > npm > uv > pip > cargo > bundler >
  composer > go) with `CLAUDE_CODE_REMOTE=true` gate; writes
  `.github/workflows/claude.yml` using the canonical
  `anthropics/claude-code-action@v1` shape with `@claude`-mention
  triggers across `issue_comment`, `pull_request_review_comment`, and
  `issues` events.
- **Tier 3 (warn-only):** flags STDIO MCP servers, oversized
  `CLAUDE.md`, missing lockfiles, and the
  `permissions.deny`-as-defense-in-depth pattern for sensitive paths.

Re-running on a fully configured repository produces zero writes —
idempotency is enforced via `grep -qF`-before-append for line additions
and append-only Python merge for JSON keys. Includes README + CLAUDE.md
updates (commands count `8 → 9`).
