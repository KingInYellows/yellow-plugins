# Feature: Bounded Authority, Supervision, and Codex Surface (PR3)

## Overview

With the runtime and routing live, this shell ships the three mutating commands
(`delegate`, `reply`, `approve`, moved here from shell 02 by the Open Question 6
decision, 2026-09-10). It also adds what lets a supervisor act without asking at
every step while staying inside limits the owner sets:

- a grant object created by a dedicated command;
- a runtime authority check on every mutation;
- a bounded one-pass supervision loop;
- pause-on-outside-activity behavior.

It also makes Codex a first-class host by exposing two host-neutral skills
through the generator and documenting the single-controller handoff procedure.

## Origin

- Spec: `plans/specs/yellow-jules-integration.md`
- Covers: R8 (partial: mutating-authorize-and-supervise-commands), R24
  (partial: live-jules-dispatch-branch), R28 (partial:
  codex-distribution-doc), R29, R30, R31, R32, R33 (partial:
  supervision-loop), R34, R38, R39, R44, R45, R46, R47, R48, R52 (partial:
  mutating-surface-grant-and-lock-scenarios), R53 (partial:
  procedure-and-checklist)
- Shell: yellow-jules-integration-03-authority-supervision-and-codex
- Depends on: `plans/complete/yellow-jules-integration-02-runtime-provider-and-claude-routing.md`

## Decisions Fixed at Expansion (2026-10-08, owner)

