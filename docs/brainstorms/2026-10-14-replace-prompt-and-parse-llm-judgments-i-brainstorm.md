# Replace prompt-and-parse LLM judgments with TypeSafe typed judgments

Date: 2026-10-14

## What We're Building

Find yellow-plugins steps where a Claude prompt-and-parse decision could become a
typed TypeSafe judgment (Choice, Noul or Score) and propose changes against
`plugins/`. Success is measured on accuracy against recorded outcomes, parse
reliability and latency/cost, with accuracy as a hard floor: no change that
trades quality for speed or cost.

Original direction (approach C): extend the existing shadow-mode Jev prefilter
(`plugins/yellow-core/lib/jev-prefilter.sh`) to log a category choice and a
`track` choice beside the existing `durable` and `has_instruction` answers, then
compare them against real promoter outcomes. No behavior change ships.

Superseded during planning (`plans/jev-category-offline-eval.md`): approach C
was replaced by an offline eval script,
`plugins/yellow-core/lib/jev-category-eval.py`, with no hook, agent or drain
change. Approach C could not answer the question:

- At Stop time Jev sees the raw transcript tail, but the real pick is made
  later from the scorer's `candidate_text`, so a Stop-time answer tests no
  change that could ship.
- Only 8 of 193 solution docs came from the staging pipeline, and
  `COMPOUND_JEV_PREFILTER` is not set anywhere, so shadow pairs would number
  in the tens.
- The promoter cannot override the reviewer's pick, so the logged outcome is
  Sonnet's own answer: the comparison would measure agreement, not accuracy.

The offline script lists disagreements for a person to judge, and its verdict
is a pre-registered paired non-inferiority test on docs dated after the
criteria were frozen (the holdout split).

## Why This Approach

The only experiment with tracked ground truth, the solution-category pick in
`plugins/yellow-core/agents/workflow/staging-reviewer.md`, did not clear the
accuracy floor. TypeSafe with the same information as the current prose table
scored 15 points below Sonnet. A richer variant tuned on a dev split was within
noise of Sonnet on held-out data, which is not enough to replace it. An
offline evaluation against frozen criteria changes no staging behaviour, and
its holdout split (docs written after the freeze) is the only evidence that
was never used for tuning.

### Experiment: solution-category pick

Input: title, problem and tags of the 193 tracked `docs/solutions/` docs (the
archived README excluded). Label: the doc's folder. Deterministic split by path
hash: 57 dev, 136 test. Only git-tracked content was sent to the API. The
baseline is a blind Sonnet pass using the production marker table, run once.

| Classifier | Dev (57) | Test (136) |
|---|---|---|
| Majority class (code-quality) | 38.6% | 33.8% |
| Sonnet, blind, current prose table | 63.2% | 66.2% (90/136) |
| TypeSafe `jev-1.13.0`, variant A (same info as the table) | 42.1% | 51.5% |
| TypeSafe `jev-1.13.0`, variant B (richer descriptions) | 63.2% (tuned on dev) | 64.0% (87/136) |
| TypeSafe `jev-1.14.0`, variant B | 57.9% | 64.0% |

- Variant A fails the accuracy floor (about 15 points under Sonnet on test).
- Variant B was written after reading dev errors. Paired test split: 73 both
  right, 17 Sonnet-only, 14 TypeSafe-only, 32 both wrong. Difference -2.2
  points, 95% bootstrap interval -10.3 to +5.9, so it cannot be called equal or
  worse.
- TypeSafe confidence is informative: 79% accurate at confidence >= 0.95 (66
  items) versus 44% below 0.5.
- Cascade (TypeSafe if confidence >= t, else Sonnet), threshold chosen on dev: at
  t = 0.7, test accuracy 67.6% (92/136) with 71% of items answered by TypeSafe.
  That is two items above Sonnet, within noise. Other thresholds are descriptive
  only.
- Reliability: 636 TypeSafe requests, 0 errors, 0 parse failures. The Sonnet
  baseline returned 193 of 193 valid values from a single agent pass, so it is
  not a comparable reliability figure.
- Latency: TypeSafe median 0.14 s per request, p95 at most 0.22 s. Sonnet was
  not timed.
- Cost: about 510k input tokens, roughly $0.02 at the documented $0.042 per
  million input tokens. The category pick is one table lookup inside a larger
  Sonnet prompt, so replacing it would save close to nothing.
- The `track` (bug vs knowledge) question: 68.4% on test against a 57% majority
  floor. No Sonnet baseline was run, so it supports no recommendation.

### Baseline: offline eval (committed criteria)

`plugins/yellow-core/lib/jev-category-eval.py run`, 2026-10-14, model
`jev-1.13.0` requested and returned, criteria sha
`41a973c98bebb3c7b1aae713e82d83c2c81b05991e8f05b687fd8c4d1a47f3fd`
(variant B, frozen in `jev-category-criteria.json`; complete run, 192 of 192
eligible docs). This is the first trustworthy baseline; the table above used
degraded inputs (see Caveats).

| Split | n | Agreement | Wilson 95% | conf >= 0.7: coverage / agreement | conf >= 0.95: coverage / agreement |
|---|---|---|---|---|---|
| dev | 61 | 65.6% (40/61) | 53.0-76.3% | 67.2% / 73.2% | 32.8% / 85.0% |
| test | 131 | 68.7% (90/131) | 60.3-76.0% | 67.9% / 77.5% | 33.6% / 90.9% |
| holdout | 0 | - | - | - | - |
| all | 192 | 67.7% (130/192) | 60.8-73.9% | 67.7% / 76.2% | 33.3% / 89.1% |

