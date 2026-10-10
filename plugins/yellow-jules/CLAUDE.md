# yellow-jules Plugin

Google Jules integration, **experimental**, the third member of the
`remote-agent` capability group (yellow-cursor is preferred). All vendor
integration lives in a typed TypeScript CLI (`src/` → compiled `dist/cli.js`);
command markdown files are thin wrappers with no API logic.

The CLI reads sessions (`setup`, `list`, `status`, `collect`), writes to them
under a grant (`delegate`, `reply`, `approve`), and supervises them in bounded
passes (`supervise`). Grants are written only by `authorize`, which the owner
confirms on a terminal (see "Security model"). `/linear:delegate` launches
through it under a covering grant. The binding contract — subcommands, JSON
shapes, error catalog, redaction layers, identifier allowlist, local state — is
[`docs/yellow-jules/contract-v1.md`](../../docs/yellow-jules/contract-v1.md);
this file does not restate it.

## Architecture

```text
plugins/yellow-jules/
  package.json          # private; @google/jules-sdk "0.2.0" (exact); engines.node >=22.22
  tsconfig.json         # extends ../../tsconfig.base.json, module node16 (CJS emit)
  runtime/              # data-dir install manifest + lockfile (npm ci source)
  src/
    cli.ts              # entry: strict parseArgs, one JSON line on stdout, exit 0/1/2
    runtime.ts          # setup / list / status / collect over an injected SdkAdapter
    runtime-support.ts  # RuntimeDeps, withAdapter, bounded read, status vocabulary
    mutations.ts        # delegate / reply / approve (one POST each, never retried) and abandon (local settle, no vendor call)
    write-gate.ts       # the R31 authority critical section and the settle helpers
    reconcile.ts        # status --reconcile: one shared sessions walk, per-session resolution
    supervise.ts        # one bounded supervision pass; --clear-pause
    authorize.ts        # create / list / revoke grants; --take-over
    authority.ts        # grants.json, evaluateAuthority (pure), counters
    controller.ts       # R38 authority file outside the data dir, epoch, takeover
    tty-confirm.ts      # the runtime-owned /dev/tty challenge (the only trust root)
    activity-walk.ts    # the single bounded activity-walk unit
    sdk-adapter.ts      # ONLY file touching the SDK API (plus the resolver's location work)
    sdk-resolver.ts     # locate, verify, and dynamically import the ESM-only SDK
    fetch-guard.ts      # pins the vendor origin, refuses redirects, 30 s reads
    test-seam.ts        # the only loopback baseUrl path; tests only
    config.ts           # data dir resolution + owner-only checks
    state.ts            # journal, lock, reservations
    deadline.ts         # absolute deadlines + bounded read retry
    errors.ts redact.ts validate.ts types.ts shape.ts   # shape.ts: small type guards
  dist/                 # committed compiled CJS; drift-checked in CI
  commands/jules/       # setup, list, status, collect, delegate, reply, approve, authorize, abandon, supervise
  skills/               # jules-delegation, jules-supervision (host-neutral; also exposed to Codex)
  codex/skills/         # generated Codex copies of the two skills; never hand-edit
  tests/                # vitest; fake adapter, fake HTTP server, packed-SDK suite, compiled-CLI e2e
```

### sdk-adapter boundary

`sdk-adapter.ts` is the only file that uses the SDK API (R2); `sdk-resolver.ts`
only locates and loads the package. The runtime depends on the `SdkAdapter` port
in `types.ts`. It exposes the reads plus exactly three writes — `createSession`,
`sendMessage`, `approvePlan` — each one POST and never retried. A write failure
carries `AdapterError.dispatched`, taken from the fetch guard's POST counter:
before dispatch it maps like a read; after dispatch only a clear rejection keeps
its code and everything else is `JULES_UNKNOWN_OUTCOME`. With no counter wired,
every write failure counts as dispatched. There is no cancel, pause, resume,
`run`, `all`, `result`, `ask`, or `waitFor`; adding a method changes the adapter
prototype test in `unsupported-capability.test.ts`. The adapter builds the
client with `config.requestTimeoutMs: 60000`,
`config.rateLimitRetry.maxRetryTimeMs: 0` (nested — a top-level key is silently
ignored), and a recording in-memory `storageFactory` whose bindings it asserts
after `connect()` and on first per-session use. `buildCreateSessionConfig` is a
pure builder that `createSession` calls on every `delegate` and the packed-SDK
tests also exercise directly.

