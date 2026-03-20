# Feature: Improve gt-setup with AI Agent Configuration Wizard

## Problem Statement

### Current Pain Points

The current `/gt-setup` is a read-only validator (124 lines). It checks whether
`gt` is installed, authenticated, and repo-initialized, then reports pass/fail.
It configures nothing and creates nothing.

For AI agents operating across many repos, three gaps exist:

1. **No AI-agent-aware Graphite settings.** Default `gt user` settings are
   designed for humans: branch dates on, no prefix, PR bodies exclude commit
   messages, pager enabled (hangs non-interactive runs).
2. **No repo-level override mechanism.** `smart-submit`, `gt-stack-plan`, and
   `gt-amend` have hardcoded behaviors (3 audit agents, always non-draft, inline
   branch naming). Teams cannot configure these per repo.
3. **No PR template for stacked PRs.** Graphite reads
   `.github/pull_request_template.md` for PR body pre-fill. No template exists
   in most repos.

### Background: `.graphite.yml` Is Our Convention

ChatGPT suggested a `.graphite.yml` with `guards`, `stack.submit.restack`, and
`stack.diff.context_lines`. After verifying the Graphite CLI v1.8.2 binary, live
docs, and GitHub code search: **none of those keys exist**. Graphite CLI has no
`.graphite.yml` file. The actual config surface is two JSON files
(`~/.config/graphite/user_config` and `.git/.graphite_repo_config`) plus `gt
user`/`gt config` CLI commands.

The `.graphite.yml` we create is a **gt-workflow convention file** — clearly
documented as such, committed to the repo, and read by gt-workflow commands only.

### Who Benefits

- AI agents running gt-workflow commands across multiple repositories
- Teams standardizing Graphite behavior for agent-driven development
- Developers onboarding to repos with agent-generated stacked PRs

## Key Decisions (Resolved)

| Decision | Answer | Rationale |
|---|---|---|
| `branch.prefix` precedence | Repo-level `.graphite.yml` wins | Teams share one prefix per repo; portable |
| Pager disable handling | AskUserQuestion (M3 pattern) | User-global, irreversible without manual reset |
| Consumer command changes | In scope (full feature) | Convention file must have runtime value immediately |
| Branch prefix + type interaction | Prepend: `agent/feat/ENG-123-foo` | Keeps conventional type visible; agents get namespace |

## Proposed Solution

Expand `/gt-setup` from a validation-only command into a 3-phase wizard:

1. **Phase 1** — Existing validation (unchanged)
2. **Phase 2** — Guided Graphite CLI settings wizard (5 settings via `gt user`)
3. **Phase 3** — Convention file + PR template generation

Update consumer commands (`smart-submit`, `gt-stack-plan`, `gt-amend`) to read
`.graphite.yml` with `yq` (kislyuk variant), falling back to current hardcoded
defaults when file or keys are absent.

## Implementation Plan

### Phase 1: gt-setup Command Expansion

#### 1.1: Add `allowed-tools` and update frontmatter

**File:** `plugins/gt-workflow/commands/gt-setup.md`

Current `allowed-tools: [Bash]`. Add: `AskUserQuestion`, `Write`, `Read`, `Bash`.
Update description to reflect new capabilities.

#### 1.2: Phase 2 — Graphite Settings Wizard

Insert after existing Step 3 (Report). New sections:

**Step 4: Pre-prompt summary.** Before any settings are applied, show the user
all 5 planned changes and their current vs proposed values:

```bash
# Read current gt user settings
gt_prefix=$(gt user branch-prefix 2>/dev/null || echo "(not set)")
gt_date=$(gt user branch-date 2>/dev/null || echo "(unknown)")
gt_restack=$(gt user restack-date 2>/dev/null || echo "(unknown)")
gt_submit_body=$(gt user submit-body 2>/dev/null || echo "(unknown)")
gt_pager=$(gt user pager 2>/dev/null || echo "(unknown)")
```

Display summary table of current vs AI-agent-recommended values.

