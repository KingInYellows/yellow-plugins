# Feature: Offline TypeSafe Jev evaluation of the solution-category pick

## Problem Statement

`staging-reviewer` Phase 9 has Sonnet pick one of six `docs/solutions/`
folders from a prose marker table. The brainstorm
(`docs/brainstorms/2026-10-14-replace-prompt-and-parse-llm-judgments-i-brainstorm.md`)
tested TypeSafe Jev on the same pick: 64.0% against Sonnet's 66.2% on 136 docs,
with informative confidence. That is too close to call. Accuracy is a hard
floor, so we need more evidence before any change ships.

The brainstorm's approach C (log a category answer from the Stop-time
prefilter) was rejected during planning for three reasons:

- At Stop time Jev sees the raw transcript tail. The real pick is made later,
  from the scorer's `candidate_text`. A Stop-time answer therefore does not
  test any change that could ship.
- Only 8 of 193 solution docs came from the staging pipeline, and
  `COMPOUND_JEV_PREFILTER` is not set anywhere. Shadow pairs would number in
  the tens.
- The promoter cannot override the reviewer's pick, so the logged "outcome"
  is Sonnet's own answer. The comparison measures agreement, not accuracy.

User decisions:

- Use an offline eval script, with no hook, agent or drain change.
- The script lists disagreements, the user judges them, and the report counts
  those judgements.
- Drop `track` from scope.

<!-- deepen-plan: codebase -->
> **Codebase:** The experiment's inputs were degraded. `exp/extract.py`
> parsed frontmatter with a single-line regex (`^key:\s*(.*)$`). That sent
> empty titles for 19 docs and empty problems for 18 (15 had neither), and it
> left the raw quote characters on 179 titles. Both the 64.0% TypeSafe figure
> and the 66.2% Sonnet figure in the brainstorm were measured on those inputs
> (whether Sonnet saw the same degraded fields is unconfirmed). Treat the
> brainstorm numbers as a rough signal, not a baseline. Task 3.3 is the first
> trustworthy baseline.
<!-- /deepen-plan -->

## Current State

- `plugins/yellow-core/lib/jev-prefilter.sh` holds the Stop-time shadow call
  (`durable`, `has_instruction`). It is bash-only and sourced only by
  `_stop-capture-subshell.sh`. This plan leaves it unchanged.
- `staging-reviewer.md` maps categories at about lines 526-534. The promoter
  only enum-checks the category (`staging-promoter.md` about lines 143-149)
  and hard-codes `track: knowledge` (about line 311).
- `scripts/validate-solutions.js` about lines 88-95 has the six category
  names (`VALID_CATEGORIES`).
- `lib/` already ships invoked stdlib Python (`context-observer.py`,
  `statusline-settings.py`) with bats coverage. That is the precedent for a
  new invoked script.
- The experiment code lives in the session scratchpad (`exp/`), which will not
  persist. The criteria text tested as "variant B" must be committed before it
  is lost.

## Proposed Solution

Add a stdlib-only Python script, `plugins/yellow-core/lib/jev-category-eval.py`,
with two subcommands:

- **`run`** reads git-tracked `docs/solutions/<category>/*.md` (excluding
  `archived/`). For each doc it sends the frontmatter `title`, `problem` and
  `tags` as `state.lesson` to Jev with one `category` choice question. It
  writes one JSONL row per doc to `--out DIR`. It never writes inside the
  repository.
- **`report`** is fully offline. It reads a results file and an optional
  review file, then prints agreement, confidence bins and coverage at the
  pre-registered thresholds. It writes `disagreements.tsv` for the user to
  judge, and counts those judgements on later runs.

Key decisions:

- **Committed, frozen criteria.** Variant B's six descriptions and the question
  instructions go into `plugins/yellow-core/lib/jev-category-criteria.json`,
  with a `frozen_at` date and a note that they were tuned on the dev split.
  Every row records the file's sha256. `report` refuses to pool rows that
  carry different criteria shas.
- **No `other` option in this version.** Adding one would change the criteria
  from what was tested. A variant with `other` is a follow-up and gets its
  own sha.
