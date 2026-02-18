# Incident Postmortem Template

**Status:** Active **Last Updated:** 2026-01-12 **Maintainer:** Platform Team
**Document Type:** Incident Analysis Template

---

## Overview

This template guides incident investigation and documentation for Yellow Plugins
operational failures. It provides structured sections for capturing timelines,
root causes, contributing factors, and action items referenced in Architecture
§3.16 (Operational KPIs & Review Cadence) and Section 6 of the Verification &
Integration Strategy (test gating plus documentation deliverables).

**Purpose:**

- Standardize incident analysis across operational teams
- Ensure complete documentation for knowledge retention
- Drive continuous improvement through systematic review
- Link incidents back to metrics, KPIs, and verification requirements

**Related Documents:**

- [Operational Runbook](./runbook.md) - Incident response procedures
- [Metrics Guide](./metrics.md) - KPI definitions and alert thresholds
- [Operational Architecture](../.codemachine/artifacts/architecture/04_Operational_Architecture.md) -
  Section 3.16 KPI review cadence
- [Verification & Integration Strategy §6](../.codemachine/artifacts/plan/03_Verification_and_Glossary.md#6-verification-and-integration-strategy) -
  Defines evidence required for closure

---

## Postmortem Metadata

| Field                 | Value                                                |
| --------------------- | ---------------------------------------------------- |
| **Incident ID**       | [e.g., INC-2026-001]                                 |
| **Incident Date**     | [YYYY-MM-DD HH:MM UTC]                               |
| **Severity**          | [P0 / P1 / P2 / P3]                                  |
| **Services Affected** | [e.g., CLI install, publish workflow, CI validation] |
| **Duration**          | [Total time from detection to resolution]            |
| **Author**            | [Name/Team conducting postmortem]                    |
| **Review Date**       | [Date postmortem was reviewed]                       |
| **Reviewers**         | [Names of reviewers]                                 |

### Severity Definitions

| Level  | Impact                                     | Examples                                          |
| ------ | ------------------------------------------ | ------------------------------------------------- |
| **P0** | Production down / complete service outage  | Marketplace unavailable, all installs failing     |
| **P1** | Significant degradation, workaround exists | CI blocked, installs failing for specific plugins |
| **P2** | Degraded performance or limited scope      | Cache evictions frequent, rollback slow           |
| **P3** | Minor issue or cosmetic                    | Documentation outdated, metrics export slow       |

---

## Executive Summary

**In 2-3 sentences, describe the incident, impact, and resolution:**

[Example: On 2026-01-10, registry corruption caused 100% of plugin installs to
fail for 2 hours. The incident was resolved by restoring from backup
(registry.json.backup) and implementing atomic write verification. All users
were notified and no data was lost.]

---

## Timeline

Document key events in chronological order. Include all detection,
investigation, and remediation steps.

| Time (UTC)        | Event                         | Notes                                                  |
| ----------------- | ----------------------------- | ------------------------------------------------------ |
| **Detection**     |
| [HH:MM]           | Incident detected             | [How was it detected? Alert, user report, monitoring?] |
| [HH:MM]           | Initial investigation started | [Who started investigating?]                           |
| **Investigation** |
| [HH:MM]           | Root cause identified         | [What analysis led to identification?]                 |
| [HH:MM]           | Remediation plan decided      | [What options were considered?]                        |
| **Resolution**    |
| [HH:MM]           | Fix implemented               | [What fix was applied?]                                |
| [HH:MM]           | Verification completed        | [How was fix verified?]                                |
| [HH:MM]           | Incident closed               | [When was service restored?]                           |
| **Follow-up**     |
| [HH:MM]           | Postmortem published          | [When was this document completed?]                    |

---

## Impact Assessment

### KPI Impact

Reference metrics from the [Metrics Guide](./metrics.md), Architecture §3.16
KPIs, and Section 6 verification hooks (CI reports, telemetry exports, cache
audits).

| KPI                          | Target     | Actual During Incident | Deviation     | Status |
| ---------------------------- | ---------- | ---------------------- | ------------- | ------ |
| **Install Success Rate**     | ≥ 99%      | [%]                    | [+/- %]       | ❌/✅  |
| **Rollback Duration**        | < 60s      | [seconds]              | [+/- seconds] | ❌/✅  |
| **Cache Eviction Frequency** | [baseline] | [incidents/hour]       | [spike %]     | ❌/✅  |
| **Doc Update Latency**       | ≤ 2 days   | [days]                 | [+/- days]    | ❌/✅  |

### User Impact

- **Users Affected:** [Number or percentage of users impacted]
- **Commands Affected:** [List of CLI commands that failed or degraded]
- **Data Loss:** [Yes/No - describe if yes]
- **Workarounds Available:** [Yes/No - describe if yes]

### Metrics Evidence

Capture relevant metrics from `.ci-metrics/*.prom` or telemetry exports:

```prometheus
# Example: Registry corruption incident metric
yellow_plugins_registry_corruption_incidents_total 1

# Example: Install failure rate during incident
yellow_plugins_install_total{command="install",status="failure"} 42
yellow_plugins_install_total{command="install",status="success"} 0
```

---

## Root Cause Analysis

### Primary Root Cause

[Describe the fundamental technical or process failure that caused the incident.
Be specific.]

**Example:** Registry file (`.claude-plugin/registry.json`) was corrupted due to
non-atomic write operation during concurrent install commands. The write
operation was interrupted by system crash, leaving partial JSON that failed
validation.

### Contributing Factors

List all factors that contributed to the incident occurring or being worse than
it could have been:

1. **Technical Factor 1:** [e.g., Lack of atomic write implementation using temp
   file + rename]
2. **Process Factor 2:** [e.g., No automated registry backup validation in CI]
3. **Monitoring Gap 3:** [e.g.,
   `yellow_plugins_registry_corruption_incidents_total` metric not monitored]
4. **Documentation Gap 4:** [e.g., Recovery procedures not documented in
   runbook]

### Why It Happened (5 Whys)

Use the "5 Whys" technique to drill into root causes:

1. **Why did the incident occur?**
   - [First-level answer]

2. **Why did [first-level answer] happen?**
   - [Second-level answer]

3. **Why did [second-level answer] happen?**
   - [Third-level answer]

4. **Why did [third-level answer] happen?**
   - [Fourth-level answer]

5. **Why did [fourth-level answer] happen?**
   - [Root cause]

---

## What Went Well

Document positive aspects of the incident response:

- [✅ Detection was fast due to automated monitoring]
- [✅ Runbook provided clear remediation steps]
- [✅ Backup restoration completed without data loss]
- [✅ Team communicated effectively during response]

---

## What Went Poorly

Document areas for improvement:

- [❌ Alert thresholds were not configured for registry corruption metric]
- [❌ Recovery documentation was missing from runbook]
- [❌ Backup validation was manual, not automated]
- [❌ Users were not notified until 30 minutes after detection]

---

## Remediation Steps Taken

### Immediate Fixes (Applied During Incident)

| Action                        | Time Applied | Result              | Owner  |
| ----------------------------- | ------------ | ------------------- | ------ |
| Restored registry from backup | [HH:MM]      | ✅ Service restored | [Name] |
| Verified backup integrity     | [HH:MM]      | ✅ No data loss     | [Name] |
| Restarted affected workflows  | [HH:MM]      | ✅ Installs resumed | [Name] |

### Temporary Workarounds

- [Documented manual recovery steps for users with corrupted registries]
- [Increased backup frequency from daily to hourly during investigation]
- [Disabled concurrent install operations via feature flag]

---

## Action Items

All action items reference requirement IDs (FR/NFR/CRIT) and Architecture
sections for traceability.

### Short-Term Actions (1-2 weeks)

| Action                                           | Owner  | Due Date     | Requirement           | Status              |
| ------------------------------------------------ | ------ | ------------ | --------------------- | ------------------- |
| Implement atomic write semantics (temp + rename) | [Name] | [YYYY-MM-DD] | CRIT-018, NFR-REL-002 | [ ] Open / [x] Done |
| Add registry corruption recovery to runbook      | [Name] | [YYYY-MM-DD] | Architecture §3.7     | [ ] Open / [x] Done |
| Configure alerts for registry corruption metric  | [Name] | [YYYY-MM-DD] | Architecture §3.16    | [ ] Open / [x] Done |
| Add automated backup validation to CI            | [Name] | [YYYY-MM-DD] | NFR-REL-004           | [ ] Open / [x] Done |

### Medium-Term Actions (1-3 months)

| Action                                                   | Owner  | Due Date     | Requirement        | Status              |
| -------------------------------------------------------- | ------ | ------------ | ------------------ | ------------------- |
| Implement registry schema versioning                     | [Name] | [YYYY-MM-DD] | NFR-MAINT-003      | [ ] Open / [x] Done |
| Add concurrent install queue manager                     | [Name] | [YYYY-MM-DD] | Architecture §3.13 | [ ] Open / [x] Done |
| Update incident response runbook with postmortem process | [Name] | [YYYY-MM-DD] | Architecture §3.16 | [ ] Open / [x] Done |

### Long-Term Actions (3+ months)

| Action                                               | Owner  | Due Date     | Requirement        | Status              |
| ---------------------------------------------------- | ------ | ------------ | ------------------ | ------------------- |
| Explore distributed locking for multi-user scenarios | [Name] | [YYYY-MM-DD] | Architecture §3.13 | [ ] Open / [x] Done |
| Implement telemetry alerting dashboard               | [Name] | [YYYY-MM-DD] | Architecture §3.5  | [ ] Open / [x] Done |

---

## Lessons Learned

### Technical Lessons

1. **Atomic operations are critical for data integrity**
   - Non-atomic writes to registry files can cause corruption during interrupts
   - Always use temp file + atomic rename pattern for critical state files
   - Reference: CRIT-018, Architecture §3.4

2. **Backup validation must be automated**
   - Manual backup checks are insufficient for reliability targets
   - CI should validate backup integrity on every commit
   - Reference: NFR-REL-004, Architecture §3.7

### Process Lessons

1. **Alert configuration is as important as metric collection**
   - Collecting metrics without alerts delays incident detection
   - All critical metrics need alert thresholds defined upfront
   - Reference: Architecture §3.16 (Operational KPIs)

2. **Runbook completeness directly impacts MTTR**
   - Missing recovery procedures increased resolution time by 50%
   - Runbooks must cover all foreseeable failure scenarios
   - Reference: Architecture §3.7 (Operational Processes)

### Knowledge Sharing

- [How will these lessons be shared? Team meeting, documentation update,
  training?]
- [What updates are needed to onboarding materials?]
- [Which specification sections need amendment?]

---

## Prevention Measures

### Code Changes

- **PR #[number]:** Implement atomic registry writes using temp file pattern
- **PR #[number]:** Add registry backup validation to CI workflow
- **PR #[number]:** Add corruption detection and auto-recovery logic

### Process Changes

- **Update runbook** with registry corruption recovery procedures
- **Configure alerts** for `yellow_plugins_registry_corruption_incidents_total`
- **Add backup verification** to weekly operational checks

### Monitoring Enhancements

- **New metric:** `yellow_plugins_registry_backup_age_seconds` to track backup
  freshness
- **New alert:** Fire when backup age > 86400 seconds (24 hours)
- **Dashboard update:** Add registry health panel to operational dashboard

### Documentation Updates

- **Runbook:** Add "Registry Corruption Recovery" section referencing this
  postmortem
- **Metrics Guide:** Document KPI alert thresholds for registry operations
- **Onboarding:** Add registry integrity checks to developer setup checklist

---

## Verification

### How Was the Fix Validated?

- [✅ Integration test: Simulate system crash during registry write, verify
  recovery]
- [✅ Manual test: Interrupt install command, confirm automatic recovery]
- [✅ CI validation: Run backup verification in GitHub Actions workflow]
- [✅ Metrics validation: Confirm `registry_corruption_incidents_total` remains
  0 post-fix]

### Acceptance Criteria (Reference I4.T4 Task)

- [ ] All KPIs enumerated with owners + review cadence (see
      `docs/operations/metrics.md`)
- [ ] Runbook covers lifecycle script incidents, cache recovery, publish
      rollback (see `docs/operations/runbook.md`)
- [ ] Postmortem template linked from runbook escalation section
- [ ] Documentation cross-links Section 6 verification requirements

---

## Appendix

### Log Excerpts

```json
{
  "timestamp": "2026-01-10T14:32:10.123Z",
  "level": "error",
  "command": "install",
  "correlationId": "a3f2c9d8-1b4e-4a5c-9d7f-8e3c2a1b4d5e",
  "message": "Registry validation failed",
  "errorCode": "ERROR-REGISTRY-001",
  "data": {
    "registryPath": ".claude-plugin/registry.json",
    "parseError": "Unexpected token } in JSON at position 1234"
  }
}
```

### Metrics Snapshots

Attach or reference metrics files from `.ci-metrics/` or telemetry exports:

- **Metrics snapshot:** [link to .ci-metrics/incident-2026-001.prom]
- **Telemetry export:** [link to
  .claude-plugin/audit/telemetry-2026-01-10.jsonl]

### Related Issues

- **GitHub Issue #[number]:** [Link to incident tracking issue]
- **GitHub PR #[number]:** [Link to fix implementation PR]
- **Related Postmortems:** [Links to similar past incidents]

---

## Review Sign-off

| Reviewer | Role                  | Sign-off Date | Comments                       |
| -------- | --------------------- | ------------- | ------------------------------ |
| [Name]   | Platform Team Lead    | [YYYY-MM-DD]  | [Approved / Requested changes] |
| [Name]   | Operational Architect | [YYYY-MM-DD]  | [Approved / Requested changes] |
| [Name]   | Security Reviewer     | [YYYY-MM-DD]  | [Approved / Requested changes] |

---

## References

### Internal Documentation

- [Operational Runbook](./runbook.md) - Incident response procedures
- [Metrics Guide](./metrics.md) - KPI definitions and alert thresholds
- [CI Pipeline Spec](./ci-pipeline.md) - CI validation procedures
- [Traceability Matrix](../traceability-matrix.md) - Requirements coverage

### Architecture Documents

- [04_Operational_Architecture.md](../.codemachine/artifacts/architecture/04_Operational_Architecture.md) -
  Section 3.7, 3.16
- [03_Verification_and_Glossary.md](../.codemachine/artifacts/plan/03_Verification_and_Glossary.md) -
  Section 6 verification strategy

### Requirement References

- **CRIT-018:** Atomic operations validation
- **NFR-REL-002:** 100% rollback success rate
- **NFR-REL-004:** 100% schema validation coverage
- **NFR-MAINT-003:** Zero breaking changes per minor version

---

**Document Status:** Production-Ready Template **Next Review:** Quarterly
(alongside KPI review cadence per Architecture §3.16)

---

**END OF POSTMORTEM TEMPLATE**