**Step 5: Branch prefix prompt.** Use `AskUserQuestion` with options:
- `"agent/" (Recommended)` — flat namespace for agent branches
- `"<inferred-username>/"` — scoped per user (derive from `git config user.name`
  or `gh api user -q .login`)
- `"Other"` — free-text input (only button that opens free-text field)

**Branch prefix validation (before passing to `gt user`):**
- Allowed characters: `[a-z0-9/_-]` only
- Reject path traversal: `..`, `~`
- Normalize: append trailing `/` if missing
- Max length: 20 characters
- Empty string: skip setting (keep current)
- Use `printf '%s'` not inline substitution (user-supplied text in shell)

**Step 6: Pager prompt.** Use `AskUserQuestion` with options:
- `"Disable pager (Recommended for AI agents)"` — runs
  `gt user pager --disable`
- `"Keep current pager setting"` — no change

If pager is disabled, include reversal instructions in the summary:
`"To re-enable: gt user pager --enable"`

**Step 7: Apply settings.** Apply the 4 non-prompted settings silently:
- `gt user branch-date --disable`
- `gt user restack-date --use-author-date`
- `gt user submit-body --include-commit-messages`
- Branch prefix (from Step 5 answer)

Plus pager (from Step 6 answer) if user chose to disable.

**Failure handling:** If any `gt user` command fails:
- Record the error output
- Continue applying remaining settings (do not stop on first failure)
- After all commands, show summary: "Applied" / "Already set" / "Failed
  (error)" / "Skipped"
- Offer via `AskUserQuestion`: "Retry failed settings" or "Continue with
  partial configuration"

**Step 8: Settings summary report.** Show all 5 settings with final status.

#### 1.3: Phase 3 — Convention File Generation

**Step 9: Check for existing `.graphite.yml`.** Read if exists.

- If exists and valid YAML: show current contents, offer `AskUserQuestion`:
  "Update with new values", "Show diff", "Skip"
- If exists and malformed YAML: warn, offer "Overwrite" or "Skip"
- If does not exist: proceed to generation

**Step 10: Generate `.graphite.yml`.** Build YAML content with values from
Phase 2 answers + sensible defaults:

```yaml
# gt-workflow convention file — read by smart-submit, gt-stack-plan, gt-amend
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
  prefix: "agent/"

pr_template:
  create: true
```

- Validate `audit.agents` is 1-3 at write time
- Write atomically: write to temp file, validate with `yq empty`, rename
- Fix CRLF on WSL2: `sed -i 's/\r$//' .graphite.yml` after write

**Step 11: PR template.** Check for `.github/pull_request_template.md`:

- If exists: show "View", "Regenerate", "Skip" via `AskUserQuestion`
- If `.github/` directory missing: create it first (`mkdir -p .github`)
- If `pr_template.create` is `false` in `.graphite.yml`: skip silently, note
  in summary

Generated template content:

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

- Fix CRLF after write: `sed -i 's/\r$//' .github/pull_request_template.md`

#### 1.4: Idempotent Re-run Behavior

- Phase 1: re-validates, reports current status (no change)
- Phase 2: reads current `gt user` settings. Only prompts for settings that
  differ from AI-agent defaults. Shows "already configured" for matching ones.
- Phase 3: if `.graphite.yml` exists, "Show diff" compares current file values
  vs what the wizard would generate (key-by-key comparison, not raw file diff).
  "Update" overwrites. "Skip" keeps current.
- PR template: if exists, "Regenerate" overwrites, "Skip" keeps current.

### Phase 2: Consumer Command Updates

#### 2.1: Shared YAML parsing pattern

All three consumer commands use the same parsing block at the top. Define the
canonical pattern here (each command inlines it, no shared file):

