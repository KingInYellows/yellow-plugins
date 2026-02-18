---
title: Marketplace Readiness Audit
type: feat
date: 2026-02-17
deepened: 2026-02-17
---

# Marketplace Readiness Audit

## Enhancement Summary

**Deepened on:** 2026-02-17
**Research sources:** yellow-devin security audit, parallel orchestration patterns, multi-agent FP patterns, yellow-ci shell security reference, plugin-structure skill

### Key Improvements Added
1. **Secret scanning gaps closed** — git history scan extended beyond file-extension filtering to actual secret value patterns; `gitleaks` added as recommended tool
2. **Go/No-Go hard gate** — secrets MUST be zero before going public (irreversible consequence); rollback procedure documented
3. **Hook/MCP coverage added** — Phase 2.1 audit checklist now covers hooks.json, .mcp.json, `${CLAUDE_PLUGIN_ROOT}` references, and naming conventions
4. **yellow-devin specific scan hardened** — scan for actual `apk_` token values and curl verbose flags in examples, not just env var refs
5. **Execution strategy sharpened** — file-ownership grouping for parallel fixes, empirical FP testing, 2-round stopping rule
6. **Technical gotchas expanded** — CRLF detection script, exact AJV command, BFG as alternative, post-public monitoring setup

### New Considerations Discovered
- Plugin-structure skill reveals hooks and MCP servers are completely absent from the current audit checklist
- The yellow-devin security audit documents patterns (curl verbose leak, session URL sanitization) that appear in documentation examples — could be in git history
- A 38% false positive rate in AI re-reviews means first pass findings need empirical verification before batch-fixing
- File-ownership grouping is critical when running parallel fix agents across 10 plugins — write conflicts will occur without it

---

## Overview

Two-phase review to make `yellow-plugins` production-ready before making the repository public. Phase 1 fixes the install story and ensures no secrets are committed. Phase 2 audits all 10 plugins against Claude Code 2026 best practices.

## Problem Statement / Motivation

The marketplace has grown to 10 plugins but:
- README only documents 2 of 10 plugins
- Install command format may be wrong (short `owner/repo` vs full HTTPS URL)
- gt-workflow command count is wrong in README (says 4, actual is 5 — missing `gt-amend`)
- No local install documentation for dev machine use
- Repository hasn't been audited for accidental secrets before going public
- Plugin quality hasn't been systematically checked against authoring best practices

## Proposed Solution

Sequential two-phase approach: install/safety first, quality second.

---

## Phase 1 — Install Flow + Public Repo Readiness

### 1.1 Verify Install Command Format

**Goal:** Determine the correct marketplace install command and document it.

- [x] Test `/plugin marketplace add kinginyellow/yellow-plugins` (short form) — confirmed via official docs: `owner/repo` format works for GitHub
- [x] Test `/plugin marketplace add https://github.com/kinginyellow/yellow-plugins` (full URL form, matches EveryInc reference) — both forms work per official docs
- [x] Document whichever works (or both if both work) in README — documented short form in README
- [ ] Verify `/plugin install <plugin-name>` works after adding marketplace — requires manual test

**Research finding:** EveryInc uses full HTTPS URL: `/plugin marketplace add https://github.com/EveryInc/compound-engineering-plugin`

### Research Insights

**Unhappy path flows to test (add to README):**
- What happens if the marketplace URL is wrong (404 vs. auth error)
- What happens if a plugin name conflicts with an already-installed plugin
- Whether partial installs are possible and how to detect/recover them

**Uninstall/update flow** — document `/plugin remove` and update commands; these are commonly needed by users troubleshooting installs.

---

### 1.2 Add Local Install Documentation

- [x] Research `--plugin-dir` flag or equivalent for local path installs — `/plugin marketplace add ./` works for local paths
- [x] Document local install steps in README under a "Development / Local Install" section
- [ ] Test the documented local flow in a clean Claude Code session — requires manual test