- **Splits.**
  - `dev` and `test` are assigned by sha256(path) mod 100, below 30 for dev.
    This re-baselines the experiment, which split by index, so the numbers
    will move slightly.
  - `holdout` is every doc whose frontmatter `date` is after `frozen_at`. It
    is the only split never used for tuning.

<!-- deepen-plan: codebase -->
> **Codebase:** "The experiment split by index" is wrong. The brainstorm (line
> 31) says "split by path hash". `labels.json["split"]` is pseudorandom, and
> `sha256(path) % 100 < 30` matches it on only 109 of 193 docs, which is near
> chance. Whatever the experiment used, the new split is different, so the
> numbers will move. Holdout size: the newest doc is dated 2026-10-11, so a
> freeze at commit time starts with 0 holdout docs. New docs arrive at about
> 12 a month (3 in Jun, 18 in Jul, 4 in Aug, 18 in Sep, 12 so far in Oct) and
> in bursts.
<!-- /deepen-plan -->
- **Pre-registered protocol**, in the criteria file and printed in the report
  header:
  - The primary metric is adjudicated accuracy on `holdout`. Until review
    marks exist, the report prints it as agreement.
  - The confidence thresholds are fixed at 0.7 and 0.95 and are never tuned
    on eval data.
  - The default verdict is no-go. The user chose (2026-10-14) a paired
    non-inferiority test with margin Δ = 0.10 and one-sided α = 0.05, using
    the Tango score interval on Jev versus folder correctness over the same
    holdout docs.
    - **GO** when the interval's lower bound is above −0.10.
    - **NO-GO** when the upper bound is below −0.10.
    - **INSUFFICIENT-DATA** otherwise.
    - **One pre-registered look** at n = 155 holdout docs, which gives about
      80% power and takes roughly 13 months at the current rate. Earlier
      reports are descriptive only and print INSUFFICIENT-DATA.
    - **Adjudication:** the user judges every disagreement plus a random 20%
      sample of agreements (fixed seed), to limit discrepant-analysis bias.

<!-- deepen-plan: external -->
> **Research:** The Wilson rule is the wrong test.
> - **Why:** it treats the incumbent's accuracy as a fixed number and ignores
>   that both sides are scored on the same docs.
> - **Instead:** use a paired non-inferiority test, the Tango score interval
>   on discordant pairs, with H0: d ≤ −Δ. Check the implementation against
>   R `PropCIs::scoreci.mp`.
> - **Verdicts:** read them off the interval, not an n ≥ 50 gate. GO when
>   the lower bound is above −Δ. NO-GO when the upper bound is below −Δ.
>   INSUFFICIENT-DATA otherwise.
>
> Sample size at 25% discordance, equal true accuracy and 80% power:
>
> | Margin Δ | One-sided α | n | Time at about 12 docs a month |
> |---|---|---|---|
> | 0.05 | 0.025 | ~785 | ~5 years |
> | 0.10 | 0.05 | ~155 | ~13 months |
>
> At Δ = 0.05, power at n = 50 is about 11%. **This is the user's decision:**
> widen the margin, accept low power and say so, or add another source of
> labels.
>
> Other protocol points:
> - Re-checking monthly as the holdout grows inflates α. Pre-register one
>   look at a fixed n, or use alpha-spending or confidence sequences.
> - Adjudicating only disagreements is the "discrepant analysis" bias. Also
>   adjudicate a random sample of agreements, not just treat them as
>   correct.
>
> See: https://pubmed.ncbi.nlm.nih.gov/9595618,
> https://search.r-project.org/CRAN/refmans/PropCIs/html/scoreci.mp.html,
> https://www.ncss.com/wp-content/themes/ncss/pdf/Procedures/NCSS/Two_Correlated_Proportions-Non-Inferiority,_Superiority,_and_Equivalence_Tests.pdf
<!-- /deepen-plan -->
- **Model.** The default is `jev-1.13.0`, with `--model` to override. Each
  row records the model id the response returns.