```bash
# --- .graphite.yml convention file parsing ---
REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
GW_DRAFT=""
GW_MERGE_WHEN_READY=""
GW_RESTACK_BEFORE=""
GW_AUDIT_AGENTS=""
GW_SKIP_ON_DRAFT=""
GW_BRANCH_PREFIX=""

if command -v yq >/dev/null 2>&1 && \
   yq --help 2>&1 | grep -qi 'jq wrapper\|kislyuk' && \
   [ -f "$REPO_TOP/.graphite.yml" ]; then
  GW_DRAFT=$(yq -r '.submit.draft // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null || true)
  GW_MERGE_WHEN_READY=$(yq -r '.submit.merge_when_ready // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null || true)
  GW_RESTACK_BEFORE=$(yq -r '.submit.restack_before // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null || true)
  GW_AUDIT_AGENTS=$(yq -r '.audit.agents // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null || true)
  GW_SKIP_ON_DRAFT=$(yq -r '.audit.skip_on_draft // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null || true)
  GW_BRANCH_PREFIX=$(yq -r '.branch.prefix // ""' "$REPO_TOP/.graphite.yml" 2>/dev/null || true)
elif [ -f "$REPO_TOP/.graphite.yml" ]; then
  printf '[gt-workflow] Warning: .graphite.yml exists but yq (kislyuk) is not installed. Using defaults.\n' >&2
fi
# --- end convention file parsing ---
```

**Runtime warning:** When `.graphite.yml` exists but `yq` is missing, consumers
warn to stderr. This prevents the silent-defaults trap where a user sets
`submit.draft: true` but gets live PRs because yq isn't installed.

#### 2.2: Update `smart-submit.md`

**File:** `plugins/gt-workflow/commands/smart-submit.md`

Changes:
- Add `yq` parsing block (from 2.1) at the start of Phase 1
- **Phase 2 audit agent count:** Replace hardcoded 3-agent spawn with
  `$GW_AUDIT_AGENTS` (default 3 if empty, clamp to 1-3 range)
- **Phase 2 skip-on-draft:** If `$GW_SKIP_ON_DRAFT` is `true` and `--draft`
  flag is used, skip the audit phase entirely
- **Phase 3 branch naming:** When on trunk and creating new branch via
  `gt create`, prepend `$GW_BRANCH_PREFIX` to the generated branch name:
  `gt create "${GW_BRANCH_PREFIX}feat/slug" -m "message"`
- **Phase 4 submit flags:** Add `--draft` if `$GW_DRAFT` is `true`.
  Add `--merge-when-ready` if `$GW_MERGE_WHEN_READY` is `true`.
  Add `--restack` before submit if `$GW_RESTACK_BEFORE` is `true`.

#### 2.3: Update `gt-stack-plan.md`

**File:** `plugins/gt-workflow/commands/gt-stack-plan.md`

Changes:
- Add `yq` parsing block (from 2.1) at the start of Phase 1
- **Phase 2 branch naming:** When generating branch names in the stack plan,
  prepend `$GW_BRANCH_PREFIX` to each branch name. Example: if
  `branch.prefix: "agent/"` and planned branch is `feat/ENG-123-foo`, output
  `agent/feat/ENG-123-foo` in the decomposition.
- Update the `## Stack Decomposition` output to use prefixed branch names

#### 2.4: Update `gt-amend.md`

**File:** `plugins/gt-workflow/commands/gt-amend.md`

Changes:
- Add `yq` parsing block (from 2.1) at the start of Phase 1
- **Phase 2 audit agent count:** Replace hardcoded 3-agent spawn with
  `$GW_AUDIT_AGENTS` (default 3 if empty, clamp to 1-3 range)
- **Phase 2 skip-on-draft:** If `$GW_SKIP_ON_DRAFT` is `true` and current
  branch PR is in draft state, skip the audit phase

### Phase 3: setup:all Integration

#### 3.1: Update setup:all classification

**File:** `plugins/yellow-core/commands/setup/all.md`

Changes:
- Add `.graphite.yml` check to the `=== Config Files ===` bash section
- Add `.github/pull_request_template.md` check to the same section
- Update the gt-workflow classification to include a PARTIAL state:
  - READY: existing conditions AND `.graphite.yml` present
  - PARTIAL: existing conditions pass but `.graphite.yml` missing
  - NEEDS SETUP: existing hard-stop conditions not met

### Phase 4: Testing & Documentation

