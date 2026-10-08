# yellow-jules Owner Smoke Procedure (R53)

The one human-run check that exercises the grant-gated surface against the
**real** Jules API. Everything before it is fake-server and packed-SDK evidence;
this is the first `live-observed` evidence, and the only place the real
`/dev/tty` path runs.

**Status:** Required before PR4 (`integrate`) starts. Not CI. It spends Jules
quota and opens a real session against this repository.

**Who runs it:** the repository owner, on the machine that will be the
controller host, with a live `JULES_API_KEY`. An agent cannot run it: step B
needs a person at a terminal.

**Gate:** PR4 work refuses to start until `docs/yellow-jules/smoke-result.md`
exists with `result: pass`. This procedure ships a _template_ only
([`smoke-result.template.md`](smoke-result.template.md)); the gated file is
created by copying it after the smoke, so the template can never satisfy the
gate.

**Related:** [contract-v1.md](contract-v1.md) ·
[capability-matrix.md](capability-matrix.md) ·
[`plugins/yellow-jules/CLAUDE.md`](../../plugins/yellow-jules/CLAUDE.md)

---

## Section A: Prerequisites

**Objective**: A controller host, an isolated scratch branch, and a working
setup.

- [ ] `node` 22.22 or later and `jq` are on `PATH`.
- [ ] `JULES_API_KEY` is exported in the shell that will run the CLI. The CLI
      never prints it.
- [ ] Jules has a source connection to this repository (sources are discovered,
      never created by the plugin).
- [ ] The plugin is installed and `dist/cli.js` exists:

  ```text
  /plugin install yellow-jules@yellow-plugins
  /jules:setup
  ```

  - Expected: `credentialSource: "env"`, `sdkResolution` not `missing`,
    `sourcesReachable.supported: true`.

- [ ] Create an isolated scratch branch from `main` and push it. Jules clones
      from GitHub, so it must exist on `origin`:

  ```text
  git switch -c scratch/jules-smoke-YYYYMMDD main
  git push -u origin scratch/jules-smoke-YYYYMMDD
  ```

  - Expected: the branch holds no work you care about. Nothing in this procedure
    merges it.

- [ ] Note the data directory (`$YELLOW_JULES_DATA_DIR`, else
      `$XDG_DATA_HOME/yellow-jules`, else `~/.local/share/yellow-jules`) and the
      controller directory (`$YELLOW_JULES_CONTROLLER_DIR`, else
      `$XDG_STATE_HOME/yellow-jules-controller`, else
      `~/.local/state/yellow-jules-controller`).

---

## Section B: Write the Grant From a Terminal

**Objective**: Prove the terminal challenge works on a real `/dev/tty` and that
an agent cannot satisfy it.