### SDK pin policy

`@google/jules-sdk` is pinned to `0.2.0` exact, in `package.json` (workspace)
and in `runtime/package.json` + `runtime/package-lock.json` (the data-dir
install, every package carrying an integrity hash). `setup --install-sdk` copies
both into `<dataDir>/runtime/` and runs `npm ci --ignore-scripts`; on any
failure it removes the install. Every later load re-verifies `runtime/pin.json`
(entry-file sha256 and the installed tree). Treat any SDK bump as a
re-verification of the four R3 criteria recorded in
`docs/yellow-jules/sdk-investigation.md` §10 — load, explicit create flags,
count-proven retry disablement, isolatable storage — and of the `@internal`
`storageFactory` and `baseUrl` options, before the pin moves. Regenerate the
lockfile with `npm install --package-lock-only --ignore-scripts` inside
`runtime/`, and update `docs/upstream-pins.md`.

### CLI contract and error catalog

See `contract-v1.md` "Output envelope", "Exit codes", and "Error catalog". In
short: one JSON object on stdout, diagnostics on stderr, exit `0`/`1`/`2`; every
degraded success carries `requiresAttention` plus an `attention` list; `JULES_*`
codes each carry `retryable` and a default `recoveryAction`.

## Local state

`YELLOW_JULES_DATA_DIR` > `$XDG_DATA_HOME/yellow-jules` > platform default,
never under a git work tree containing the cwd or under the plugin directory.
Directories are `0700` and files `0600`; a group- or world-writable or non-owned
data dir, `state/`, `sdk-scratch/`, or `runtime/` is refused with
`JULES_DATA_DIR` on every invocation. Layout: `state/journal.json`,
`state/.lock`, `artifacts/<local-id>/`, `sdk-scratch/` (must stay empty),
`runtime/`. A corrupt journal is never replaced (`JULES_JOURNAL_CORRUPT`); a
stale lock is never taken over (`JULES_STALE_LOCK`) — both need a human.
`state/grants.json` follows the same rules (a corrupt file is never read as
empty). Outside the data directory, `<controllerDir>/<controllerId>.json`
(`YELLOW_JULES_CONTROLLER_DIR` > `$XDG_STATE_HOME/yellow-jules-controller` >
`~/.local/state/yellow-jules-controller`) records the epoch and the canonical
data-directory path this host may write from.

## Security model

- **Grants only.** Every real write (`delegate`, `reply`, `approve`, and what
  `supervise` triggers) needs `--grant-id`. There is no per-operation
  confirmation token. A grant fixes one repository, a branch or branch prefix,
  task refs, a subset of `create`/`reply`/`approve`/`collect`, limits, an
  expiry, and a controller epoch. Defaults: 1 active session, 3 tasks, 2
  corrective rounds, 120 minutes. Ceilings `authorize` enforces: 3 active
  sessions, 10 tasks, 3 corrective rounds, 24 hours. A grant can only narrow
  under the runtime: counters go up, slots free up, nothing widens.
- **`authorize` is the only trust root.** The runtime opens `/dev/tty` itself,
  prints the grant, and requires the owner to type back a random 6-character
  code. A caller with no controlling terminal — the agent's Bash tool, the Codex
  sandbox, a closed-stdin engine, CI — is refused with
  `JULES_CONFIRMATION_REQUIRED`. Whether stdin is a TTY is never consulted, and
  the code appears in no envelope, argv, journal, or log. `abandon`,
  `supervise --clear-pause`, and `authorize --take-over` are gated the same way,
  because each widens effective authority. `authorize --list` and `--revoke`
  need no terminal.
