# Orchestrator Handoff Instructions
# Phase 0 → Phase 1 Transition

**Date**: 2026-01-11
**From**: rewoo-planner (Agent #4/7)
**To**: Orchestrator / Execution Coordinator
**Status**: Ready for Phase 1 Execution

---

## PHASE 0 COMPLETE ✅

All meta-analysis agents have completed successfully:

| Agent # | Agent Name | Status | Output Location |
|---------|------------|--------|----------------|
| **#1** | step-back-analyzer | ✅ Complete | memory: `search/meta/principles` |
| **#2** | ambiguity-clarifier | ✅ Complete | memory: `search/meta/ambiguities` |
| **#3** | self-ask-decomposer | ✅ Complete | memory: `search/meta/self-ask-questions` |
| **#4** | rewoo-planner | ✅ Complete | memory: `search/meta/research-plan-complete` |

---

## CRITICAL: AMBIGUITY CLARIFICATION REQUIRED

Before starting Phase 1 execution, you MUST present the following ambiguity questions to the user for clarification.

### Retrieved from Memory: `search/meta/ambiguities`

The ambiguity-clarifier identified several unresolved questions that will impact specification quality. These questions must be answered before D01-D08 can produce accurate outputs.

**Action Required**:
1. Retrieve full ambiguity list: `npx claude-flow memory query ambiguities --namespace search/meta`
2. Present questions to user
3. Store user responses in memory: `search/meta/ambiguity-resolutions`
4. Update Phase 1 agents with clarified definitions

**Why This Matters**:
- D01 (functional requirements extraction) depends on clear requirement definitions
- D03/D04 (schema design) depend on understanding "compatibility", "permissions", "version pinning"
- D05 (constraint research) depends on knowing what aspects of Claude Code plugin system are in scope

**Estimated Time**: 15-30 minutes of user interaction

---

## PHASE 1 EXECUTION PLAN

### Start Immediately After Ambiguity Resolution

**Group 1A (Parallel Execution)**:
```bash
# Spawn three agents concurrently
Task("gap-hunter", "Execute D01: Extract 13 functional requirements from PRD.md sections 1. Focus on REQ-MKT-001 through REQ-MKT-031. Output as markdown table with columns: ID, Name, Description, Priority (MUST/SHOULD/MAY), Acceptance Criteria. Use ambiguity resolutions from memory.", "gap-hunter")

Task("risk-analyst", "Execute D02: Extract NFRs and success metrics from PRD.md sections 1, 1. Output: Primary Success Metric (PSM) with target value, secondary success metrics, 3 NFRs (NFR-PERF-001, NFR-REL-001, NFR-MAINT-001) with measurable acceptance criteria, 3 risks (RISK-01 to RISK-03) with probability/impact/mitigation.", "risk-analyst")

Task("researcher", "Execute D05: Research Claude Code plugin constraints. Find official documentation (Anthropic, GitHub). Document: 1) Permission model (how declared, displayed, enforced), 2) Version compatibility format (semver ranges), 3) Entrypoint structure (command syntax, file paths). Analyze 3 real-world plugin examples. Include citations with URLs. Output as markdown with examples.", "researcher")
```

**Duration**: 1.5 hours (max of 45m, 30m, 1.5h)

---

### Group 1B (After D01 Completes)

**Wait Condition**: D01 output file exists and contains 13 requirements

```bash
# Spawn two schema designers in parallel
Task("coder", "Execute D03: Design marketplace.json JSON Schema Draft 7. Requirements from D01 memory. Schema must include: plugin list array, plugin metadata (name, version, author, description), marketplace metadata (version, updated date), validation rules for required fields. Follow REQ-MKT-001, 002, 003. Output: valid JSON Schema file at docs/schemas/marketplace.schema.json", "coder")

Task("coder", "Execute D04: Design plugin.json JSON Schema Draft 7. Requirements from D01 memory. Schema must include: name (string, required), version (semver, required), description (string, required), entrypoints (array, required), compatibility (object with claudeCodeVersion), permissions (array), docs (URL, required). Follow REQ-MKT-002. Output: valid JSON Schema file at docs/schemas/plugin.schema.json", "coder")
```

**Duration**: 1 hour (both run concurrently)

---

### Group 1C (After D01 Completes, Parallel with 1B)

**Wait Condition**: D01 output exists

```bash
Task("error-handling-architect", "Execute D06: Define error scenarios catalog. Use functional requirements from D01. Create catalog with 20+ scenarios covering: install failures (network, permissions, incompatibility), update failures (breaking changes, rollback needed), validation failures (invalid manifest, missing fields), compatibility failures (version mismatch). Format: scenario ID, trigger condition, expected behavior, recovery action. Output as markdown table.", "error-handling-architect")
```

**Duration**: 1 hour (parallel with D03/D04)

---

### Group 1D (After D03, D04 Complete)

**Wait Condition**: Both schema files exist and are valid JSON

```bash
# Spawn two mappers in parallel
Task("gap-hunter", "Execute D07: Map PRD to Part 1 schema (sections 1.0-4.0). Input: PRD.md, project-specification-schema (Part 1), functional requirements from D01, schemas from D03/D04. Create mapping table: PRD Section → Part 1 Section → Content Source. Ensure 100% coverage of PRD. Output as markdown table.", "gap-hunter")

Task("gap-hunter", "Execute D08: Map PRD to Part 2 schema (sections 5.0-9.0). Input: PRD.md, project-specification-schema (Part 2), functional requirements from D01, schemas from D03/D04. Create mapping table: PRD Section → Part 2 Section → Content Source. Include: formal controls (5.0), traceable requirements (6.0), NFRs (7.0), tech constraints (8.0), risks (9.0). Output as markdown table.", "gap-hunter")
```

**Duration**: 45 minutes (both run concurrently)

---

## QUALITY GATE 1 VALIDATION

**After D01-D08 Complete**, run the following checks:

### Gate 1A: Schema Completeness
```bash
# Validate schemas
npx ajv-cli validate -s docs/schemas/marketplace.schema.json -d docs/examples/marketplace.json
npx ajv-cli validate -s docs/schemas/plugin.schema.json -d docs/examples/plugin-example-1.json

# Check criteria
- [ ] marketplace.json schema includes all fields from REQ-MKT-001, 002, 003
- [ ] plugin.json schema includes: name, version, description, entrypoints, compatibility, permissions, docs
- [ ] Both schemas include validation rules (semver, required fields)
- [ ] Example files validate successfully
```

**Pass Threshold**: 4/4 criteria met
**If Failed**: Add D09 (stakeholder interview simulation)

### Gate 1B: Constraint Research
```bash
# Review D05 output
- [ ] Claude Code permission model documented with examples
- [ ] Compatibility check mechanism specified (version ranges, semver)
- [ ] Entrypoint structure defined (command syntax, file paths)
- [ ] Minimum 3 real-world plugin examples analyzed with citations
```

**Pass Threshold**: 3/4 criteria met
**If Failed**: Add D10 (extended documentation review)

### Gate 1C: Requirement Coverage
```bash
# Validate mappings from D07, D08
- [ ] All 13 REQ-MKT-### items mapped to schema sections
- [ ] All NFRs mapped to Part 2 sections
- [ ] No unmapped PRD sections (100% coverage)
- [ ] Confidence ≥ 75% in mapping accuracy
```

**Pass Threshold**: 3/4 criteria met
**If Failed**: Add gap identification iteration

---

## PROCEED/STOP DECISION

**If ≥ 2 gates pass**: Proceed to Phase 2 (Gap Analysis)
**If < 2 gates pass**: STOP and add contingency tasks (D09, D10)

---

## PHASE 2 PREVIEW (After Gate 1 Passes)

**Group 2A (Parallel)**:
- A01: gap-hunter identifies Part 1 gaps (1 hour)
- A02: gap-hunter identifies Part 2 gaps (1 hour)
- A04: risk-analyst validates NFR measurability (45 min)

**Duration**: 1 hour total (parallel execution)

---

## MEMORY RETRIEVAL COMMANDS

### For Orchestrator

```bash
# Get complete research plan
npx claude-flow memory query "research-plan-complete" --namespace search/meta

# Get step-back principles (high-level guidance)
npx claude-flow memory query "principles" --namespace search/meta

# Get ambiguities (MUST present to user)
npx claude-flow memory query "ambiguities" --namespace search/meta

# Get self-ask questions (context for gap hunting)
npx claude-flow memory query "self-ask-questions" --namespace search/meta
```

### For Execution Agents

Each agent should retrieve relevant context:

**D01 (gap-hunter)**:
```bash
npx claude-flow memory query "principles" --namespace search/meta
npx claude-flow memory query "ambiguity-resolutions" --namespace search/meta
```

**D02 (risk-analyst)**:
```bash
npx claude-flow memory query "principles" --namespace search/meta
```

**D05 (researcher)**:
```bash
npx claude-flow memory query "ambiguities" --namespace search/meta
```

---

## PROGRESS TRACKING

Update `/docs/progress-dashboard.md` after each task completes:

```bash
# After D01 completes
sed -i 's/| D01 | gap-hunter | 45 min | ⏳ Pending | - | - |/| D01 | gap-hunter | 45 min | ✅ Complete | [timestamp] | [timestamp] |/' docs/progress-dashboard.md

# Update overall metrics
# Total Tasks Complete: 0 → 1
# Phase 1 Tasks: 0 → 1
```

**Tool**: Use TodoWrite to track task completion (optional, for user visibility)

---

## FILE OUTPUTS

### Phase 1 Expected Outputs

After Phase 1 completes, these files MUST exist:

```
/home/kinginyellow/projects/yellow-plugins/
├── docs/
│   ├── phase1-outputs/
│   │   ├── D01-functional-requirements.md
│   │   ├── D02-nfrs-success-metrics.md
│   │   ├── D03-marketplace-schema-design.md
│   │   ├── D04-plugin-schema-design.md
│   │   ├── D05-claude-code-constraints.md
│   │   ├── D06-error-scenarios-catalog.md
│   │   ├── D07-prd-part1-mapping.md
│   │   └── D08-prd-part2-mapping.md
│   ├── schemas/
│   │   ├── marketplace.schema.json
│   │   └── plugin.schema.json
│   └── examples/
│       ├── marketplace.json (placeholder for D03)
│       └── plugin-example-1.json (placeholder for D04)
```

---

## ERROR HANDLING

### If Agent Fails

**Detection**: Task exceeds estimated duration by >50% or returns error
**Action**:
1. Log failure in progress dashboard
2. Check memory for missing dependencies
3. Review task inputs (file existence, schema validity)
4. Retry with corrected inputs
5. If retry fails, escalate to user

### If Dependency Missing

**Detection**: Agent reports missing input file or memory key
**Action**:
1. Verify dependency task actually completed
2. Check file paths (absolute vs relative)
3. Validate memory namespace
4. If dependency incomplete, mark current task as BLOCKED

### If Quality Gate Fails

**Detection**: <threshold criteria met
**Action**:
1. DO NOT proceed to next phase
2. Add contingency tasks (D09, D10, etc.)
3. Re-run gate validation after contingency tasks
4. If still fails after 2 iterations, escalate to user

---

## SUCCESS METRICS

Phase 1 is successful when:
- [x] All 8 tasks (D01-D08) complete
- [x] All 3 quality gates (1A, 1B, 1C) pass
- [x] Total execution time ≤ 4.5 hours
- [x] All output files exist and validate
- [x] No CRITICAL blockers identified
- [x] Memory updated with Phase 1 results
- [x] Confidence ≥ 75% across all outputs

---

## FINAL CHECKLIST BEFORE STARTING PHASE 1

- [ ] All Phase 0 agent outputs retrieved from memory
- [ ] Ambiguity questions presented to user and resolved
- [ ] User resolutions stored in memory (`ambiguity-resolutions`)
- [ ] PRD.md and project-specification-schema files exist and are readable
- [ ] Output directories created (`docs/phase1-outputs`, `docs/schemas`, `docs/examples`)
- [ ] JSON Schema validator installed (ajv-cli or equivalent)
- [ ] Progress dashboard initialized
- [ ] 3 agents ready to spawn (gap-hunter, risk-analyst, researcher)

**When all checkboxes are ✅, execute Group 1A in parallel.**

---

## CONTACT / ESCALATION

**If You Encounter**:
- Missing memory keys → Check namespace: `search/meta`
- Invalid file paths → Use absolute paths: `/home/kinginyellow/projects/yellow-plugins/...`
- Agent failures after 2 retries → Escalate to user with error logs
- Quality gate failures after contingency tasks → Request user guidance on scope reduction

**Next Agent After Phase 1**: gap-hunter (for A01, A02 in Phase 2)

---

**Handoff Complete**: 2026-01-11
**Ready for Execution**: Yes (after ambiguity resolution)
**Estimated Phase 1 Completion**: 4 hours from start
