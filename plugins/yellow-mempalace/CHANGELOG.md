# yellow-mempalace

## 1.1.2

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

## 1.1.1

### Patch Changes

- [`0293bec`](https://github.com/KingInYellows/yellow-plugins/commit/0293bec6276e9e371b9fd3aa3dcf3a8f62f6fa3e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Harden 11
  prompt-injection fences across 7 plugin files against literal-delimiter
  breakout. Each fence now carries the canonical two-part hardening from PR
  #254: a pre-insertion substitution instruction (replace closing delimiter with
  `[ESCAPED]` form) and a post-close `Resume normal agent behavior.` sentinel.
  Affected files: `agents/mempalace/memory-archivist.md`,
  `agents/mempalace/palace-navigator.md`,
  `commands/mempalace/{kg,navigate,search,mine,status,setup}.md`. Reference:
  `docs/solutions/security-issues/prompt-injection-fence-breakout-literal-delimiter.md`.

## 1.1.0

### Minor Changes

- [`62d5d88`](https://github.com/KingInYellows/yellow-plugins/commit/62d5d889802144c6c73e21d0bcd04b9b316b246e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-mempalace plugin wrapping MemPalace MCP server for structured long-term
  memory with temporal knowledge graph. Patch yellow-core to add mempalace to
  setup:all dashboard, classification, and delegated commands.