- **The Claude wrappers add a preview, not the enforcement.** Each wrapper shows
  a fenced preview and asks via `AskUserQuestion` before using a grant (R8), but
  the enforcement is the grant. The `authorize`, `abandon`, and `--clear-pause`
  wrappers only print the command for the owner to run in a separate terminal
  window; running it through Claude Code would put the TUI between the owner and
  the prompt.
- **Counters (R31).** Reserved and unknown-outcome operations count. A `create`
  takes an active-session slot (freed when the session is observed terminal, or
  by reconcile `released`, `abandon`, or a clean rejection) and, unless it is a
  repair, one task. A repair `create` and a corrective `reply` spend a
  corrective round instead. Tasks and rounds never decrement.
- **One critical section (R31).** Controller authority, grant lookup, authority
  evaluation, the R36 duplicate lookup, the charge, and the reservation happen
  under one lock, so two processes racing for a one-session grant create one
  session. `grants.json` is written before `journal.json`: a crash between them
  leaks a slot, which can only make a grant stricter.
- **Treat grants as guardrails, not a hard security boundary.** They stop
  accidental and casual overreach by an agent that goes through the CLI. They do
  not stop a determined agent running as your user. Write grants with the
  narrowest scope that does the job: one repository, an exact scratch branch
  rather than a prefix, the task refs you mean, and only the operations needed.
