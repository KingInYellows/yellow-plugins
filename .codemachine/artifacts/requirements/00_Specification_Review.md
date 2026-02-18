# Specification Review & Recommendations: KingInYellows Personal Plugin Marketplace

**Date:** 2026-01-11
**Status:** Awaiting Specification Enhancement

### **1.0 Executive Summary**

This document is an automated analysis of the provided project specifications. It has identified critical decision points that require explicit definition before architectural design can proceed.

**Required Action:** The user is required to review the assertions below and **update the original specification document** to resolve the ambiguities. This updated document will serve as the canonical source for subsequent development phases.

### **2.0 Synthesized Project Vision**

*Based on the provided data, the core project objective is to engineer a system that:*

Implements a git-native, CLI-driven plugin marketplace enabling solo developers to discover, install, publish, and manage Claude Code plugins through a simple JSON-based registry with atomic operations, version management, and rollback capabilities.

### **3.0 Critical Assertions & Required Clarifications**

---

#### **Assertion 1: Plugin Installation Security Model & Arbitrary Code Execution**

*   **Observation:** The specification acknowledges that plugins execute arbitrary code via lifecycle.install scripts and defines disclosure-only permission models. However, the threat model, sandboxing strategy, and acceptable risk threshold for malicious plugin distribution remain undefined.
*   **Architectural Impact:** This is a foundational security decision that determines the entire trust architecture, user liability model, and long-term viability of the marketplace.
    *   **Path A (Trust-Based, No Enforcement):** Current approach—display warnings, require typed confirmation, rely on user judgment. Simple implementation, zero sandboxing overhead, but users bear 100% risk of malicious plugins.
    *   **Path B (Curated Registry):** Manual review/approval before plugins appear in marketplace.json. Reduces malicious plugin risk, but creates bottleneck for solo developer and contradicts "personal marketplace" vision.
    *   **Path C (Automated Static Analysis):** Pre-publication scanning of lifecycle scripts for known malicious patterns. Partial mitigation, requires maintenance of detection rules, can be evaded.
    *   **Path D (Runtime Sandboxing):** Execute plugins in isolated environments with permission enforcement. Maximum security, but dramatically increases complexity and breaks current "symlink-based activation" model.
*   **Default Assumption & Required Action:** To align with "simple, reliable, git-native" philosophy and solo developer constraints, the system will implement **Path A (Trust-Based, No Enforcement)** with enhanced warning UX. 

"assumes plugins sourced only from trusted personal repositories,
Phase 2 permission enforcement is aspirational only (not required or in scope yet). 
Consider adding explicit language releasing the marketplace operator from liability for plugin behavior.

---

#### **Assertion 2: Cache Eviction Policy vs. Rollback Guarantees**

*   **Observation:** The specification guarantees "100% rollback success for cached versions" while simultaneously defining cache eviction (last 3 versions, 500 MB limit). These constraints create a deterministic failure scenario: a user with 4+ installed plugin versions will lose rollback capability to older versions without explicit notification.
*   **Architectural Impact:** This conflict impacts the rollback NFR (NFR-RELI-002), user trust in system guarantees, and disk space management strategy.
    *   **Tier 1 (Strict Guarantee):** Modify cache eviction to never delete versions of currently-installed plugins. Guarantees rollback, but cache grows unbounded for long-lived installations.
    *   **Tier 2 (Explicit Downgrade):** Change "100% rollback" to "rollback to any cached version" and implement aggressive user notification when eviction occurs (e.g., "WARNING: Version 1.0.0 evicted from cache, rollback no longer available"). Maintains cache limits, but weakens stated guarantee.
    *   **Tier 3 (Configurable Policy):** Allow users to set cache retention (e.g., --cache-policy=all|last-3|space-limited). Maximum flexibility, adds configuration complexity.
*   **Default Assumption & Required Action:** To preserve simplicity and manage disk usage for solo developer environments, the system will implement **Tier 2 (Explicit Downgrade)**. **The specification must be updated** to reword NFR-RELI-002 as "rollback available to any version present in cache" and add ERROR-ROLL-003 scenario: "Target version evicted from cache, re-download required." This makes the limitation explicit rather than implied.

I agree with this as the user, lets go with tier 2 and make the necessary update

---

#### **Assertion 3: Dependency Resolution Depth & Circular Dependency Handling**

*   **Observation:** The specification defines dependency declarations (dependencies[].id, minVersion, maxVersion) and mentions circular dependency detection in CI validation, but the runtime resolution algorithm, maximum dependency depth, and handling of version conflicts in transitive dependencies are undefined.
*   **Architectural Impact:** This variable determines installer complexity, installation time guarantees, and failure modes when plugin ecosystems grow beyond initial personal use.
    *   **Path A (Flat Dependencies Only):** Install only direct dependencies declared in the target plugin's manifest, no transitive resolution. Simplest implementation, but plugins must manually declare all sub-dependencies.
    *   **Path B (Single-Level Transitive):** Resolve direct dependencies plus their dependencies (depth=2), fail if conflicts detected. Balances convenience and complexity, but depth-2 may be insufficient for complex plugin chains.
    *   **Path C (Full Recursive Resolution):** npm/pip-style dependency tree with conflict resolution algorithm. Maximum compatibility, but introduces significant complexity and unpredictable installation times.
