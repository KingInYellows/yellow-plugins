# Discovery User Journeys - Phase 2 Gap Analysis

**Context**: Addresses Gap #1 - Missing 3 user journeys for marketplace discovery
**Created**: 2026-01-11
**Status**: Ready for integration into PRD Part 1 Section 2.0
**Coverage Impact**: 90% → 100% (adds 3 of 3 missing journeys)

---

## 2.2.4 User Journey: Browse Marketplace

**Trigger**: User wants to explore available plugins

**Steps**:
1. User runs `/plugin browse` → app **MUST** fetch marketplace.json
2. App parses marketplace index → app **MUST** display plugin list with key metadata (name, version, description, category)
3. User selects filter (category: "productivity") → app **MUST** filter plugins array by matching category field
4. User selects sort (by: "updated") → app **MUST** re-order results by last update timestamp descending
5. User views paginated results → app **SHOULD** display 10 plugins per page with navigation controls

**Exit Criteria**: User has identified plugins of interest

**Error Paths**:
- If marketplace.json unreachable → app **MUST** show cached version with timestamp OR display "Offline - cannot browse marketplace"
- If no plugins match filter → app **MUST** show "No plugins found. Try different filters."
- If marketplace.json malformed → app **MUST** show "Invalid marketplace format. Please try again later."

**Performance Requirements**:
- Load marketplace.json: p95 < 1s (maps to NFR-PERF-001)
- Filter/sort operations: p95 < 100ms (client-side operations)

**NFR Mappings**:
- NFR-PERF-001: Manifest read/parse time
- NFR-USE-001: Actionable error messages (derived)

**Acceptance Criteria**:
- [ ] Given valid marketplace.json, When user browses, Then app displays plugin list with name, version, description, category
- [ ] Given filter "category: productivity" selected, When user applies filter, Then only plugins with category="productivity" shown
- [ ] Given offline mode, When marketplace unreachable, Then app shows cached version with "Last updated: [timestamp]" warning

**Related Requirements**:
- REQ-MKT-001: Marketplace index must be machine-readable
- REQ-MKT-003: Detail view should be accessible from browse results

---

## 2.2.5 User Journey: Search Plugins

**Trigger**: User wants to find specific plugin by keyword

**Steps**:
1. User runs `/plugin search "hook"` → app **MUST** load marketplace.json
2. App searches plugin names, descriptions, and tags → app **MUST** match case-insensitive across all fields
3. App ranks results by relevance → app **SHOULD** prioritize: exact name match > partial name match > description match > tag match
4. User views search results → app **MUST** display matching plugins with highlighted search terms
5. User refines search with additional keywords or filters → app **SHOULD** support AND logic for multiple keywords

**Exit Criteria**: User has found target plugin(s) or determined plugin doesn't exist

**Error Paths**:
- If no results found → app **MUST** show "No plugins match '[query]'. Try different keywords or browse all plugins."
- If marketplace unreachable → app **MUST** search cached index with "Warning: Searching offline cache (updated [timestamp])"
- If query too short (<2 chars) → app **SHOULD** show "Enter at least 2 characters to search"
- If marketplace.json corrupted → app **MUST** show "Cannot search - marketplace index unavailable"

**Performance Requirements**:
- Search operation: p95 < 200ms (client-side search with highlighting)
- Supports fuzzy matching with edit distance ≤ 2 for typo tolerance

**NFR Mappings**:
- NFR-PERF-001: Manifest read/parse time (initial load)
- NFR-USE-001: Actionable error messages with fallback options

**Acceptance Criteria**:
- [ ] Given keyword "hook", When user searches, Then app shows all plugins with "hook" in name, description, or tags
- [ ] Given tag "productivity", When user searches, Then all plugins with tag="productivity" shown
- [ ] Given no matches for "nonexistent", When user searches, Then app suggests "No plugins match 'nonexistent'. Browse all: /plugin browse"
- [ ] Given search "hok" (typo), When user searches, Then app finds "hook" via fuzzy matching

**Related Requirements**:
- REQ-MKT-001: Marketplace index must support searchable fields
- REQ-MKT-003: Search results link to detail view

---

## 2.2.6 User Journey: View Plugin Details

**Trigger**: User wants detailed information about a specific plugin before installing

**Steps**:
1. User runs `/plugin info hookify` → app **MUST** fetch plugin.json from source path defined in marketplace index
2. App parses plugin manifest → app **MUST** display full metadata structured for readability
3. App checks compatibility → app **MUST** show pass/fail for each constraint:
   - Claude Code version requirement
   - Node.js version requirement
   - OS compatibility (if specified)
   - Architecture compatibility (if specified)
   - Plugin dependencies (if any)
4. App displays permissions → app **MUST** show all permission scopes with reasons (per REQ-MKT-030)
5. User reviews documentation links → app **SHOULD** display:
   - README URL
   - Changelog URL
   - Examples/getting-started URL
6. User decides to install or cancel → app returns to command prompt

**Exit Criteria**: User has sufficient information to make install decision

**Error Paths**:
- If plugin.json unreachable → app **MUST** show "Cannot fetch plugin details for 'hookify'. Network error or plugin removed."
- If plugin.json invalid/incomplete → app **MUST** show "Invalid plugin manifest for 'hookify'. Contact plugin author."
- If plugin not in marketplace → app **MUST** show "Plugin 'hookify' not found in marketplace. Check plugin name or use /plugin search."
- If compatibility check fails → app **MUST** highlight failed constraints in red/bold with specific version requirements