- **Residual risks — read these.**
  - A process running as the same UID can read and rewrite `state/grants.json`
    and the controller file. There is no grant MAC, because any key the runtime
    can read the same UID can read. Integrity rests on `0600` permissions, the
    separate grants file, the controller epoch and path binding, and grants that
    only narrow.
  - The terminal challenge defeats a caller that has no controlling terminal. A
    same-UID process that can allocate a pseudo-terminal of its own (`script`,
    Python's `pty`, `expect`) gets one, can read the code, and can answer it.
    The controls against that are the host's sandbox and what the agent is
    allowed to run, not this plugin.
  - **Grants constrain the CLI, not the credential.** `JULES_API_KEY` is read
    from the environment of whoever runs the CLI, so an agent whose shell holds
    it can call the Jules API directly with `curl`: no grant, no terminal, no
    journal entry. The fetch guard protects only the CLI's own process. Keep the
    key out of the agent's environment (a separate UID or a keyring prompt) if
    that matters; the plugin cannot do it for you.
  - Inside tmux or screen, a process that can reach the owner's multiplexer
    (`capture-pane`, `send-keys`) can read and answer the challenge on the real
    terminal. This is the pseudo-terminal risk above by another route.
  - `YELLOW_JULES_ACTIVE_GRANT` is a hint the agent could unset, not a control;
    the control is the terminal challenge.
  - Expiry and pause do not stop remote work; see the containment procedure.
  - Only a call made with `--correction` (`reply` or `delegate`) spends a
    corrective round, and the caller sets that flag. A plain reply is not
    counted, so a grant bounds repair sessions and approvals but not the number
    of messages sent to a session it covers.
  - `delegate --request-id <id> --retry-failed` (used by `/linear:delegate`)
    resolves the id to `<id>.a<N>`, N = prior clean `failed` creates + 1. Any
    reserved, accepted, unknown-outcome or session-bearing record still
    collides, so one in-flight attempt is never relaunched.
  - A prompt or message travels as a command-line argument, which other local
    users can read in `/proc/<pid>/cmdline` for as long as the call runs (unless
    `/proc` is mounted with `hidepid`). Do not put secrets in a prompt on a
    shared host. Very long multi-byte prompts can exceed the per-argument limit.
  - The controller id is the host name. A cloned VM or container that keeps the
    host name and a copied home directory looks like the same controller.

## Single-controller handoff (R38)

One data directory is the only writer. To move it to another host or path:

1. Quiesce the source writer: no `delegate`, `reply`, `approve`, or `supervise`
   process running.
2. Run `status --reconcile` until no `reserved` or `unknown-outcome` operation
   remains (or settle them with `abandon`).
3. Revoke the grants on the source with `authorize --revoke`, or let them
   expire.
4. Copy the data directory to the new host.
5. On the new host, in a terminal, run `authorize --take-over`. It writes
   epoch+1 for that host and its canonical data-directory path and rebinds every
   grant.
6. Delete the source host's controller file, so the source copy fails loud with
   `JULES_CONTROLLER_MISMATCH` instead of writing in parallel.
7. Run `status --reconcile` on the new host before any write.

A copied or restored data directory with no matching controller file cannot
write.

The controller id is the host name, and every grant is bound to it. If the host
name changes (a WSL2 or homelab rename), writes under existing grants fail with
`JULES_CONTROLLER_MISMATCH` until you run `authorize --take-over` in a terminal,
which rebinds the grants to the new name.

## Outside activity freezes writes

When `status` or a supervision pass finds a message on a session that this
plugin did not send (for example someone typed in the Jules web page), it
records that as outside activity. While it is recorded, `reply` and `approve`
under a grant are refused with `JULES_SUPERVISION_PAUSED`, and so is a repair
`delegate` for that task. Only `supervise --clear-pause` removes it: it needs a
complete `status` walk that began after the newest pause evidence (the pause or
the latest outside message, whichever is later) and a typed code in a terminal,
and its prompt lists the outside activity so you read it before you confirm. If
writes start failing with a paused error, look at the session first; a teammate
may have commented on it.

### Where the guarantee ends

Revocation, expiry and outside activity are honoured up to the final local
re-check, `assertGrantLiveBeforeWrite`, which runs just before the vendor call.
A `reply` or `approve` that was reserved before outside activity was recorded is
marked `invalidatedBy: 'outside-activity'` (in the same journal write as
`outsideSeen`) and that re-check refuses it with `JULES_SUPERVISION_PAUSED`; a
revoked grant is refused with `JULES_AUTHORITY_DENIED`. Both settle as a clean
failure with no vendor call. Tests: `runtime-reply.test.ts` "races inside the
write gate" (revoke after reserve; outside activity after reserve) and
`runtime-delegate.test.ts` and `runtime-approve.test.ts` (revoke between
reservation and POST).

The same re-check, in one journal lock, also refuses a reply or approve whose
owner finished after the reserve, and a corrective `delegate` whose task gained
a pause or outside activity on an earlier launch (`blocksRepairLaunch`, the
predicate the reserve uses), then stamps `dispatchedAt`. Only a reservation
carrying that stamp can claim a vendor activity as its own echo, so a teammate
repeating a still-undispatched message is classified as outside activity.

A reply or approve also records a vendor floor at that stamp: just before the
POST the controller reads the session's newest activity (`createTime`, id;
the stored status watermark plus a walk from it) and stores it as
`vendorFloorCreateTime` / `vendorFloorActivityId`, or `vendorFloorEmpty` when
the session had no activities. A failed or partial read refuses the write before
the POST (`JULES_SERVICE_UNAVAILABLE`, retryable; the reservation settles
`failed` and nothing is dispatched). An echo, in `status --reconcile` and in
`claimOwnEchoes`, must be strictly newer than the floor by vendor `createTime`.
Older (or the floor activity itself) is not an echo; an equal `createTime`, a
record with no floor (legacy), or a missing `createTime` cannot be ordered, so reconcile reports
`ambiguous-reconcile` (`dispatch-time-unknown`) and `status` treats the message
as outside activity. No local time is compared with a vendor time for this. A
create is exempt: its session did not exist before the POST.

`status --reconcile` carries a bound reply's echo `createTime` with its id
(`echoCreateTime`), because a later walk sees the id as already claimed and
never fills it, and `supervise` needs it to order the reply against a plan swap.
An `approve` reservation stores the reviewed digest (`observedPlanDigest`).
Before binding a `planApproved`, reconcile reads the whole session and applies
the post-POST verifier's rule to the newest plan generated before the approval:
a different digest (or an unorderable tie) binds the approve but records the
policy deviation on the session's owner; an incomplete walk or no readable
preceding plan leaves it `ambiguous-reconcile` (`approved-plan-unreadable`).
Opaque activity ids never order events in a decision. Everywhere two activities
share a `createTime` the result is unordered evidence, and a decision that
depends on the order is ambiguous (pause, or blocked writes): outside messages
(all tied ids kept), plans, approvals (several at one time naming different
plans decide nothing), the post-approve verifier (an approval at the reviewed
plan's own time is kept, not discarded), the surplus split of same-text
messages, and the resume marker. Watermarks and the dedup ring still use id
order as a cursor only. After a lost approve response, `status --reconcile`
treats a `planApproved` that names a different plan as a candidate: a single
one proven after dispatch binds as a changed-plan deviation, anything less
certain stays `ambiguous-reconcile` (`approval-of-another-plan`); both record a
deviation on the session's owner, so grant-backed writes stay blocked.

A `planApproved` and a `planGenerated` that share a `createTime` are unordered
(ids carry no order). The approval clears the plan only when it names that
plan's id (a resumed walk carries it as `resumeApproval.approvedPlanId`; markers
without it stay ambiguous); a different plan stays pending, marked `ambiguous`, so `supervise`
offers no action and `approve` / plan-bound `reply` refuse.

