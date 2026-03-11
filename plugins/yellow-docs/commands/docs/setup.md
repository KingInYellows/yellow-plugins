---
name: docs:setup
description: "Validate docs plugin prerequisites and detect project structure. Use when first installing the plugin or when docs commands fail."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Glob
  - AskUserQuestion
---

# Set Up yellow-docs

Validate the required local tooling and detect project structure. This command
does not write any files.

## Workflow

### Step 1: Check Prerequisites

Run a single Bash call:

```bash
printf '=== Prerequisites ===\n'
for cmd in git; do
  command -v "$cmd" >/dev/null 2>&1 && printf '%-12s ok\n' "${cmd}:" || printf '%-12s NOT FOUND\n' "${cmd}:"
done

printf '\n=== Repository ===\n'
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$repo_top" ] && printf 'git_repo:     ok\n' || printf 'git_repo:     NOT A GIT REPOSITORY\n'

if [ -n "$repo_top" ]; then
  printf '\n=== Project Detection ===\n'
  [ -f "$repo_top/.claude-plugin/plugin.json" ] && printf 'type:         Claude Code plugin\n'
  [ -f "$repo_top/Cargo.toml" ] && printf 'type:         Rust (Cargo.toml)\n'
  [ -f "$repo_top/pyproject.toml" ] && printf 'type:         Python (pyproject.toml)\n'
  [ -f "$repo_top/setup.py" ] && printf 'type:         Python (setup.py)\n'
  [ -f "$repo_top/go.mod" ] && printf 'type:         Go (go.mod)\n'
  [ -f "$repo_top/package.json" ] && [ -f "$repo_top/tsconfig.json" ] && printf 'type:         TypeScript (package.json + tsconfig.json)\n'
  [ -f "$repo_top/package.json" ] && [ ! -f "$repo_top/tsconfig.json" ] && printf 'type:         JavaScript (package.json)\n'

  printf '\n=== Monorepo Detection ===\n'
  [ -f "$repo_top/pnpm-workspace.yaml" ] && printf 'workspace:    pnpm workspaces\n'
  [ -f "$repo_top/go.work" ] && printf 'workspace:    Go workspace\n'
  # Check for workspaces field in package.json
  if [ -f "$repo_top/package.json" ]; then
    grep -q '"workspaces"' "$repo_top/package.json" 2>/dev/null && printf 'workspace:    npm/yarn workspaces\n'
  fi
  if [ -f "$repo_top/Cargo.toml" ]; then
    grep -q '\[workspace\]' "$repo_top/Cargo.toml" 2>/dev/null && printf 'workspace:    Rust workspace\n'
  fi

  printf '\n=== Existing Doc Tooling ===\n'
  [ -f "$repo_top/mkdocs.yml" ] && printf 'tooling:      MkDocs\n'
  [ -f "$repo_top/docs/conf.py" ] && printf 'tooling:      Sphinx\n'
  [ -f "$repo_top/typedoc.json" ] && printf 'tooling:      TypeDoc\n'
  [ -f "$repo_top/.readthedocs.yml" ] && printf 'tooling:      ReadTheDocs\n'
  [ -f "$repo_top/docusaurus.config.js" ] && printf 'tooling:      Docusaurus\n'
  [ -f "$repo_top/book.toml" ] && printf 'tooling:      mdBook\n'

  printf '\n=== Documentation Files ===\n'
  doc_count=$(find "$repo_top" -maxdepth 3 -name '*.md' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | wc -l)
  printf 'markdown:     %d files found\n' "$doc_count"
  [ -f "$repo_top/README.md" ] && printf 'readme:       present\n' || printf 'readme:       MISSING\n'
  [ -d "$repo_top/docs" ] && printf 'docs/:        present\n' || printf 'docs/:        missing\n'
fi
```

### Step 2: Interpret Results

1. **Hard prerequisites** — `git` must be installed and repo must be a git
   repository. If either fails, stop: "yellow-docs requires git and a git
   repository."

2. **Project detection** — Report all detected project types. If none detected,
   warn: "No project type detected. yellow-docs will use file-structure-only
   analysis."

3. **Summary** — Report overall readiness:
   - "yellow-docs is ready. Run `/docs:audit` to scan for documentation gaps."
   - If no README found: "Tip: Run `/docs:generate readme` to create a README."
