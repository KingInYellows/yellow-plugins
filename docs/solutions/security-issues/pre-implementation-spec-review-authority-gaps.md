---
title: "Pre-Implementation Spec Review: Authority and Trust-Boundary Gaps Survive Strong Error-Handling Discipline"
date: "2026-09-09"
category: "security-issues"
track: knowledge
problem: "Pre-implementation review of a 62-requirement remote-agent delegation spec: authority/trust-boundary gaps and late-amendment contradictions that non-adversarial personas missed"
tags:
  - pre-implementation-review
  - spec-review
  - authority-modeling
  - trust-boundary
  - adversarial-review
  - security-review
  - spec-coherence
  - late-amendment-drift
  - remote-agent-provider
  - requirement-cross-reference
components:
  - plans/specs/yellow-jules-integration.md
  - docs/brainstorms/2026-09-09-yellow-jules-integration-brainstorm.md
---

# Pre-Implementation Spec Review: Authority and Trust-Boundary Gaps Survive Strong Error-Handling Discipline

## Context

PR #785 (`docs(yellow-jules): brainstorm, spec, and shells for Jules
remote-agent provider`) added no code — a brainstorm, a 62-requirement spec,
and five implementation shells for a new remote-agent provider plugin
(`yellow-jules`), modeled on the existing `yellow-devin` provider. The spec
was written with strong "every outcome has a defined state" discipline
(explicit recoveryAction fields, R32's pause-on-unexpected-activity rule,
etc.). `/review:pr`'s always-on personas (correctness, maintainability,
project-compliance, project-standards) plus the conditional personas
`adversarial` and `security` (triggered by >5 requirements, new
abstractions, and an auth-adjacent domain) still surfaced 27 findings: 1 P0,
9 P1, and 17 P2. Two clusters stand out because they are not generic
correctness or completeness issues. The requirement ids below mark where
the spec as first submitted (commit `d9d4316d`) left each gap; the PR's
second commit amended every one in place, so none is a current defect:

1. **Authority/trust-boundary gaps** — cases where the spec defines what
   happens on success and failure, but not who is allowed to trigger the
   mutating action, what proves that authorization, or whether the record
   proving it can be forged or replayed. Concrete instances from the spec
   (requirement ids are from `plans/specs/yellow-jules-integration.md`):
   - R29 — "interactive" mutation authority is a caller-asserted flag;
     any process able to exec the CLI inherits it.
   - R30 — a grant record has no branch scope, though the authority
     check it backs (R53) is meant to authorize one branch.
   - R33 — no requirement fences vendor-originated text (plans,
     activities, questions, artifacts) before the supervising LLM reads it
     or a command prints it.
   - R19 — a policy-deviation record blocks new delegation but not
     `collect` or `integrate` of the already-flagged session's artifact.
   - R35 — the authority check trusts journal contents, but the journal
     location is env-var selected with no ownership/integrity requirement —
     a forged grant bypasses `authorize`.
   - R31/R36 — no journal lookup for an unresolved reservation before
     starting a new session (duplicate-session risk), and the
     authority-check + counter-increment + reservation-write sequence is
     not specified as one atomic critical section under the lock.
   - R38 — the directory lock can't detect a copied/restored data dir on
     a second host; no controller epoch binds a session to one controller.
   - R39 — no stop path: cancel is unsupported and expiry only refuses
     new instructions, so a runaway remote session has no containment
     procedure.
   - R7/R40 — a vendor-supplied session id becomes a filesystem path in
     `collect` with no anchored allowlist.
   - R41 — a vendor-authored patch can run dependency installs and
     lifecycle scripts on the controller host during `integrate`, before a
     human sees the diff.
   - R30/R48 — no host-neutral owner-confirmation primitive for
     `authorize`; nothing stops a granted session from widening its own
     grant.

2. **Self-contradictions from late text amendments** — three places where
   an amendment made in one section left a cross-referenced section
   unreconciled: R31 ("a grant is required before every write") vs. R29 and
   the command table (interactive writes without a grant, since PR2
   precedes grants); the artifact data model's "verified" gate vs.
   `integrate` being the step that performs verification (R41/R43); and the
   engine design's JSON-Lines run stream vs. R7's single-JSON-object CLI
   contract (R7/R59). None of these are typos — each is a coherent
   sub-design that stopped matching a requirement written earlier or later
   in the same document.

This is the same genre of finding as
[`yellow-devin-plugin-security-audit.md`](yellow-devin-plugin-security-audit.md)
(a prior pre-implementation audit of a comparable remote-agent provider
plugin, 21 findings across token security, session-ID injection, TOCTOU, and
MCP trust boundaries) — a second, independent instance of the same review
outcome: a plan can pass a thorough error-handling/completeness read and
still ship with authority modeling holes, because authority modeling is a
different question than "does every branch have an outcome."

## Guidance

When a spec has one component (supervisor, controller, orchestrator)
granting scoped, time-bound authority to another (delegate, remote agent,
subprocess, CLI invocation) to perform mutating actions, review it against
four questions that neither error-handling review nor a general "is this
requirement complete" pass will ask on its own:

1. **What does the grant name, and is that scope actually checked?** A
   grant that authorizes "this delegate" without naming the repo, branch,
   or operation it covers will be checked for *presence*, not *scope*, by
   any code that merely tests "is there a grant."
2. **What store holds the authority state, who can write to it, and is a
   write atomic with the check it gates?** An authority check that reads a
   journal or lock file is only as trustworthy as that file's
   ownership/integrity guarantees, and only as race-free as the atomicity
   of check + mutate + record.
3. **What is untrusted vendor/remote-originated content, and is it fenced
   everywhere it is read by an LLM or printed to a terminal?** Vendor text
   (plans, activities, patches, artifact metadata) is exactly the class of
   input the repo's own untrusted-input-fencing convention exists for; a
   spec that pauses only on *unexpected* vendor activity, never on the
   *content* of expected activity, has not applied that convention.
4. **Can a granted session extend, re-derive, or bypass its own authority?**
   Self-widening grants and caller-asserted authority flags both fail this
   check the same way: the thing being authorized is also the thing
   asserting the authorization.

Separately, treat "the spec was amended after most of it was already
written" as its own risk surface. A requirement number is a cross-reference,
not just local prose — an editor changing R31's rule needs to re-read every
place R29-and-earlier already answered the same question, and a reviewer
should re-derive requirement numbers used elsewhere rather than reading each
section in isolation. `yellow-docs:review:coherence-reviewer` exists
specifically to catch this; make sure it (or an equivalent contradiction
pass) actually runs on large, multiply-amended specs, not only the
domain-specific personas (`security-lens`, `adversarial-document-reviewer`).

## Why This Matters

`/review:pr` and `/docs:review` already gate `adversarial`/`security`-class
personas on size and domain heuristics (>5 requirements, new abstractions,
auth-adjacent domains). Those heuristics fired here because the spec was
large and obviously about delegated authority. A smaller spec that grants
privilege through a less obvious path (e.g., a config flag consumed by a
privileged shell, or a cross-plugin handoff) may not trip the same
heuristics, and none of the always-on personas (correctness, maintainability,
project-compliance/standards) ask the four authority questions above — they
ask whether logic is correct and consistent, not whether the thing being
described is safe to authorize. The takeaway is not "add more personas" but
"authority modeling is a checklist item independent of completeness,"
whether or not a persona happens to be triggered.

## When to Apply

- Authoring or reviewing any spec/plan where a supervisor grants scoped
  authority to a delegate to perform mutating actions — run the four
  authority questions explicitly, in addition to normal
  completeness/coherence review.
- Reviewing a diff that amends an already-large spec (tens of numbered
  requirements, authored over multiple sessions) — check whether the
  amendment's cross-references still hold elsewhere in the document, and
  make sure a coherence-focused pass runs, not just the domain personas.

## Examples

- [`yellow-devin-plugin-security-audit.md`](yellow-devin-plugin-security-audit.md)
  — a fuller worked pre-implementation audit of a comparable remote-agent
  provider plugin, same "adversarial lens over a plan with real but
  incomplete security discipline" pattern, different concrete gaps (token
  leakage, session-ID injection, TOCTOU, MCP response trust).
- PR #785 findings not itemized above but folded into the same review
  outcome: R52's shell-slice claim not matching what its scenarios actually
  need (`plans/specs/yellow-jules-integration.md`), and the brainstorm's
  "paste verbatim" instruction going stale against later spec edits
  (`docs/brainstorms/2026-09-09-yellow-jules-integration-brainstorm.md`)
  — both are spec-maintenance issues of the same "late edit, stale
  cross-reference" family as the three self-contradictions above, resolved
  by the same fix (re-anchor to the current requirement text, don't restate
  it elsewhere).