Same-text echoes are matched as a vendor-time-ordered batch, not in arrival
order: with several writes sharing a digest, the oldest echo goes to the
oldest-dispatched write (by dispatch sequence, else `dispatchedAt`), checked per
position: each echo must be eligible for its paired write, so differing vendor
floors do not make the batch order-dependent. Equal or
missing vendor times, unorderable dispatches, or a different number of echoes
and writes make the batch ambiguous: the messages are recorded as outside
activity (pause) and its unresolved writes are marked `echoAmbiguous`.
The pre-dispatch vendor-floor walk of a `reply` or `approve` classifies the user
messages it sees with the same own-echo / outside-activity logic as `status`
(`claimOwnEchoes`). A teammate's message that arrived since the last status, or
between preflight and the floor read, is recorded as outside activity and the
write is refused (`JULES_SUPERVISION_PAUSED`) before the POST; a message only an
in-flight write could explain refuses too. An approval rebase never clears a
fresh pending plan stored as `ambiguous`.

A tie of different plans at the newest vendor time is kept in the retained
generated-plan state (`lastGeneratedPlan.ambiguous`), so a later approval that
clears `pendingPlan` cannot hide it: the next `supervise` pass treats it as an
unexplained replacement and pauses. Create reconciliation walks sessions
without a `create_time` filter, since a floor derived from the controller's
clock would hide the tagged session when that clock runs ahead of the service's;
a walk cut short by the page cap is `not-reached`, never a release. Untagged
candidates have no create-time floor either: an unowned same-repo/branch session
in a complete walk leaves the create `ambiguous-reconcile`
(`untagged-candidate`). The final floor walk of `reply` and `approve` also
re-validates the target on that same complete read: the pending plan must still
be the reviewed one and not ambiguous (approve: `JULES_POLICY_DEVIATION`;
guarded reply: `JULES_QUESTION_CHANGED`), and a guarded question must have no
newer or tied agent message; a mismatch settles as a clean failure before the POST.

`authorize --take-over` stamps the journal with `controllerTakeover` (the new host's
clock and a sequence). Reconcile ages a `reserved` row created before it (by
sequence, or without one) from that stamp, not from its own `createdAt`, which
is the earlier controller's clock: the row stays in flight for the settle
interval after the take-over.

