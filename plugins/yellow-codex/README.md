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

- **Codex CLI** (`codex`) v0.140.0+, a standalone binary: install via
  `curl -fsSL https://chatgpt.com/codex/install.sh | sh` (macOS/Linux), the
  PowerShell installer `irm https://chatgpt.com/codex/install.ps1 | iex`
  (Windows), `brew install --cask codex`, or GitHub Releases. No Node.js
  required.
- **Authentication** -- `OPENAI_API_KEY` env var or `codex login` OAuth

Run `/codex:setup` after install to detect the CLI, verify auth, and
install if needed.

## Model Selection

No command passes `-m` by default. Codex resolves the model in this order:

1. `CODEX_MODEL` environment variable, if set (every `codex exec` site
   forwards it as `-m "$CODEX_MODEL"`).
2. The `model` key in `~/.codex/config.toml`.
3. Your account's default.

`CODEX_SMOKE_MODEL` is separate: it forces a model for `/codex:setup`'s
smoke test only and is retried without it if the API refuses.

If a command reports `Codex rejected model <name>`, the API returned HTTP
400 for that model name — typically a legacy `gpt-5.4`/`gpt-5.4-mini` or a
`gpt-5.x-codex` name under ChatGPT-account auth. Set `CODEX_MODEL` to a
model your account allows, or unset it (and remove the `model` key from
`~/.codex/config.toml`) to fall back to the account default.

## Commands

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `/codex:setup`   | Detect CLI, verify auth, install if needed               |
| `/codex:review`  | Invoke Codex review on diff/PR, structured P1/P2/P3 output |
| `/codex:rescue`  | Delegate debugging task to Codex with user approval gate |
| `/codex:status`  | Check Codex processes, sessions, and configuration       |

## Agents

| Agent            | Category | Description                                                       |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `codex-reviewer` | Review   | Supplementary reviewer spawned by `/review:pr` and `/council`; returns the structured 6-key contract |
| `codex-executor` | Workflow | Rescue/debug agent spawned on task failure                        |
| `codex-analyst`  | Research | Codebase research and analysis                                    |

## Skills

| Skill            | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `codex-patterns` | CLI invocation patterns, output parsing, security conventions |

## Cross-Plugin Dependencies

| Dependency     | Purpose                                                     | Required? |
| -------------- | ------------------------------------------------------------ | --------- |
| yellow-review  | Spawns `codex-reviewer` during PR review                      | Optional  |
| yellow-council | Spawns `codex-reviewer` as a cross-lineage council reviewer   | Optional  |
| yellow-core    | Spawns `codex-executor` on task failure                       | Optional  |

Codex is an enhancement, never a dependency. All existing workflows function
identically without `yellow-codex` installed.

## Limitations

- Large diffs (>128K tokens) cause hard errors -- no built-in truncation
- Codex CLI is actively evolving (v0.140.0+) -- flags may change
- Each invocation uses OpenAI API tokens; concurrent use may trigger rate limits
- `--output-schema` is silently ignored by the `codex exec review` subcommand
  on every model -- use plain `codex exec` when structured JSON is required

## License

MIT