#### 4.1: Manual testing checklist

- [ ] Fresh setup: no `.graphite.yml`, no PR template — full wizard runs
- [ ] Re-run: `.graphite.yml` exists with matching values — shows "already
  configured", offers Skip
- [ ] Re-run: `.graphite.yml` exists with different values — shows diff, offers
  Update
- [ ] Re-run: malformed `.graphite.yml` — warns, offers Overwrite
- [ ] `gt user` command failure mid-wizard — shows partial summary, offers retry
- [ ] Branch prefix validation: rejects `../../etc`, spaces, empty string
- [ ] Branch prefix with trailing `/` — normalized correctly
- [ ] Pager prompt: disable → verify `gt user pager` reflects change
- [ ] Pager prompt: keep → verify no change
- [ ] `smart-submit` reads `submit.draft: true` — creates draft PR
- [ ] `smart-submit` reads `audit.agents: 1` — spawns 1 agent instead of 3
- [ ] `smart-submit` reads `branch.prefix: "agent/"` — branch name starts with
  `agent/`
- [ ] `gt-stack-plan` reads `branch.prefix` — decomposition uses prefixed names
- [ ] `gt-amend` reads `audit.agents: 2` — spawns 2 agents
- [ ] `yq` missing + `.graphite.yml` exists — consumers warn to stderr, use
  defaults
- [ ] `yq` missing — gt-setup Phase 3 still generates file with warning
- [ ] WSL2: generated files have LF line endings (no CRLF)
- [ ] `setup:all` shows `.graphite.yml` in config files section
- [ ] `setup:all` classification reflects PARTIAL when `.graphite.yml` missing

#### 4.2: Update gt-workflow CLAUDE.md

Add documentation about `.graphite.yml` convention file:
- Schema reference
- Which commands read which keys
- Fallback behavior when file/keys are absent
- `yq` dependency note

#### 4.3: Update gt-workflow README.md

Add section describing the convention file and the improved setup experience.

## Technical Specifications

### Files to Modify

| File | Changes |
|---|---|
| `plugins/gt-workflow/commands/gt-setup.md` | Expand from 124 to ~280 lines: add Phase 2 (wizard) + Phase 3 (convention file + PR template) |
| `plugins/gt-workflow/commands/smart-submit.md` | Add yq parsing block (~20 lines), wire `draft`, `merge_when_ready`, `restack_before`, `audit.agents`, `skip_on_draft`, `branch.prefix` |
| `plugins/gt-workflow/commands/gt-stack-plan.md` | Add yq parsing block (~15 lines), wire `branch.prefix` to branch naming |
| `plugins/gt-workflow/commands/gt-amend.md` | Add yq parsing block (~15 lines), wire `audit.agents`, `skip_on_draft` |
| `plugins/yellow-core/commands/setup/all.md` | Add `.graphite.yml` and PR template checks, add PARTIAL classification |
| `plugins/gt-workflow/CLAUDE.md` | Add `.graphite.yml` schema docs, consumer command mapping |
| `plugins/gt-workflow/README.md` | Add convention file section |

### Files to Create

| File | Purpose |
|---|---|
| `.github/pull_request_template.md` | PR template for stacked PRs (generated by gt-setup, committed to repo) |
| `.graphite.yml` | Convention file (generated by gt-setup, committed to repo) |

### Dependencies

- `yq` (kislyuk variant, `pip install yq`) — for YAML parsing in consumer
  commands. Already used by `yellow-debt` plugin. Falls back to defaults when
  absent.

## `.graphite.yml` Schema Reference

```yaml
# gt-workflow convention file
# NOT a Graphite CLI feature — read by gt-workflow plugin commands only

submit:
  draft: false              # boolean — submit PRs as draft (default: false)
  merge_when_ready: false   # boolean — auto-merge when CI passes (default: false)
  restack_before: true      # boolean — restack before every submit (default: true)

audit:
  agents: 3                 # integer 1-3 — parallel audit agents (default: 3)
  skip_on_draft: false      # boolean — skip audit when submitting as draft (default: false)

branch:
  prefix: ""                # string — prepended to branch names (default: "")
                            # repo-level setting; overrides gt user branch-prefix

pr_template:
  create: true              # boolean — whether gt-setup should create PR template (default: true)
```