*   **Default Assumption & Required Action:** **Path C (Full Recursive Resolution):** npm/pip-style dependency tree with conflict resolution algorithm. Maximum compatibility, but introduces significant complexity and unpredictable installation times.

Make it as least complex as possible, but if a plugin is installed with claude code it should work out of the box installed (outside of personal environment variables)

---

#### **Assertion 4: Marketplace Index Governance & Multi-Source Federation**

*   **Observation:** The specification describes a single marketplace.json file in the official repository, but the governance model for plugin additions, removal of malicious/abandoned plugins, and the possibility of users maintaining private/forked marketplace indices is undefined.
*   **Architectural Impact:** This decision affects the "personal marketplace" vision, centralization risk, and long-term scalability if the user wishes to integrate third-party plugin ecosystems.
    *   **Model A (Single Canonical Source):** One authoritative marketplace.json maintained by KingInYellows. Simple, centralized control, but single point of failure and potential bottleneck.
    *   **Model B (User-Configurable Sources):** CLI allows adding multiple marketplace URLs (e.g., official + community + private). Maximum flexibility, but introduces source priority conflicts and version inconsistencies.
    *   **Model C (Fork-First Architecture):** Encourage users to fork the marketplace repo and customize their local index. Aligns with git-native philosophy, but fragments discovery and creates update synchronization challenges.
*   **Default Assumption & Required Action:** To align with "personal plugin marketplace" framing and solo developer scale, the system will implement **Model A (Single Canonical Source)** with implicit assumption that KingInYellows is the sole curator. **The specification must be updated** to explicitly state this is a personal, non-federated registry, document the process for adding new plugins to the official index (likely manual PR review), and clarify that multi-source support is out of scope for Phase 1. 

I will be integrating existing plugins into my plugin marketplace. However, these will be customized so more so I will "borrow" the plugin and make my own version for my marketplace. 
---

#### **Assertion 5: Plugin Compatibility Matrix Validation Strategy**

*   **Observation:** The specification defines four-dimensional compatibility constraints (claudeCodeMin/Max, nodeMin/Max, osSupported, archSupported) but does not specify the validation timing, compatibility mismatch UX, or handling of partial compatibility (e.g., plugin works on linux-x64 but not linux-arm64).
*   **Architectural Impact:** This determines when incompatibility errors surface, whether installations can be attempted with warnings, and the quality of error diagnostics.
    *   **Strategy A (Hard Pre-Install Block):** Validate all compatibility dimensions before download, reject incompatible plugins with ERROR-COMPAT-001/002. Clean failure mode, but prevents "try anyway" user override.
    *   **Strategy B (Warn and Proceed):** Show compatibility warnings but allow installation to continue with explicit user confirmation. Supports edge cases (e.g., plugin author's platform list incomplete), but risks broken installations.
    *   **Strategy C (Post-Install Validation):** Download and install, then test activation with fallback to rollback on failure. User-friendly for false positives in compatibility metadata, but wastes bandwidth and disk space.
*   **Default Assumption & Required Action:** To minimize wasted resources and align with the atomic operation model, the system will implement **Strategy A (Hard Pre-Install Block)** with explicit compatibility validation in Step 2 of the install journey. **The specification must be updated** to clarify that compatibility checks occur pre-download, define the exact validation logic (e.g., "Node.js version must satisfy nodeMin ≤ current ≤ nodeMax"), and add a note that users needing override capability should manually download/install via git clone. This makes the safety-first approach explicit.

I agree with this one, please implement this way

---

#### **Assertion 6: Symlink Activation Model vs. Multi-Profile Environments**

*   **Observation:** The specification uses symlink-based plugin activation from cache to ~/.claude-plugins, but does not address scenarios where users operate multiple Claude Code profiles, development/production environment separation, or concurrent plugin version testing.
*   **Architectural Impact:** This affects the data model for InstalledPluginRegistry, the symlink strategy, and whether the marketplace supports per-project or per-user plugin configurations.
    *   **Scope A (Global User-Level Only):** Single ~/.claude-plugins directory, one active version per plugin globally. Simplest implementation, matches "personal marketplace" scale, but prevents side-by-side testing.
    *   **Scope B (Profile-Aware Installation):** Support multiple named profiles (e.g., ~/.claude-plugins/default, ~/.claude-plugins/dev) with separate registries. Enables environment separation, adds profile management complexity.
    *   **Scope C (Project-Local Plugins):** Allow plugins to be installed in project directories (e.g., ./.claude-plugins) with precedence over global. Mirrors npm/node_modules pattern, but complicates discovery and cache sharing.
*   **Default Assumption & Required Action:** To maintain Phase 1 simplicity and align with solo developer workflows, the system will implement **Scope A (Global User-Level Only)**. **The specification must be updated** to explicitly state plugin installations are global per user, document the ~/.claude-plugins symlink convention, and note that project-local or profile-based installations are deferred to Phase 2+ if user feedback indicates demand. This removes ambiguity about the installation scope.

I beleive claude-code handles this itself. The plugins can be applied to the gloabl/user/project, but all we are doing is providing the plugin itself. Claude-Code allows the user to decide. 

---

### **4.0 Next Steps**

Upon the user's update of the original specification document to resolve these six critical assertions, the development process will be unblocked and can proceed to the architectural design phase. Please review the existing documents in the docs/ directory to understand the work and detail that has already been completed, and adjust if necessary