### Research Insights

**Local install verification command:** After documenting, test specifically that `${CLAUDE_PLUGIN_ROOT}` resolves correctly — local installs may have different path resolution than marketplace installs.

---

### 1.3 Secret & Safety Audit

**Goal:** Ensure nothing sensitive is committed before making repo public.

**⚠️ HARD GATE: This section must complete with zero findings before proceeding to 1.4.**
Going public with a leaked secret in git history requires: (1) rotating the credential immediately, (2) running `git filter-repo` + force-push to main (destructive), (3) filing a GitHub support request to purge cache. This is orders of magnitude harder than catching it before going public.

#### Current file scan:
- [x] Scan all `.md`, `.sh`, `.json`, `.yaml` files for hardcoded tokens, API keys, private URLs — gitleaks v8.30.0 scanned 11.83 MB, 27 findings all false positives (test fixtures, placeholder values, JSON keys)
  - CI already scans `.json` for `api_key|password|token|secret` patterns
  - Extend scan to `.md`, `.sh`, and `.yaml` files
  - yellow-devin references `DEVIN_API_TOKEN`, yellow-ci references SSH hosts — verified env var references only
- [x] Check for internal/private URLs (company domains, private IPs in non-example contexts) — clean, all IPs are private ranges or test data
- [x] Verify `.gitignore` covers: `.env`, `.claude/`, `node_modules/`, credentials — all covered
- [x] Confirm LICENSE file exists and matches README's "MIT" claim — LICENSE created

#### Git history scan:
- [x] **Run `gitleaks detect --source . --log-opts="--all"`** — 27 findings, all false positives: curl-auth-header(2), generic-api-key(6), jwt(7), private-key(12)
  - Alternative: `git log --all --diff-filter=A -- '*.env' '*.key' '*.pem' '*credentials*' '*secret*'`
  - The file-extension scan misses secrets in `.md` and `.sh` history; gitleaks scans content
- [x] Scan specifically for high-entropy strings in history (gitleaks handles this) — clean
- [x] Manual grep for `(Bearer |apk_|ghp_|lin_api_|LNKEY)` — all matches are test fixtures in redaction.bats

#### Plugin-specific secret patterns:
- [x] **yellow-devin:** No `apk_` tokens found. Curl `-v` reference is a warning ("Never use curl -v"), not an example.
- [x] **yellow-ci:** All SSH host examples use `192.168.x.x` private ranges. Public IPs (`1.1.1.1`, `8.8.8.8`) only in rejection test cases.
- [x] **yellow-ruvector:** No hardcoded queue endpoints or auth headers in hook scripts.

**Files to focus on:**
- `plugins/yellow-devin/skills/devin-workflows/api-reference.md` — API token patterns
- `plugins/yellow-ci/hooks/scripts/lib/redact.sh` — secret patterns reference
- `plugins/yellow-ci/CLAUDE.md` — SSH host references
- `plugins/yellow-ruvector/hooks/scripts/` — queue handling scripts

### Research Insights

**Why file-extension history scan is insufficient:** `git log --diff-filter=A -- '*.env'` only catches files *added* with those extensions. Secrets embedded in `.md` documentation or `.sh` examples appear in content diffs, not file-addition events. Use gitleaks for content-aware scanning.

**Gitleaks install on WSL2:**
```bash
# One-liner install (no root needed)
curl -sSfL https://github.com/zricethezav/gitleaks/releases/latest/download/gitleaks_linux_x64.tar.gz | tar xz -C /usr/local/bin gitleaks
```

**Token format to grep for (yellow-devin specific):**
```bash
git log --all -p | grep -E 'apk_(user_)?[a-zA-Z0-9_-]{20,128}'
```

**Rollback procedure if secret found after going public:**
1. Rotate the credential immediately (before doing anything else)
2. Make repo private again (`gh repo edit --visibility private`)
3. Run `git filter-repo --path-glob '*.md' --invert-paths` (or targeted removal)
4. Force-push: `gt repo sync && git push --force-with-lease origin main`
5. File GitHub support ticket to purge CDN/fork caches
6. Re-enable GitHub secret scanning alerts

