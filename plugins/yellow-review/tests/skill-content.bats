#!/usr/bin/env bats
# Static content assertions for the stack-traversal provider-resolution-
# ordering fixes (L14), which are prose, not executable code, so they cannot
# be exercised via a Node/Bash unit test. Each case asserts a specific
# ordering fix landed in the relevant file and stays there — regressions
# here are silent (a future edit could reintroduce a Graphite-only
# enumeration/adoption call ahead of provider resolution and nothing else
# would notice).

bats_require_minimum_version 1.5.0

SKILLS_DIR="$BATS_TEST_DIRNAME/../skills"
COMMANDS_DIR="$BATS_TEST_DIRNAME/../commands/review"
TRAVERSAL_SKILL="$SKILLS_DIR/stack-traversal/SKILL.md"
RESOLVE_STACK="$COMMANDS_DIR/resolve-stack.md"
REVIEW_ALL="$COMMANDS_DIR/review-all.md"

@test "stack-traversal skill: Step 0 (resolve provider) heading precedes Step 1 (enumerate)" {
  step0_line=$(grep -n '^### Step 0: Resolve the active stacked-PR provider' "$TRAVERSAL_SKILL" | head -1 | cut -d: -f1)
  step1_line=$(grep -n '^### Step 1: Enumerate the stack' "$TRAVERSAL_SKILL" | head -1 | cut -d: -f1)
  [ -n "$step0_line" ]
  [ -n "$step1_line" ]
  [ "$step0_line" -lt "$step1_line" ]
}

@test "resolve-stack: provider resolution (Step 0) precedes the gt preflight check" {
  provider_line=$(grep -n 'skill: "stack-provider-router"' "$RESOLVE_STACK" | head -1 | cut -d: -f1)
  gt_check_line=$(grep -n 'command -v gt' "$RESOLVE_STACK" | head -1 | cut -d: -f1)
  [ -n "$provider_line" ]
  [ -n "$gt_check_line" ]
  [ "$provider_line" -lt "$gt_check_line" ]
}

@test "review-all: gt track is gated on READY_GRAPHITE, not run unconditionally" {
  track_line=$(grep -n '^gt track$' "$REVIEW_ALL" | head -1 | cut -d: -f1)
  gate_line=$(grep -n 'READY_GRAPHITE.\{0,20\}only' "$REVIEW_ALL" | head -1 | cut -d: -f1)
  [ -n "$track_line" ]
  [ -n "$gate_line" ]
  [ "$gate_line" -lt "$track_line" ]
  # Only one unconditional `gt track` invocation should exist in the file
  # (the gated one above) — a second bare occurrence would mean a new
  # unconditional call slipped back in.
  count=$(grep -c '^gt track$' "$REVIEW_ALL")
  [ "$count" -eq 1 ]
}

# --- review-findings ledger: rule and scope in the compact-return schema ----
# Every compact-return producer must emit `rule` and `scope`, or its
# findings reach the ledger defaulted to unclassified/unscoped and lose
# their identity key (plans/review-findings-ledger.md Stage 2).

REVIEW_PR="$COMMANDS_DIR/review-pr.md"
WORKFLOW_SKILL="$SKILLS_DIR/pr-review-workflow/SKILL.md"
YR_AGENTS="$BATS_TEST_DIRNAME/../agents/review"
YC_AGENTS="$BATS_TEST_DIRNAME/../../yellow-core/agents/review"
VOCAB="$BATS_TEST_DIRNAME/../lib/review-ledger-vocab.json"

producers() {
  local n
  for n in project-compliance correctness maintainability project-standards reliability adversarial plugin-contract cli-readiness agent-cli-readiness agent-native thermonuclear; do
    printf '%s\n' "$YR_AGENTS/$n-reviewer.md"
  done
  printf '%s\n' "$YC_AGENTS/security-reviewer.md" "$YC_AGENTS/performance-reviewer.md"
}

