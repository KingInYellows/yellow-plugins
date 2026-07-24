---
name: ci:setup-runner-targets
description: 'Configure runner pool targets, routing rules, and semantic metadata for CI workflow optimization. Supports interactive wizard, YAML import, and GitHub API discovery. Use when setting up runner-aware CI optimization or after changing your runner fleet.'
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Skill
model: sonnet
---

# Set Up Runner Targets

Configure runner pool definitions, routing rules, and semantic metadata.

## Host binding (Claude Code)

- **Global config:** `${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci/runner-targets.yaml`
- **Per-repo override:** `.claude/yellow-ci-runner-targets.yaml` (repo-local). If
  saving per-repo, advise that `.claude/` is typically gitignored — add
  `!.claude/yellow-ci-runner-targets.yaml` to share it with the team.
- **Import validation:** run `validate_runner_targets_file` from
  `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/validate.sh` against a temp copy of
  imported YAML.
- **Merged routing cache (after write):** source the plugin's resolution library
  and run the merge, which reads the global config plus the per-repo `.claude/`
  override and rewrites the routing-summary + merged-JSON cache:

  ```bash
  SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/hooks/scripts"
  . "${SCRIPT_DIR}/lib/validate.sh"
  . "${SCRIPT_DIR}/lib/resolve-runner-targets.sh"
  resolve_runner_targets
  ```

## Usage

Invoke the `Skill` tool with `skill: "ci-setup-runner-targets"`, treating
`.claude/yellow-ci-runner-targets.yaml` as the per-repo override path and running
the merged-cache regeneration above after the config is written. Pass the args
string `$ARGUMENTS` (literal — substitute the actual argument text the user
provided after the command name, if any) so it reaches the skill.