- **Egress.** Only frontmatter `title`, `problem` and `tags` of git-tracked
  docs are sent; body text is not. `run` refuses to start without
  `TYPESAFE_API_KEY`. The key goes in a request header, never in argv or
  output. `--dry-run` prints the doc count and the estimated input size
  without sending anything.

<!-- deepen-plan: codebase -->
> **Codebase:** The prefilter runs `curl -q`, so `~/.curlrc` is ignored, and
> it passes the key on fd 3. `urllib` behaves differently: it honours
> `HTTPS_PROXY`/`NO_PROXY`, and with an `http://` `--url` it sends the bearer
> token in cleartext. `docs/security.md:490-540` documents the endpoint
> override's trust assumption, and the new subsection should match it.
> Frontmatter is sent unfenced, unlike the prefilter's `jev_fence_state`. The
> experiment did the same and these are the repo's own docs, but
> `docs/security.md` should state that exemption explicitly.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** urllib copies `add_header` headers onto cross-host redirects
> (CPython gh-77842, still open).
> - **Opener:** build it with `ProxyHandler({})` plus an `HTTPRedirectHandler`
>   whose `redirect_request` returns `None`. Send the token with
>   `add_unredirected_header`.
> - **Plain http:** refuse it unless `ipaddress.ip_address(host).is_loopback`,
>   so `localhost` by name is refused; the stub binds `127.0.0.1`. Refuse
>   URLs carrying userinfo. Keep TLS verification at its defaults.
> - **Errors:** raise your own error `from None`. Never print the `Request`
>   object or a raw error body. Strip the token string from any echoed text.
>   Keep `http.client` debuglevel at 0.
>
> See: https://docs.python.org/3/library/urllib.request.html,
> https://github.com/python/cpython/issues/77842
<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: Foundation

- [x] 1.1: Recover the variant B criteria text and the `category`
  instructions string from
  `/tmp/claude-1000/-home-kinginyellow--herdr-worktrees-yellow-plugins-jev/aa7eb31c-5ab9-4d4d-b856-60b1dd2ceb0f/scratchpad/exp/variant_b.py`
  and `run_ts.py` (the `q()` `category` entry). If the scratchpad is gone,
  copy the text from this plan's References section.
- [x] 1.2: Create `plugins/yellow-core/lib/jev-category-criteria.json`. Store
  `schema: 1`, `model_default`, `frozen_at` (the commit date), `tuned_on`
  ("dev split of 57 docs, 2026-10-14 brainstorm"), `instructions`, a
  `criteria` map of six objects with `what` and `not_for` keys, and a
  `protocol` object (primary metric, thresholds `[0.7, 0.95]`, go rule).
  Make sure the six keys equal `VALID_CATEGORIES` in
  `scripts/validate-solutions.js`.

### Phase 2: Implementation

- [x] 2.1: Write `plugins/yellow-core/lib/jev-category-eval.py` (stdlib only,
  Python 3.9+, LF endings).
  - List files with `git ls-files -z docs/solutions`, keeping depth-4 `.md`
    files whose folder is in the criteria keys.
  - Parse the frontmatter with a small line parser: `title`, `problem`,
    `tags` (both inline-list and block-list forms) and `date`.
  - Skip a doc with no frontmatter or an empty title and problem, and count
    the skip with a reason.