`authorize` (create) refuses under the lock when any existing grant is bound to
another controller id or epoch (for example after another host's take-over): a
stale local epoch never mints a grant beside them; run `--take-over` explicitly.

An equal-time approval clears the pending plan only when exactly one plan
content exists at that timestamp; with several, the plan stays pending and
`ambiguous`. The slot release after a clean rejection of a create POST asserts
controller authority under the journal lock like the terminal and reconcile
releases: after a take-over during the POST the slot stays held
(`slotReleased: false`).

Every `ambiguous-reconcile` on an `approve` also records a blocking deviation
on the session's owner (fail closed), whatever the reason. One vendor activity
is credited to at most one record: same-plan and foreign approvals count as
owners alongside reply echoes, so two unresolved approves never both claim one
approval. A bound approve persists the consumed activity id (`echoActivityId`),
so a later pass cannot reuse it. A same-digest message with more than one
eligible writer and no proven pairing is never assigned to the latest
dispatch: it is outside activity, whatever the batch size.
A bound approve that landed on a changed plan carries `policyDeviation: true` on
its reconciled entry, so a sessionless `status --reconcile` sets
`policyDeviation` and `requiresAttention`. Terminal-session slot release (in
`status` and the reconcile path) asserts the grant's controller authority under
the journal lock; on a host without it the slot stays held, `grants.json` is
untouched, status still succeeds, and the output flags `slotReleaseSkipped`.
`authorize --revoke` needs no terminal but asserts the grant's controller
authority under the journal lock; a host without it is refused
(`JULES_CONTROLLER_MISMATCH`, recovery: revoke from the controlling host, or
`authorize --take-over` there if it lost its authority file).

A dispatched reservation proves only that the POST began, not that it landed. A
message that only such a still-`reserved` reply (inside its settle window) could
explain is held: `status` neither claims it nor classifies it, and the watermark
and dedup ring do not pass it. After the write settles, the next walk claims it
as the echo (accepted) or records it as outside activity (cleanly rejected). A
message is also held when the only matching write was created or dispatched
after the walk began: that write cannot be its echo, and the next walk (which
starts after the write) decides. Newer outside messages replace `outsideSeen`
and older ones never do (the marker keeps the message's `createTime`, ordered by
`compareStamp`), so a `--clear-pause` confirmed against an older id is refused
and a delayed overlapping walk cannot swap in an older message.
`lastCompleteWalkAt`, a stored pause and `lastDecision` likewise only move
forward.

Relative order never rests on a clock. `journal.json` carries a `seq` counter
that only advances under the journal lock; a write's create and dispatch, a
walk's and a pass's start, a plan evaluation, a pause or outside marker, and a
held message's first read each store the value they were given. Every "before"
or "after" that decides an authority or pause outcome compares those values,
which cannot tie, so two events in one millisecond are still ordered. Timestamps
stay for display, TTLs and the vendor-clock windows in `reconcile.ts`. State
written before sequences has an unknown order and never authorizes: such a reply
cannot suppress a plan-swap pause, and a pause with a sequence is cleared only
by a walk that has one. Where the old timestamp rule already failed closed on a
tie it still applies to those older records, so they do not stall.

Only positive landing evidence explains a plan replacement and so suppresses the
`plan-changed-after-evaluation` pause: an `accepted` or `reconciled` reply
sequenced after the evaluation, or one whose echo was claimed. A `reserved` or
`unknown-outcome` reply may never have landed and does not hide a swap; the pass
pauses. `status --reconcile` binds an unknown-outcome reply to the echo a plain
`status` already recorded for that same reply; only echoes claimed by other
operations are excluded.

`status --reconcile` also counts settled (`accepted` or `reconciled`) replies
with the same digest, and approvals of the same plan, that have no recorded echo
as competing candidates: an activity that could be theirs is ambiguous and
leaves an unknown-outcome reply unbound. When `status` classifies an ambiguous
echo, a settled write is credited before an unresolved one, so an unproven reply
is never marked landed on a guess.

A bindable `needs-answer` question must also display unchanged through the
`supervise` wrapper's `safe` filter (tabs and carriage returns become spaces,
dash runs fold, text over 6000 characters is cut). Otherwise `reply` is withheld
and `questionUnavailable` is set, because the digest binds the raw question.

`supervise --clear-pause` also checks the owning grant's controller authority,
before the terminal prompt and again under the journal lock; a host without a
matching authority file is refused with `JULES_CONTROLLER_MISMATCH`. A plan step
whose title is not a string, or whose description is present and not a string,
is an unmapped activity (the walk stops, supervision pauses, approval refetch
refuses) rather than being normalized to an empty string.

A plan replacement is detected by plan id or by digest: a newer `planGenerated`
that reuses the evaluated plan id with different steps pauses like a new id
(evaluations stored before digests compare by id only). `status` marks a plan it
redacted (`redacted: true` on `pendingPlan`); `supervise` then offers no
`approve` or `reply` for it, because the supervisor judged incomplete text. A
`reply --expect-activity-id` also fails closed with `JULES_QUESTION_CHANGED`
when a user message that is not one of this plugin's claimed echoes follows the
question.

