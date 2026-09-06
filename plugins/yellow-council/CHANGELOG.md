# yellow-council

## 0.3.1

### Patch Changes

- [`e239b34`](https://github.com/KingInYellows/yellow-plugins/commit/e239b3462d7c65e866d87dc27197b0167dc0e0d7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Rename the
  skill frontmatter key `user-invokable` to `user-invocable` in every SKILL.md.
  Claude Code (verified against 2.1.259) parses only `user-invocable`; the `k`
  spelling this repo standardised on was silently ignored, so every internal
  skill declared `user-invokable: false` still appeared in the `/` menu. The
  validator gains RULE 20 (error tier) rejecting the old key so it cannot creep
  back through stale templates.

- [`2f39283`](https://github.com/KingInYellows/yellow-plugins/commit/2f39283d69689e9d03c00db8094c058765df1621)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Modernise the
  authoring surface for current Claude Code and the Claude 5 generation. The
  agent-authoring validator now accepts the `fable` model alias and full
  `claude-*` model IDs (V2), understands the post-2.1.63 `Agent` tool name in
  `Agent(bareword):` shorthand checks, and adds RULE 21 — a warning-tier line
  ceiling for commands (500) and agents (300) so the next progressive-disclosure
  pass has a scoreboard. The `tools:` / `allowed-tools:` lists, the `Task(` call
  sites and the tool name in prose are renamed from the legacy `Task` to `Agent`
  (the alias still works), and the pseudo-YAML `Task:` dispatch labels are swept
  as well. The `debt-conventions` scanner template now matches the shipped
  scanners (`model: sonnet`, `effort: low`).

## 0.3.0

### Minor Changes

- [#705](https://github.com/KingInYellows/yellow-plugins/pull/705)
  [`111c55a`](https://github.com/KingInYellows/yellow-plugins/commit/111c55acfca4e24ff4c985b535d48201fe329e8b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `claude-reviewer` as the council's fourth slot and extend the `/council`
  fan-out, parsing, and report assembly from three reviewers to four.

  `claude-reviewer` is the architecture's deliberate asymmetry: it runs
  in-process with no CLI, no subprocess, and no `Bash` — it reads the pack from
  its spawn prompt, investigates with Read/Grep/Glob, and returns the same 6-key
  contract (`verdict=` / `confidence=` / `summary=` / `fenced_output_path=` /
  `findings_block_begin`…`findings_block_end`) that `parse_reviewer_return`
  already extracts uniformly, so no parser change was needed. It carries a
  contrarian review stance so it decorrelates from the synthesizer it shares a
  model family with, and it never self-identifies in its output.

  Three consequences of being in-process are surfaced rather than hidden:
  - `COUNCIL_TIMEOUT` does not bound it, and it has no not-installed degradation
    branch — a failed spawn falls through to the same missing-return handling
    and is recorded as `ERROR`.
  - It cannot mint its own temp path (no `Bash`, no `mktemp`), so `council.md`
    mints the fenced-output path with `mktemp -u` and passes the literal path in
    the spawn prompt; the agent's single `Write` is therefore a create, not an
    overwrite. `Write` on a `review/` agent is allowlisted in
    `scripts/validate-agent-authoring.js` with that narrow rationale.
  - Its credential-redaction and fence-escaping safeguards are prompt-level
    prose, not the `awk`/`sed` mechanics the CLI wrappers run. The agent, the
    `council-patterns` skill, and the plugin CLAUDE.md all state that weaker
    guarantee plainly.

  `council:setup` now reports `N of 4` with
  `Claude=in-process (always available)`: `READY_COUNT` seeds at 1, the
  previously unreachable zero-reviewer branch becomes a `MINIMAL` status, and
  the full-council threshold moves to 4.

  Because claude-reviewer's own redaction and fence-escaping rules are
  prompt-level prose with nothing executing them, `council.md` mechanically
  enforces both invariants for this leg from the orchestrator side:
  - The 11-pattern credential/PEM `awk` redaction block (canonical copy in the
    `council-patterns` skill) now runs twice for the claude leg — once in
    `parse_reviewer_return` over `summary=`/`findings_block` and any non-enum
    `verdict=`, before Step 5 synthesis ever sees them, and once in Step 7 over
    the fenced-file appendix, before it lands in the persisted report. Both
    copies are mawk-safe: no `{n,}` interval expressions, since mawk (the
    default `/usr/bin/awk` on Debian/Ubuntu) matches those literally instead of
    treating them as quantifiers; a `match()`+`RLENGTH` helper reproduces the
    same minimum-length gate without interval syntax.
  - Step 7 rebuilds claude-reviewer's injection-fence sandwich unconditionally
    rather than trusting the file's own begin/end delimiters — the file it wrote
    may be missing either delimiter or carry a forged extra copy, so every
    delimiter-shaped line is escaped first, then `council.md`'s own fresh
    begin/end pair wraps the result.
  - Step 4's reclamation of orphaned fenced-output files from a prior
    claude-reviewer run that never reached cleanup is age-gated (24 hours): only
    files older than that are swept, so a second concurrent `/council`
    invocation's own in-flight file is never at risk of being deleted out from
    under it.

  Three further fixes from review:
  - The appendix fence-escaping pass matched only `council-output:` lines, so a
    native `--- end codex-output ---` or `--- code end ---` in injected reviewer
    output survived into the persisted report and any consumer recognising those
    would read the text after it as unfenced. It now escapes every structural
    form `claude-reviewer.md` Safeguard 2 names, including the two
    `findings_block_*` sentinels (prefixed, since they carry no leading `--- `
    to consume).
  - `validate-agent-authoring.js` honoured a `REVIEW_AGENT_ALLOWLIST` entry
    regardless of whether the agent still carried its
    `Tool Surface — Documented … Exception` section, so the human-auditable
    rationale for a Write-capable reviewer could be deleted with CI still green.
    The allowlist is now only honoured while that section is present.
  - `find` drives the stale-`/tmp` sweep but was never declared a prerequisite.
    On a host without it the sweep silently produced no candidates with its
    stderr suppressed, so a cancelled run left raw reviewer output in `/tmp`
    despite the documented next-run reclamation. Added to both prerequisite
    loops and the docs.

  Two follow-ups from review: the documented-exception heading check accepts the
  ASCII-hyphen spelling `AGENTS.md` uses as well as the em dash every shipped
  agent uses; and `docs/testing/yellow-council-manual-tests.md` scenarios
  3.1-3.3 are updated for four slots. They previously expected all reviewers to
  time out or fail together, which the in-process slot cannot do — it has no
  subprocess for `COUNCIL_TIMEOUT` to bound and needs no CLI auth — so a
  maintainer following the checklist would have reported false failures and
  never exercised the new slot.

### Patch Changes

- [#705](https://github.com/KingInYellows/yellow-plugins/pull/705)
  [`111c55a`](https://github.com/KingInYellows/yellow-plugins/commit/111c55acfca4e24ff4c985b535d48201fe329e8b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Redact and fail
  closed around the in-process Claude reviewer slot

  `claude-reviewer` has no `Bash`, so it cannot run the credential-redaction
  pass the three CLI reviewers run inside their own agent. `council.md`
  therefore carries the pass on its behalf, in Step 4 over the returned fields
  and in Step 7 over the persisted fenced file, so no reviewer content reaches
  `docs/council/<report>.md` unredacted regardless of which slot produced it.

  Closes the sanitized-field handoff: Step 4 redacted the summary and findings
  into Bash associative arrays, but every Bash block runs in its own subprocess,
  so those values were gone by the time Step 5 synthesized — Step 5 had nothing
  sanitized to read and fell back to the raw Task return still in model context,
  bypassing the redaction entirely. Step 4 now redacts the persisted fenced file
  in place and Step 5 reads reviewer text from that file rather than the return.

  Every branch around that file now fails CLOSED, because each one that did not
  handed synthesis something it should not read:
  - A returned path this run did not mint is discarded rather than merely left
    un-redacted; it was still persisted to `$STATE_FILE`, and Step 5 reads each
    reviewer summary from exactly that value, so a prompt-injected return naming
    any readable file became an arbitrary-file-read into the report.
  - A path that IS the minted one but is missing, not a regular file, or a
    symlink now fails the slot instead of keeping an apparently valid vote.
  - An empty `fenced_output_path=` fails the slot too, but only when it carries
    an actual participating verdict — a TIMEOUT or UNAVAILABLE slot keeps its
    more specific reason.
  - The truncation that backstops a failed redaction no longer ignores its own
    exit status; an unwritable file or I/O error would otherwise leave the raw
    review at a path the function still reported as good.

  Step 4b also `chmod 600`s the fenced file as soon as it takes ownership.
  `claude-reviewer` creates it with the `Write` tool under the ordinary process
  umask, so on a multi-user host the raw review was world-readable until the
  redacted copy replaced it. The window between the agent's write and that line
  remains, and a cancelled or hung run never reaches it at all — both are
  recorded in the plugin's Known Limitations. Closing it fully needs a nested
  `mktemp -d` path, which every path guard in `council.md` rejects on purpose.

  The appendix fence-escaping pass now covers every structural form
  `claude-reviewer.md` Safeguard 2 names, not just this command's own fence: a
  native `--- end codex-output ---` or `--- code end ---` in injected output
  previously survived into the persisted report, and the two `findings_block_*`
  sentinels are prefixed rather than substituted since they carry no leading
  `--- ` to consume.

  Two supporting fixes: `validate-agent-authoring.js` now honours a
  `REVIEW_AGENT_ALLOWLIST` entry only while the agent still carries its
  `Tool Surface — Documented … Exception` section, so the rationale for a
  Write-capable reviewer cannot be deleted with CI staying green; and `find`,
  which drives the stale-`/tmp` sweep, is declared a prerequisite instead of
  being depended on silently.

  The slot now returns `summary=` and its findings block EMPTY, and `council.md`
  reads both back out of the fenced file after redacting it. The CLI reviewers
  redact inside their own agent before returning, so their prose is already
  sanitized when the orchestrator sees it; the in-process slot has no `Bash` and
  cannot, so anything it returned entered orchestrator context raw — and once
  read, no later pass can retract it. Sanitizing the file afterwards was too
  late by construction. Verdict and confidence are still returned directly,
  being enum- constrained with no free text.

  Four corrections to the above, from review of it:
  - The EMPTY-return rule is scoped to the SUCCESS path. Step 1's malformed-pack
    and Step 3's refused-path branches produce no fenced file, so their fixed
    diagnostic summaries must still be returned or the reason is lost; they are
    constant strings, not pack-derived prose, and are redacted on arrival.
  - Only the claude leg is read from disk. The CLI legs redact inside their own
    agent before returning, and `yellow-codex`'s reviewer writes only findings
    to its fenced file — its summary exists solely in that already-redacted
    return, so demanding the file for every leg would have dropped Codex's
    explanation.
  - The findings capture is bounded by the fence end and cut at the LAST
    `Summary: ` line rather than the first, so a finding whose body starts with
    that literal prefix no longer truncates every finding after it.
  - The documented-exception heading check runs on live markdown, with fenced
    blocks and HTML comments stripped first — otherwise a commented-out or
    illustrative copy of the heading kept the privileged grant alive.

  The vote is now derived from the same place as the prose. Reading only the
  summary and findings from the sanitized file left the Task-return `verdict=`
  authoritative, so a return claiming `APPROVE` while its own fenced file said
  `Verdict: REVISE` produced a headline the persisted appendix visibly
  contradicted. The two are compared and the slot fails closed when they differ
  — a disagreement means one of them is not the reviewer's judgement and there
  is no way to tell which.

  Two corrections to that consistency check: a MISSING `Verdict:` line in the
  fenced file is treated as a mismatch rather than an exemption, so the
  Task-return vote cannot stand while the appendix shows no vote at all; and
  both interpolated values are redacted before reaching stderr, since neither
  has been through the enum coercion or the redaction pass at that point and a
  malformed return can carry credential-shaped text in `verdict=`.

  The fenced verdict must now be UNIQUE and inside the claude fence: a
  first-match parser over the whole file accepted a forged `Verdict:` quoted
  ahead of the real one, and a matching forged Layer-2 return would then pass
  the consistency check. Zero or multiple matches both fail the slot. The
  fenced-file schema also gains `UNKNOWN`, which Step 2 already requires for the
  early-stop path — without it, following the template produced a verdict the
  consistency check turned into ERROR on every partial review.

  Summary and findings extraction is fence-scoped and unique too, matching the
  verdict: a `Summary:` line appended after the end delimiter is outside the
  reviewer's own fence, and a whole-file scan let that injected prose win.

- [#703](https://github.com/KingInYellows/yellow-plugins/pull/703)
  [`766268d`](https://github.com/KingInYellows/yellow-plugins/commit/766268d108f5cee2abc6bce7b80ca961a2937389)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Close
  credential-redaction bypasses and add a regression suite
  - `strip_deco` refused to strip git's `-` prefix from PEM delimiter lines, so
    a key echoed as diff deletions (`------BEGIN…`, six dashes) was classified
    as a prose mention and ran under the bounded window — a narrowly-wrapped
    body then leaked past the stray cutoff.
  - The real-vs-prose test runs on the decoration-stripped line and requires the
    BEGIN marker to be the WHOLE line: a marker that merely terminates a line of
    prose stays a mention and runs under the bounded window, so an ordinary
    report quoting a header is not read as a key and redacted through EOF.
    Decoration is stripped before the test, so a blockquoted, listed, numbered
    or diff-prefixed real marker still reaches it anchored.
  - `cred_hit` tested only `match()`'s leftmost occurrence, so a short
    placeholder sharing a token's prefix shadowed a real credential later on the
    same line and the line was emitted unredacted.
  - The post-close re-arm window ran unconditionally and could overwrite the
    mode of a block that had already begun inside it, misclassifying
    back-to-back blocks.
  - Decoration stripping was bounded by a CONSTANT (8, then 64). Output carrying
    more prefixes than the bound left the loop with prefixes still attached, so
    the anchored test above failed on a genuine key and the block leaked on the
    bounded path. The bound is now derived from the input length, which no
    attacker-chosen nesting depth can exceed, and exhausting it fails closed.

  The re-arm now also requires a digit or base64 punctuation, so an ordinary
  camelCase identifier no longer re-enters unbounded redaction and swallows
  `Verdict:`/`Confidence:`/`Summary:` through EOF.

  Adds `plugins/yellow-council/tests/redaction.bats`, which extracts the live
  awk program from each file that ships it (rather than testing a copy that
  drifts), asserts all copies are byte-identical, and pins both failure
  directions — leaks and over-redaction — under every awk on the host.

  Round two, from continued review of the above:
  - Decoration stripping consumed a `+` run one character per pass while copying
    the remainder, so an attacker-supplied run was quadratic in its length — a
    100k-character run took roughly ten seconds and could outlast the timeout
    meant to bound the redaction step. `+` runs are now taken whole. A long `-`
    run still costs one pass per character, because the delimiter guard has to
    re-test after each removal; that remains a known open cost rather than a
    closed one.

  An interim revision of this PR also normalized serialized markers (JSON
  strings and markdown table cells) and capped line length with a fail-closed
  guard. Both were reverted: reviewers demonstrated that each traded the leak
  for the opposite failure. The length cap keyed "real key" off length alone, so
  any long line merely MENTIONING a marker swallowed the report through EOF; the
  wrapper strip ran after list/blockquote/numbered prefixes were already
  removed, so `- "<marker>"` normalized to a bare marker and did the same. A key
  serialized as a JSON string is therefore still classified as a mention and
  takes the bounded window — the same accepted trade as an inline-prose mention,
  recorded in the plugin Known Limitations. Handling serialized shapes safely
  needs the bounded window's width floor reworked alongside it, which belongs in
  its own change.

  A re-arm window left over from an earlier block was never retired when a new
  BEGIN opened. `pem_watch` only decrements while outside a block, so a
  countdown still running was frozen for the whole of the next block and resumed
  afterwards with a stale count — and the re-arm path restores the real/prose
  mode from the PREVIOUS block, so a later base64-shaped prose line could
  re-enter unbounded redaction on the strength of a key that had already closed,
  swallowing the report. Opening a block now closes any window that belongs to
  an earlier one.

  The suite is now a REQUIRED CI step rather than part of the advisory
  `continue-on-error` plugin glob. Left advisory, a change that reintroduced any
  tested credential leak could merge with the whole regression suite red, which
  defeats the reason for writing it.

- [#708](https://github.com/KingInYellows/yellow-plugins/pull/708)
  [`4fe52aa`](https://github.com/KingInYellows/yellow-plugins/commit/4fe52aaa113ce6d26bd25ef5d874c3d367dfd5da)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `/council review --base <ref>`, which was silently non-functional since the
  plugin shipped.

  The `--base` parsing lives in its own fenced bash block, and each block runs
  as a fresh subprocess, but it never re-derived `$REST` (Step 2 derives it in a
  different block). So `set -- $REST` left `$#` at 0, the parse loop never ran,
  `EXPLICIT_BASE` stayed empty, and every invocation fell through to the
  upstream-tracking / `origin/main` default — including one passing an explicit
  `--base`. That directly contradicted the contract stated three lines above it:
  "An invalid or non-existent ref must fail loudly rather than silently falling
  back, otherwise the advertised flag would be non-functional."

  `MODE`/`REST` are now re-derived at the top of that block, matching Step 6's
  existing convention.

  The skill's truncation snippet recomputes the diff in its own bash block, so
  the caller's empty-diff guard does not cover it. Left unsubstituted, the
  `BASE` placeholder made `git diff` exit 128 while the redirect still created
  the file, `wc -c` read 0, and the block exited successfully with an empty diff
  — fanning out reviewers over nothing, which returns an unfounded APPROVE. The
  snippet now rejects an unsubstituted placeholder, requires `BASE` to resolve
  to a commit, and aborts when `git diff` fails or produces an empty file.

  The truncation block also never emitted its result. It wrote the truncated
  diff to a randomized `$DIFF_FILE` and ended, but it runs in its own Bash call,
  so neither the variable nor the path reaches the pack-assembly step that
  consumes it — a review large enough to trigger truncation fanned out with no
  diff at all, which every reviewer answers with an unfounded APPROVE. The block
  now prints the diff on stdout and removes the file, and `council.md` states
  that the captured stdout is the handoff.

  The truncation is now bounded by bytes as well as lines. `head -200` alone is
  not a size bound — 200 lines of a minified bundle or a generated lockfile can
  exceed the 200K the truncation exists to stay under, so the truncated result
  came back as large as the input and blew the pack budget anyway.

  The byte cap is set from the tightest downstream consumer rather than from the
  raw diff alone: the assembled pack also carries the stat header, up to three
  4K changed-file excerpts and the fence framing, and must clear both the 100K
  pack budget and OpenCode's 120000-byte argv rejection. A 150000-byte diff
  portion exceeded both on its own and would have marked that reviewer
  UNAVAILABLE on every large-diff run.

  Correction to the above: the earlier derivation assumed at most three 4K
  changed-file excerpts, which is the `debug`/`question` limit — `review` mode
  has no file-count cap and appends every changed file, and the
  `git diff --stat` was unbounded as well, so a wide change still blew the
  budget with the diff portion capped. The stat is now bounded, changed-file
  excerpts are added until a 30K combined budget is reached (then a count of
  omissions), and the assembled-pack ceiling of 100K is stated with the
  per-section arithmetic beside it.

  The ceiling is now a measured post-assembly check rather than arithmetic: the
  pack is written out, `wc -c` is taken, and changed-file excerpts are dropped
  from the end until it is under 100000 bytes. A content-only budget counted
  neither the per-file path/heading/fence framing — which a diff touching
  hundreds of tiny files pays for every one of them — nor the byte cost of
  non-ASCII content over its character count.

  Two more from review of that check: the truncation trigger is lowered from
  200K to the 60K diff budget, since a diff between the two skipped truncation
  entirely and dropping every excerpt still could not bring the pack under
  OpenCode's guard; and the measurement copy must be `mktemp`-staged (0600) and
  removed on every path, because it holds the pack unredacted and a
  Write-created file would persist at the ordinary umask.

  Three fixes to the truncation work itself: byte caps now cut at a line
  boundary via `LC_ALL=C awk` rather than `head -c`, which could split a
  multibyte character and emit invalid UTF-8 into the pack; the truncated diff
  is staged through `mktemp` (0600) instead of a `>` redirect that created it at
  the ordinary umask; and the plugin README and CLAUDE.md now document the
  thresholds and the omission policy, since a council review may legitimately
  not inspect the complete change.

- [#703](https://github.com/KingInYellows/yellow-plugins/pull/703)
  [`766268d`](https://github.com/KingInYellows/yellow-plugins/commit/766268d108f5cee2abc6bce7b80ca961a2937389)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix a PEM
  private-key redaction bypass in `gemini-reviewer` and `opencode-reviewer`.
  Both matched the BEGIN/END markers with a fully anchored pattern
  (`^-----BEGIN [A-Z ]+PRIVATE KEY-----[[:space:]]*$`), which diverged from the
  canonical unanchored form documented in `council-patterns` SKILL.md. Two
  shapes leaked through as a result: a key flattened onto one line or quoted
  inline in prose never matched the anchor, and `[A-Z ]+` failed to match the
  bare PKCS#8 header `-----BEGIN PRIVATE KEY-----` (no algorithm word) even in
  the multi-line case. Both now use the canonical
  `-----BEGIN [A-Z ]*PRIVATE KEY-----` substring match, so reviewer output
  containing key material is redacted before it reaches the council report.

  Unanchoring BEGIN also means it matches prose that merely quotes the marker,
  and such a line has no matching END — which would have pinned the redaction
  state on to EOF and replaced the entire remaining report with placeholders.
  The state machine is now span-bounded: PEM armor is base64 plus the
  `Proc-Type`/`DEK-Info` headers, so it counts consecutive lines that cannot be
  key material and leaves PEM mode after three of them. A real key block stays
  fully redacted (its body is base64 throughout, even when truncated with no END
  marker), while a stray prose mention now costs four redacted lines instead of
  the reviewer's whole verdict. Blockquote and list decoration is stripped
  before that body test, so a reviewer that renders a key inside `> `, `1. `, or
  a diff `-`/`+` prefix does not fall out of redaction mode partway through the
  key. Blank lines are neutral for that counter — treating them as valid key
  body would reset it at every paragraph gap in prose, defeating the bound.

## 0.2.12

### Patch Changes

- [#700](https://github.com/KingInYellows/yellow-plugins/pull/700)
  [`df24cd4`](https://github.com/KingInYellows/yellow-plugins/commit/df24cd4ec438366617b07df23bc9b4353e372096)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Harden the six
  items deferred from the #695/#697/#698 review stack: validate BASE_REF against
  a branch-name allowlist before shell substitution in /codex:review; unify
  every inline stderr-peek redaction block onto the canonical 11-pattern list
  with a mutation-safe PEM state machine; make /codex:review Step 4b credential
  redaction JSON-aware so it no longer corrupts the structured REVIEW_OUTPUT;
  cut the codex-reviewer FINDINGS cap only at complete finding-record boundaries
  with per-record field-shape validation (plus a committed Step 6 conformance
  test); make the codex-patterns review snippet's consume-before-rm ordering
  explicit; and fence extracted reviewer summaries at council.md's synthesis
  consumption site.

## 0.2.11

### Patch Changes

- [#697](https://github.com/KingInYellows/yellow-plugins/pull/697)
  [`1374672`](https://github.com/KingInYellows/yellow-plugins/commit/137467287e06471411ea7f20329b5aaedab1fc19)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `codex-reviewer` so its structured output actually arrives. Step 4 invoked
  `codex exec review`, which silently ignores `--output-schema` and always
  writes its own hardcoded prose to `-o` — so Step 6's `jq` parsing found no
  `findings[]`/`overall_correctness` and every Codex review degraded to
  UNKNOWN/no-findings while appearing healthy.

  Step 4 now uses plain `codex exec`, which honours `--output-schema`. Because
  plain `exec` has no `--base` selector, the diff is written to a temp file and
  named in the prompt rather than fetched by Codex itself — instructing Codex to
  run `git diff` made it explore the repository until the 300s timeout expired
  (measured: 66 tool calls, exit 124, no output). The file-based form converges
  in 3-4 minutes and scopes the review to exactly what Step 3 already
  size-checked.

  `schemas/review-findings.json` is rewritten for OpenAI strict
  structured-output mode (`additionalProperties: false` on every object, every
  key listed in `required`, nullable unions for optional fields). Step 6's `jq`
  is unchanged — `null` and absent behave identically under `//`.

  Also in this change:
  - `</dev/null` on the invocation: plain `exec` appends stdin to the prompt and
    blocks waiting for EOF if stdin is left attached.
  - A fail-closed guard when the schema file is missing from the installation,
    rather than silently falling back to unparsable prose.
  - `$DIFF_FILE` cleanup on every exit path.
  - Fixed the `FINDINGS` byte-cap guard: `wc -l` counts newlines, so a cut
    landing mid-second-line leaves exactly one and the `-gt 1` test wrongly
    returned the chopped tail. Now `-ge 1`, which accepts dropping one complete
    line when the cut lands exactly on a boundary — preferable to emitting a
    truncated one.
  - Corrected the docs that asserted `exec review`'s `-o` file already contains
    this JSON, and the "may be ignored with certain model variants" note — the
    subcommand, not the model, is the deciding factor.

- [#695](https://github.com/KingInYellows/yellow-plugins/pull/695)
  [`83b273a`](https://github.com/KingInYellows/yellow-plugins/commit/83b273a047b4a56a33e552b4d3e92e8b1f135b59)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Note in
  `council-patterns` SKILL.md that `codex-reviewer` now emits the same
  structured 6-key contract as the Gemini and OpenCode reviewer slots, for
  symmetry with those subsections. No functional change to `council.md` — its
  `parse_reviewer_return` was already reviewer-agnostic.

## 0.2.10

### Patch Changes

- [#693](https://github.com/KingInYellows/yellow-plugins/pull/693)
  [`c54b1b3`](https://github.com/KingInYellows/yellow-plugins/commit/c54b1b3ce57f4fd2bd70da38fd687564d2e88cd0)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Migrate the
  Gemini reviewer slot from the retired consumer-tier Gemini CLI to the
  Antigravity CLI (`agy`). Google stopped serving Gemini CLI requests for
  consumer subscriptions on 2026-06-18, so the slot was non-functional under
  subscription auth. The reviewer now runs
  `agy --sandbox --print-timeout <duration> -p "<pointer>"` cwd-isolated inside
  the throwaway pack dir, with the council pack delivered as a workspace file
  (agy does not read piped stdin), a validated integer `COUNCIL_TIMEOUT`, and
  pack ingestion verified via a final-line INGEST_TOKEN echo. Setup detection,
  skill invocation patterns, security docs, and manual tests updated
  accordingly; spike record at
  `docs/spikes/antigravity-cli-headless-2026-08.md`.

## 0.2.9

### Patch Changes

- [#676](https://github.com/KingInYellows/yellow-plugins/pull/676)
  [`339ccf4`](https://github.com/KingInYellows/yellow-plugins/commit/339ccf42a0a4be59176e994ec9531c988fa391e1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Residual P2
  fixes from the #670–#672 sweep-all batch: guard the `resolve-pr`
  branch-verification redirect against zsh noclobber (`2>|`); drop drifting hard
  pattern-counts from yellow-codex redaction prose; add the missing "Cannot
  verify — semgrep CLI not found" branch (and `unverified` commit trailer) to
  `/semgrep:fix`; bound memory-manager flush retries at 3 attempts per entry;
  centralize the council reviewers' Write-grant rationale in the
  council-patterns skill; feed the gemini council pack via stdin (ARG_MAX) and
  guard the opencode pack size; cap reviewer FINDINGS output at 200 lines /
  20000 bytes.

## 0.2.8

### Patch Changes

- [#670](https://github.com/KingInYellows/yellow-plugins/pull/670)
  [`67865ad`](https://github.com/KingInYellows/yellow-plugins/commit/67865ade25dd455e5fdbf46f35f081ccf937b586)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Security
  follow-ups deferred from the PR #666/#667 review loops
  - yellow-council: `gemini-reviewer` now stages the untrusted council pack via
    the Write tool (bounded to `$PACK_FILE`) instead of a fixed-delimiter
    heredoc, matching the `opencode-reviewer` conversion — closes the heredoc
    delimiter collision on attacker-influenced pack text.
  - yellow-codex: `/codex:rescue` fails loudly when the staged task-description
    file is missing or empty, and `[ESCAPED]`-substitutes literal
    task-description fence delimiters in the untrusted text before interpolation
    so a pasted bug report cannot break out of the injection fence.

## 0.2.7

### Patch Changes

- [#666](https://github.com/KingInYellows/yellow-plugins/pull/666)
  [`5a0b9c5`](https://github.com/KingInYellows/yellow-plugins/commit/5a0b9c5190885e45927aa9afd63a779e69bacd67)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Prompt-quality
  correctness pass across instructional markdown, driven by the updated
  prompting-guidance research (docs/research/best-practices/
  gpt-claude-latest-model-prompting-guidance.md and its 2026-07-27 addendum).

  Fixes fall into four classes: (1) dangling or stale references — archived plan
  paths, a nonexistent MCP tool name, "MEMORY.md" citations that do not resolve
  for installed users, undefined jargon like "(M3)" and "the keystone"; (2)
  contradictions between paired files — dedup-threshold drift (0.85 vs the
  canonical 0.82), revert/retry option mismatches, doc claims the referenced
  code disproves; (3) ambiguous or unactionable instructions — AskUserQuestion
  free-text options not labeled `Other`, undefined shell variables in
  illustrative bash, branches with no specified check; (4) Codex-exposed
  gt-workflow skills assuming Claude-only primitives (AskUserQuestion, the Skill
  tool) with no host branch — each now carries an "On Codex" fallback, with
  generated codex/ artifacts regenerated. No command interfaces changed.

## 0.2.6

### Patch Changes

- [#628](https://github.com/KingInYellows/yellow-plugins/pull/628)
  [`811ae11`](https://github.com/KingInYellows/yellow-plugins/commit/811ae114f1bd4eb75cda5c5bb8d40149ceb5b9f5)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - docs: align the
  Codex reviewer-leg read-only invocation description with the `-c`
  config-override form (`sandbox_mode="read-only"`, `approval_policy="never"`) —
  `-s`/`-a` no longer parse on `codex exec review` as of codex-cli 0.140.0.

## 0.2.5

### Patch Changes

- [#605](https://github.com/KingInYellows/yellow-plugins/pull/605)
  [`ff312b4`](https://github.com/KingInYellows/yellow-plugins/commit/ff312b4baec6d207a09ac47f7c7370754ae25035)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  Progressive-disclosure splits (Tier 2 C6): move conditional and late-sequence
  detail out of oversized skill and command files into `references/` files
  behind imperative load stubs, verbatim (except positional cross-reference
  words like "above"/"below" corrected for the new file locations, and the
  review-pr Steps 9a/9b top-level skip-gate merged into one provably-equivalent
  condition).
  - `yellow-core/skills/optimize/SKILL.md` 461 → 297 lines (judge protocol,
    pagination layouts, failure modes, design rationale → `references/`)
  - `yellow-core/skills/compound-lifecycle/SKILL.md` 414 → 291 lines
    (staleness/clustering formulas + config keys, report template, archive
    rationale → `references/`)
  - `yellow-council/skills/council-patterns/SKILL.md`: only the non-executed
    Cross-References provenance bullets move (grep-confirmed unconsumed); every
    runtime-load-bearing preloaded section stays inline
  - New command-file pattern (no prior precedent): `/review:pr` legacy
    fallback + Steps 9a/9b, `/workflows:work` Graphite cheat-sheet, and
    `/setup:all` Steps 1.6/1.7 move to plugin-local `references/` dirs loaded
    via `${CLAUDE_PLUGIN_ROOT}` stubs at their branch points
  - Manual stub-firing e2e checklist at
    `docs/testing/c6-progressive-disclosure-stub-firing-checklist.md`; stale
    provenance comment in `debugging/SKILL.md` corrected

## 0.2.4

### Patch Changes

- [#575](https://github.com/KingInYellows/yellow-plugins/pull/575)
  [`1df6023`](https://github.com/KingInYellows/yellow-plugins/commit/1df602315d3d3fa53487d5c57b4e3625bc15d64b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - fix: persist
  reviewer verdicts/confidences/fenced-paths to a deterministic state file in
  /council Step 4 and re-load it at the top of Steps 7-9 — associative arrays
  populated in one bash block do not survive into later blocks, so the
  report-assembly and cleanup steps previously read empty REVIEWER\_\* arrays

## 0.2.3

### Patch Changes

- [#507](https://github.com/KingInYellows/yellow-plugins/pull/507)
  [`0cae892`](https://github.com/KingInYellows/yellow-plugins/commit/0cae8920e98592d467c86e19372ca8998c05db04)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! -
  docs(skill-descriptions): trim non-load-bearing content from 8 skill
  descriptions while preserving WHAT + WHEN + differentiating clauses.

  Targets 7 yellow-core skills (compound-lifecycle 686→220, ideation 664→202,
  optimize 613→234, debugging 518→225, session-history 516→242,
  agent-native-audit 377→250, agent-native-architecture 314→224) and 1
  yellow-council skill (council-patterns 285→190). Total reduction: 2,186 chars
  (55% across modified skills).

  Rationale: descriptions over ~250 chars are in a documented degradation zone
  where trailing content is invisible to Claude's auto-invocation logic
  (anthropics/claude-code#44780, observed 2026-05-09; community-reported
  behavior, not documented in the official schema). The trim removes enumerated
  trigger phrase lists, body-content repetition, and methodology bleed — content
  that adds no signal at skill-selection time and was actively suppressing
  routing accuracy on the verbose skills. The five-principle enumeration in
  agent-native-architecture, the OFFLINE/DEGRADED/HEALTHY classification in
  mcp-health-probe, and the temporal differentiator in
  memory-recall/remember-pattern were all preserved as load-bearing selection
  signal.

  Updates CONTRIBUTING.md "Skill Description Budget" section to reconcile the
  existing "don't trim for budget" guidance with the new "trim non-load-bearing
  content for selection accuracy" principle. The two are compatible. The
  `user-invokable: false` carve-out clarifies that documentation-bloat trims
  (capability enumerations, body-content repetition) are valid for internal
  skills; budget pressure alone is not.

  See plans/complete/skill-description-audit.md and
  docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md for the full
  audit methodology and per-skill before/after analysis.

## 0.2.2

### Patch Changes

- [`b52d058`](https://github.com/KingInYellows/yellow-plugins/commit/b52d0583f1afd9cc11259b8e4eac62a124596623)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add explicit
  `model:` and `effort:` frontmatter to 8 phase-1 agents to escape the
  inheritance trap on narrow-role agents and add chain-of-thought depth to
  synthesizers/orchestrators.
  - `product-lens-reviewer` (yellow-docs): `model: sonnet` (matches sibling
    reviewers' explicit tiering)
  - `gemini-reviewer`, `opencode-reviewer` (yellow-council): `model: haiku` +
    `effort: low` — CLI relay agents that do no reasoning
  - `learnings-researcher` (yellow-core): `model: haiku` + `effort: low` — BM25
    retrieval, no synthesis; called on every `/review:pr` and `/workflows:plan`
  - `runner-assignment` (yellow-ci): `model: haiku` + `effort: low` —
    deterministic label-matching against fixed runner taxonomy
  - `audit-synthesizer` (yellow-debt): `effort: high` (model already `opus`) —
    cross-scanner deduplication and confidence gating benefit from extended CoT
  - `research-conductor` (yellow-research): `effort: high` (model already
    `opus`) — multi-source fan-out routing involves ambiguous decomposition
  - `brainstorm-orchestrator` (yellow-core): `model: sonnet` + `effort: high` —
    iterative dialogue with research integration; Sonnet is the structured-
    orchestration ceiling

## 0.2.1

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

## 0.2.0

### Minor Changes

- [`955cf03`](https://github.com/KingInYellows/yellow-plugins/commit/955cf03a9067003482c9968c799ff18672ffd3f3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Initial release
  of yellow-council plugin: on-demand cross-lineage council command
  (`/council <mode>`) fanning out to Codex (via yellow-codex), Gemini, and
  OpenCode CLIs in parallel for advisory consensus. Four modes: `plan`,
  `review`, `debug`, `question`. Synchronous fan-out with 600s per-reviewer
  timeout and partial-result reporting on timeout. Inline synthesis (Headline /
  Agreement / Disagreement) plus persisted report at
  `docs/council/<date>-<mode>-<slug>.md`. PR1 ships the scaffold + manifests +
  spike documentation; full reviewer agents and `/council` command
  implementation land in subsequent stacked PRs
  (yellow-council-core-implementation, yellow-council-polish-and-tests).

## 0.1.0

### Minor Changes

- Initial release: on-demand cross-lineage council command (`/council <mode>`)
  fanning out to Codex (via yellow-codex), Gemini, and OpenCode CLIs in
  parallel. Four modes: `plan`, `review`, `debug`, `question`. Synchronous
  fan-out with 600s per-reviewer timeout and partial-result reporting. Inline
  synthesis (Headline / Agreement / Disagreement) plus persisted report at
  `docs/council/<date>-<mode>-<slug>.md`. V1 scaffold + spikes; full
  implementation lands in subsequent PRs.
