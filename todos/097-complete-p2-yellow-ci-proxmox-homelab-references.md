---
status: complete
priority: p2
issue_id: "097"
tags: [code-review, yellow-ci, public-release, internal-details]
dependencies: []
---

# Proxmox/Homelab References in yellow-ci Plugin Files

## Problem Statement

The yellow-ci plugin.json description and keywords were cleaned in Phase 5, but
6 Proxmox references and 1 "homelab" SSH key name remain in user-facing plugin
files (skills, agents, README). These reveal internal infrastructure details.

## Findings

1. `plugins/yellow-ci/README.md:93` — `ssh_key: ~/.ssh/homelab` (personal key
   name in example config)
2. `plugins/yellow-ci/skills/ci-conventions/references/failure-patterns.md:32` —
   "Increase VM memory in Proxmox"
3. `plugins/yellow-ci/skills/ci-conventions/references/failure-patterns.md:52` —
   "Resize disk in Proxmox"
4. `plugins/yellow-ci/skills/ci-conventions/references/failure-patterns.md:115`
   — "Check firewall rules on Proxmox host"
5. `plugins/yellow-ci/skills/diagnose-ci/SKILL.md:13` — "Proxmox runners"
6. `plugins/yellow-ci/agents/maintenance/runner-diagnostics.md:35` — "Proxmox
   VMs"
7. `plugins/yellow-ci/agents/maintenance/runner-diagnostics.md:131` — "suggest
   checking Proxmox"

## Proposed Solutions

### Option A: Generalize to "hypervisor" (Small effort)

Replace "Proxmox" with generic terms: "hypervisor", "VM host", "host machine".
Replace `~/.ssh/homelab` with `~/.ssh/runner-key`.

- **Pros:** Generic, works for any virtualization platform
- **Cons:** Slightly less specific in failure pattern remediation steps
- **Effort:** Small
- **Risk:** Low

### Option B: Keep Proxmox, remove homelab only (Minimal effort)

Proxmox is a legitimate, well-known hypervisor. Only change the SSH key name.

- **Pros:** Proxmox references are technically accurate and helpful
- **Cons:** Still tied to one hypervisor vendor
- **Effort:** Minimal
- **Risk:** None

## Recommended Action

_To be filled during triage_

## Technical Details

- **Affected files:** 4 files in plugins/yellow-ci/
- **Changes needed:** Text replacements only

## Acceptance Criteria

- [ ] No `homelab` references in any plugin file
- [ ] Proxmox references either removed or explicitly accepted

## Work Log

| Date       | Action          | Notes                                    |
| ---------- | --------------- | ---------------------------------------- |
| 2026-02-18 | Finding created | PR #24 review — internal infra details   |

## Resources

- PR: #24
- Phase 5 already cleaned plugin.json description and keywords