When several unresolved writes (`reserved` past its window, or
`unknown-outcome`) could own one matching message, `status` credits none of them
and keeps the message held; only a settled write is credited first. `approve`
applies the question-reply rule to its complete re-read: a user message after
the reviewed plan that is not a claimed echo refuses the approval
(`JULES_INVALID_STATE`; a dry run reports `planChanged`). A plan-bound `reply`
applies the same rule. For these freshness checks an equal `createTime` counts
as after, because opaque activity ids carry no order. When plans with differing
digests share the newest `createTime`, the current plan cannot be told: `approve`
and a plan-bound `reply` refuse (`JULES_POLICY_DEVIATION` / `JULES_QUESTION_CHANGED`)
instead of picking one by id. After the POST, the newest plan generated before
the recorded approval must match the reviewed digest, and an equal-time tie
there counts as changed, and so does any differing plan stamped at the approval's
own `createTime` (it cannot be ordered against the approval); the same id with
other steps is reported as a policy deviation. Two different agent questions at
the newest `createTime` withhold the `reply` action in `supervise` and make a
question-bound `reply` refuse with `JULES_QUESTION_CHANGED`.

Same-text messages are classified as a batch: when a settled write and an
unresolved one share a digest and a walk holds more such messages than settled
writes, the settled writes take the earliest messages, the unresolved write gets
no landing evidence, and the surplus is consumed (not held, so no later walk can
reclassify it as the unresolved write's echo) and recorded as possible outside
activity. The unresolved write is
also marked `echoAmbiguous` on its journal record: no later walk, even one that
re-reads the surplus message, may give it an `echoActivityId`; only reconcile or
abandon settles it. Older records without the field parse unchanged.
Only writes that could own a message of the batch count: those dispatched before
the walk began, not after the message was first read, and whose echo is proven
newer than the write's vendor floor (below).

A swap pause in `supervise` is suppressed by our own reply only when that reply
has positive landing evidence and its echo's vendor `createTime` (recorded as
`echoCreateTime`) is strictly before the differing `planGenerated` activity's.
The local dispatch clock is never compared with the vendor's: a reply without an
echo `createTime` explains no plan swap, and the swap pauses.

Plans with differing content that share the newest `createTime` are unordered:
the walk marks the pending plan `ambiguous`, and `supervise` offers no action
for it (`allowedActions` empty, `planUnavailable`), as for a redacted plan.
`abandon` asserts controller authority for every record carrying a `grantId`;
only a create releases a grant slot.

Outside-activity markers treat an equal `createTime` as unordered: outside
messages tied on the newest time are all kept (`alsoActivityIds` beside
`activityId`, merged across walks), so the `--clear-pause` prompt lists every
one and a confirmation against a narrower set is refused. `approve` rejects any
observed unclaimed steering message regardless of the pause state it cached when
it resolved the session (`JULES_SUPERVISION_PAUSED` if that state already
recorded outside activity, else `JULES_INVALID_STATE`).

A scratch-tripwire failure when the adapter closes after `delegate`, `reply` or
`approve` dispatched never replaces the write's result: a success keeps its
body and gains `cleanupViolation` plus the `adapterCleanupViolation` attention
flag, and `JULES_UNKNOWN_OUTCOME` stays `JULES_UNKNOWN_OUTCOME` (the violation
goes to stderr), so a caller does not retry a write that may have landed.

Activity ids are stored without their session, so every claimed-echo lookup
(`claimOwnEchoes`, the reply and approve freshness checks, reconcile) is scoped
to the session it reads; an echo claimed in one session never explains a message
in another.

Binding a create to a session that an `observe` row already owns (reconcile, or
a create whose response arrived after a raw-resource `status`) folds that row
into the create and retires its local id: deviations stay unreconciled if either
copy was, pause and outside markers keep the later evidence, and read cursors
reset so the next `status` rewalks the session under the create. A session
already owned by another create is not bound: the create stays unresolved as
`ambiguous-reconcile` (`session-already-owned`).