**Data Displayed** (Structured Output):
```
Plugin: hookify
Version: 1.2.3
Author: kingin-yellows
Description: [full description from plugin.json]

Category: productivity
Tags: hooks, automation, workflow
Maturity: stable

Compatibility:
  ✓ Claude Code: >=1.0.0 (current: 1.2.0)
  ✓ Node.js: >=16.0.0 (current: 18.14.0)
  ✓ OS: linux, darwin (current: linux)
  ✓ Architecture: x64, arm64 (current: x64)

Permissions:
  - file:read (Reason: Read hook configuration files)
  - file:write (Reason: Write hook execution logs)
  - network:http (Reason: Fetch remote hook scripts)

Dependencies:
  - @kingin-yellows/common-utils@^2.0.0

Documentation:
  README: https://github.com/kingin-yellows/hookify#readme
  Changelog: https://github.com/kingin-yellows/hookify/blob/main/CHANGELOG.md
  Examples: https://github.com/kingin-yellows/hookify/tree/main/examples

Install: /plugin install hookify
```

**Performance Requirements**:
- Fetch plugin.json: p95 < 2s (network latency + parse time)
- Compatibility check: p95 < 200ms (local version comparison)

**NFR Mappings**:
- NFR-PERF-001: Manifest read/parse time
- NFR-REL-005: Compatibility check reliability (derived)
- NFR-USE-001: Actionable error messages

**Acceptance Criteria**:
- [ ] Given plugin ID "hookify", When user requests details, Then app displays all required fields: name, version, author, description, category, tags, maturity, compatibility, permissions, dependencies, docs
- [ ] Given incompatible plugin (requires Claude Code 2.0, user has 1.0), When user views details, Then app highlights "Claude Code: ✗ >=2.0.0 (current: 1.0.0)" in red
- [ ] Given plugin with 3 permissions, When user views details, Then all 3 permissions shown with scope and reason
- [ ] Given plugin without dependencies, When user views details, Then "Dependencies: None" displayed
- [ ] Given malformed plugin.json, When user views details, Then error message suggests contacting plugin author

**Related Requirements**:
- REQ-MKT-002: Standard plugin.json manifest structure
- REQ-MKT-003: Detail view requirement (this journey implements it)
- REQ-MKT-011: Compatibility enforcement
- REQ-MKT-030: Permission disclosure

---

## Integration Summary

### Complete User Journey Coverage (Part 1, Section 2.0)

After adding these 3 journeys, Part 1 Section 2.0 achieves **100% coverage**:

1. Install plugin (REQ-MKT-010) - ✓ Existing
2. Update plugin (REQ-MKT-013) - ✓ Existing
3. Rollback plugin (REQ-MKT-013) - ✓ Existing
4. **Browse marketplace (REQ-MKT-003)** - ✓ NEW
5. **Search plugins (REQ-MKT-003)** - ✓ NEW
6. **View plugin details (REQ-MKT-003)** - ✓ NEW
7. Publish plugin (REQ-MKT-020) - ✓ Existing
8. Version pin (REQ-MKT-012) - ✓ Existing
9. Check updates (REQ-MKT-014) - ✓ Existing

### NFR Compliance Matrix

| User Journey | NFR Mappings | Performance Target |
|--------------|--------------|-------------------|
| Browse marketplace | NFR-PERF-001, NFR-USE-001 | Load < 1s, Filter < 100ms |
| Search plugins | NFR-PERF-001, NFR-USE-001 | Search < 200ms |
| View plugin details | NFR-PERF-001, NFR-REL-005, NFR-USE-001 | Fetch < 2s, Check < 200ms |

### Error Handling Standards

All 3 journeys follow consistent error pattern:
- Network failures → cached fallback OR actionable error
- Validation failures → specific error with context
- Missing data → helpful suggestions (e.g., "Try /plugin browse")
- Always include exit path to related commands

### Testing Implications

Each journey includes 3-5 acceptance criteria in Given/When/Then format:
- Browse: 3 test cases (valid browse, filter, offline)
- Search: 4 test cases (keyword match, tag match, no results, fuzzy match)
- View details: 5 test cases (valid details, incompatible, permissions, dependencies, malformed)

**Total new test cases**: 12 (adds to existing test coverage)

---

## Memory Storage

Store this analysis for Phase 2 coordination:

```json
{
  "gap_id": "G01",
  "gap_title": "Missing discovery user journeys",
  "status": "resolved",
  "journeys_added": 3,
  "coverage_before": "90%",
  "coverage_after": "100%",
  "nfr_compliance": "100%",
  "test_cases_added": 12,
  "format_standard": "compliant",
  "integration_target": "PRD Part 1 Section 2.0"
}
```

---

## Recommendation for Specification Writers

**Where to Add**:
- PRD Part 1, Section 2.0 "User Journeys"
- Insert as subsections 2.2.4, 2.2.5, 2.2.6
- Reference existing sections 2.2.1-2.2.3 for formatting consistency

**Validation Checklist**:
- [ ] All 3 journeys use MUST/SHOULD keywords consistently
- [ ] All error paths documented with actionable messages
- [ ] All performance requirements map to NFRs
- [ ] All acceptance criteria in Given/When/Then format
- [ ] All journeys reference related REQ-MKT-### requirements
- [ ] Structured output example included for "View plugin details"

**Next Steps** (Phase 2 continuation):
1. Coder agent: Implement discovery features (browse, search, detail view)
2. Test agent: Generate 12 test cases from acceptance criteria
3. Integration: Ensure UI/CLI consistency across all 9 user journeys
4. Documentation: Update PRD Part 1 with these 3 journeys

---

**Phase 2 Gap Analysis Status**: Gap #1 RESOLVED ✓
**Next Gap**: G02 (Technology Stack Research) - assigns to coder agent