- 192 docs sent: the archived README is excluded, and
  `code-quality/cat-file-argmax-inline-substitution-antipattern.md` is
  skipped because its title is not valid YAML (PyYAML rejects it too).
- 0 errors, 0 invalid answers. Median latency 0.147 s, p95 0.167 s; 167,538
  input tokens.
- Verdict: INSUFFICIENT-DATA. There are no holdout docs yet; the one
  pre-registered look is at 155 adjudicated holdout docs.
- Jev is not fully deterministic. An earlier run the same day, under a
  criteria file that differed only in its notes (the instructions and
  criteria sent were byte-identical), changed 4 of 192 answers, all at
  confidence below 0.40; mean confidence moved by 0.018. That run scored
  69.5% (91/131) on test. Treat a one- or two-doc difference as noise.
- Why test moved from 64.0% to 68.7%:
  - On the experiment's own 136 test docs this run scores 65.9% (89/135; the
    unparseable doc is now skipped). The corrected parser changed the title
    or problem sent for 34 docs; against the experiment's run, 9 test docs
    flipped to agreement and 6 away from it.
  - The rest is the new split. Dev and test are now assigned by
    sha256(path) mod 100, and 40 of the 131 new test docs were in the
    experiment's dev split, which variant B was tuned on: 70.0% (28/40) on
    those against 68.1% (62/91) on docs never used for tuning. Dev and test
    figures are therefore optimistic; only holdout is clean.

### Caveats

- Labels are folders assigned by earlier promoters or humans: noisy, positives
  only, no negatives. Many bug-like tooling lessons sit in the code-quality
  catch-all, so the accuracy ceiling is low for any classifier.
- Variant B was tuned on 57 dev docs. The Sonnet baseline is one run, so its
  sampling variance is unmeasured. Test n = 136.
- The experiment's inputs were degraded. Its frontmatter extraction used a
  single-line regex, which sent empty titles for 19 docs and empty problems
  for 18 (15 had neither) and left the raw quote characters on 179 titles.
  Both the 64.0% TypeSafe figure and the 66.2% Sonnet figure were measured on
  those inputs (whether Sonnet saw the same degraded fields is unconfirmed),
  so treat the table above as a rough signal. The offline eval's parser
  matched PyYAML on every tracked doc in a one-off check on 2026-10-14 (the
  bats suite checks four committed fixtures); its baseline is the section
  above.
- The offline eval's dev/test split is new (sha256(path) mod 100, below 30
  for dev), not the experiment's split, so its figures are not directly
  comparable with the table above.
- The other candidate sites were not measured because no tracked outcome labels
  exist: staging-scorer skip/promote, learnings-researcher relevance filter,
  `/review:pr` fuzzy persona triggers, resolver per-thread dispositions. Their
  real outcome data is untracked (`jev-shadow/*.jsonl`, `.git/yellow-review/`
  ledgers, `todos/debt/`) and was kept out of the experiments.
- Docs are version-dependent: `jev-latest` points to `jev-1.13.0` today and
  aliases move. Pin a versioned model ID.
- The experiment's code and per-run outputs lived in a session scratchpad
  and were not kept. The tested variant B text is committed as
  `plugins/yellow-core/lib/jev-category-criteria.json`, and
  `jev-category-eval.py` replaces the experiment scripts.

### Alternatives considered

**Approach B: confidence-gated cascade.** Use TypeSafe above a confidence
threshold and Sonnet below it. Pros: accuracy held on test and most items skip
Sonnet. Cons: the saving is negligible for this step, and it adds a threshold to
maintain. Best when: the offline holdout verdict is GO and the cascade holds
there too.

**Approach A: no change.** Keep the Sonnet prose table. Pros: nothing to
maintain. Cons: the step stays non-deterministic and unmeasured. Best when: the
offline holdout verdict is NO-GO or stays INSUFFICIENT-DATA.

## Key Decisions

- Do not replace the solution-category pick with TypeSafe on current evidence;
  accuracy is a hard floor.
- ~~Approach C~~ (superseded): measure the category pick offline with
  `jev-category-eval.py` against frozen, committed criteria. Staging behavior
  and `jev-prefilter.sh` are unchanged.
- `track` is dropped from scope: the promoter hard-codes `track: knowledge`
  for staged docs, so there is no recorded outcome to compare against. A
  `track` evaluation belongs on knowledge-compounder docs, where it varies.
- Keep the guardian and injection-marker checks deterministic regardless of any
  future TypeSafe use.
- Only tracked, public repo content was sent to the API; local-only files
  (`yellow-plugins.local.md`, `.ruvector/`, `.git` ledger state) were excluded.

## Open Questions

- ~~How many shadow records are needed before a category comparison is
  meaningful?~~ Answered by the offline protocol: one look at 155 adjudicated
  holdout docs (about 80% power at a 0.10 margin), roughly 13 months at the
  current rate of new docs.
- ~~Should the promoter's final category be the recorded outcome, since the
  promoter can override it?~~ Answered: it cannot. `staging-promoter` only
  checks the category against the enum and writes the reviewer's pick.
- Which of the unmeasured sites (persona triggers, learnings relevance, resolver
  dispositions) should get shadow logging next, and where would their labels
  come from?
- Does `jev-1.14.0` behave differently on real session text than on doc
  summaries? It matched `jev-1.13.0` on test but scored lower on dev.
