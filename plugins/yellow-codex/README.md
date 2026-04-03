# yellow-codex

OpenAI Codex CLI wrapper with review, rescue, and analysis agents for
workflow integration. Codex runs as a supplementary AI agent, providing
independent code review, debugging/rescue capabilities, and codebase research.

## Install

```text
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-codex@yellow-plugins
```

## Prerequisites

- **Codex CLI** (`codex`) v0.118.0+ via `npm install -g @openai/codex`,
  `brew install --cask codex`, or GitHub Releases (requires Node 22+)
- **Authentication** -- `OPENAI_API_KEY` env var or `codex login` OAuth

Run `/codex:setup` after install to detect the CLI, verify auth, and
install if needed.

## Commands

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `/codex:setup`   | Detect CLI, verify auth, install if needed               |
| `/codex:review`  | Invoke Codex review on diff/PR, structured P1/P2/P3 output |
| `/codex:rescue`  | Delegate debugging task to Codex with user approval gate |
| `/codex:status`  | Check Codex processes, sessions, and configuration       |

## Agents

| Agent            | Category | Description                                        |
| ---------------- | -------- | -------------------------------------------------- |
| `codex-reviewer` | Review   | Supplementary reviewer spawned by `review:pr`      |
| `codex-executor` | Workflow | Rescue/debug agent spawned on task failure         |
| `codex-analyst`  | Research | Codebase research and analysis                     |

## Skills

| Skill            | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `codex-patterns` | CLI invocation patterns, output parsing, security conventions |

## Cross-Plugin Dependencies

| Dependency     | Purpose                                      | Required? |
| -------------- | -------------------------------------------- | --------- |
| yellow-review  | Spawns `codex-reviewer` during PR review     | Optional  |
| yellow-core    | Spawns `codex-executor` on task failure      | Optional  |

Codex is an enhancement, never a dependency. All existing workflows function
identically without `yellow-codex` installed.

## Limitations

- Large diffs (>128K tokens) cause hard errors -- no built-in truncation
- Codex CLI is actively evolving (v0.118.0+) -- flags may change
- Each invocation uses OpenAI API tokens; concurrent use may trigger rate limits
- `--output-schema` may be ignored with certain model variants

## License

MIT