# Field names inside a file's first ```json example that has "findings".
schema_fields() {
  awk '/^```json/ { inb = 1; buf = ""; next }
       inb && /^```/ { if (buf ~ /"findings"/) { print buf; exit } inb = 0; next }
       inb { buf = buf "\n" $0 }' "$1" |
    grep -oE '^ +"[a-z_]+":' | tr -d ' ":' | sort -u
}

@test "ledger: the producer census is complete (every compact-return example is covered)" {
  census=$(producers | sort)
  found=$(grep -l '^ *"autofix_class": "' "$YR_AGENTS"/*.md "$YC_AGENTS"/*.md | sort)
  [ "$census" = "$found" ]
}

@test "ledger: every compact-return producer lists rule and scope after category" {
  while IFS= read -r f; do
    grep -q '^ *"rule": "<slug from the injected rule-vocabulary>",$' "$f" || { echo "no rule: $f"; false; }
    grep -q '^ *"scope": "<enclosing dotted symbol path or nearest markdown heading>",$' "$f" || { echo "no scope: $f"; false; }
    [ "$(grep -A1 '^ *"category": ' "$f" | grep -c '"rule":')" -eq 1 ]
  done < <(producers)
}

@test "ledger: review-pr.md and SKILL.md schema examples carry the same fields" {
  a=$(schema_fields "$REVIEW_PR")
  b=$(schema_fields "$WORKFLOW_SKILL")
  [ -n "$a" ]
  [ "$a" = "$b" ]
  printf '%s\n' "$a" | grep -qx rule
  printf '%s\n' "$a" | grep -qx scope
}

@test "ledger: missing rule/scope is defaulted, not dropped, in both review commands" {
  grep -q 'rule: unclassified`, `scope: unscoped`' "$REVIEW_PR"
  grep -q 'Defaulted, never dropped:\*\* `rule` and `scope`' "$REVIEW_PR"
  grep -q 'Findings defaulted (missing rule/scope)' "$REVIEW_PR"
  grep -q 'Categories unmapped' "$REVIEW_PR"
  grep -q '`rule: unclassified`, `scope: unscoped`' "$REVIEW_ALL"
  grep -q 'defaulted to$' "$REVIEW_ALL"
}

@test "ledger: both review commands inject the rule vocabulary from the plugin's file" {
  grep -q '^7\. A `<rule-vocabulary>` block' "$REVIEW_PR"
  grep -q 'lib/review-ledger-vocab.json' "$REVIEW_PR"
  grep -q "item 7's \`<rule-vocabulary>\` block" "$REVIEW_ALL"
  jq -e '.categories | keys == ["contract","correctness","docs","maintainability","performance","reliability","security","testing"]' "$VOCAB" >/dev/null
}

@test "ledger: review-all's imperative Read explicitly loads item 7 before dispatch" {
  run bash -c "grep -A2 'block): Read' '$REVIEW_ALL'"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "Step 5 item 7's"
  echo "$output" | grep -q "alias-expanded \`<rule-vocabulary>\` jq procedure"
}

@test "ledger: the injected rule vocabulary also exposes category_aliases" {
  grep -q 'category_aliases' "$REVIEW_PR"
  grep -q 'alias of' "$REVIEW_PR"
  jq -e '.category_aliases | has("plugin-contract") and has("adversarial") and has("project-compliance")' "$VOCAB" >/dev/null
}

# --- review-findings ledger: write points (Stage 3) -------------------------

LEDGER_REF="$BATS_TEST_DIRNAME/../references/review-pr/ledger.md"

@test "ledger: ledger.md defines every write point both commands reference" {
  for h in '## Conventions' '## Step 3e' '## After Step 6' '## Step 7' '## After Step 8' '## Step 9' '## Step 10'; do
    grep -q "^$h" "$LEDGER_REF" || { echo "missing section: $h"; false; }
  done
  grep -q 'dismissed-context <PR> --head <REVIEWED_HEAD> --fenced' "$LEDGER_REF"
  grep -q 'observe <PR> --head <REVIEWED_HEAD> --base <BASE_OID> --step 6' "$LEDGER_REF"
  grep -q -- '--step 8 --anchor-source worktree' "$LEDGER_REF"
  grep -q 'remote-head <PR>' "$LEDGER_REF"
  grep -q 'settle <PR> --remote-head' "$LEDGER_REF"
}

@test "ledger: REVIEWED_HEAD is set only after remote-head verification" {
  # Guards against re-anchoring the ledger on a stale local checkout: the
  # remote-head call must precede the variable assignment and the
  # dismissed-context read, and an unverifiable head must skip both.
  verify_line=$(grep -n 'REMOTE=\$("\$RL" remote-head <PR>)' "$LEDGER_REF" | head -1 | cut -d: -f1)
  assign_line=$(grep -n 'REVIEWED_HEAD="\$LOCAL"' "$LEDGER_REF" | head -1 | cut -d: -f1)
  read_line=$(grep -n 'dismissed-context <PR> --head <REVIEWED_HEAD> --fenced' "$LEDGER_REF" | head -1 | cut -d: -f1)
  [ -n "$verify_line" ]
  [ -n "$assign_line" ]
  [ -n "$read_line" ]
  [ "$verify_line" -lt "$assign_line" ]
  [ "$assign_line" -lt "$read_line" ]
  grep -q 'never the raw `git rev-parse HEAD` from Step 3' "$LEDGER_REF"
  grep -q 'the head is \*\*unverifiable\*\*' "$LEDGER_REF"
  grep -q 'Ledger: head unverifiable' "$LEDGER_REF"
}