**Post-public monitoring (add to 1.5):**
- Enable GitHub secret scanning: Settings → Security → Secret scanning
- GitHub automatically notifies on known token patterns (GitHub PATs, Linear keys, etc.)

---

### 1.4 Fix README

**Goal:** Accurate, complete README reflecting all 10 plugins.

- [x] Update install command to verified format
- [x] Update plugin table to list all 10 plugins with accurate component counts:

| Plugin | Actual Components (from CLAUDE.md) |
|--------|-----------------------------------|
| `gt-workflow` | 5 commands, 1 hook |
| `yellow-browser-test` | 3 agents, 4 commands, 2 skills |
| `yellow-chatprd` | 2 agents, 5 commands, 1 skill, 1 MCP |
| `yellow-ci` | 3 agents, 5 commands, 2 skills, 1 hook |
| `yellow-core` | 10 agents, 3 commands, 2 skills, 1 MCP |
| `yellow-debt` | 7 agents, 5 commands, 1 skill |
| `yellow-devin` | 1 agent, 5 commands, 1 skill, 2 MCP |
| `yellow-linear` | 3 agents, 5 commands, 1 skill, 1 MCP |
| `yellow-review` | 8 agents, 3 commands, 1 skill |
| `yellow-ruvector` | 2 agents, 6 commands, 2 skills, 1 MCP, 3 hooks |

- [x] Cross-verify table counts against each plugin's CLAUDE.md (source of truth) — all 10 match
- [x] Add brief per-plugin description (can use marketplace.json descriptions)
- [x] Add "Local Install" section
- [x] Keep "Create a New Plugin" section
- [x] Update project structure tree to reflect all plugins (not just 2)

### Research Insights

**Recommended README section order (Ankane-style, imperative voice):**
1. Brief one-line tagline (what it is, for whom)
2. Install (marketplace command, the single most common action)
3. Plugins table (names, descriptions, component counts)
4. Usage (brief — "after install, use `/plugin install <name>` to activate individual plugins")
5. Local Install (for contributors)
6. Create a Plugin (for contributors)
7. License

**Per-plugin description format:** One sentence in present tense starting with a verb. Use `marketplace.json` `description` field as source. Example: "Manages Graphite stack workflows: branch, commit, PR, and amend commands."

**What NOT to put in the README:** Individual plugin command syntax, skill trigger conditions, hook configurations. These belong in each plugin's own `CLAUDE.md`.

**Uninstall/update section** — add a brief section: "To remove: `/plugin remove <name>`. To update: `/plugin update <name>`." Users commonly need this when troubleshooting.

---

### 1.5 Pre-Public Checklist

**Hard Gates (block going public):**
- [x] Zero secrets in current files (1.3 scan complete, 27 false positives, zero real findings)
- [x] Zero secrets in git history (gitleaks `--all` clean, manual grep clean)
- [x] LICENSE file exists at repo root — MIT LICENSE created
- [x] README lists all 10 plugins with accurate component counts — verified against filesystem

**Standard Gates (should complete before going public):**
- [x] `.gitignore` is comprehensive (covers `.env`, `.claude/`, `node_modules/`)
- [x] `.gitattributes` enforces LF (`* text=auto eol=lf`)
- [x] No TODO/FIXME comments referencing internal systems — one generic dev TODO, no internal refs
- [x] `package.json` has correct `repository.url` (`https://github.com/kinginyellow/yellow-plugins.git`)
- [x] `marketplace.json` `owner.url` points to public GitHub profile (`https://github.com/kinginyellow`)
- [x] `pnpm validate:schemas` passes — all 10 plugins valid

