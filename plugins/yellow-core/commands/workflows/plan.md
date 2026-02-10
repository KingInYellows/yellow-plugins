---
name: workflows:plan
description: Transform feature descriptions into structured implementation plans
argument-hint: "[feature description]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Feature Planning Workflow

Transform rough feature ideas into actionable implementation plans with proper research, analysis, and structured documentation.

## Phase 1: Idea Refinement

**Objective:** Understand the feature deeply before planning.

**Steps:**

1. Check for existing brainstorm documents:
   ```bash
   find docs/brainstorms/ -type f -name "*.md" 2>/dev/null | head -10
   ```

2. If brainstorm docs exist, read them for context. If found, use them to enrich understanding.

3. Parse the feature description from `#$ARGUMENTS`. If vague or missing, use AskUserQuestion to gather:
   - What problem does this solve?
   - Who are the users?
   - What's the expected outcome?
   - Any known constraints or requirements?

4. Assess complexity dimensions:
   - **Familiarity:** Is this touching known/unknown parts of codebase?
   - **Intent:** Clear requirements or exploratory work?
   - **Risk:** Potential breaking changes, security implications?
   - **Uncertainty:** Well-defined scope or needs discovery?

## Phase 2: Local Research

**Objective:** Gather context from codebase and establish conventions.

**Steps:**

1. Launch research agents in parallel using Task tool:

   ```
   Task: repo-research-analyst
   Input: {feature_description}
   Goal: Find relevant files, existing patterns, similar implementations
   ```

   ```
   Task: best-practices-researcher
   Input: {feature_description}
   Goal: Identify project conventions, architectural patterns, testing approaches
   ```

2. Collect findings:
   - File paths that need modification
   - Existing patterns to follow
   - Code conventions (naming, structure, error handling)
   - Test patterns and coverage expectations
   - Dependencies and integrations

3. Use Grep/Glob to verify critical paths:
   ```bash
   rg "pattern_name" --type ts --files-with-matches
   fd "component.*\.tsx$" src/
   ```

## Phase 3: SpecFlow Analysis

**Objective:** Validate completeness and identify gaps.

**Steps:**

1. Run specification flow analyzer:
   ```
   Task: spec-flow-analyzer
   Input: {feature_description, research_findings}
   Goal: Validate completeness, identify edge cases, find missing requirements
   ```

2. Review analyzer output for:
   - Missing acceptance criteria
   - Unhandled edge cases
   - Integration points not considered
   - Performance implications
   - Security considerations
   - Backwards compatibility concerns

3. If critical gaps found, use AskUserQuestion to clarify before proceeding.

## Phase 4: Plan Writing

**Objective:** Create structured implementation plan.

**Steps:**

1. Determine detail level based on complexity:
   - **MINIMAL:** Small changes, well-understood domain, low risk
   - **STANDARD:** Medium complexity, some unknowns, moderate risk
   - **COMPREHENSIVE:** High complexity, many unknowns, high risk

2. Create plan document at `plans/<issue-title>.md` with structure:

### MINIMAL Template (50-100 lines):
```markdown
# Feature: [Title]

## Overview
Brief description (2-3 sentences).

## Implementation
- [ ] Step 1: Modify file X
- [ ] Step 2: Add tests
- [ ] Step 3: Update docs

## Acceptance Criteria
- Criterion 1
- Criterion 2

## References
- Related file paths
- Existing patterns
```

### STANDARD Template (100-200 lines):
```markdown
# Feature: [Title]

## Problem Statement
What problem are we solving? Who benefits?

## Current State
Brief analysis of existing implementation.

## Proposed Solution
High-level approach with key decisions.

## Implementation Plan

### Phase 1: Foundation
- [ ] Task 1.1: Setup/scaffolding
- [ ] Task 1.2: Core data structures

### Phase 2: Implementation
- [ ] Task 2.1: Primary logic
- [ ] Task 2.2: Integration points

### Phase 3: Quality
- [ ] Task 3.1: Tests (unit, integration)
- [ ] Task 3.2: Documentation

## Technical Details
- Key files to modify
- New files to create
- Dependencies to add

## Acceptance Criteria
Specific, testable conditions.

## Edge Cases
Known scenarios to handle.

## References
- File paths
- Related issues
- Documentation links
```

### COMPREHENSIVE Template (200-400 lines):
```markdown
# Feature: [Title]

## Overview
Executive summary with context and motivation.

## Problem Statement
### Current Pain Points
### User Impact
### Business Value

## Proposed Solution
### High-Level Architecture
### Key Design Decisions
### Trade-offs Considered

## Implementation Plan

### Phase 1: Discovery & Setup
- [ ] 1.1: Spike on approach X vs Y
- [ ] 1.2: Setup infrastructure/dependencies
- [ ] 1.3: Create interfaces/contracts

### Phase 2: Core Implementation
- [ ] 2.1: Implement component A
- [ ] 2.2: Implement component B
- [ ] 2.3: Wire integrations

### Phase 3: Edge Cases & Polish
- [ ] 3.1: Handle error scenarios
- [ ] 3.2: Performance optimization
- [ ] 3.3: Security hardening

### Phase 4: Testing & Documentation
- [ ] 4.1: Unit tests (target: X% coverage)
- [ ] 4.2: Integration tests
- [ ] 4.3: E2E tests if needed
- [ ] 4.4: Update documentation
- [ ] 4.5: Add migration guide if breaking

## Technical Specifications

### Files to Modify
- `path/to/file1.ts` - Changes needed
- `path/to/file2.ts` - Changes needed

### Files to Create
- `path/to/new-file.ts` - Purpose

### Dependencies
- `package-name@version` - Why needed

### API Changes
Before/after examples.

### Database Changes
Schema migrations if applicable.

## Testing Strategy
- Unit test approach
- Integration test scenarios
- Manual testing checklist

## Acceptance Criteria
1. Criterion with verification method
2. Criterion with verification method

## Edge Cases & Error Handling
- Scenario 1: How to handle
- Scenario 2: How to handle

## Performance Considerations
- Expected load/scale
- Optimization opportunities

## Security Considerations
- Auth/authz requirements
- Input validation
- Data protection

## Migration & Rollback
- Deployment steps
- Rollback procedure
- Breaking change mitigation

## References
- [Related Issue #123](url)
- [Design Doc](path)
- [Similar Implementation](path)
- [External Documentation](url)
```

3. Write the plan file using Write tool.

## Phase 5: Post-Generation

**Objective:** Guide next steps.

**Steps:**

1. Present plan summary to user.

2. Use AskUserQuestion to ask:
   ```
   Plan created at plans/<name>.md

   What would you like to do next?

   1. Start implementation (/workflows:work plans/<name>.md)
   2. Review the plan (/workflows:review plans/<name>.md)
   3. Create GitHub issue (I'll use gh issue create)
   4. Simplify the plan (reduce detail level)
   5. Something else
   ```

3. Based on response:
   - Option 1: Transition to /workflows:work
   - Option 2: Transition to /workflows:review
   - Option 3: Create issue with `gh issue create --title "..." --body-file plans/<name>.md`
   - Option 4: Rewrite plan with simpler template
   - Option 5: Ask for clarification

## Guidelines

- **Be thorough in research:** Better to over-research than under-plan
- **Ask questions early:** Clarify ambiguities before writing plan
- **Match detail to complexity:** Don't over-engineer simple changes
- **Include references:** File paths, similar code, external docs
- **Make it actionable:** Clear tasks that can be checked off
- **Consider the reader:** Plan should make sense to others on the team