@test "ledger: review-pr.md points at ledger.md at Steps 3e, 6, 7, 8, 9 and 10" {
  grep -q '^### Step 3e: Review-findings ledger' "$REVIEW_PR"
  grep -q 'references/review-pr/ledger.md' "$REVIEW_PR"
  grep -q '^#### Ledger write (after partition)' "$REVIEW_PR"
  grep -q 'ledger.md "Step 7"' "$REVIEW_PR"
  grep -q 'ledger.md.s "After Step 8"' "$REVIEW_PR"
  grep -q 'ledger.md "Step 9" item 1' "$REVIEW_PR"
  grep -q '^- Ledger: <new> new' "$REVIEW_PR"
  grep -q 'headRefOid,baseRefOid' "$REVIEW_PR"
  # the write after partition sits between the quality gates and Step 7
  gates=$(grep -n '^#### Quality gates' "$REVIEW_PR" | cut -d: -f1)
  write=$(grep -n '^#### Ledger write (after partition)' "$REVIEW_PR" | cut -d: -f1)
  step7=$(grep -n '^### Step 7: Apply Fixes' "$REVIEW_PR" | cut -d: -f1)
  [ "$gates" -lt "$write" ] && [ "$write" -lt "$step7" ]
}

@test "ledger: review-all.md mirrors every write point" {
  grep -q 'references/review-pr/ledger.md' "$REVIEW_ALL"
  grep -q 'SOURCE=review-all' "$REVIEW_ALL"
  grep -q 'mirrors review-pr.md Step 3e' "$REVIEW_ALL"
  grep -q 'run ledger.md.s "After$' "$REVIEW_ALL"
  grep -q 'ledger.md "Step 7"' "$REVIEW_ALL"
  grep -q 'ledger.md "After Step 8"' "$REVIEW_ALL"
  grep -q 'ledger.md "Step 9" item 1' "$REVIEW_ALL"
  grep -q 'ledger.md "Step 10"' "$REVIEW_ALL"
  grep -q 'headRefOid,baseRefOid' "$REVIEW_ALL"
}

@test "ledger: the dismissed block is injected unchanged and skipped in legacy mode" {
  grep -q '^8\. The dismissed-findings block from Step 3e' "$REVIEW_PR"
  tr '\n' ' ' <"$LEDGER_REF" | grep -q 'Do not rebuild or reformat the block'
  grep -q 'legacy mode' "$LEDGER_REF"
}

# --- /review:triage (Stage 4) -----------------------------------------------

TRIAGE="$COMMANDS_DIR/triage.md"

@test "triage: stored text is shown only through the fenced, stripped cards" {
  grep -q '"\$RL" cards <PR>' "$TRIAGE"
  grep -q -- '--- begin ledger-finding (reference only) ---' "$TRIAGE"
  grep -q 'Never print the full fold' "$TRIAGE"
  grep -q 'Never put a$' "$TRIAGE"
  grep -q -- '--reason "$(cat <reason-file>)"' "$TRIAGE"
}

@test "triage: the edit gate compares HEAD with headRefOid and a clean tree" {
  grep -q '^## Step 4: Edit gate' "$TRIAGE"
  grep -q '`git rev-parse HEAD` equals `headRefOid`' "$TRIAGE"
  grep -q '`git status --porcelain` is empty' "$TRIAGE"
}

@test "triage: unattended mode applies nothing; restore is attended-only" {
  grep -q '^## Step 6: Unattended mode stops here' "$TRIAGE"
  grep -q 'applies nothing' "$TRIAGE"
  tr '\n' ' ' <"$TRIAGE" | tr -s ' ' | grep -q 'never in unattended mode'
  step6=$(grep -n '^## Step 6' "$TRIAGE" | cut -d: -f1)
  restore=$(grep -n '"\$RL" restore' "$TRIAGE" | cut -d: -f1)
  [ "$step6" -lt "$restore" ]
}

