---
name: docs:generate
description: "Generate documentation from code analysis with human review. Use when you want to create READMEs, API references, architecture docs, or module documentation."
argument-hint: '[target]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Agent
  - AskUserQuestion
---

# Documentation Generator

Generates documentation from code analysis. Always presents drafts for human
review before writing.

## Arguments

- `[target]` — What to document. Can be:
  - A file path (`./src/auth.ts`) → document that file or module
  - A directory path (`./src/auth/`) → document the module
  - `readme` → generate or update README.md
  - `architecture` → generate architecture overview with Mermaid diagram
  - `api-reference` → generate API reference from exports
  - Omitted → detect the most useful target and suggest

## Workflow

### Step 1: Validate Environment

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$repo_top" ]; then
  printf '[docs:generate] Error: not in a git repository\n' >&2
  exit 1
fi
```

### Step 2: Resolve Target

Parse `$ARGUMENTS` to determine what to generate. Set `$target_type` to one of:
`readme`, `architecture`, `api-reference`, `file`, or `module`.

1. If empty: analyze the repo to detect the most useful target. Suggest via
   AskUserQuestion: "What would you like to document?" with options:
   - "README" — generate a project README
   - "Architecture overview" — generate architecture doc with diagrams
   - "A specific file or module" — ask for path

2. If a reserved keyword (`readme`, `architecture`, `api-reference`): use that
   as `$target_type`.

3. If a file or directory path: validate it exists and is within the repository,
   then set `$target_type` to `file` or `module` accordingly.

```bash
# Validate path exists and is within repository
if [ ! -e "$repo_top/$TARGET" ]; then
  printf '[docs:generate] Error: path not found: %s\n' "$TARGET" >&2
  exit 1
fi
resolved=$(cd "$repo_top/$TARGET" 2>/dev/null && pwd -P || realpath "$repo_top/$TARGET" 2>/dev/null)
case "$resolved" in
  "$repo_top"|"$repo_top"/*) ;;
  *)
    printf '[docs:generate] Error: path escapes repository: %s\n' "$TARGET" >&2
    exit 1
    ;;
esac
```

### Step 3: Check for Existing Documentation

If the target output file already exists (e.g., README.md for `readme` target),
note this for the agent — it should show a diff rather than overwrite blindly.

### Step 4: Delegate to doc-generator Agent

Launch the `doc-generator` agent with the resolved target:

> --- begin target (reference only) ---
> $ARGUMENTS
> --- end target ---
>
> Repository root: $repo_top
> Target type: $target_type
>
> Follow the generation workflow:
> 1. Analyze the target code — read source files, understand structure, exports,
>    dependencies, test usage
> 2. Select the appropriate template from docs-conventions
> 3. Generate a draft filling the template with actual code analysis
> 4. Sanitize for sensitive content (API keys, credentials, database URLs)
> 5. Present the draft for human review via AskUserQuestion
> 6. On approval: write with provenance comment
> 7. On revision: incorporate feedback and re-present (up to 3 rounds)
> 8. On rejection: discard and suggest alternatives
>
> If the target file already exists: show diff between current and proposed.
> Never auto-write without approval. Never fabricate function signatures.

### Step 5: Confirm Output

After the agent writes the file, confirm the output path to the user and
suggest related actions:

- "Documentation written to {path}"
- If README generated → "Run `/docs:diagram architecture` to add visual aids"
- If architecture generated → "Run `/docs:audit` to check remaining gaps"