**Precedence:** `branch.prefix` in `.graphite.yml` overrides `gt user
branch-prefix`. Consumer commands check `.graphite.yml` first, fall back to
Graphite CLI's global setting only when the key is absent or empty.

**Validation:** `audit.agents` must be 1-3. Values outside this range are
clamped to the nearest bound (0 → 1, 5 → 3) with a stderr warning.

## Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| `gt user` command fails mid-wizard | Stop, show partial summary with Applied/Failed/Skipped, offer retry |
| Branch prefix contains `..` or `~` | Reject with error message, re-prompt |
| Branch prefix contains spaces or special chars | Reject (allow only `[a-z0-9/_-]`), re-prompt |
| `.graphite.yml` exists but is malformed YAML | Warn, offer Overwrite or Skip |
| `.graphite.yml` exists with `pr_template.create: false` | Skip PR template phase silently, note in summary |
| `yq` missing + `.graphite.yml` exists | Consumer commands warn to stderr, use hardcoded defaults |
| `yq` missing during gt-setup Phase 3 | Generate file anyway with warning about yq needed for consumers |
| `.github/` directory missing | `mkdir -p .github` before writing PR template |
| `audit.agents` set to 0 or > 3 | Clamp to 1-3 range with stderr warning in consumer commands |
| CRLF on WSL2 | `sed -i 's/\r$//'` after every file write |
| Phase 2 partially applied, user cancels | Summary shows which settings were applied; re-run detects current state |
| Non-interactive context (CI) | Not in scope — command is interactive-only. Document this limitation. |

## Security Considerations

- **Branch prefix injection:** User-supplied prefix is validated against
  `[a-z0-9/_-]` regex before passing to `gt user branch-prefix --set`. Use
  `printf '%s'` not inline substitution.
- **YAML injection via prefix:** Branch prefix written to `.graphite.yml` as a
  quoted YAML scalar to prevent injection of additional YAML keys.
- **Path traversal:** Reject `..`, `~`, absolute paths in branch prefix.
- **File writes:** Atomic write pattern (temp file → validate → rename) for
  `.graphite.yml`.

## Acceptance Criteria

1. `/gt-setup` validates prerequisites (existing behavior preserved)
2. `/gt-setup` configures 5 Graphite CLI settings via guided wizard with M3
   confirmation for branch prefix and pager
3. `/gt-setup` generates `.graphite.yml` with documented schema
4. `/gt-setup` generates `.github/pull_request_template.md` for stacked PRs
5. `/smart-submit` reads `.graphite.yml` for draft, merge-when-ready, restack,
   audit agent count, skip-on-draft, and branch prefix
6. `/gt-stack-plan` reads `.graphite.yml` for branch prefix
7. `/gt-amend` reads `.graphite.yml` for audit agent count and skip-on-draft
8. All consumer commands warn when `.graphite.yml` exists but `yq` is missing
9. All consumer commands fall back to current defaults when `.graphite.yml` is
   absent
10. Re-running `/gt-setup` is idempotent: detects current state, only prompts
    for differences
11. `setup:all` dashboard reflects `.graphite.yml` and PR template status
12. All generated files use LF line endings (CRLF fix applied on WSL2)

## References

- Brainstorm: `docs/brainstorms/2026-03-19-improve-gt-setup-for-ai-agent-workflows-brainstorm.md`
- Existing gt-setup: `plugins/gt-workflow/commands/gt-setup.md` (124 lines)
- Consumer commands: `smart-submit.md`, `gt-stack-plan.md`, `gt-amend.md`
- yq pattern precedent: `plugins/yellow-debt/commands/debt/triage.md:25-32`
- setup:all dashboard: `plugins/yellow-core/commands/setup/all.md`
- Plugin CLAUDE.md: `plugins/gt-workflow/CLAUDE.md`