<!-- deepen-plan: codebase -->
> **Codebase:** The 193 tracked docs use a wider grammar than a line parser
> handles.
> - **Titles:** 129 single-quoted, 31 double-quoted, 14 bare. 18 put the
>   value on a continuation line (`title:\n  '…'`), and 1 uses a `''`
>   escape.
> - **Problems:** 123 single-quoted, 14 double-quoted, 31 bare, 25 continued
>   or folded.
> - **Tags:** 83 inline, 103 block, 7 neither.
> - **Dates:** 3 docs have no `date`
>   (`build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md`,
>   `build-errors/userconfig-type-title-remote-validator-drift.md`,
>   `security-issues/docs-snippet-path-traversal-and-lex-sort.md`).
> - **No `title`:**
>   `code-quality/claude-code-bare-flag-and-hook-recursion-guard.md` uses
>   `name:` and `description:` instead.
> - **Unparseable:** one doc fails PyYAML.
>
> `scripts/validate-solutions.js:301-340` handles all of these with
> `yaml.parse`, but there is no stdlib Python equivalent. The Python floor is
> a choice: 3.9+ here, while the `context-observer.py` docstring says 3.7+.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Write a small state machine for exactly this subset, and
> fail with `file:line` on anything outside it. Don't use per-line regexes.
> - **Golden test:** generate expected JSON once with PyYAML
>   (`uv run --with pyyaml`) over all docs, commit it, and test the stdlib
>   parser against it.
> - **Keep every value a string.** PyYAML's YAML 1.1 rules turn `yes`/`no`
>   into booleans and `2026-01-05` into a date.
> - **Single quotes:** the only escape is `''`.
> - **Double quotes:** support `\n \t \" \\ \xNN \uNNNN` and line
>   continuation.
> - **Folding:** a newline folds to one space, and a blank line becomes `\n`.
> - **Inline lists:** split on commas outside quotes, and accept a trailing
>   comma.
> - **Block lists:** a `- item` may sit at the key's own indentation.
> - **Reject:** duplicate keys, tab indentation, a BOM and CRLF.
>
> Vendoring is possible: PyYAML's pure-Python package (MIT, about 17 files) or
> `Oaklight/zerodep` `yaml.py` (single file, 3.10+, young, licence
> unverified). A ~150-line subset parser with the golden test is simpler.
>
> See: https://yaml.org/spec/1.2.2, https://github.com/Oaklight/zerodep
<!-- /deepen-plan -->
- [x] 2.2: Implement the `run` subcommand.
  - **Flags:** `--repo DIR` (default `.`), `--out DIR` (required, must not be
    inside `--repo`), `--model`, `--url` (default
    `https://api.typesafe.ai/v1/systemone`), `--timeout` (default 30),
    `--limit N`, `--dry-run`.
  - **Request:** one per doc, body
    `{model, state: {lesson: {title, problem, tags}}, questions: {category: {type: "choice", instructions, criteria}}}`.
  - **Retries:** one retry on a timeout or 5xx.

<!-- deepen-plan: external -->
> **Research:** Retries and timeouts.
> - **What to retry:** `{429, 500, 502, 503, 504}`. Catch `HTTPError` before
>   `URLError` (it is a subclass), and also catch `TimeoutError`.
> - **Retry-After:** honour it, capped. It can be seconds or an HTTP date.
>   Otherwise back off with jitter.
> - **Timeouts:** `timeout=` applies per socket operation, so also enforce an
>   overall per-request budget with `time.monotonic()`.
> - **Billing:** a POST that times out after sending may still be billed.
> - **Experiment default:** retried on 429 as well. Add 429 to the plan's
>   retry set.
<!-- /deepen-plan -->
  - **Rows:** each row records `schema`, `path`, `folder`, `split`,
    `prediction`, `confidence`, `probabilities` (filtered to the criteria
    keys), `model_requested`, `model_returned` (kept only if it matches
    `^jev-[0-9.]+$`), `criteria_sha`, `lesson_sha` (sha256 of the lesson
    sent, so judgements bind to content), `latency_s`, `input_tokens` and
    `status` (`ok`, `invalid` or `error:<class>`).
  - **Failures are rows.** A failed request writes a row with
    `prediction: null`. Never drop it silently.
  - **Output:** write to `results-<utc>.jsonl` with mode 600, refusing to
    overwrite an existing file.
