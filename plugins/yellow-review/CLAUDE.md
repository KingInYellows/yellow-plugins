# yellow-review Plugin

Multi-agent PR review with adaptive agent selection, parallel comment resolution, and sequential stack review. Graphite-native workflow.

## Conventions

- Use Graphite (`gt`) for all branch management and PR creation — never raw `git push` or `gh pr create`
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Agents report findings — they do NOT edit files directly
- Orchestrating commands apply fixes sequentially to avoid conflicts
- All shell scripts follow POSIX security patterns (quoted variables, input validation, `set -euo pipefail`)

## Plugin Components

_Component inventory will be finalized after all phases are complete._