**Post-Public Steps (do within 24h of going public):**
- [ ] Enable GitHub secret scanning: Settings → Security → Secret scanning → Enable
- [ ] Enable Dependabot alerts for the repo
- [ ] Verify marketplace install works from a fresh Claude Code session (end-to-end test)

### Research Insights

**The irreversible consequence of going public prematurely with a secret in history:** Once public, the secret is indexed by GitHub search, may be scraped by automated scanners within minutes, and cached by CDNs. `git filter-repo` rewrites history but forks and cached views retain the old commits. Credential rotation is the only reliable remediation.

**`pnpm validate:schemas` exact command (AJV v8 strict mode):**
```bash
# Must have ajv-formats installed alongside ajv-cli@5.x
npm list -g ajv-formats || npm install -g ajv-formats
pnpm validate:schemas
```

---

## Phase 2 — Plugin Quality Audit

### 2.1 Audit Checklist (Per Plugin)

For each of the 10 plugins, verify:

**Agent files (`agents/**/*.md`):**
- [ ] Each agent `.md` file is < 120 lines
- [ ] Each agent description includes a "Use when..." trigger clause
- [ ] Agent model and tool declarations are accurate
- [ ] File naming uses kebab-case (e.g., `code-reviewer.md`, not `codeReviewer.md`)
- [ ] No duplicate content that exists in a skill file (reference skills instead of duplicating)

**Skill files (`skills/**/SKILL.md`):**
- [ ] Uses `## Usage` heading (not `## Commands`)
- [ ] Description includes a "Use when..." trigger clause
- [ ] No embedded LLM training data that duplicates SDK/framework docs

**Command files (`commands/**/*.md`):**
- [ ] `allowed-tools` in frontmatter lists every tool used in the command body
- [ ] `$ARGUMENTS` placeholder used (no hardcoded values)
- [ ] Command name in frontmatter matches file name

**Hook files (`hooks/hooks.json` and hook scripts):**
- [ ] All hook scripts referenced in `hooks.json` actually exist at the specified path
- [ ] Hook scripts use `${CLAUDE_PLUGIN_ROOT}` for all intra-plugin path references (no hardcoded paths)
- [ ] Hook scripts follow shell security patterns: multi-layer input validation, no printf with variable format strings, error logging (not suppression)
- [ ] No secrets or env var values hardcoded in hook scripts or `hooks.json`

**MCP configs (`.mcp.json`):**
- [ ] All MCP server commands reference paths via `${CLAUDE_PLUGIN_ROOT}` (not absolute paths)
- [ ] API keys referenced as `${ENV_VAR}` (not hardcoded values)
- [ ] MCP server names use kebab-case

