### Phase 3: Generate Convention File

#### Step 9: Check for Existing .graphite.yml

Determine the repo root and check for an existing convention file:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
[ -f "$repo_top/.graphite.yml" ] && printf 'EXISTS\n' || printf 'NOT_FOUND\n'
```

**If the file exists**, read it and show the current contents. Then use
`AskUserQuestion`:

- `"Update with new values"` — overwrite with wizard-generated values
- `"Skip"` — keep the existing file unchanged

**If the file exists but is malformed YAML** (read fails or structure is
unexpected), warn the user and use `AskUserQuestion`:

- `"Overwrite with valid configuration"` — replace entirely
- `"Skip"` — keep the broken file as-is

**If the file does not exist**, proceed to Step 10.

If the user chose "Skip", jump to Step 11.

#### Step 10: Generate .graphite.yml

Build the convention file content using values from Phase 2 (branch prefix from
Step 5) and sensible defaults. Use the Write tool to create the file at
`<repo_root>/.graphite.yml`.

The file content:

```yaml
# gt-workflow convention file — read by smart-submit, gt-stack-plan, gt-amend, gt-setup
# This is NOT a Graphite CLI feature. It is a gt-workflow plugin convention.
# Docs: https://github.com/KingInYellows/yellow-plugins/tree/main/plugins/gt-workflow

submit:
  draft: false
  merge_when_ready: false
  restack_before: true

audit:
  agents: 3
  skip_on_draft: false

branch:
  prefix: '<prefix-from-step-5-or-empty>'

pr_template:
  create: true
```

Substitute the actual branch prefix chosen in Step 5. If the user skipped the
prefix, use an empty string: `prefix: ""`.

After writing, fix CRLF line endings (WSL2 safety):

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
sed -i 's/\r$//' "$repo_top/.graphite.yml" 2>/dev/null || \
  sed -i '' 's/\r$//' "$repo_top/.graphite.yml" 2>/dev/null || \
  printf '[gt-workflow] Warning: could not strip CRLF from .graphite.yml\n' >&2
```

#### Step 11: PR Template

First, if `.graphite.yml` was loaded in Step 9 and `pr_template.create` is
`false`, skip this step entirely and note "PR template: skipped
(pr_template.create is false in .graphite.yml)" in the final report.

Otherwise, check for an existing PR template:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
[ -f "$repo_top/.github/pull_request_template.md" ] && printf 'EXISTS\n' || printf 'NOT_FOUND\n'
```

**If the template exists**, use `AskUserQuestion`:

- `"View current template"` — show contents, then re-prompt with Regenerate/Skip
- `"Regenerate"` — overwrite with the agent-optimized template
- `"Skip"` — keep existing

**If the template does not exist**, create `.github/` directory if needed and
write the template using the Write tool:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
mkdir -p "$repo_top/.github"
```

Template content:

```markdown
## Summary

<!-- 2-3 bullet points of what this PR does -->

## Stack context

<!-- What branch is below this one and why (critical for stack reviewers) -->

## Test plan

<!-- What was verified before submit -->

## Notes for reviewers

<!-- Anything the author wants to call attention to -->
```

After writing, fix CRLF:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
sed -i 's/\r$//' "$repo_top/.github/pull_request_template.md" 2>/dev/null || \
  sed -i '' 's/\r$//' "$repo_top/.github/pull_request_template.md" 2>/dev/null || \
  printf '[gt-workflow] Warning: could not strip CRLF from PR template\n' >&2
```

#### Step 12: Final Report

Show the complete setup summary:

```text
gt-workflow Setup Complete
──────────────────────────
Phase 1: Validation         PASSED
Phase 2: Graphite Settings  5/5 configured
Phase 3: Convention File    .graphite.yml created
         PR Template        .github/pull_request_template.md created

Consumer skills (smart-submit, gt-stack-plan, gt-amend) will read
.graphite.yml for repo-level behavior overrides.

Next steps:
  - Review and commit .graphite.yml and .github/pull_request_template.md
  - Run smart-submit or gt-sync to verify your workflow
```

Adjust the summary to reflect actual outcomes (skipped items, partial
configuration, existing files kept, etc.).
