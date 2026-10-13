# Phase 3: Pilot Skill Progressive Disclosure

Executed in the existing isolated WSL worktree on 2026-10-06. Existing Phase 1
changes were preserved. Generated artifacts are the coordinator’s write surface
and were not edited by this phase.

## Implemented

Shared-source ci-runner-health, ci-diagnose, and gt-setup now use concise
workflow entrypoints with three flat, skill-local references apiece. References
resolve from the active SKILL.md so the same source procedure works from an
installed plugin. The CI entrypoints retain validation, pre-display
sanitization, fixed-token connection/OS classification, same-invocation shell
scope, report shape, and the SSH confirmation gate. The Graphite entrypoint
loads prerequisite checks separately from user settings and convention-file
creation; report-only requests stop after prerequisites. Existing phase prompts
and overwrite/skip behavior survive.

All original fenced shell bodies were verified byte-identical in the new
references (6 runner-health, 6 diagnose, 7 setup). Formatting adjusted prose and
table alignment only. A frontmatter prettier-ignore comment preserves
single-line descriptions, as required by the authoring validator.

## Size Evidence

| Source skill     | Before lines / bytes | Entry point lines / bytes | Total entry + references bytes |
| ---------------- | -------------------- | ------------------------- | ------------------------------ |
| ci-runner-health | 995 / 55751          | 67 / 3776                 | 55882                          |
| ci-diagnose      | 612 / 36330          | 60 / 3384                 | 39233                          |
| gt-setup         | 440 / 18953          | 40 / 1949                 | 20393                          |

Machine-readable source hashes and per-reference sizes are in
[phase3-sizes.json](phase3-sizes.json). The smaller entrypoint is not a measured
task-token saving: loading all references can cost more than the previous
monolithic skill. Installed task-level tokens, tool usage and outcomes are
recorded separately in task-metrics.json and the final receipts.

## Thermonuclear Rubric Evaluation

The rubric remains 414 lines / 20,394 bytes. Its attribution and MIT notice,
opt-in trigger, read-only scope validation, nonce fencing, evidence-gated
file-size rule, concrete-alternative discipline, P1 ceiling, and compact JSON
report contract are cohesive behavior. There is no measured task evidence
supporting a further content split; removing that material would weaken
attribution or decision/output constraints. No rubric or sidecar policy was
edited by this phase. Explicit-only installed activation and negative
ordinary-review prompts are separate coordinator acceptance.

## Focused Verification

- Confirmed: 32 tests in ci-pilot-progressive-disclosure.test.ts execute the
  moved shell blocks with local fake gh/git/ssh/gt boundaries under bash and
  zsh. Fixtures cover metadata/log sanitization, fence escaping, repo override,
  latest-run failures/empty/invalid values, bounded log stream draining,
  executable private-target/key/name gates, first-use stderr separation,
  instruction-shaped OS data, fixed error categories, fresh SSH option/identity
  rebuilding, health/journal redaction, retrieval failure, and non-GNU-sed
  fail-closed behavior. The gt prerequisite block performs no
  auth/init/user-settings mutation.
- Confirmed: focused ESLint and Prettier checks for the new test, the three
  entrypoints, and their nine reference files exit 0.
- Confirmed: pnpm validate:agents, pnpm lint:plugins, pnpm
  validate:shell-compat, and SHELL_COMPAT_REQUIRE_ZSH=1 pnpm check:shell-parse
  exit 0. Other source and stale generated authoring warnings remain advisory;
  regeneration is the coordinator’s step.
- Confirmed: gt-workflow Bats (107 cases, one historical jq-only skip) and
  shell-compat Bats (21 cases) exit 0.
- Confirmed: yellow-ci Bats (286 cases, one markdown-orchestration scope skip)
  exits 0. The new integration suite executes the moved shell blocks; the
  skipped Bats case remains honest about model-orchestrated behavior.

Confirmation is interpreted model control flow, so its routing assertions are
not a live user refusal test. Installed reference discovery/loads, before/after
task tokens, complete approval behavior, and negative strict review activation
require the coordinator’s installed-session receipts.

## Changed Surfaces

Three source SKILL.md entrypoints; nine flat references; additive README.md and
CLAUDE.md sections for yellow-ci and gt-workflow; a two-plugin patch changeset;
one focused integration suite; this report and source-size data. No catalog,
manifest generator, generated artifact, package version, existing smoke harness,
commit, or remote mutation was changed by this phase.

## Final installed task evidence

pilot-before.json and pilot-after-final.json record four representative CI tasks
before and after the split; gt-before.json and gt-after-final.json record three
Graphite tasks. All pass. The final tasks load skill-local references from the
installed cache. CI diagnosis uses declared read-only fixtures, and
runner-health stops on the user's SSH refusal. Graphite setup remains
prerequisite/report-only. policy-final.json proves explicit thermonuclear
activation and no activation for implicit ordinary-review or unrelated prompts.

task-metrics.json records actual provider token notifications and tool/read
counts. CI observed cumulative tokens before/after: diagnosis 91,916/78,061,
missing auth 71,120/65,671, SSH refusal 126,955/65,442 and unrelated
17,903/18,005. These are single-run observations with different cache states and
prompt/tool trajectories, not a controlled savings estimate. The Graphite
baseline exposes one staged skill whereas the final plugin exposes eleven, so
its token totals are not comparable as an efficiency claim. The structural split
is justified by smaller discovery entrypoints and preserved behavior, not a
claimed reduction in task cost.