- [x] 2.3: Implement the `report` subcommand.
  - **Usage:** `report RESULTS [--review TSV] [--seed 0]`.
  - Refuse mixed `criteria_sha` or mixed `model_returned` values.
  - **Per split:** n, agreement with a Wilson 95% interval, the confusion
    pairs, coverage and agreement at 0.7 and 0.95, and the error and invalid
    counts.
  - **Disagreements file:** write `disagreements.tsv` beside the results with
    the columns path, folder, jev, confidence and an empty `judgement`. Keep
    any judgements already in an existing TSV.
  - **Judgements:** with `--review`, read the `judgement` values (`folder`,
    `jev`, `both` or `neither`). Print adjudicated accuracy for each side,
    treating unreviewed agreements as correct for both and labelling them
    so.
  - Then print the protocol verdict: `GO`, `NO-GO` or `INSUFFICIENT-DATA`,
    from the Tango interval at Δ = 0.10, α = 0.05. Before 155 adjudicated
    holdout docs it is always `INSUFFICIENT-DATA`, with the interval shown
    as descriptive only. Also write the random 20% agreement sample (fixed
    seed) into `disagreements.tsv` for judging.
  - Test the Tango interval against `PropCIs::scoreci.mp` reference values,
    hard-coded in the bats fixtures.
  - Print no doc text, only paths.
- [x] 2.4: Exit codes: 0 on success, 2 for usage errors (missing key, `--out`
  inside the repo, mixed shas), 1 when every request in `run` failed.

### Phase 3: Quality

- [x] 3.1: Add the fixtures.
  - A stub server `plugins/yellow-core/tests/fixtures/jev-eval/stub_server.py`
    (stdlib `http.server`, `do_POST`, an ephemeral port printed to stdout,
    canned answers keyed by title, plus 500 and timeout modes).
  - A small fixture repo under the same folder (git-initialised in bats
    `setup`) with docs in three categories, one `archived/` doc, one doc with
    no frontmatter, one with block-list tags, and one dated after
    `frozen_at`.

<!-- deepen-plan: codebase -->
> **Codebase:** There is no HTTP stub precedent in the repo. `jev-prefilter.bats`
> (`:15-25`) mocks `curl` with a PATH shim, which cannot intercept `urllib`,
> and `tests/mocks/curl` is a forbidden-command shim. `tests/fixtures/` already
> holds committed `.md` fixtures (`handoff/`, `plan-status/`), and
> `validate-solutions.js` only scans `docs/solutions/`, so fixture docs are
> safe. Initialise git in `setup`, since a nested `.git` cannot be committed.
> `git add` plus `ls-files` needs no `user.name`.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** The bats stub pattern.
> - **Start:** in `setup`, start the server in the background with
>   `</dev/null >"$PORT_FILE" 2>"$LOG" 3>&- &`. If fd 3 is not closed, bats
>   hangs.
> - **Server:** `ThreadingHTTPServer(("127.0.0.1", 0))` prints its port with
>   `flush=True`, and the port appearing means it is ready.
> - **Wait:** poll for up to about 5 s with `kill -0` liveness checks.
> - **Stop:** in `teardown`, `kill`, wait a little, `kill -KILL`, then `wait`,
>   and end on `|| true`.
> - **Avoid:** never start the server inside `run` or `$(…)`.
> - **Request log:** have the stub log request headers as JSONL into
>   `$BATS_TEST_TMPDIR`, for the Authorization and retry-count assertions.
> - **Scenarios:** pass one as an argument, e.g. `429-then-200`.
> - **Timeout:** set `BATS_TEST_TIMEOUT` in `setup_file` as a backstop.
>
> See: https://bats-core.readthedocs.io/en/stable/writing-tests.html
<!-- /deepen-plan -->

- [x] 3.2: Add `plugins/yellow-core/tests/jev-category-eval.bats` covering:
  - `--dry-run` sends nothing;
  - a missing key exits 2, and `--out` inside the repo exits 2;
  - only tracked, non-archived docs are sent, and the request body holds
    `state.lesson` with no body text;
  - the key is in neither argv nor stdout/stderr (scan both and the results
    file for the key string);
  - a 500 after the retry becomes an `error:` row;
  - a prediction outside the criteria becomes an `invalid` row;
  - holdout assignment by `date`;
  - `report` agreement counts, confidence bins and the Wilson output on a
    hand-made results fixture;
  - judgement merge keeps existing marks;
  - mixed criteria sha refusal, and the verdict line in each of the three
    cases.

