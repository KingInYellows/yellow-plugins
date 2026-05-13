---
'yellow-core': minor
---

docs(yellow-core): multi-host-fleet skill + userConfig required-vs-startup solution doc

Adds the user-facing reference for replicating yellow-plugins credentials
across a fleet (workstations, CI, devcontainers, ephemeral sandboxes)
without per-host userConfig prompt cycles.

- `plugins/yellow-core/skills/multi-host-fleet/SKILL.md` — canonical
  env-var contract table for every credential-bearing plugin
  (yellow-research, yellow-morph, yellow-semgrep, yellow-composio,
  yellow-devin), with patterns for dotfiles/direnv, GitHub Actions /
  GitLab CI / devcontainers, and tool-agnostic secrets managers
  (1Password CLI, Vault envconsul, Doppler). User-invokable skill:
  `/multi-host-fleet`.
- `docs/solutions/build-errors/userconfig-required-fires-at-startup-not-install.md`
  — solution doc explaining why `required: true` on userConfig fields
  does NOT block install (it surfaces at MCP startup, per Claude Code
  bug #39827) and the wrapper-script pattern that should be used
  instead.

This closes the "no multi-host story" gap reported by users running
plugins on multiple hosts. The 3-element fallback wrapper pattern
introduced in the foundation PR is now discoverable end-to-end.