The residual window is between that re-check and the vendor POST: local state
and the remote call cannot be made atomic, so a revoke or an outside message
landing in that interval does not stop the write. `delegate` is wider: the SDK
reads the source and sends the POST inside one `client.session()` call, so the
re-check cannot be moved after the source read without changing the vendored
SDK.

## Out-of-band containment (R39)

Usable without any grant. Grant expiry, a deadline, a pause, and revocation do
**not** stop a Jules session that is already running, and the plugin never
claims they do. Errors that follow an expired grant list the sessions that may
still be running. To contain them:

1. Stop the session in the Jules console.
2. Revoke the repository's source connection in Jules.
3. Rotate `JULES_API_KEY` if the key may have leaked.

## Testing

`pnpm --filter yellow-jules test` (also run by root `pnpm test:unit`). Layers:

- fake-adapter suites (`runtime-*.test.ts`, `authority.test.ts`,
  `controller.test.ts`, `tty-confirm.test.ts`, `supervise.test.ts`) over
  `tests/fake-sdk.ts` and an in-memory terminal (`tests/support/grants.ts`);
- `packed-sdk-transport.test.ts` — installs the real `0.2.0` artifact through
  the shipped `npm ci` path (needs npm registry access) and drives it against
  `tests/fake-http-server.ts`, including the shipped adapter's three writes;
- `cli-json-contract.test.ts` and `offline-coverage.test.ts` — the CLI built
  with `tsc --outDir <mkdtemp>` into a temp "plugin cache", spawned with
  `tests/support/loopback-preload.cjs`; includes the negative test that the
  read-only subcommands issue zero POST/PATCH/PUT/DELETE and that every mutating
  subcommand refuses before sending anything without a grant or a terminal;
- `cli-mutations-e2e.test.ts` — compiled CLI processes under a seeded grant: two
  processes racing for one slot create one session, a copied data directory
  cannot write, a lost response is reconciled and never replayed. A real
  `/dev/tty` cannot exist in CI, so the terminal is a fake, and the real
  `/dev/tty` path is exercised only in the manual smoke
  (`docs/yellow-jules/smoke-procedure.md`).

Real tools on `PATH` are replaced by failing traps
(`tests/support/path-traps.ts`). Fake-server response bodies are illustrative: a
pass proves request shape, count, and side effects, not vendor compatibility.

## Build discipline

`dist/` is committed. After any `src/` change run
`pnpm --filter yellow-jules run build`; CI fails on any tracked or untracked
difference under `plugins/yellow-jules/dist`. The units copied from
yellow-cursor (`validateRef`, `validateIdempotencyKey`,
`assertNoSecretShapedValues`, `redactDeep`, `resolveDataDir`, the `AppError`
shape, `makeAppError`) sit between `// replica:<unit>:start/end` markers in both
plugins; `pnpm validate:jules` fails on drift. Change both sides together.

## Component catalog

### Commands (10)

- `/jules:setup` — credential presence, SDK location and verification, a
  one-page sources probe; installs the pinned SDK only with consent
- `/jules:list` — one page of sessions with normalized condition and local ids
- `/jules:status` — fresh session read plus a bounded activity walk; with
  `--reconcile`, resolves reservations whose outcome was unknown
- `/jules:collect` — stage patches, generated files, and PR references under
  `artifacts/<local-id>/`; never touches a checkout
- `/jules:delegate` — dry-run, find a covering grant, preview, confirm, launch
- `/jules:reply` — the same flow for one non-blocking message
- `/jules:approve` — re-read the plan completely, confirm, approve once
- `/jules:authorize` — list and revoke grants; prints the terminal command to
  write one or to take over the controller
- `/jules:abandon` — prints the terminal command to give up an unresolved
  operation
- `/jules:supervise` — one bounded pass; at most one reply, approval, or repair
  delegate

### Skills (2)

- `jules-delegation` — host-neutral lifecycle, CLI contract, and grant rules
- `jules-supervision` — host-neutral one-pass semantics and the decision table

Both are `user-invocable: false`, exposed to Codex through
`targets.codex.skillAllowlist`, and deliberately free of slash commands, host
environment variables, and host tool names. Their names differ from the
commands' on purpose.