<!-- deepen-plan: codebase -->
> **Codebase:** `context-observer.bats:19-21` skips when `python3` is
> missing. CI runs `bats plugins/yellow-core/tests/` as a required step
> (`validate-schemas.yml:1475-1479`) on `ubuntu-latest`, which has a system
> `python3` (no `setup-python`). Make sure a skip cannot pass silently in CI;
> for example, fail rather than skip when `CI` is set.
<!-- /deepen-plan -->
- [x] 3.3: Run the eval once against this repo with the real key, to
  re-baseline. Record the summary (n, agreement per split, the model id and
  the criteria sha, no doc text) in the brainstorm's results section as the
  committed baseline.
- [x] 3.4: Update the documentation.
  - `plugins/yellow-core/CLAUDE.md`: add the script to the Shared Libraries
    Python list and `jev-category-eval` to the Testing list.
  - `plugins/yellow-core/README.md`: add a usage section and the
    review-judgement workflow.
  - `docs/security.md`: add a "Jev category eval (offline)" subsection under
    "Jev Shadow Pre-Filter" covering what leaves the machine (frontmatter of
    tracked docs only), when (manual run only), where the key lives, and that
    the output is written outside the repo.
<!-- deepen-plan: codebase -->
> **Codebase:** The Shared Libraries section of `yellow-core/CLAUDE.md` says
> "four Node modules and two Python scripts". Change it to three Python
> scripts. Add `jev-category-eval` to the Testing list (about lines 584-590).
<!-- /deepen-plan -->

- [x] 3.5: Update the brainstorm.
  - Mark `track` as dropped, since the promoter hard-codes it.
  - Record that approach C was replaced by the offline eval, and why.
  - Correct the split description (the experiment split by index).
  - Answer the open question: the promoter cannot override the category.

<!-- deepen-plan: codebase -->
> **Codebase:** Drop the "correct the split description" sub-item. The
> brainstorm's "split by path hash" was not shown to be wrong. Note instead
> that the plan's split is new. Also add the degraded-parser finding to the
> brainstorm's Caveats.
<!-- /deepen-plan -->
- [x] 3.6: Run `pnpm changeset` (yellow-core `minor`, a new opt-in tool) and
  commit the file.
- [x] 3.7: Run `pnpm validate:schemas`, `pnpm lint:plugins`, `pnpm lint`, and
  `bats tests/` from `plugins/yellow-core`.

## Technical Details

- **New files:**
  - `plugins/yellow-core/lib/jev-category-eval.py`
  - `plugins/yellow-core/lib/jev-category-criteria.json`
  - `plugins/yellow-core/tests/jev-category-eval.bats`
  - `plugins/yellow-core/tests/fixtures/jev-eval/` (stub server and fixture
    docs)
  - `.changeset/<slug>.md`
- **Modified files:**
  - `plugins/yellow-core/CLAUDE.md`
  - `plugins/yellow-core/README.md`
  - `docs/security.md`
  - the brainstorm doc
- **Unchanged on purpose:** `jev-prefilter.sh`, `staging-reviewer.md`,
  `staging-promoter.md`, the hooks, `catalog/` and the manifests.
- **Dependencies:** none. The script uses stdlib only (`urllib.request`,
  `json`, `hashlib`, `subprocess`, `argparse`).

## Acceptance Criteria

- `run --dry-run` against this repo reports 193 eligible docs, or the current
  count, and makes no network request (bats asserts the stub received
  nothing).
- No staging, hook or agent behaviour changes; the diff touches none of the
  "unchanged on purpose" files.
- The key and doc body text never appear in argv, stdout, stderr or output
  files; bats asserts this.
- Every results row carries `criteria_sha` and `model_returned`, and
  `report` refuses mixed shas.
- `report` prints the protocol verdict and writes `disagreements.tsv` with
  paths only.
- The baseline run is recorded in the brainstorm; agreement on `test` is in
  line with the experiment (64.0% ± noise), or the difference is explained.
- All validators in 3.7 pass, and the yellow-core bats suite is green.