- **Spec Open Question 6, R29 confirmation authentication: grants only, with a
  TTY-confirmed `authorize`.**
  - There is no per-operation confirmation token. Every real (non-dry-run)
    mutation (`delegate`, `reply`, `approve`, and the writes `supervise`
    triggers) requires `--grant-id`. Without one, the call returns
    `JULES_CONFIRMATION_REQUIRED`, and its `recoveryAction` names the exact
    `authorize` command to run.
  - `authorize` is the only trust root. The runtime opens `/dev/tty` itself,
    prints the grant summary there, and requires the owner to type back a
    random challenge code.
  - A caller with no controlling terminal cannot satisfy that prompt. That
    covers the agent's Bash tool, the Codex sandbox, the engine's closed-stdin
    process interface (R59), and CI. Whether stdin is a TTY is never consulted.
  - The same TTY gate guards `abandon` and `supervise --clear-pause`, because
    both widen effective authority.
  - R29 is satisfied by the "grants only" option that Open Question 6 itself
    lists. The Claude wrappers keep an AskUserQuestion preview before using a
    grant (R8's UX gate), but enforcement is the grant.
- **Spec Open Question 5, grant MAC: none.**
  - Any key the runtime can read is readable by a process running as the same
    UID, the agent included.
  - Integrity rests on four controls: `0600` permissions, the separate
    `state/grants.json` written only by the TTY-confirmed `authorize` path, the
    R38 host-local controller epoch and path binding, and the fact that a
    grant can only narrow under the runtime.
  - Same-UID forgery of `grants.json` is recorded as residual risk in
    `plugins/yellow-jules/CLAUDE.md`.
- **Spec Open Question 4.** `authorize` is not wrapped by any Codex skill
  (R48). Because it is a TTY command, the owner can run it from any terminal
  on the controller host. Recording that this resolves Open Question 4 is a
  spec-owner follow-up, not done in this PR.
- **Spec Open Question 2** (Codex capabilities) is discovered in Step 30 and
  recorded in `docs/yellow-jules/capability-matrix.md`.
- **Whether the R53 smoke surfaces a vendor PR** is recorded in the smoke
  result template (Step 37) and decided before shell 04 starts.

## Pattern Survey

**PR3 seams left by shell 02**

| Location | What PR3 changes |
| --- | --- |
| `plugins/yellow-jules/src/cli.ts:42-49` `LATER_OPERATIONS` | Move delegate, reply, approve, authorize and supervise out (`integrate` stays) into `KNOWN_OPERATIONS`. |
| `cli.ts` `dispatch()` (`:107`) | Add a case per subcommand (strict `parseArgs`). |
| `src/runtime.ts:631-649` `reconcileInPr2()` | Replace with the real reconcile. |
| `src/sdk-adapter.ts:14`, `src/types.ts:142` | Wire `session()`, `send()` and `approve()`. |
| `src/activity-walk.ts:3` | Already lists `approve (PR3)` as a caller. |

**Reusable state primitives in `src/state.ts`**

- `reserveOperation` (`:616`) already runs the R36 unresolved lookup and the reservation write in one critical section.
- `ReservationInput` (`:596`) already carries `grantId`, `promptDigest` and `observedPlanId`.
- Lock and journal helpers:
  - `withJournalLock` (`:480`), `updateJournal` (`:498`)
  - `markOperation` (`:691`), `recordDeviation` (`:1033`)
  - `hasUnreconciledDeviation` (`:1064`)
  - `findUnresolvedOperations` (`:559`), `findBySessionResource` (`:536`), `findByLocalId` (`:545`)
- `UNRESOLVED_STATUSES` (`:82`), `TERMINAL_STATUSES` (`:76`).

**Types in `src/types.ts`**

- `OperationKind` (`:160`) and `OperationStatus` (`:170`) already include `create|reply|approve` and `failed`.
- `OperationRecord` (`:217`) already has `grantId`, `deviations` and `pendingPlan`.
- No grant type, controller reference or supervision state exists yet.

**Errors in `src/errors.ts`**

- Codes already declared (`:58-84`, table `:156-186`): `JULES_CONFIRMATION_REQUIRED`, `JULES_AUTHORITY_DENIED`, `JULES_GRANT_EXPIRED`, `JULES_STALE_LOCK`, `JULES_UNKNOWN_OUTCOME`, `JULES_DUPLICATE_LAUNCH`, `JULES_POLICY_DEVIATION`, `JULES_DEADLINE_EXCEEDED`.
- Only `after-dispatch` `CallPhase` yields an unknown outcome.
- `// replica:AppError` and `makeAppError` blocks are drift-checked against yellow-cursor by `scripts/validate-jules.js:55-63`. Add new codes outside those blocks.

**Other reusable helpers**

- `redact.ts`: `redactDeep`, `fenceUntrusted` and `FENCE_BEGIN`/`FENCE_END` (`:170`), `assertNoSecretShapedValues` (`:79`; `prompt` is a banned key, so store `promptDigest` only).
- `validate.ts`: `validateRequestId`, `validateTaskRef`, `validateSessionResource`, `validatePlanId`, `mintLocalId`, `validatePositiveInt`, `sourceResourceFor`.
- `config.ts`: `ensureOwnerOnlyDir`, `assertOwnerOnlyFile`, `assertDataDirLocation`. No grants or controller path resolver exists yet.

**Tests**

- `tests/fake-http-server.ts`:
  - already routes `POST /sessions` (`:344`) and `:sendMessage|:approvePlan` (`:386`);
  - counts `mutatingCount` (`:207`);
  - lacks failure injection and request-body capture.
- `tests/fake-sdk.ts`: `FakeSdkAdapter` (`:69`) and `makeDeps` (`:196`) have no write methods.
- `tests/offline-coverage.test.ts:414-440`: the zero-mutating-requests test must be narrowed to the read-only subcommands.
- `tests/unsupported-capability.test.ts:38` ("adapter exposes no mutating method") must be rewritten.

**Wrappers**

- `commands/jules/collect.md:1-101` is the frontmatter, Bash, jq-allowlist, random-tag fence and error-table pattern.
- `plugins/yellow-cursor/commands/cursor/delegate.md:53-130` is the dry-run → AskUserQuestion → real-run pattern, with the request id reused and never auto-retried.

**Linear route**

- `plugins/yellow-linear/commands/linear/delegate.md:581-587` is the fail-closed `**Jules.**` branch. Rows sit at `:656`, `:674` and `:693`, and the probe at `:162-186`.
- Its tests in `plugins/yellow-linear/tests/delegate.bats`: `:221` asserts the stub and `:228` asserts that the CLI is never invoked.

**Codex**

- `catalog/plugins/yellow-review.json` and `yellow-core.json:71-74` show the enabled-block shape. `catalog/plugins/yellow-jules.json:26-28` is currently `enabled: false`.
- `scripts/generate-manifests.js` writes `codex/skills/`, `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`.
- `scripts/validate-codex.js` provides `runExposureLint` (patterns at `:175-212`, `:304-316`).
- `tests/integration/generate-manifests-codex.test.ts` is fixture-based, with no committed snapshot.
- `docs/codex-distribution.md:36-38` has the "**Four** plugins" list and order, `:54` the exposure lint, and `:83` known constraints.
- The `plugins/yellow-cursor/skills/cursor-delegation/SKILL.md` frontmatter and section shape is the host-neutral model.
- Lint blind spots (`AskUserQuestion`, `Task`, `Skill`, out-of-allowlist skill prose) must be grepped by hand (`docs/solutions/integration-issues/codex-skill-exposure-validator-blind-spots.md`).

**Conventions**

- Keep `src/` flat and kebab-case, with single-concern modules.
- Inject dependencies, with `env = process.env` as a default parameter.
- Put new logic in new modules rather than `runtime.ts` (about 1000 lines).
- Never swallow errors in authority or controller code: no bare `catch {}`.
- Shape-validate every parsed file.
- Use `Object.create(null)` maps.
- Rebuild and commit `dist/` after every `src/` change.
- Keep skill names distinct from command names (`jules-delegation`/`jules-supervision` vs `jules:*`).
- Skill headings must be `## What It Does`, `## When to Use` and `## Usage` (RULE 15b).
- `references/` must be flat.

**Smoke docs**

- `docs/operations/post-w3-functional-smoke-test.md`, with sectioned checklists and `Expected:` lines, is the closest procedure template.
- No `smoke-result.md` exists anywhere yet.

## Implementation

### Phase A: contract and state model

- [x] Step 1: Update `docs/yellow-jules/contract-v1.md`.
  - **Confirmation token section:** replace its body with the grants-only plus TTY-`authorize` mechanism, keeping the OQ6 history paragraph. Drop the token-survives-`redactDeep` constraint. Add that the challenge code never appears in any envelope, argv, or journal.
  - **Subcommand shapes:** fix the shapes for `authorize`, `authorize --list`, `authorize --revoke`, `supervise`, `supervise --clear-pause`, and `abandon`. Mark them PR3 in the Subcommands table.
  - **Local state, R38:** fix the controller authority file shape and the `JULES_CONTROLLER_MISMATCH` code.
  - **Autonomy boundaries:** add the documented ceilings.
- [x] Step 2: Annotate spec Open Questions 5 and 6 in `plans/specs/yellow-jules-integration.md` with the 2026-10-08 decisions. These are docs-only one-line "Decided" notes.
- [x] Step 3: Add the new types to `plugins/yellow-jules/src/types.ts`.
  - `GrantOperation = 'create'|'reply'|'approve'|'collect'`.
  - `GrantRecord`, with these fields:
    - `grantId` (`jg-<32 hex>`), `repository`, `sourceResource`, `branchPattern`, `taskRefs[]`, `operations[]`;
    - `maxActiveSessions`, `maxTotalTasks`, `maxCorrectiveRounds`;
    - `expiresAt`, `createdAt`, `owner`, `controllerId`, `epochRef: { controllerId, epoch }`, `revokedAt?`;
    - `usage: { activeSessionRefs: string[], totalTasks, correctiveRounds: Record<taskRef, n> }`.
  - `GrantsFile = { version: 1, grants }`, built with `Object.create(null)`.
  - `SupervisionState` on `OperationRecord`: `{ paused?: { reason, observedAt, activityId? }, backoff?: { failures, nextCheckAt }, lastDecision? }`.
  - `abandonedAt?` and `abandonReason?` on `OperationRecord`. `abandon` maps onto terminal `failed`; no new status is added.
- [x] Step 4: Extend `src/validate.ts` with `validateGrantId`, `validateBranchPattern`, `validateOperations` and `validateControllerId`. Branch patterns are an exact ref or a single trailing `*` glob, anchored and length-bounded.
- [x] Step 5: Extend `src/config.ts` with two resolvers.
  - `resolveGrantsPath` returns `state/grants.json`.
  - `resolveControllerDir(env = process.env)`:
    - The precedence is `YELLOW_JULES_CONTROLLER_DIR` > `$XDG_STATE_HOME/yellow-jules-controller` > `~/.local/state/yellow-jules-controller`.
    - It must resolve outside `<dataDir>` by canonical path; otherwise it fails with `JULES_DATA_DIR`.
    - It is created `0700`, using `ensureOwnerOnlyDir`.
- [x] Step 6: Add `JULES_CONTROLLER_MISMATCH` to `src/errors.ts`, outside the `replica:` markers.
  - `retryable: false`.
  - recovery: "this data directory is not the authorized controller copy; follow the handoff procedure in the plugin CLAUDE.md".
  - Also add `JULES_GRANT_EXHAUSTED`, with recovery "create a new grant with `authorize`", and `JULES_SUPERVISION_PAUSED`, with recovery "inspect the session, then run `supervise --clear-pause` in a terminal".
  - Set the R39 containment text as the `JULES_GRANT_EXPIRED` recoveryAction: vendor console stop, source-connection revocation, API-key rotation.
  - Run `node scripts/lint-error-codes.js`.

### Phase B: controller authority, grants, TTY gate

- [x] Step 7: Create `src/controller.ts` with `readControllerAuthority`, `initControllerAuthority`, `assertControllerAuthority` and `takeOverController`.
  - **`readControllerAuthority(controllerDir, controllerId)`** reads `<controllerDir>/<controllerId>.json` = `{ controllerId, epoch, dataDir: <canonical realpath>, updatedAt }`. It shape-validates the file and requires it to be `0600` and owner-owned.
  - **`initControllerAuthority`** runs on the first `authorize` when no file and no grants exist. It writes epoch 1.
  - **`assertControllerAuthority(dataDir, epochRef)`** throws `JULES_CONTROLLER_MISMATCH` in three cases: the file is missing, the epoch differs, or the canonical data-dir path differs.
  - **`takeOverController`** serves the handoff: it writes epoch+1 for this host and path, then rewrites every grant's `epochRef` under the lock. It runs only inside a TTY-confirmed `authorize --take-over`.
  - The controller id defaults to `os.hostname()` and is validated.
  - The module takes no `process.env` reads, only injected deps.
- [x] Step 8: Create `src/authority.ts` with `loadGrants`, `evaluateAuthority`, `chargeGrant`, `releaseGrant`, `listGrants` and `revokeGrant`.
  - **`loadGrants`** shape-validates the file. A corrupt grants file returns `JULES_JOURNAL_CORRUPT`; it is never treated as empty.
  - **`evaluateAuthority(grant, request, now)`** is pure. It returns `ok` or a typed denial in this order:
    1. revoked
    2. expired → `JULES_GRANT_EXPIRED`
    3. repository or `sourceResource` mismatch
    4. branch outside the pattern
    5. task ref outside `taskRefs`
    6. operation outside `operations`
    7. limits exhausted → `JULES_GRANT_EXHAUSTED` (active sessions, total tasks, corrective rounds per task)
    8. an unreconciled `policy-deviation` on any session under the grant (R13)
  - **`chargeGrant` and `releaseGrant`** handle counters.
    - Reserved and unknown-outcome operations count against the limits (R31).
    - `releaseGrant` is callable only from reconcile and abandon paths, never from a write path.
    - `totalTasks` never decrements.
  - **`listGrants` and `revokeGrant`.** Revocation needs no TTY because it only narrows authority.
- [x] Step 9: Create `src/tty-confirm.ts` with `confirmOnTty`.
  - **`confirmOnTty({ summary, deadlineMs, openTty = defaultOpenTty })`** opens `/dev/tty` read-write.
    - `ENXIO`, `ENOENT` or `EACCES` → `JULES_CONFIRMATION_REQUIRED`, with recovery "run this command yourself in a terminal on the controller host".
    - On `win32` → `JULES_UNSUPPORTED_CAPABILITY`.
  - **Prompt.** It writes the redacted summary and a 6-character challenge from `crypto.randomBytes`. It uses an unambiguous base32 alphabet chosen so it matches no redaction layer.
  - **Response.** It reads one line within the deadline and compares in constant time. A mismatch or EOF → `JULES_AUTHORITY_DENIED`.
  - **Output channels.** Nothing goes to stdout or stderr, and the code is never logged.
  - **Tests.** They inject a fake `openTty`; the real `/dev/tty` path is exercised only in the manual smoke.
- [x] Step 10: Add `authorize` in a new `src/authorize.ts`, with its CLI case in `cli.ts`.
  - **Flags:** `authorize --repo --branch <ref|pattern> --source? --task-ref (repeatable) --operations create,reply,approve,collect --max-active-sessions --max-total-tasks --max-corrective-rounds --ttl-minutes --owner [--take-over]`.
  - **Defaults (R30):** 1 active session, 3 tasks, 2 corrective rounds, 120 minutes.
  - **Documented ceilings** (constants in `authority.ts`, stated in the contract and README): 3 active sessions, 10 tasks, 3 corrective rounds, 24 hours. Anything over a ceiling → `JULES_INVALID_INPUT`.
  - **Source:** resolved via the adapter's `getSource` (R17).
  - **Flow:**
    1. Run `confirmOnTty` before the lock is taken.
    2. Under `withJournalLock`, init or assert the controller authority and write the grant atomically.
  - **Output:** `{ grantId, repository, sourceResource, branchPattern, taskRefs, operations, limits, expiresAt, controllerId, epoch }`.
  - **List and revoke:** `authorize --list` returns `{ grants: [...with usage, expired, revoked] }`, and `authorize --revoke <grantId>` returns `{ grantId, revokedAt }`.
  - **Refusals:** `authorize` takes no `--grant-id` and refuses when `YELLOW_JULES_ACTIVE_GRANT` is set (exported by the supervision skill), so a grant can never be created or widened from inside a supervised session (R30). The TTY gate covers the case where that variable is absent.

### Phase C: mutating operations

- [x] Step 11: Extend the `SdkAdapter` port in `src/types.ts` and `JulesSdkAdapter` in `src/sdk-adapter.ts` with `createSession(config)`, `sendMessage(sessionResource, message)` and `approvePlan(sessionResource)`.
  - `createSession` uses `buildCreateSessionConfig` (`:125`) with `requireApproval: true` and `autoPr: false` (R12).
  - These methods are never retried. Errors are classified by `CallPhase`, so anything after dispatch becomes `JULES_UNKNOWN_OUTCOME` while keeping any known session id (R16).
  - Do not add `run`, `all`, `result`, `ask` or `waitFor` (R9).
  - Rewrite `tests/unsupported-capability.test.ts:38` so it asserts that only these three writes exist and that there is still no cancel, pause or resume method.
- [x] Step 12: Create `src/mutations.ts` with `delegate(deps, input)`.
  - **Dry run:** validation plus `getSource`, returning the contract's dry-run shape with no reservation.
  - **Real run:**
    1. Require `--grant-id`, or fail with `JULES_CONFIRMATION_REQUIRED`.
    2. In one `updateJournal` critical section: `assertControllerAuthority`, `loadGrants`, `evaluateAuthority({op:'create'})`, `findUnresolvedOperations` (R36), `chargeGrant`, then `reserveOperation` with `grantId` and `promptDigest`.
    3. Issue the single POST with the title tag `[yellow:<local-id>] <title>`.
    4. On success, `markOperation('accepted')` and bind `sessionResource`.
    5. After dispatch, mark `unknown-outcome` and keep the charge (R31).
  - **Repair tasks (R44):** `--correction` charges `correctiveRounds[taskRef]` and requires a `--task-ref` already in the grant.
- [x] Step 13: Add `reply(deps, input)` to `src/mutations.ts`.
  - Run the same critical section, with `op:'reply'`, the message `sha256` digest, and `--correction` charging a corrective round.
  - Issue one non-blocking POST (R9).
  - The dry run does one `info()` and returns `sent: false, dryRun: true`.
- [x] Step 14: Add `approve(deps, input)` to `src/mutations.ts`, following the contract `approve` paragraph exactly.
  - **Pre-POST check:** the `info()` state must be `awaitingPlanApproval`. Run `walkActivities` from `pendingPlan.activityCreateTime` minus 5 min, within 40 % of the deadline, and it must reach the newest page.
  - **Pre-POST failures:**
    - a partial walk → `JULES_INVALID_STATE`, with the cause-split recoveryAction;
    - a newest plan different from `--plan-id` → `JULES_POLICY_DEVIATION`.
  - **POST and re-read:** run the authority critical section, then the POST, then a re-read from the same start.
  - **Post-POST results:**
    - a mismatch records a deviation via `recordDeviation` (R34);
    - a partial re-read gives `verificationDeferred: true`.
  - Document in the JSDoc that the endpoint takes no plan id, so compare-and-approve is not atomic.
- [x] Step 15: Replace `reconcileInPr2()` (`runtime.ts:631-649`) with `reconcile()` in a new `src/reconcile.ts`.
  - `delegate` reservations are resolved by the shared sessions walk: tag regex, 5-page cap, archive-visibility gate.
  - `reply` and `approve` are resolved on their own session, with digest or plan-id matching inside the overlap window.
  - Every outcome follows the contract `status` paragraph.
  - Grant release:
    - `released` calls `releaseGrant`.
    - `bound` keeps the active-session charge.
    - Observing a terminal vendor state (`completed`/`failed`) on a bound session during `status` releases the active-session slot.
- [x] Step 16: Add `abandon --request-id <id>` in `src/mutations.ts`.
  - It accepts only an operation whose last reconcile outcome was `ambiguous-reconcile` or `not-reached`; anything else is `JULES_INVALID_STATE`.
  - It requires `confirmOnTty`, whose summary shows the request id, repository, branch and outcome reason.
  - It marks the operation terminal `failed` with `abandonedAt` and `abandonReason`, and calls `releaseGrant`.
  - Output: `{ localRequestId, localId, abandoned: true, released: {...} }`.
- [x] Step 17: Enforce R39 in `evaluateAuthority` callers.
  - When a grant is expired and sessions under it are non-terminal, return `JULES_GRANT_EXPIRED` with `details.runningSessions[]` and the containment recoveryAction.
  - The text never says "terminated" or "stopped".
  - Add a mutating-operation deadline constant `DEFAULT_MUTATION_DEADLINE_MS = 180_000` in `src/deadline.ts`.
  - Authority is rechecked inside the critical section before each write (R14).
- [x] Step 18: Wire the CLI cases in `src/cli.ts` for `delegate`, `reply`, `approve`, `authorize`, `supervise` and `abandon`.
  - Each case uses strict `parseArgs` and the contract argument shapes, plus `--correction` on delegate and reply.
  - Move these subcommands into `KNOWN_OPERATIONS`; `integrate` stays in `LATER_OPERATIONS`.
  - `localRequestId` and `localId` are echoed on every mutating failure envelope.
  - Rebuild `dist/` with `pnpm --filter yellow-jules run build`.

### Phase D: supervision

- [x] Step 19: Create `src/supervise.ts` with `superviseOnce(deps, { session, grantId, deadlineMs, host })`. It runs one bounded pass and never loops or sleeps.
  - **Gate.** The grant must exist and permit the session's task.
  - **Observation.** It performs the `status` observation walk, using `status`'s write capability for read-state.
  - **R32 outside activity.** Pause when either of these is observed:
    - any `userMessaged` activity whose digest matches no journal `reply` reservation;
    - a `planGenerated` that differs from the journal's evaluated `observedPlanId` after evaluation.
    It also pauses when a partial walk leaves outside activity undetermined. A pause writes `supervision.paused` and returns `decision: 'paused'` (`JULES_SUPERVISION_PAUSED` on any later write).
  - **Decisions:**

    | `decision` | When | Details |
    | --- | --- | --- |
    | `no-change` | nothing new | `nextCheck` comes from the condition: starting 120 s, working 600 s |
    | `check-failed` | network or auth failure, exhausted retries, or `dedupWindowExceeded` | backoff persisted in `supervision.backoff`, 60 s doubling to 3600 s |
    | `pass-aborted` | the deadline fired | no verdict |
    | `needs-plan-review` | a plan is pending | fenced plan steps plus `observedPlanId` |
    | `needs-answer` | `awaiting-reply` | fenced question |
    | `needs-verification` | `remote-completed` | collect is run within the pass; R43 tooling ships in PR4, so the result is `verification: 'unavailable'` and the only permitted verdicts are correction or escalate, never accept |
    | `escalate` | policy deviation, unknown state (`needs-inspection`), exhausted corrective rounds, or grant expiry with remote work active | — |

  - **Output.** It returns `{ decision, condition, vendorState, nextCheck: { afterSeconds, reason }, allowedActions: [...], correctiveRoundsLeft, fenced: { plan?, question?, activities? }, attention? }`.
  - **Fencing.** All vendor text is passed through `fenceUntrusted` (R33).
- [x] Step 20: Add `supervise --clear-pause --session <ref>`. It is TTY-confirmed via `confirmOnTty`, and it requires a complete `status` walk since the pause; otherwise it fails with `JULES_INVALID_STATE` and recovery "run `status` first".
- [x] Step 21: Record corrections (R44). A `--correction` reply to an active session, or a `--correction` repair `delegate` on the same `--task-ref`, decrements `correctiveRoundsLeft`. The `supervise` output never suggests reopening a completed session.

### Phase E: Claude wrappers and Linear route

- [x] Step 22: Create `plugins/yellow-jules/commands/jules/delegate.md`, `reply.md` and `approve.md`.
  - **Pattern:** `collect.md` frontmatter and body, and the flow from cursor `delegate.md:53-130`.
  - **Frontmatter:** `allowed-tools: [Bash, AskUserQuestion]`.
  - **Body:**
    1. Validate arguments.
    2. Run `--dry-run`.
    3. Find a covering grant via `authorize --list`, filtered by jq on repository, branch, operation, unexpired and unrevoked.
    4. If none covers the operation, print the exact terminal `authorize` command and stop.
    5. Show a fenced preview and confirm with AskUserQuestion (R8).
    6. Run with `--grant-id` and the same `--request-id`. Never auto-retry, and on `JULES_UNKNOWN_OUTCOME` say "reconcile with `status --reconcile`".
  - **Error table:** include the new codes.
- [x] Step 23: Create `commands/jules/authorize.md` with `allowed-tools: [Bash]`.
  - `--list` and `--revoke` run directly.
  - Grant creation and `--take-over` validate the flags and print the exact `node <plugin-root>/dist/cli.js authorize …` command for the owner to run in their own terminal. The body explains why the agent cannot run it.
  - Create `commands/jules/abandon.md` the same way, for terminal-only use.
- [x] Step 24: Create `commands/jules/supervise.md` with `allowed-tools: [Bash, AskUserQuestion]`. It runs one `supervise` pass and renders the decision with the fenced vendor text.
  - **`needs-plan-review` or `needs-answer`:** the session evaluates or answers, then runs at most one `approve` or `reply` under the same grant. The pass then ends.
  - **Every pass:** report the decision and `nextCheck`.
  - It is not a thin `Skill` wrapper. The skill is a reference, following the cursor pattern.
- [x] Step 25: Replace the fail-closed `**Jules.**` branch in `plugins/yellow-linear/commands/linear/delegate.md` (about `:581-587`) with a live call. Re-anchor the line numbers.
  - The branch dry-runs, looks up a grant, confirms via AskUserQuestion, then runs `node "$YELLOW_JULES_ROOT/dist/cli.js" delegate … --grant-id`.
  - With no grant it prints the terminal `authorize` command.
  - Update the result and error rows (about `:656`, `:674`, `:693`) and the intro (`:25-27`).
  - Update `plugins/yellow-linear/tests/delegate.bats:221` and `:228` so they assert the live path and the no-grant refusal instead of the stub.

### Phase F: host-neutral skills and Codex

- [x] Step 26: Create `plugins/yellow-jules/skills/jules-delegation/SKILL.md`.
  - **Frontmatter:** `name`, a single-line description containing "Use when", and `user-invocable: false`.
  - **Sections:** What It Does / When to Use / Usage.
  - **Content:**
    - the lifecycle;
    - the CLI JSON contract;
    - the grant requirement;
    - telling the operator to run `authorize` in a terminal;
    - dry-run before every write;
    - never auto-retrying;
    - reconcile on unknown outcome;
    - an Inputs section with a "no input supplied" branch;
    - the verbatim untrusted-content fencing block.
  - **Exclusions:** no slash commands, `CLAUDE_*` variables, AskUserQuestion, `Task`/`Skill`, or repo-relative paths.
- [x] Step 27: Create `plugins/yellow-jules/skills/jules-supervision/SKILL.md`.
  - **Body:**
    - one-pass semantics;
    - the decision table from Step 19;
    - at most one write per pass, under `--grant-id`;
    - exporting `YELLOW_JULES_ACTIVE_GRANT` for the pass;
    - pause handling;
    - the correction limits;
    - the verbatim fencing block;
    - R47 reporting: every pass report lists the research and review capabilities it used and those unavailable on the current host, and never names Claude-only sibling plugins as tools.
  - **Exclusions:** the same as Step 26.
- [x] Step 28: Baseline the Codex manifests before the flip, as a separate commit.
  - Run `pnpm vitest run tests/integration/generate-manifests-codex.test.ts tests/integration/generate-manifests-characterization.test.ts` on the unflipped catalog and record that it passes.
  - Add a fixture case in `generate-manifests-codex.test.ts` for a plugin with an enabled interface, a two-skill allowlist and `includeHooks: false`, matching the jules shape.
- [ ] Step 29: Flip Codex on in `catalog/plugins/yellow-jules.json` `targets.codex`, in a separate commit.
  - Set `{ enabled: true, includeHooks: false, interface: { displayName: "Jules", category: "Developer Tools" }, skillAllowlist: ["jules-delegation","jules-supervision"], componentPaths: { skills: "./codex/skills" } }`.
  - Run `pnpm generate:manifests` and commit `plugins/yellow-jules/codex/skills/**`, `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`.
  - Refresh the characterization snapshot with `vitest -u`, then run `pnpm validate:codex` and `pnpm validate:versions`.
- [ ] Step 30: Discover the Codex tools (spec Open Question 2).
  - Record `codex --version` and the research and review tools available to a Codex session.
  - Add a "Codex supervision capabilities" table to `docs/yellow-jules/capability-matrix.md`, with evidence labels.
  - Run a manual Codex host smoke covering: skill discovery, `status` through the skill, a `delegate --dry-run`, and refusal of a real `delegate` without a grant.
  - Record the result in the PR description.

### Phase G: tests (R52 PR3 scenarios, by name)

- [ ] Step 31: Extend `tests/fake-http-server.ts` and `tests/fake-sdk.ts`.
  - **Fake HTTP server:** request-body capture, plus per-route failure injection: 429, 500/502/503/504, drop after dispatch, invalid 2xx.
  - **`FakeSdkAdapter`:** `createSession`, `sendMessage` and `approvePlan`, with call logging.
- [ ] Step 32: Add the new test files.
  - `tests/authority.test.ts` covers `evaluateAuthority` ordering, ceilings, and charge and release rules.
  - `tests/controller.test.ts` covers:
    - a missing, mismatched-epoch, or moved data dir → `JULES_CONTROLLER_MISMATCH`;
    - a copied data dir at another path fails;
    - takeover increments the epoch.
  - `tests/tty-confirm.test.ts` covers no TTY, a wrong code, the deadline, and that the code never reaches stdout or the envelope.
  - `tests/runtime-delegate.test.ts`, `tests/runtime-reply.test.ts`, `tests/runtime-approve.test.ts`, `tests/runtime-abandon.test.ts` and `tests/supervise.test.ts` cover these named scenarios:
    - **unauthorized writes:** no grant, wrong repo, wrong branch, operation not permitted;
    - **expired grants**, with remote work active (R39 wording, no termination claim);
    - **task limits:** total tasks, active sessions, corrective rounds;
    - **stale plan observations:** approve on a changed plan → `JULES_POLICY_DEVIATION`, and a post-approve mismatch records a deviation;
    - **ambiguous creation/reply outcomes:** a drop after dispatch → `unknown-outcome`, with no replay and an exact outgoing-call count;
    - **crash recovery:** a reservation left `reserved` blocks a duplicate create, then reconcile `bound`/`released`/`ambiguous-reconcile` behaves as specified;
    - **corrupt journal (writes)** and **corrupt grants file** both block writes;
    - **stale lock on restart:** a dead pid → `JULES_STALE_LOCK`, never taken over;
    - **grant counters after an unknown-outcome write:** the charge persists until reconcile releases it;
    - **two concurrent `delegate` calls against a one-session grant:** exactly one create, asserted against the fake server's `mutatingCount` (R31);
    - **deadline with remote work active**;
    - **deadline mid-pass:** `pass-aborted` with no verdict;
    - **outside-activity pause** and `--clear-pause` gating;
    - **`dedupWindowExceeded`** → `check-failed`;
    - **supervision with `verification: unavailable`** never accepts.
- [ ] Step 33: Update the existing tests.
  - In `tests/offline-coverage.test.ts:414-440`, narrow the zero-mutating-requests test to `setup`/`list`/`status`/`collect`/`authorize --list`.
  - Add offline CLI cases for each new subcommand: stdout/stderr/exit contract, usage errors exit 2, `JULES_CONFIRMATION_REQUIRED` without `--grant-id`.
  - Update the header comments in `tests/packed-sdk-transport.test.ts:11` and `tests/cli-json-contract.test.ts`.
  - Add packed-SDK transport cases asserting the serialized create body carries `requirePlanApproval: true` and `automationMode: AUTOMATION_MODE_UNSPECIFIED` (R12).

### Phase H: docs, smoke procedure, release

- [ ] Step 34: Update `plugins/yellow-jules/CLAUDE.md`.
  - **Commands:** refresh the catalog (4 → 10 commands) and the skills list. Drop the "read-only surface only" paragraph.
  - **Security model:** grants only, the TTY trust root, the ceilings, and the residual same-UID forgery risk (Open Question 5 decision).
  - **Single-controller handoff procedure (R38):**
    1. Quiesce the source writer.
    2. Run `status --reconcile` until no `reserved`/`unknown-outcome` remain.
    3. Revoke or let expire the grants on the source.
    4. Copy the data dir.
    5. On the new host, run the TTY-confirmed `authorize --take-over`, which writes epoch+1 and the canonical path.
    6. Delete the source host's controller file, so the source copy fails loud.
    7. Run `status --reconcile` on the new host before any write.
  - **Out-of-band containment procedure (R39),** usable without a grant: vendor console stop, source-connection revocation, API-key rotation.
- [ ] Step 35: Update `plugins/yellow-jules/README.md`. Cover the mutating commands, `authorize` usage from a terminal, the defaults and ceilings, supervision, and Codex availability.
- [ ] Step 36: Update the Codex distribution docs (R28).
  - `docs/codex-distribution.md`: "Four" → "Five" plugins, the canonical order list, and the jules note in the host-neutral skills and known constraints sections.
  - Also check `docs/cursor-distribution.md`, root `README.md`, and `AGENTS.md:327-330` (the Codex-enabled list) and its component counts.
  - Run `node scripts/validate-doc-counts.js`.
- [ ] Step 37: Write the R53 human smoke materials.
  - **`docs/yellow-jules/smoke-procedure.md`** follows the `docs/operations/post-w3-functional-smoke-test.md` shape: prerequisites, an isolated scratch branch, a grant from a terminal bound to that branch only, and a checklist with `Expected:` lines. The checklist covers:
    - one session created;
    - plan inspected;
    - one reply or approval under the grant;
    - an interrupted `delegate` that does not duplicate the task;
    - patch collected and independently checked;
    - no vendor PR, observed and recorded;
    - no merge;
    - archive-visibility observation with an unfiltered sessions walk.
  - **`docs/yellow-jules/smoke-result.template.md`** carries the frontmatter `result: pass|fail`, `archiveVisibilityConfirmed: true|false`, `vendorPrObserved: true|false`, date, and operator. It is a template only; the real `smoke-result.md` is committed after the smoke, so shell 04's gate cannot pass on a template.
- [ ] Step 38: Add the changesets.
  - `.changeset/yellow-jules-authority-supervision-codex.md` with `'yellow-jules': minor`.
  - `.changeset/yellow-linear-jules-live-delegate.md` with `'yellow-linear': minor`. The live provider branch is a new capability, so it is minor.
- [ ] Step 39: Run the validators: `pnpm validate:agents`, `pnpm lint:plugins`, `pnpm validate:shell-compat` and `pnpm check:shell-parse`. Then hand-grep the skill bodies for `AskUserQuestion|Task|Skill|/jules:|CLAUDE_` (exposure-lint blind spots). Fix any CRLF line endings.
- [ ] Step 40: Submit through the enabled stacked-PR provider.
  - Run `/stack:status` and continue only on `READY_GRAPHITE`/`READY_GITHUB`.
  - The commit order keeps the Step 28 baseline before the Step 29 flip.
  - The PR description lists the follow-ups:
    - R53 smoke after merge;
    - the vendor-PR-in-smoke decision before shell 04;
    - the spec Open Question 4 note.

## Verification

- `pnpm --filter yellow-jules run build && git diff --exit-code plugins/yellow-jules/dist` → expected: no drift.
- `pnpm --filter yellow-jules test` → expected: every Step 32 and Step 33 test passes, the concurrent-delegate test shows exactly one create, and the read-only subcommands show zero mutating requests.
- `cd plugins/yellow-linear && bats tests/` → expected: the delegate live-path and no-grant refusal tests pass, with all Cursor and Devin cases unchanged.
- `pnpm validate:schemas && pnpm validate:agents && pnpm lint:plugins && pnpm validate:codex && pnpm validate:versions` → expected: all pass, the exposure lint is clean for both skills, and the Codex two-way version check is green.
- `pnpm test:unit && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm release:check` → expected: pass, with the characterization and codex generator tests refreshed deliberately.
- `pnpm validate:shell-compat && pnpm check:shell-parse && pnpm test:shell-compat` → expected: pass.
- Manual check from the agent's Bash tool: `node plugins/yellow-jules/dist/cli.js authorize --repo o/r --branch scratch/x --task-ref t1 --operations create --owner me` → expected: `JULES_CONFIRMATION_REQUIRED` (no TTY), and no grant written.
- Manual check from a real terminal: the same command → expected: challenge prompt on the TTY; typing the code writes `state/grants.json` (0600) and the controller file outside the data dir.
- Manual: copy the data dir to another path and run `delegate --grant-id …` → expected: `JULES_CONTROLLER_MISMATCH`, zero requests.
- Manual Codex host smoke (Step 30) → expected: both skills listed, `status` works, and a real `delegate` is refused without a grant.

## Context Files

- `plans/specs/yellow-jules-integration.md`: R8, R24, R28-R34, R38, R39, R44-R48, R52, R53, and Open Questions 2, 4, 5, 6.
- `docs/yellow-jules/contract-v1.md`: the authoritative shapes for `delegate`, `reply`, `approve` and reconcile, the confirmation token, local state, and autonomy boundaries.
- `plans/complete/yellow-jules-integration-02-runtime-provider-and-claude-routing.md`: what PR2 shipped and the hand-offs to this shell.
- Runtime files under `plugins/yellow-jules/src/`:
  - `state.ts`, `types.ts`, `runtime.ts`, `cli.ts`, `errors.ts`;
  - `sdk-adapter.ts`, `activity-walk.ts`, `redact.ts`, `validate.ts`, `config.ts`, `deadline.ts`.
- `plugins/yellow-jules/tests/fake-http-server.ts`, `fake-sdk.ts`, `offline-coverage.test.ts`, `unsupported-capability.test.ts`: the test seams.
- `plugins/yellow-jules/commands/jules/collect.md`: the wrapper pattern.
- `plugins/yellow-cursor/commands/cursor/delegate.md`: the confirm-gated mutation pattern.
- `plugins/yellow-cursor/skills/cursor-delegation/SKILL.md`: the host-neutral skill model.
- `plugins/yellow-linear/commands/linear/delegate.md`, `plugins/yellow-linear/tests/delegate.bats`: the stub to replace and its tests.
- `catalog/plugins/yellow-jules.json`, `catalog/plugins/yellow-review.json`, `scripts/generate-manifests.js`, `scripts/validate-codex.js`, `tests/integration/generate-manifests-codex.test.ts`: Codex enablement.
- `docs/codex-distribution.md`, `docs/solutions/integration-issues/codex-skill-exposure-validator-blind-spots.md`, `docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md`: Codex constraints.
- `scripts/validate-jules.js`: the replica drift check.
- `docs/operations/post-w3-functional-smoke-test.md`: the smoke procedure template.
