# AI Coding Agent - Architectural Decision Record Template

Use this template to document architectural decisions that affect the Yellow Plugins workspace.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [ADR Metadata](#adr-metadata)
- [Traceability References](#traceability-references)
- [Executive Summary](#executive-summary)
- [Context & Problem Statement](#context--problem-statement)
  - [Problem Description](#problem-description)
  - [Constraints & Requirements](#constraints--requirements)
  - [Triggering Event](#triggering-event)
- [Decision Drivers & Criteria](#decision-drivers--criteria)
- [Options Considered](#options-considered)
- [Decision](#decision)
- [Implementation Details](#implementation-details)
- [Architecture & Design Impact](#architecture--design-impact)
- [Consequences & Impact Analysis](#consequences--impact-analysis)
- [Validation & Monitoring](#validation--monitoring)
- [Agent Reasoning Chain](#agent-reasoning-chain)
- [Follow-up Actions](#follow-up-actions)
- [Approval & Review](#approval--review)
- [Agent Completion Metadata](#agent-completion-metadata)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## ADR Metadata

- **ADR ID**: ADR-[AUTO-GENERATED-NUMBER]
- **Agent ID**: [AGENT_IDENTIFIER]
- **Task ID**: [TASK_REFERENCE_ID]
- **Date**: [TIMESTAMP]
- **Duration**: [TASK_EXECUTION_TIME]
- **Status**: [Proposed | Accepted | Implemented | Superseded | Deprecated]
- **AI Model/Version**: [MODEL_USED]
- **Confidence Level**: [High | Medium | Low]

## Traceability References

- **Functional Requirements (FR IDs)**: [FR-00X, ...]
- **Non-Functional Requirements (NFR IDs)**: [NFR-PERF-00X, ...]
- **Risk IDs / CRIT references**: [CRIT-00X, ...]
- **Specification Anchors**: [Section references that justify this ADR]

## Executive Summary

Provide a concise statement describing what decision was made and why it matters.

## Context & Problem Statement

### Problem Description

Describe the business, product, or technical need that triggered this ADR.

### Constraints & Requirements

- Functional requirements that the decision must satisfy
- Non-functional requirements (performance, reliability, security, etc.)
- Technical or business constraints (timeline, budget, compliance, integrations)

### Triggering Event

Document the request, incident, or discovery that required this decision.

## Decision Drivers & Criteria

List the top factors that influenced the decision. When helpful, capture a lightweight scoring matrix with weights.

## Options Considered

For each option include the description, pros/cons, cost/effort, risk level, and explicit FR/NFR coverage notes.

## Decision

- **Chosen Option**: [Name]
- **Rationale**: Explain why this option best satisfies the decision criteria,
  what tradeoffs were accepted, and how the related FR/NFR items remain compliant.
- **Decision Matrix** (optional):

  | Option | Driver 1 | Driver 2 | Driver 3 | Weighted Total |
  |--------|---------|----------|----------|----------------|
  | Option A | [Score] | [Score] | [Score] | [Total] |
  | Option B | [Score] | [Score] | [Score] | [Total] |
  | Selected | [Score] | [Score] | [Score] | [Total] |

## Implementation Details

- **Technical Approach**: Outline the implementation steps, data/model changes, and configuration updates.
- **Dependencies**: List upstream/downstream services, packages, or schema artifacts affected.
- **Integration Points**: Describe interfaces, contracts, or pipelines touched by this ADR.
- **Configuration/Setup**: Specify any environment variables, feature flags, or automation tasks that must be run.

## Architecture & Design Impact

- **System Architecture Changes**: Summarize how the decision modifies diagrams or component responsibilities.
- **Code Organization**: Note new modules, refactored files, or deprecated packages.
- **Component Design**: Provide tables or bullet lists describing new/modified components,
  their purpose, interfaces, and dependencies.
- **Data Flow & Integration**: Document how data moves across layers after this decision.
- **Quality Attributes**: Call out expected effects on performance, reliability, maintainability, and security.
- **Technology Stack Impact**: Identify any new libraries, tooling, or infrastructure brought in by this decision.
- **Compliance**: Confirm alignment with architecture rulebook items (e.g., Section 4 directives, FR/NFR IDs).

## Consequences & Impact Analysis

- **Positive Consequences**: Benefits unlocked by the decision.
- **Negative Consequences/Risks**: Known drawbacks or risks with mitigation strategies.
- **Impact Assessment**: Include blast radius analysis, rollback considerations, and stakeholder impact.

## Validation & Monitoring

- **Success Metrics**: Define measurable outcomes tied to FR/NFR targets.
- **Monitoring Plan**: Describe dashboards, alerts, or manual checks required.
- **Rollback Plan**: Enumerate criteria for reverting and the exact steps to do so safely.

## Agent Reasoning Chain

- **Decision Process**: Summarize the analysis path, including tools or scripts that informed the choice.
- **Knowledge Sources**: Reference documents, diagrams, or datasets consulted.
- **Collaboration Notes**: Mention any human approvals or cross-team reviews obtained.

## Follow-up Actions

- **Immediate Next Steps**: Checklist of tasks that must be completed after accepting the ADR.
- **Future Considerations**: Ideas to revisit once more data is available or constraints change.
- **Related ADRs**: Link to previous or superseding ADRs for continuity.

## Approval & Review

- **Stakeholders Consulted**: Names or roles that must review this ADR.
- **Human Review Required**: Indicate whether sign-off is mandatory before implementation.
- **Review Status**: Track approval states or outstanding questions.

## Agent Completion Metadata

- **Author Notes**: Optional context for future agents or reviewers.
- **Attachments**: Links to diagrams, experiments, pull requests, or validation logs.
- **Completion Checklist**:

  ```text
  - [ ] Traceability updates committed (FR/NFR references)
  - [ ] Tests/lint/docs plans updated
  - [ ] Rollback/monitoring playbooks refreshed
  ```