@test "triage: per-card actions are gated by the legal rl_edge_ok transitions" {
  norm=$(tr '\n' ' ' <"$TRIAGE" | tr -s ' ')
  grep -qF 'per `rl_edge_ok` in `lib/review-ledger.sh`: Apply and Restore file need a legal `→ applied` edge (not from `stale`); Dismiss needs a legal `→ dismissed` edge (not from `applied`)' <<<"$norm"
  grep -qF 'Neither Apply nor Restore file is offered on an `applied` card either' <<<"$norm"
  grep -qF -- '- **Apply** — offered for `open`, `reopened` and `report_only` cards, never `stale` or `applied`.' <<<"$norm"
  grep -qF -- '- **Dismiss** — offered for every card except `applied` (no legal `→ dismissed` edge from `applied`).' <<<"$norm"
  grep -qF -- '- **Restore file** — offered only for a card marked `deletion` whose state is `open`, `reopened` or `report_only` (never `stale`, which has no legal `→ applied` edge, or `applied`)' <<<"$norm"
  grep -qF 'Use that printed OID as `<headRefOid>` for every later step' <<<"$norm"
  grep -qF 'Remove that directory as soon as the transition returns' <<<"$norm"
}

@test "triage: reconcile runs before any attended action and prune goes through the library" {
  rec=$(grep -n '"\$RL" reconcile <PR>' "$TRIAGE" | cut -d: -f1)
  cards=$(grep -n '"\$RL" cards <PR>' "$TRIAGE" | cut -d: -f1)
  [ "$rec" -lt "$cards" ]
  grep -q '"\$RL" prune <PR>' "$TRIAGE"
  ! grep -q 'rm -' "$TRIAGE"
}

@test "triage: Step 8 explicitly Reads the shared ledger reference before using it" {
  grep -q 'Read `\${CLAUDE_PLUGIN_ROOT}/references/review-pr/ledger.md` and run its' "$TRIAGE"
  grep -q 'If the Read fails, stop and report the path' "$TRIAGE"
}

# --- PR head checkout: validated and quoted, never raw shell-interpolated --
# headRefName is attacker-controlled on a fork PR. Pin that review-pr.md
# (the source triage.md's Apply gate delegates to) validates it and never
# hands the raw, unquoted value to `gt checkout` or `git checkout`.

@test "review-pr: headRefName is validated and quoted before checkout, never used bare" {
  grep -q 'git check-ref-format --branch "<headRefName>"' "$REVIEW_PR"
  grep -q 'gt checkout "<headRefName>"' "$REVIEW_PR"
  ! grep -q '^gt checkout <headRefName>$' "$REVIEW_PR"
}

@test "review-all: mirrors review-pr's validated, quoted checkout for parity" {
  grep -q 'validate it first with the same check as' "$REVIEW_ALL"
  grep -q 'gt checkout "<branch>"' "$REVIEW_ALL"
  grep -q 'git checkout "<branch>"' "$REVIEW_ALL"
  ! grep -q '^   \*\*Graphite:\*\* `gt checkout <branch>`$' "$REVIEW_ALL"
}

# --- sweep integration (Stage 5) --------------------------------------------

SWEEP="$COMMANDS_DIR/sweep.md"
SWEEP_ALL="$COMMANDS_DIR/sweep-all.md"

@test "sweep: unattended triage runs after resolve and before the summary, skipped when not open" {
  resolve=$(grep -n '^### Step 3: Run /review:resolve' "$SWEEP" | cut -d: -f1)
  triage=$(grep -n '^### Step 3b: Reconcile the review-findings ledger' "$SWEEP" | cut -d: -f1)
  summary=$(grep -n '^### Step 4: Final summary' "$SWEEP" | cut -d: -f1)
  [ "$resolve" -lt "$triage" ] && [ "$triage" -lt "$summary" ]
  grep -q '`<PR#> --non-interactive`' "$SWEEP"
  grep -q 'skill: "review:triage"' "$SWEEP"
  grep -q 'longer `OPEN`, skip this step' "$SWEEP"
  grep -q '^  Ledger:  <pending> pending, <attention> need attention' "$SWEEP"
}

@test "sweep-all: pruning skips on a failed or possibly truncated open-PR query" {
  grep -q '^### Step 3b: Prune ledgers of closed PRs' "$SWEEP_ALL"
  grep -q "gh pr list --state open --limit 1000 --json number) || { printf 'skip" "$SWEEP_ALL"
  grep -q "jq 'length')\" -lt 1000 \] || { printf 'skip" "$SWEEP_ALL"
  grep -q '`--prune <PR#>`' "$SWEEP_ALL"
  # the prune query covers every author, not the --author @me sweep list
  ! grep -q 'gh pr list --state open --limit 1000 --json number.*--author' "$SWEEP_ALL"
}

@test "sweep-all: the summary table carries a Residual column from the ledger" {
  grep -q 'review-ledger.sh" summary --all' "$SWEEP_ALL"
  grep -q '^| PR# | Title .*| Outcome   | Residual |' "$SWEEP_ALL"
  grep -q '`—` when the PR has no ledger, and `?` when the call failed' "$SWEEP_ALL"
}