<!-- deepen-plan: codebase -->
> **Codebase:** Correct the dry-run count to 193 eligible docs; 194 are
> tracked, including `archived/README.md`. The "in line with 64.0% ± noise"
> criterion cannot hold as written. The correct parser changes the inputs for
> about 20% of docs, so the baseline will move for a known reason. Reword it
> as "baseline recorded, with the change from the brainstorm figure
> explained".
<!-- /deepen-plan -->

## Edge Cases

- **Frontmatter variants:** quoted titles with `''` escapes, block-list
  `tags:`, a missing `problem`. The doc is parsed, or skipped with a reason
  and never crashes the run.
- **New category folders** not in the criteria are skipped and counted. They
  signal that the criteria need a new frozen version.
- **API answers outside the criteria, or a malformed response,** produce an
  `invalid` row.
- **A rate limit or 429** counts as an error class after one retry. The run
  continues and the report shows the error count.
- **A doc moved between folders after a run** shows up as a changed label.
  The report keys judgements by path and flags a judgement whose folder no
  longer matches.
- **Zero holdout docs**, as right after the freeze, gives an
  `INSUFFICIENT-DATA` verdict, not an error.

<!-- deepen-plan: codebase -->
> **Codebase:** Three docs have no `date`, so they can never be holdout;
> assign them to dev/test only. Docs that use `name:`/`description:` instead
> of `title:`/`problem:` are skipped with a reason, or mapped explicitly.
> Decide which. One doc has no `category:` frontmatter, which is fine because
> the label comes from the folder.
<!-- /deepen-plan -->

## References

- Brainstorm:
  `docs/brainstorms/2026-10-14-replace-prompt-and-parse-llm-judgments-i-brainstorm.md`
- `plugins/yellow-core/lib/jev-prefilter.sh`: the request-shape and
  probability-filter precedent.
- `plugins/yellow-core/agents/workflow/staging-reviewer.md` about lines
  490-543: the Phase 9 category table.
- `scripts/validate-solutions.js` about lines 88-95: the category enum.
- `plugins/yellow-core/lib/context-observer.py` and
  `tests/context-observer.bats`: the invoked-Python and bats precedent.
- TypeSafe docs: https://docs.typesafe.ai/primitives/choice.md (criteria
  objects, `other`), https://docs.typesafe.ai/models.md (pin versions; jev
  pricing $0.042 per million input tokens), https://docs.typesafe.ai/confidence.md
  (calibrate thresholds on your own data).
- Evaluation practice: Cawley and Talbot, JMLR 2010 (no threshold tuning on
  eval data), https://jmlr.org/papers/v11/cawley10a.html; Google Rules of ML
  (test on later data), https://developers.google.com/machine-learning/guides/rules-of-ml

<!-- deepen-plan: external -->
> **Research:** Additional sources from enrichment.
> - Tango (1998), the paired non-inferiority score test:
>   https://pubmed.ncbi.nlm.nih.gov/9595618
> - Reference implementation: R `PropCIs::scoreci.mp`.
> - NCSS correlated-proportions NI sample size (Connor 1987).
> - CPython gh-77842 (header leak on redirect).
> - bats-core "Writing tests" (fd 3, `BATS_TEST_TIMEOUT`).
> - YAML 1.2.2 spec (quoting and folding rules).
>
> The Parallel task group `tgrp_72bf620457b9414b8c2b1bbbf6262285` was still
> running at enrichment time, so its results are not included.
<!-- /deepen-plan -->
- Variant B criteria: committed as
  `plugins/yellow-core/lib/jev-category-criteria.json`, the frozen source of
  truth (the backup copy that stood here was removed once the file shipped).

## Follow-ups (out of scope)

- Drain-time shadow arm on `candidate_text`, only if the offline holdout
  reaches `GO`.
- A criteria variant with `other`, under its own sha.
- A `track` evaluation on knowledge-compounder docs, where `track` actually
  varies.
- Rotation for `jev-shadow/predictions.jsonl` and `outcomes.jsonl`, which have
  no reaper today.
