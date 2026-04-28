---
"yellow-debt": minor
"yellow-ci": minor
---

Add prompt-injection hardening to debt scanners and CI agents

Adds the CRITICAL SECURITY RULES + content-fencing block (already present in
yellow-core and yellow-review review agents) to 5 yellow-debt scanners
(ai-pattern, architecture, complexity, duplication, security-debt) and 4
yellow-ci agents (failure-analyst, workflow-optimizer, runner-assignment,
runner-diagnostics). These agents read untrusted content (source code, CI
logs, workflow files) and benefit from the same injection-defense posture as
the review agents.

- yellow-debt scanners use the canonical pattern from yellow-core review
  agents (`--- code begin ---` fence, "code comments" wording) which matches
  the `debt-conventions` skill.
- yellow-ci agents use artifact-typed delimiters (`--- begin ci-log ---`,
  `--- begin workflow-file: <name> ---`, `--- begin runner-output: ... ---`,
  `--- begin lint-findings ---`, `--- begin runner-targets-config ---`)
  defined in the `ci-conventions` skill, since CI agents process logs and
  workflow files rather than source code.
- `runner-diagnostics` intentionally has a sixth Do NOT bullet
  ("Run any SSH command not pre-authorized in the diagnostic playbook") on
  top of the canonical 5-bullet list — the SSH execution surface is unique to
  this agent and warrants the explicit pre-auth constraint.
- `failure-analyst` previously had a separate `## Security Rules` section that
  duplicated the CRITICAL SECURITY RULES block; that section has been
  collapsed into a one-line operational pointer to keep the new block as the
  single authoritative source.