- [ ] From **inside Claude Code** (the agent's Bash tool), try to write a grant:

  ```text
  node <plugin-dir>/dist/cli.js authorize --repo OWNER/REPO --branch scratch/jules-smoke-YYYYMMDD --task-ref SMOKE-1 --operations create,reply,approve,collect --owner you
  ```

  - Expected: `JULES_CONFIRMATION_REQUIRED`, exit 1, and **no**
    `state/grants.json` afterwards.

- [ ] In a **separate terminal window** on the same machine, run the same
      command with the small defaults (1 active session, 3 tasks, 2 corrective
      rounds, 120 minutes).
  - Expected: the grant and a six-character code are printed on the terminal.
  - Expected: typing a wrong code prints `JULES_AUTHORITY_DENIED` and writes
    nothing.
  - Expected: typing the right code prints a JSON result with a `grantId`
    (`jg-<32 hex>`), `epoch: 1`, and the controller id.
- [ ] Check the files:

  ```text
  ls -l <dataDir>/state/grants.json <controllerDir>/*.json
  ```

  - Expected: both are mode `0600`; the controller file lives outside the data
    directory.

- [ ] `/jules:authorize --list` shows the grant, unexpired, unrevoked, with
      empty usage.

---

## Section C: One Session, One Reply or Approval

**Objective**: One session is created, its plan inspected, and one write sent
within the grant.

- [ ] Dry-run first, then launch with a deliberately tiny task (for example "add
      a one-line comment to `docs/yellow-jules/smoke-scratch.md`"):

  ```text
  /jules:delegate --repo OWNER/REPO --branch scratch/jules-smoke-YYYYMMDD --task-ref SMOKE-1 --prompt "<the tiny task>"
  ```

  - Expected: the dry-run prints a `localRequestId`; the preview shows the grant
    and asks; after "Yes" the launch returns a `sessionResource`, a `localId`,
    and `condition: "starting"`.
  - Expected: the Jules console shows **one** new session whose title starts
    with `[yellow:jl-…]`.

- [ ] `/jules:status --session <localId>` until a plan is pending.
  - Expected: `condition: "awaiting-approval"` and a `pendingPlan` whose steps
    match the console.
- [ ] `/jules:supervise --session <localId> --grant-id <grantId>`.
  - Expected: `decision: "needs-plan-review"`, `observedPlanId` equal to the
    pending plan, the steps inside the untrusted-content fence.
  - Expected: the session's own first message is **not** treated as outside
    activity (no `paused`). If it is, record exactly what the vendor echoed: the
    initial prompt may come back reformatted, and that decides whether the
    digest match needs a rule change.
- [ ] Send **one** write inside the grant: either approve the plan
      (`/jules:approve --session <localId> --plan-id <id>`) or send one reply
      (`/jules:reply --session <localId> --message "…"`).
  - Expected: with approve, `approvedPlanId` equals the evaluated plan,
    `observedPlanIdAfter` equals it (or `verificationDeferred: true`), and no
    `policyDeviation`.
  - Expected: `/jules:authorize --list` now shows the session's slot and one
    task used.

---

## Section D: An Interruption Does Not Duplicate the Task

**Objective**: A write whose result the CLI never saw is reconciled, never
replayed.

- [ ] Delegate a second tiny task on a **second** scratch branch pushed the same
      way (raise `--max-active-sessions` to 2 on a second grant if the first
      slot is still held). Kill the CLI with `SIGKILL` right after it prints
      nothing — for example run it in one terminal and, from another,
      `kill -9 <pid>` as soon as `state/journal.json` shows a `reserved` or
      `unknown-outcome` record.
  - Expected: the record is `reserved` or `unknown-outcome`; the Jules console
    shows **at most one** session for that launch.
- [ ] Try to launch the same repository and branch again.
  - Expected: `JULES_DUPLICATE_LAUNCH`, and the console still shows at most one
    session.
- [ ] Wait at least 260 seconds after the kill, then
      `/jules:status --reconcile`. A reservation younger than that is reported
      `not-reached` and left unrecorded, because its write may still be in
      flight.
  - Expected: if the session was created, outcome `bound`; if not, outcome
    `ambiguous-reconcile` with `reason: "archive-visibility-unverified"` (it is
    never `released` until Section G is recorded and acted on).
  - Expected: the number of sessions in the console is unchanged by the
    reconcile.

---

## Section E: The Patch Is Collected and Independently Checked

**Objective**: The artifact reaches disk and is verified by a human, not by the
plugin.

- [ ] Wait for the session to finish, then `/jules:collect --session <localId>`.
  - Expected: patches and generated files appear under
    `<dataDir>/artifacts/<localId>/` with a `manifest.json`; every artifact is
    `verification: "unverified"`; your checkout is untouched.
- [ ] `/jules:supervise --session <localId> --grant-id <grantId>`.
  - Expected: `decision: "needs-verification"`, `verification: "unavailable"`,
    and `allowedActions` containing no acceptance.
- [ ] Review the patch yourself and apply it in a throwaway worktree with the
      repo's own tests.
  - Expected: you can state, from your own check, whether the patch is correct.

---

## Section F: No Vendor PR, No Merge

**Objective**: The vendor opened no pull request and nothing merged.

- [ ] Look at the repository's pull requests and the scratch branch on GitHub.
  - Expected: no pull request from Jules for the session (sessions are created
    with auto-PR off). **Record whether one appeared**: it decides whether shell
    04 treats a vendor PR as an anomaly or an expected variant.
- [ ] `/jules:status --session <localId>`.
  - Expected: no `policyDeviation`; `outputs` contains no unexpected
    `pullRequest`.
- [ ] Confirm the scratch branch was never merged.

---

## Section G: Archive Visibility

**Objective**: Settle the unknown that gates the `released` reconcile outcome.

- [ ] Archive one completed smoke session in the Jules console (or pick an
      existing archived session if the console shows one).
- [ ] Walk **every** page of sessions with no filter and look for it:

  ```text
  /jules:list --limit 100
  /jules:list --limit 100 --page-token <nextPageToken>
  ```

  - Expected: you can say whether the archived session appears in the unfiltered
    walk (match it by its `[yellow:…]` title tag or console id).

- [ ] Record the answer as `archiveVisibilityConfirmed: true|false` in the
      result file.
  - Note: no command writes the journal's `archiveVisibilityConfirmed` flag yet.
    Recording the observation is this procedure's job; turning the flag on, and
    therefore enabling the `released` outcome, is a separate follow-up decision.

---

## Section H: Codex (optional, recommended)

**Objective**: The live half of the Codex host check that could not be run
without your credentials.

- [ ] Install `yellow-jules` from the repository's Codex marketplace in a real
      Codex session with `JULES_API_KEY` set. Ask it to read a session with
      `jules-delegation`.
  - Expected: both skills are offered; `status` runs; a `delegate --dry-run`
    runs; a real `delegate` without a grant is refused with
    `JULES_CONFIRMATION_REQUIRED` and the printed `authorize` command.

---

## Section I: Clean Up and Record

- [ ] `/jules:authorize --revoke <grantId>` for every grant written here.
- [ ] Delete the scratch branches on `origin`.
- [ ] Copy `smoke-result.template.md` to `smoke-result.md`, fill every field,
      and commit it.
  - Expected: `result: pass` only if Sections B through F all met their Expected
    lines. Otherwise `result: fail`, with the failing line and the session ids.

## If something fails

Stop. Do not retry a write by hand. Run `/jules:status --reconcile`, note the
`localRequestId`, and use the out-of-band containment steps in the plugin's
`CLAUDE.md` (stop the session in the Jules console, revoke the source
connection, rotate the API key) if a session may be running that should not be.
Record `result: fail` with what you saw.