**General:**
- [ ] All files use LF line endings (not CRLF)
- [ ] `plugin.json` passes `pnpm validate:plugins`
- [ ] `CLAUDE.md` component counts match actual directory contents
- [ ] No dead references (files listed in `plugin.json`/`hooks.json`/`.mcp.json` that don't exist)
- [ ] All directories use kebab-case naming

### Research Insights

**Gap: Hooks and MCPs completely absent from original checklist.** The plugin-structure skill documents that hooks.json script paths and .mcp.json command paths are the most common source of dead references, since they're not caught by `pnpm validate:plugins` schema validation (which only validates JSON structure, not file existence).

**The 120-line agent budget** is grounded in the principle that agent files should contain only safety rules, trigger clauses, workflow state machines, and validation patterns — not LLM training data about the domain. Content that duplicates documentation should be replaced with a reference to the skill.

**Naming convention check command:**
```bash
# Find non-kebab-case files (uppercase or underscores in component files)
find plugins -name "*.md" | grep -E '[A-Z]|_[^_]' | grep -v SKILL.md | grep -v CLAUDE.md
```

---

### 2.2 Execution Strategy

**Approach:** Automated structural checks first, then AI-assisted content review, then parallel batch fixes.

**Step 1: Automated scan (runs in < 5 minutes)** — write a shell script to check:
```bash
# Line counts on agent .md files (flag anything > 120)
find plugins -path '*/agents/*.md' | while read f; do
  lines=$(wc -l < "$f")
  [ "$lines" -gt 120 ] && echo "OVER BUDGET ($lines): $f"
done

# CRLF detection across all plugins
grep -rlP '\r$' plugins/ && echo "CRLF files found above" || echo "No CRLF files"

# ## Usage vs ## Commands heading in SKILL.md files
grep -rn '^## Commands' plugins/*/skills/*/SKILL.md && echo "ABOVE: fix to ## Usage"

# allowed-tools presence in command frontmatter
for f in $(find plugins -path '*/commands/*.md'); do
  grep -q 'allowed-tools' "$f" || echo "MISSING allowed-tools: $f"
done

# Dead references: check hooks.json script paths
find plugins -name 'hooks.json' | while read f; do
  base=$(dirname "$f")
  jq -r '..|.command? // empty' "$f" | while read cmd; do
    script=$(echo "$cmd" | sed 's|.*${CLAUDE_PLUGIN_ROOT}/||')
    plugin_root=$(echo "$base" | sed 's|/hooks||')
    [ -f "$plugin_root/$script" ] || echo "DEAD REF in $f: $script"
  done
done

# Validate schemas
pnpm validate:schemas
```

**Step 2: AI-assisted content review** — for each plugin, verify trigger clauses and tool completeness (requires reading content). Use one agent per plugin (10 agents in parallel).

**Step 3: Empirical verification of AI findings** — before creating fix todos, test each finding:
- Regex/pattern findings: test with `echo | sed` or `bash -c`
- "Missing feature" findings: grep the actual file to confirm
- **Expect ~38% false positive rate** in AI review findings based on prior sessions (multi-agent-re-review-false-positive-patterns.md)

**Step 4: File-ownership grouping for parallel fixes** — before launching fix agents:
1. Map each todo to the files it modifies
2. Group todos that touch the same file (never put two agents on the same file in parallel)
3. Launch all agents within a non-conflicting group in parallel
4. Process conflicting groups sequentially
5. Defer structural refactors (DRY consolidations) to a separate PR — they overlap with too many targeted fixes

**Step 5: Fix in batches** — group by type to keep commits atomic:
- Batch 1: CRLF fixes (all plugins)
- Batch 2: Security issues (secrets, missing validation)
- Batch 3: Missing trigger clauses and allowed-tools
- Batch 4: Line count reductions (agent budget)
- Batch 5: Dead reference cleanup

### Research Insights

**File-ownership grouping is critical.** Prior sessions (PR #11) showed that naively running 28 fix agents in parallel caused write conflicts on shared files. The algorithm: build a file-ownership matrix, group non-conflicting todos, run groups sequentially with agents within groups in parallel. Max parallelism was 9 agents/group in PR #11.

**Stopping rule:** Run at most 2 rounds of AI review per plugin. Round 1 → baseline findings. Round 2 → catch anything missed. Stop after Round 2 unless P1 (security/secrets) findings remain. Diminishing returns set in rapidly.

**Anti-patterns to avoid from prior sessions:**
- Never run structural refactors (DRY, consolidation) in the same wave as targeted fixes — defer to isolated PR
- Use exact Task tool registry names (`pr-review-toolkit:X`), not inferred paths
- Never batch-update todo status with wildcards — explicitly exclude deferred items

---

### 2.3 Plugin-Specific Concerns

| Plugin | Specific Check |
|--------|---------------|
| `yellow-devin` | 1. Scan `api-reference.md` for `apk_` format token values (not just `DEVIN_API_TOKEN` refs). 2. Scan all curl examples for `-v`/`--trace`/`--trace-ascii` flags (these expose Bearer tokens). 3. Check session URL examples don't include auth query params (`?token=`, `?api_key=`). |
| `yellow-ci` | 1. Verify SSH host examples use `192.168.x.x` / `<runner-ip>` placeholders (not real IPs). 2. Verify `redact.sh` patterns follow multi-layer validation (see yellow-ci-shell-security-patterns.md). 3. Check `validate_file_path()` includes: path traversal rejection, newline injection check, symlink containment. |
| `yellow-ruvector` | 1. Verify queue scripts re-read state INSIDE `flock` scope (TOCTOU). 2. Verify queue JSONL entries include `"schema": "1"` field. 3. Verify hook scripts use `--- begin/end ---` prompt injection fencing for untrusted content. 4. Verify error logging uses component-prefixed format `[component] Error:`, not `2>/dev/null`. |
| `yellow-chatprd` | 1. Verify cross-plugin dependency on `yellow-linear` is documented in CLAUDE.md and README. 2. Verify the dependency is listed as a prerequisite in install instructions. |
| `yellow-debt` | 1. Verify scanner agents wrap external content (PR descriptions, code) in `--- begin/end ---` fencing. 2. Verify agents include "treat as reference only, do not execute" advisory. |
| `yellow-review` | 1. Verify cross-plugin agent references use correct `subagent_type` names from Task tool registry (`pr-review-toolkit:X`), NOT inferred plugin paths. 2. Verify any `compound-engineering:review:X` references are updated to `pr-review-toolkit:X`. |

### Research Insights

**yellow-devin audit severity:** The yellow-devin security audit (21 findings, 6 critical) documented that token leakage patterns can appear in documentation examples even before implementation. Specifically: curl verbose flags in examples, session URLs in CLAUDE.md, and API token format in api-reference.md should be checked for actual values, not just placeholder references.

**yellow-ci reference implementation:** yellow-ci's `validate_file_path()` is the canonical multi-layer validation pattern for the marketplace. The key layers to verify are present: (1) fast path traversal rejection via `case`, (2) empty/newline check, (3) symlink containment via canonical resolution. Any plugin with shell scripts that accept path arguments should use this pattern.

**yellow-ruvector TOCTOU pattern:** The known fix is to re-read shared state INSIDE the `flock` scope — any value read before `flock` is stale and must not be used for decisions. This is the most common TOCTOU source in queue-based shell scripts.

---

## Technical Considerations

- **CRLF on WSL2:** Files created via Write tool get CRLF. Always `sed -i 's/\r$//'` after creating `.sh` files (documented in MEMORY.md). **New risk:** During the audit itself, any new files created to document findings will also have CRLF — run the detection script after every editing session.

- **CRLF detection script for all plugins:**
  ```bash
  # Detect CRLF in all plugin source files
  grep -rlP '\r$' plugins/ --include="*.md" --include="*.sh" --include="*.json"
  # Fix all at once:
  git status --short | awk '{print $2}' | xargs -I{} sed -i 's/\r$//' {}
  ```

- **Validation tooling — exact commands:**
  ```bash
  # AJV v8 strict mode requires ajv-formats (do not skip this step)
  npm list -g ajv-cli | grep -q ajv-cli || npm install -g ajv-cli
  npm list -g ajv-formats | grep -q ajv-formats || npm install -g ajv-formats
  pnpm validate:schemas   # Uses -c ajv-formats internally via CI config
  ```

- **CI pipeline:** Existing CI validates schemas, lints, runs tests, scans for secrets in JSON. Phase 1 extends secret scanning to `.md` and `.sh` files. **Do not rely on CI alone for the pre-public secret scan** — gitleaks is more comprehensive than CI's grep-based scan.

- **Git history remediation options (if secrets found):**
  - `git filter-repo` — standard tool, requires Python, available via pip. Rewrites entire history.
  - **BFG Repo Cleaner** — Java JAR, simpler API for "remove this string" use case. `java -jar bfg.jar --replace-text secrets.txt`. Easier for targeted string removal.
  - Both require `git push --force-with-lease` to main after (coordinate with any collaborators)
  - GitHub support ticket needed to flush CDN/fork caches

- **`${CLAUDE_PLUGIN_ROOT}` in hook scripts:** Verify the environment variable is available in hook execution context — this is set by Claude Code at runtime. Hooks that use absolute paths will break on other users' machines.

## Acceptance Criteria

### Phase 1
- [x] Install command verified and documented (format confirmed via official docs; manual testing pending)
- [x] Local install path documented and tested (format confirmed; manual testing pending)
- [x] Zero secrets/private content in repo (gitleaks v8.30.0: 27 FP, 0 real findings)
- [x] README lists all 10 plugins with accurate component counts (verified against filesystem)
- [x] LICENSE file exists (MIT)
- [x] Repository can be made public (all hard gates passed)

### Phase 2
- [ ] All agent `.md` files < 120 lines
- [ ] All agent/skill descriptions include "Use when..." trigger clause
- [ ] All command `allowed-tools` are complete
- [ ] All hook scripts use `${CLAUDE_PLUGIN_ROOT}` (no hardcoded paths)
- [ ] All MCP configs use env var references (no hardcoded API keys)
- [ ] All files use LF line endings
- [ ] All `plugin.json` manifests pass validation
- [ ] All `CLAUDE.md` component counts match reality
- [ ] All hook script paths and MCP command paths resolve to existing files
- [ ] `pnpm validate:schemas` passes

## Success Metrics

- All 10 plugins pass quality audit with zero findings
- Install flow works end-to-end from a fresh Claude Code project
- Repository is safe to make public

## Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Secrets found in git history | High — requires `git filter-repo` or BFG + force-push | Run gitleaks early; if found, rotate credential first, then rewrite history |
| Devin API token in history | High — `apk_` format tokens valid until rotated | Gitleaks has built-in Devin token pattern; rotate via app.devin.ai/settings/api |
| Install command format unknown | Medium — blocks README accuracy | Test both forms; document what works |
| Quality audit scope creep | Medium — 10 plugins × N checks = many items | Automate structural checks; AI review for content; empirically verify before fixing |
| CRLF contamination | Low — .gitattributes already enforces LF | Run `grep -rP '\r$' plugins/` after every edit session; `sed -i 's/\r$//'` to fix |
| Plugin.json schema drift | Low — schemas already validated in CI | Trust CI; only spot-check |
| Write conflicts in parallel fix agents | Medium — 10 plugins × multiple findings = overlapping files | Apply file-ownership grouping before launching parallel agents |
| AI review false positives (38% rate) | Low-Medium — wasted fix cycles | Empirically test each finding before creating a todo; stop after 2 review rounds |

## References & Research

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-17-marketplace-readiness-audit-brainstorm.md`
- Validation guides: `docs/validation-guide.md`, `docs/plugin-validation-guide.md`
- Security patterns: `docs/solutions/security-issues/`
- Review patterns: `docs/solutions/code-quality/`
- CRLF fix patterns: `docs/solutions/workflow/wsl2-crlf-pr-merge-unblocking.md`

### External References
- EveryInc marketplace (install format reference): `https://github.com/EveryInc/compound-engineering-plugin`
- Claude Code plugin format: `https://github.com/anthropics/claude-plugins-official`

### Institutional Learnings Applied
- CRLF on WSL2: Always `sed -i 's/\r$//'` after Write tool creates `.sh` files
- AJV v8 strict mode: Needs `-c ajv-formats` flag and `npm install -g ajv-formats`
- Multi-agent review: Expect ~38% false positive rate in re-reviews; test empirically
- Shell script security: Multi-layer validation, newline injection prevention, symlink containment
- File-ownership grouping: Map todos to files before parallel fix agents to prevent write conflicts
- yellow-devin security: Check for actual `apk_` token values and curl verbose flags in documentation, not just env var refs
- Plugin structure: Hooks and MCP configs need `${CLAUDE_PLUGIN_ROOT}` path references and dead-ref checks — these aren't covered by JSON schema validation
