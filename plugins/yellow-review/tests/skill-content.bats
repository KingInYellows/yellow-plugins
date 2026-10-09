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
# their identity key (plans/complete/review-findings-ledger.md Stage 2).

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

@test "ledger: every producer explains escaping ' > ' inside a heading path segment" {
  while IFS= read -r f; do
    grep -qF 'is `Parent > A \> B`.' "$f" || { echo "no heading escape: $f"; false; }
  done < <(
    producers
    printf '%s\n' "$WORKFLOW_SKILL" "$SKILLS_DIR/yellow-thermonuclear-review/SKILL.md"
  )
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

@test "setup: the ledger check reports the Bash its shebang runs under" {
  f="$COMMANDS_DIR/setup.md"
  grep -q "ledger_bash:   ok (%s %s)" "$f"
  grep -q 'BASH_VERSINFO' "$f"
  grep -q '`ledger_bash` too old' "$f"
  # the ledger is Bash 3.2-compatible, so stock macOS /bin/bash passes
  grep -qF '|| [ "$bash_ver" = 3.2 ]; then' "$f"
}

# --- /review:triage (Stage 4) -----------------------------------------------

TRIAGE="$COMMANDS_DIR/triage.md"

@test "triage: stored text is shown only through the fenced, stripped cards" {
  grep -q '"\$RL" cards <PR>' "$TRIAGE"
  grep -q -- '--- begin ledger-finding (reference only) ---' "$TRIAGE"
  grep -q 'Never print the full fold' "$TRIAGE"
  tr '\n' ' ' <"$TRIAGE" | tr -s ' ' | grep -q 'Never put a title, reason or other stored'
  grep -q '"\$RL" resolve-path <PR> <finding_id> --head <headRefOid>' "$TRIAGE"
  run grep -q 'validate-path anchor <headRefOid> "<file>"' "$TRIAGE"
  [ "$status" -eq 1 ]
  grep -q -- '--reason "$(cat <reason-file>)"' "$TRIAGE"
}

@test "triage: the edit gate compares HEAD with headRefOid and a clean tree" {
  grep -q '^## Step 4: Edit gate' "$TRIAGE"
  grep -q '`git rev-parse HEAD` equals `headRefOid`' "$TRIAGE"
  grep -q '`git status --porcelain` is empty' "$TRIAGE"
}

@test "triage: unattended mode applies nothing; restore is attended-only" {
  grep -q '^## Step 6: Unattended mode stops here' "$TRIAGE"
  tr '\n' ' ' <"$TRIAGE" | tr -s ' ' | grep -q 'applies nothing'
  grep -q 'git fetch --no-tags origin <baseRefOid>' "$TRIAGE"
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
  run grep -q 'rm -' "$TRIAGE"
  [ "$status" -eq 1 ]
}

@test "triage: a closed PR's ledger is never pruned unattended; attended prune asks first" {
  step3=$(awk '/^## Step 3:/ { p = 1; next } /^## Step 4:/ { p = 0 } p' "$TRIAGE" | tr -s ' \n' ' ')
  grep -qF 'With `--non-interactive`: print `Ledger: retained (PR <state>)`, or `Ledger: retained (PR <state>; state not recorded, exit <N>)` after a failed refresh, and stop. Unattended triage never reaches Step 2.' <<<"$step3"
  grep -qF 'ask one AskUserQuestion, "Delete the ledger for closed PR #<n>?", with the options "Delete" and "Keep"; after a failed refresh, append "(state not recorded, exit <N>)" to the question. Run Step 2 only on "Delete"; either way, stop.' <<<"$step3"
  # Step 2 (prune) is named only by those two bullets
  [ "$(grep -o 'Step 2' <<<"$step3" | wc -l)" -eq 2 ]
  run grep -q 'run Step 2 and stop' "$TRIAGE"
  [ "$status" -eq 1 ]
}

@test "triage: a closed PR's state is recorded before the prune question" {
  step3=$(awk '/^## Step 3:/ { p = 1; next } /^## Step 4:/ { p = 0 } p' "$TRIAGE")
  rs=$(grep -n '"\$RL" refresh-state <PR>' <<<"$step3" | cut -d: -f1)
  ni=$(grep -n 'With `--non-interactive`: print `Ledger: retained' <<<"$step3" | cut -d: -f1)
  ask=$(grep -n 'Delete the ledger for closed PR' <<<"$step3" | cut -d: -f1)
  [ -n "$rs" ] && [ -n "$ni" ] && [ -n "$ask" ] && [ "$rs" -lt "$ni" ] && [ "$rs" -lt "$ask" ]
  grep -qF 'state not recorded, exit <N>' <<<"$step3"
  grep -qF 'When it prints `OPEN`, the PR reopened after the query above' <<<"$(tr -s ' \n' ' ' <<<"$step3")"
}

@test "sweep and sweep-all record a closed PR's state they skip or keep" {
  step3b=$(awk '/^### Step 3b:/ { p = 1; next } /^### Step 4:/ { p = 0 } p' "$COMMANDS_DIR/sweep.md")
  rs=$(grep -n 'review-ledger.sh" refresh-state <PR#>' <<<"$step3b" | cut -d: -f1)
  sk=$(grep -n 'report `Ledger: skipped (PR <state>)`' <<<"$step3b" | cut -d: -f1)
  [ -n "$rs" ] && [ -n "$sk" ]
  step2b=$(awk '/^### Step 2b:/ { p = 1; next } /^### Step 3:/ { p = 0 } p' "$COMMANDS_DIR/sweep-all.md")
  grep -qF 'review-ledger.sh" refresh-state <PR#>' <<<"$step2b"
  grep -qF 'Ledger state not recorded for PR #<PR#>' <<<"$step2b"
}

@test "triage: Step 8 explicitly Reads the shared ledger reference before using it" {
  grep -q 'Read `\${CLAUDE_PLUGIN_ROOT}/references/review-pr/ledger.md` and run its' "$TRIAGE"
  grep -q 'If the Read fails, stop and report the path' "$TRIAGE"
}

# --- PR head checkout: captured into a variable, never templated ----------
# headRefName is attacker-controlled on a fork PR, and check-ref-format
# accepts `$(...)`, so any command text the value is written into is a
# shell sink. Pin that review-pr.md (the source triage.md's Apply gate
# delegates to) and review-all.md capture it with gh into $head_ref,
# validate that variable before any other command, and never template it.

# The fenced bash block that captures head_ref in <file>.
head_ref_block() {
  awk '/^ *```bash$/ { inb = 1; buf = ""; next }
       inb && /^ *```$/ { if (buf ~ /head_ref=\$\(gh pr view/) { print buf; exit } inb = 0; next }
       inb { buf = buf $0 "\n" }' "$1"
}

assert_head_ref_checkout() {
  local f="$1" block
  block=$(head_ref_block "$f")
  [ -n "$block" ] || { echo "no head_ref block: $f"; false; }
  # capture first, then the allowlist, then check-ref-format, then checkout
  printf '%s' "$block" | head -1 | grep -qF 'head_ref=$(gh pr view <PR#> --json headRefName -q .headRefName)'
  printf '%s' "$block" | grep -qF "'' | -* | *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/-]*)"
  printf '%s' "$block" | grep -qF 'git check-ref-format --branch "$head_ref"'
  printf '%s' "$block" | grep -qF 'gt checkout "$head_ref"'
  [ "$(printf '%s' "$block" | grep -n 'case "$head_ref"' | cut -d: -f1)" -lt \
    "$(printf '%s' "$block" | grep -n 'check-ref-format' | cut -d: -f1)" ]
  # the value is never templated into command text anywhere in the file
  run grep -qE '"<headRefName>"|"<branch>"' "$f"
  [ "$status" -eq 1 ]
  run grep -qE '(gt|git) checkout <(headRefName|branch)>' "$f"
  [ "$status" -eq 1 ]
}

@test "review-pr: headRefName is captured into a variable and validated before any command" {
  assert_head_ref_checkout "$REVIEW_PR"
  grep -q 'never write the `headRefName` value from' "$REVIEW_PR"
}

@test "review-all: mirrors review-pr's captured, validated checkout for parity" {
  assert_head_ref_checkout "$REVIEW_ALL"
  grep -q 'exactly as `review-pr.md`' "$REVIEW_ALL"
  grep -qF '# Graphite; GitHub: git checkout "$head_ref"' "$REVIEW_ALL"
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
  grep -q 'longer `OPEN`, record that state' "$SWEEP"
  grep -q 'then skip the rest of this step and report `Ledger: skipped (PR <state>)`' "$SWEEP"
  grep -q '^  Ledger:  <pending> pending, <attention> need attention' "$SWEEP"
}

@test "sweep: the ignored local config is snapshotted before /review:pr, checked before /review:resolve and after it, and cleared" {
  snap=$(grep -n 'guard-local-config" snapshot' "$SWEEP" | head -1 | cut -d: -f1)
  pr=$(grep -n '^### Step 2: Run /review:pr' "$SWEEP" | cut -d: -f1)
  chk1=$(grep -n 'guard-local-config" check' "$SWEEP" | head -1 | cut -d: -f1)
  chk2=$(grep -n 'guard-local-config" check' "$SWEEP" | tail -1 | cut -d: -f1)
  res=$(grep -n '^### Step 3: Run /review:resolve' "$SWEEP" | cut -d: -f1)
  clr=$(grep -n 'guard-local-config" clear' "$SWEEP" | head -1 | cut -d: -f1)
  triage=$(grep -n '^### Step 3b: Reconcile the review-findings ledger' "$SWEEP" | cut -d: -f1)
  [ -n "$snap" ] && [ -n "$pr" ] && [ -n "$chk1" ] && [ -n "$res" ] && [ -n "$clr" ] && [ -n "$triage" ]
  [ "$snap" -lt "$pr" ] && [ "$pr" -lt "$chk1" ] && [ "$chk1" -lt "$res" ]
  [ "$res" -lt "$chk2" ] && [ "$chk2" -lt "$clr" ] && [ "$clr" -lt "$triage" ]
  [ "$chk1" -ne "$chk2" ]
  [ "$(grep -c 'guard-local-config" clear' "$SWEEP")" -eq 1 ]
  text=$(flat "$SWEEP")
  [[ "$text" == *'guard-local-config" check "<guard-dir>" "<guard-digest>"'* ]]
  [[ "$text" == *'set `<guard-dir>` to `none`'* ]]
  [[ "$text" == *'yellow-plugins.local.md changed during the review'* ]]
  [[ "$text" == *'Print no `Sweep:` or `Resolve:` line'* ]]
  # The clear is conditional on exit 0 or 3; exit 4 keeps and names the snapshot.
  [[ "$text" == *'Only when the check exited `0` or `3`'* ]]
  [[ "$text" == *'On exit `4` or any other exit, do not clear'* ]]
  [ "$(grep -c 'snapshot kept at <guard-dir>' "$SWEEP")" -ge 2 ]
  # No stop path runs `clear` without a preceding `check`: Step 1b's rule, Step 2a
  # (alignment failures and the branch-mismatch stop) and the Step 3 contract-file
  # Read all name the guard exit check; the lone `clear` call follows Step 3a's check.
  step1b=$(awk '/^### Step 1b:/ { p = 1; next } /^### Step 2:/ { p = 0 } p' "$SWEEP" | tr '\n' ' ' | tr -s ' ')
  step2a=$(awk '/^### Step 2a:/ { p = 1; next } /^### Step 2b:/ { p = 0 } p' "$SWEEP" | tr '\n' ' ' | tr -s ' ')
  step3=$(awk '/^### Step 3: Run \/review:resolve/ { p = 1; next } /^### Step 3a:/ { p = 0 } p' "$SWEEP" | tr '\n' ' ' | tr -s ' ')
  [[ "$step1b" == *'first runs the guard exit check in Step 3a'* ]]
  # The PR head is classified before the snapshot, which stays before /review:pr.
  fetchline=$(grep -n 'fetch -q --no-tags -- "$REMOTE" "refs/pull/<PR#>/head"' "$SWEEP" | head -1 | cut -d: -f1)
  [ -n "$fetchline" ]
  [ "$fetchline" -lt "$snap" ]
  [[ "$step1b" == *'--work-tree="$WT" check-ignore -q --no-index'* ]]
  [[ "$step1b" == *'head=ignored'* ]]
  [[ "$step1b" == *"printf 'head=tracked\\n'"* ]]
  [[ "$step1b" == *"printf 'head=unignored\\n'"* ]]
  [[ "$step1b" == *'could not read the PR head ignore rules'* ]]
  # A config tracked here and ignored on the PR head is never snapshotted: the abort is pinned.
  [[ "$step1b" == *'do not snapshot: the snapshot would keep the tracked repository bytes'* ]]
  [[ "$step1b" == *'is tracked on this branch but ignored on the PR head; rerun /review:sweep from the PR'* ]]
  [[ "$step1b" == *'stop before Step 2, with no `Sweep:` or `Resolve:` line'* ]]
  # The snapshot condition itself: ignored here, or unignored here and ignored on the head.
  [[ "$step1b" == *'snapshot when the work-tree probe printed `ignored`, or when it printed `unignored` and this probe printed `head=ignored`'* ]]
  [[ "$step1b" == *'not an ignored untracked file; not guarded'* ]]
  [[ "$step2a" == *'Exit 2 means `gh pr view` or `git rev-parse` failed or printed nothing, so no mismatch was established'* ]]
  [[ "$step2a" == *'print no `Sweep:` or `Resolve:` line, so `/review:sweep-all` records `no contract`'* ]]
  # Only a read-and-differ comparison reaches the skip line; a failed read exits 2 first.
  [[ "$step2a" == *'|| EXPECTED=""'* && "$step2a" == *'|| ACTUAL=""'* ]]
  [[ "$step2a" == *'exit 2'*'exit 1'* ]]
  [[ "$step2a" == *'run the guard exit check'*'clear only on exit `0` or `3`'* ]]
  [[ "$step3" == *'If the Read fails, stop and report the path. Before stopping, run the guard exit check'* ]]
  run grep -nE 'runs the `clear` call|Run Step 2b.s check and, when' "$SWEEP"
  [ "$status" -eq 1 ]
  # Step 2b re-classifies on the checked-out PR head when Step 1b set none, and stops on ignored.
  step2b=$(awk '/^### Step 2b:/ { p = 1 } /^### Step 3: Run \/review:resolve/ { p = 0 } p' "$SWEEP" | tr '\n' ' ' | tr -s ' ')
  [[ "$step2b" == *'whatever `<guard-dir>` is'* ]]
  # A PR head that tracks the path must not get the starting branch's snapshot restored over it.
  [[ "$step2b" == *'Anything but `ignored`, and `<guard-dir>` is not `none`'* ]]
  [[ "$step2b" == *'Run no `guard-local-config` call'* ]]
  [[ "$step2b" == *'set `<guard-dir>` to `none`, and continue unguarded'* ]]
  [[ "$step2b" == *"Run Step 1b's first probe (the work-tree classification, not the PR head probe) again"* ]]
  [[ "$step2b" == *'git -C "$TOP" check-ignore -q -- yellow-plugins.local.md'* ]]
  [[ "$step2b" == *'**`ignored` and `<guard-dir>` is `none`:** the config was not snapshotted before the review'* ]]
  [[ "$step2b" == *'is ignored on the PR branch but was not snapshotted before the review; rerun /review:sweep from the PR'* ]]
  [[ "$step2b" == *'stop without invoking `/review:resolve`'* ]]
}

@test "sweep-all: the empty-list exit always prints and stops; only the prune prompt is conditional" {
  block=$(awk '/^\*\*Empty-list early exit\.\*\*/ { p = 1 } /^### Step 3: Upfront confirmation gate/ { p = 0 } p' "$SWEEP_ALL" | tr -s ' \n' ' ')
  grep -qF 'If the resulting array is empty (`[]` or length 0), run both steps below in order, then stop:' <<<"$block"
  grep -qF 'Prune prompt — only when the prune list is non-empty.** With an empty prune list or `skip`, go straight to step 2.' <<<"$block"
  grep -qF 'Always, whatever step 1 did:** print' <<<"$block"
  grep -qF '[review:sweep-all] No open non-draft PRs found. Nothing to sweep.' <<<"$block"
  # the exit is not conjoined with the prune condition
  run grep -q 'empty (`\[\]` or length 0) and the prune list' <<<"$block"
  [ "$status" -eq 1 ]
}

@test "sweep: unattended triage never prunes a PR that closed after the state check" {
  norm=$(tr -s ' \n' ' ' <"$SWEEP")
  grep -qF 'never edits, commits, prompts or prunes' <<<"$norm"
  grep -qF 'reports `Ledger: retained (PR <state>)`' <<<"$norm"
}

@test "sweep-all: pruning skips on a failed or possibly truncated open-PR query" {
  grep -q '^### Step 2b: Find ledgers of closed PRs' "$SWEEP_ALL"
  # deletion only after a confirmation: Step 3b follows the Step 3 gate
  gate=$(grep -n '^### Step 3: Upfront confirmation gate' "$SWEEP_ALL" | cut -d: -f1)
  prune=$(grep -n '^### Step 3b: Prune ledgers of closed PRs' "$SWEEP_ALL" | cut -d: -f1)
  [ "$gate" -lt "$prune" ]
  grep -q 'Delete the review-findings ledgers of <K> closed or merged PRs' "$SWEEP_ALL"
  grep -q "gh pr list --state open --limit 1000 --json number) || { printf 'skip" "$SWEEP_ALL"
  grep -q "jq 'length')\" -lt 1000 \] || { printf 'skip" "$SWEEP_ALL"
  grep -q '`--prune <PR#>`' "$SWEEP_ALL"
  # the prune query covers every author, not the --author @me sweep list
  run grep -q 'gh pr list --state open --limit 1000 --json number.*--author' "$SWEEP_ALL"
  [ "$status" -eq 1 ]
}

@test "sweep-all: the summary table carries a Residual column from the ledger" {
  grep -q 'review-ledger.sh" summary --all' "$SWEEP_ALL"
  grep -q '^| PR# | Title .*| Outcome   | Residual |' "$SWEEP_ALL"
  grep -q 'emits `"<PR#>": null` for that' "$SWEEP_ALL"
  grep -q '`?` when its entry is `null` (fold' "$SWEEP_ALL"
  grep -q 'Exclude any `?` row from the pending' "$SWEEP_ALL"
}

@test "sweep-all: the summary table carries a Blocking column from the Resolve line" {
  grep -q '^| PR# | Title .*| Residual | Blocking |' "$SWEEP_ALL"
  grep -q "sweep's \`Resolve:\` line" "$SWEEP_ALL"
}

@test "sweep-all: the prune loop uses find (zsh-safe) and a bounded PR-number check" {
  grep -q "find \"\$DIR\" -maxdepth 1 -type f -name '\*.jsonl'" "$SWEEP_ALL"
  grep -q "grep -Exq '\[1-9\]\[0-9\]{0,9}'" "$SWEEP_ALL"
}

@test "triage: descriptions stay on one line and diffs never take a path" {
  [ "$(sed -n '2,5p' "$TRIAGE" | grep -c '^description: ')" -eq 1 ]
  tr '\n' ' ' <"$TRIAGE" | tr -s ' ' | grep -q 'show it with `git diff` and no path argument'
}

@test "review-pr: a codex QUOTA_EXHAUSTED is a skipped reviewer and only an exact council fenced path is unlinked" {
  # The stub's findings pair is empty, so reading it as "no findings" would say
  # Codex reviewed and found nothing.
  grep -q 'TIMEOUT`, `ERROR` or `QUOTA_EXHAUSTED`' "$REVIEW_PR"
  grep -q 'only when the value is exactly' "$REVIEW_PR"
  grep -q '/tmp/council-codex-fenced-<suffix>.txt' "$REVIEW_PR"
  grep -q 'never unlinked' "$REVIEW_PR"
}

# --- resolve write phase (contract tokens) ----------------------------------

RESOLVE_PR="$COMMANDS_DIR/resolve-pr.md"
RESOLVE_REFS="$BATS_TEST_DIRNAME/../references/resolve"
RESOLVER_AGENT="$BATS_TEST_DIRNAME/../agents/workflow/pr-comment-resolver.md"

@test "resolve-pr: HEAD check precedes the fetch and the write phase" {
  head_check=$(grep -n '^### Step 2c: Verify HEAD Matches the PR Head' "$RESOLVE_PR" | cut -d: -f1)
  fetch=$(grep -n '^### Step 3: Fetch Unresolved Comments' "$RESOLVE_PR" | cut -d: -f1)
  [ "$head_check" -lt "$fetch" ]
  grep -q 'headRefOid' "$RESOLVE_PR"
}

@test "resolve-pr: steps run in order dispositions, verify/commit/push, write, re-pass, report" {
  s5=$(grep -n '^### Step 5: Dispositions' "$RESOLVE_PR" | cut -d: -f1)
  s6=$(grep -n '^### Step 6: Verify, Commit and Push' "$RESOLVE_PR" | cut -d: -f1)
  s7=$(grep -n '^### Step 7: Write Phase' "$RESOLVE_PR" | cut -d: -f1)
  s8=$(grep -n '^### Step 8: Bounded Re-pass' "$RESOLVE_PR" | cut -d: -f1)
  s9=$(grep -n '^### Step 9: Report' "$RESOLVE_PR" | cut -d: -f1)
  [ "$s5" -lt "$s6" ] && [ "$s6" -lt "$s7" ] && [ "$s7" -lt "$s8" ] && [ "$s8" -lt "$s9" ]
}

@test "resolve-pr: write phase invokes every script with its load-bearing flags" {
  grep -qF 'scripts/run-verify-command" --pr "<PR#>" --timeout' "$RESOLVE_PR"
  grep -q -- '--revert-dirty' "$RESOLVE_PR"
  grep -q -- '--revert-only --files-from' "$RESOLVE_PR"
  grep -qF 'scripts/commit-resolve-fixes" --provider "<graphite|github>"' "$RESOLVE_PR"
  grep -q -- '--allow-credential-shaped' "$RESOLVE_PR"
  grep -qF -- '--ranges-from "<ranges-file>"' "$RESOLVE_PR"
  grep -q 'scripts/file-followup-issue"' "$RESOLVE_PR"
  grep -q 'scripts/reply-pr-thread"' "$RESOLVE_PR"
  grep -q 'scripts/resolve-pr-thread"' "$RESOLVE_PR"
  grep -q 'scripts/poll-new-threads"' "$RESOLVE_PR"
}

@test "resolve-pr: only a PUSHED result keeps fixed threads fixed; refusals revert" {
  grep -q '`PUSHED` → `push=ok`' "$RESOLVE_PR"
  grep -q 'Only `PUSHED`' "$RESOLVE_PR"
  grep -q 'a refused edit must not stay' "$RESOLVE_PR"
  grep -q 'never substitute `git rev-parse`' "$RESOLVE_PR"
}

@test "resolve-pr: Resolve line and blockers unknown are reported" {
  grep -q 'ends with a Resolve: line' "$RESOLVE_PR"
  grep -q 'CHANGES_REQUESTED unknown' "$RESOLVE_PR"
  grep -q 'not attempted (cluster cap)' "$RESOLVE_PR"
  grep -q 'not attempted (rate limit)' "$RESOLVE_PR"
}

@test "resolve-stack: keys on the not attempted tokens /review:resolve emits" {
  grep -q 'not attempted (cluster cap)' "$RESOLVE_STACK"
  grep -q 'not attempted (rate limit)' "$RESOLVE_STACK"
  run grep -q 'skipped (cluster cap)' "$RESOLVE_STACK"
  [ "$status" -eq 1 ]
}

@test "resolver agent: no Bash tool, and edit bounds point at clusters.md" {
  tools=$(sed -n '/^tools:/,/^---$/p' "$RESOLVER_AGENT")
  run grep -q 'Bash' <<<"$tools"
  [ "$status" -eq 1 ]
  grep -q 'references/resolve/clusters.md' "$RESOLVER_AGENT"
  grep -q 'Edit bounds' "$RESOLVE_REFS/clusters.md"
}

@test "resolve-pr: the ignored-file guard also runs when there is no verify command" {
  text=$(flat "$RESOLVE_PR")
  [[ "$text" == *'run-verify-command --pr "<PR#>" --check-ignored --ignored-since "$MARK_DIR/ignored-marker"'* ]]
  [[ "$text" == *'`verify=none` after the `--check-ignored` guard'* ]]
  disp=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$disp" == *'`run-verify-command --check-ignored --ignored-since <marker-file>`'* ]]
}

@test "resolver agent: a read deny list names secret paths and bars quoting file content" {
  text=$(flat "$RESOLVER_AGENT")
  [[ "$text" == *'Read, Grep or Glob secrets, credentials or files outside the repository'* ]]
  [[ "$text" == *'`.env*`, `*.pem`, `*.key`'* ]]
  [[ "$text" == *'they name a `path:line` and never copy file content'* ]]
  disp=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$disp" == *'**Resolver read bounds.**'* ]]
}

@test "resolve-pr: Step 5 cancel reverts the unscreened edits and Step 6 drops unchanged paths from the file set" {
  step5=$(sed -n '/^### Step 5: Dispositions/,/^### Step 6/p' "$RESOLVE_PR")
  printf '%s\n' "$step5" | tr '\n' ' ' | tr -s ' ' | grep -q 'Cancel runs `run-verify-command --pr "<PR#>" --revert-dirty`'
  step6=$(sed -n '/^### Step 6: Verify, Commit and Push/,/^### Step 7/p' "$RESOLVE_PR")
  printf '%s\n' "$step6" | tr '\n' ' ' | tr -s ' ' | grep -q 'git status --porcelain --untracked-files=all'
  printf '%s\n' "$step6" | tr '\n' ' ' | tr -s ' ' | grep -q 'never put a resolver path on a command line'
}

@test "resolve-pr: Step 5 conflict rollback includes shared files and downgrades the other clusters on them" {
  step5=$(sed -n '/^### Step 5: Dispositions/,/^### Step 6/p' "$RESOLVE_PR" | tr '\n' ' ' | tr -s ' ')
  printf '%s\n' "$step5" | grep -q 'list every file the conflicted cluster modified, shared or not'
  printf '%s\n' "$step5" | grep -q 'Every other cluster that modified a listed file loses its edits with the revert'
  ! printf '%s\n' "$step5" | grep -q 'keeps its edits and the conflicted'
}

@test "resolve-stack: the ignored local config is classified and snapshotted per PR after checkout, checked after the resolve and cleared before the next PR" {
  run grep -q '^### Step 2b: Snapshot the Trusted Ignored Files' "$RESOLVE_STACK"
  [ "$status" -eq 1 ]
  walk=$(grep -n '^### Step 3: Walk the stack' "$RESOLVE_STACK" | cut -d: -f1)
  # Graphite branch: checkout, then item 1b classify + snapshot, then the resolve.
  gr=$(sed -n '/^#### Graphite/,/^#### GitHub/p' "$RESOLVE_STACK")
  co=$(printf '%s\n' "$gr" | grep -n '^1\. \*\*Checkout\*\*' | cut -d: -f1)
  g1b=$(printf '%s\n' "$gr" | grep -n '^1b\. \*\*Guard the local config\*\*' | cut -d: -f1)
  cls=$(printf '%s\n' "$gr" | grep -n 'git -C "\$TOP" ls-files --error-unmatch' | head -1 | cut -d: -f1)
  snap=$(printf '%s\n' "$gr" | grep -n 'guard-local-config" snapshot' | head -1 | cut -d: -f1)
  res=$(printf '%s\n' "$gr" | grep -n '^2\. \*\*Resolve\*\*' | cut -d: -f1)
  [ -n "$walk" ] && [ -n "$co" ] && [ -n "$g1b" ] && [ -n "$cls" ] && [ -n "$snap" ] && [ -n "$res" ]
  [ "$co" -lt "$g1b" ] && [ "$g1b" -lt "$cls" ] && [ "$cls" -lt "$snap" ] && [ "$snap" -lt "$res" ]
  # The GitHub branch runs the same item 1b between its checkout and resolve.
  gh=$(sed -n '/^#### GitHub/,/^### Step 4/p' "$RESOLVE_STACK")
  gco=$(printf '%s\n' "$gh" | grep -n '^1\. \*\*Checkout\*\*' | cut -d: -f1)
  gg=$(printf '%s\n' "$gh" | grep -n '^1b\. \*\*Guard the local config\*\* — identical to Graphite step 1b' | cut -d: -f1)
  gres=$(printf '%s\n' "$gh" | grep -n '^2\. \*\*Resolve\*\*' | cut -d: -f1)
  [ "$gco" -lt "$gg" ] && [ "$gg" -lt "$gres" ]
  text=$(flat "$RESOLVE_STACK")
  [[ "$text" == *'Classify it after every checkout; never carry an earlier branch'* ]]
  [[ "$text" == *'for this PR only'* ]]
  [[ "$text" == *'guard-local-config" snapshot'* ]]
  [[ "$text" == *'guard-local-config" check "<guard-dir>" "<guard-digest>"'* ]]
  [[ "$text" == *'`digest=<hex>`'* ]]
  [[ "$text" == *'guard-local-config" clear "<guard-dir>"'* ]]
  [[ "$text" == *'aborted at PR #<PR#>: yellow-plugins.local.md changed during the resolve'* ]]
  [[ "$text" == *'`not attempted (config changed)`'* ]]
  # Only an ignored, untracked config is guarded; a tracked one is skipped.
  [[ "$text" == *'git -C "$TOP" check-ignore -q -- yellow-plugins.local.md'* ]]
  [[ "$text" == *'set `<guard-dir>` to `none`'* ]]
  [[ "$text" == *'Unless `<guard-dir>` is `none`'* ]]
  # Item 3b: the check, then the clear, both precede the status check and
  # follow the snapshot; Step 4 no longer clears.
  snp=$(grep -n 'guard-local-config" snapshot' "$RESOLVE_STACK" | head -1 | cut -d: -f1)
  chk=$(grep -n 'guard-local-config" check' "$RESOLVE_STACK" | head -1 | cut -d: -f1)
  clr=$(grep -n 'guard-local-config" clear' "$RESOLVE_STACK" | head -1 | cut -d: -f1)
  sts=$(grep -n 'OUT=$(git status --porcelain=v1' "$RESOLVE_STACK" | head -1 | cut -d: -f1)
  stp4=$(grep -n '^### Step 4: Final aggregate summary' "$RESOLVE_STACK" | cut -d: -f1)
  [ "$snp" -lt "$chk" ] && [ "$chk" -lt "$clr" ] && [ "$clr" -lt "$sts" ]
  [ "$(grep -c 'guard-local-config" clear' "$RESOLVE_STACK")" -eq 1 ]
  [ "$clr" -lt "$stp4" ]
  [[ "$text" == *"remove this PR's snapshot before the next PR or any stop below"* ]]
  # The clear is conditional on exit 0 or 3; exit 4 keeps and names the snapshot.
  [[ "$text" == *'Only when the check exited `0` (unchanged) or `3` (changed and restored)'* ]]
  [[ "$text" == *'On exit `4` or any other non-zero exit, do not clear'* ]]
  [[ "$text" == *'snapshot kept at <guard-dir> (recover yellow-plugins.local.md from it by hand, then run guard-local-config clear "<guard-dir>")'* ]]
}

@test "resolve-stack: a restack that changes a branch is published before the next PR" {
  text=$(flat "$RESOLVE_STACK")
  [[ "$text" == *'publish it with `gt submit --stack --no-interactive --no-edit` before the next PR'* ]]
  [[ "$text" == *'`restack not published`'* ]]
}

@test "sweep: PR-specific pre-resolve stops end with a skip line that sweep-all reads" {
  text=$(flat "$SWEEP")
  [[ "$text" == *'`Sweep: skipped (pr-not-open)`'* ]]
  [[ "$text" == *'`Sweep: skipped (branch-mismatch)`'* ]]
  [[ "$text" == *'^Sweep: skipped \((pr-not-open|branch-mismatch)\)$'* ]]
  all=$(flat "$SWEEP_ALL")
  [[ "$all" == *'^Sweep: skipped \((pr-not-open|branch-mismatch)\)$'* ]]
  [[ "$all" == *'outcome is `skipped — <reason>`'* ]]
  [[ "$all" == *'not `no contract`'* ]]
}

@test "sweep: a failed PR fetch prints no skip line; only a confirmed non-OPEN state does" {
  text=$(flat "$SWEEP")
  [[ "$text" == *'If `exit=0` and the state is not `OPEN`'* ]]
  [[ "$text" == *'`Sweep: skipped (pr-not-open)`'* ]]
  [[ "$text" == *"grep -qiE 'rate limit|abuse|HTTP 429'"* ]]
  [[ "$text" == *'If `exit` is non-zero, the fetch failed'* ]]
  [[ "$text" == *'Print no skip line'* ]]
  [[ "$text" == *'`pr-not-open` is printed only when `gh pr view` succeeded and returned a state other than `OPEN`'* ]]
}

@test "sweep-all: a rate-limited open-PR pre-check stops the batch instead of skipping every PR" {
  text=$(flat "$SWEEP_ALL")
  [[ "$text" == *'grep -qiE '"'"'rate limit|abuse|HTTP 429'"'"''* ]]
  [[ "$text" == *'When `ratelimited=1`, the next `gh` call would hit the same limit'* ]]
}

# Collapse line wraps so a phrase can be matched across them.
flat() { tr '\n' ' ' <"$1" | tr -s ' '; }

@test "resolve-pr: ratelimited=1 is tied to reason=rate-limit only; a timeout keeps it 0" {
  text=$(flat "$RESOLVE_PR")
  [[ "$text" == *'For `reason=rate-limit` mark the rest `not attempted (rate limit)` and set `ratelimited=1`'* ]]
  [[ "$text" == *'For `reason=timeout` mark the rest `not attempted (gh timeout)`, count them blocking, and keep `ratelimited=0`'* ]]
  [[ "$text" == *'Treat a missing or unrecognized reason as `rate-limit`'* ]]
  # The old unconditional rule must be gone.
  [[ "$text" != *'After any exit 4, stop mutating and mark the rest `not attempted (rate limit)`'* ]]
}

@test "dispositions: ratelimited=1 only for reason=rate-limit, a timeout leaves it 0" {
  text=$(flat "${BATS_TEST_DIRNAME}/../references/resolve/dispositions.md")
  [[ "$text" == *'exited 4 with `reason=rate-limit` (or no recognizable reason)'* ]]
  [[ "$text" == *'`reason=timeout` stops mutations too but leaves `ratelimited=0`'* ]]
  [[ "$text" == *'A missing or unrecognized reason is treated as `rate-limit`'* ]]
}

@test "dispositions: a reused Linear hit passes the same response checks as save_issue" {
  text=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$text" == *'reuse a hit only when it passes the **Linear response checks** below'* ]]
  [[ "$text" == *'A hit that fails any check is ignored, as if the search found nothing'* ]]
  [[ "$text" == *'accept its response only when it passes the same checks'* ]]
  # The checks are stated once, with all three conditions.
  [ "$(grep -c '^- \*\*Linear response checks\.\*\*' "$RESOLVE_REFS/dispositions.md")" -eq 1 ]
  [[ "$text" == *'Apply to every `list_issues` hit before reuse and to the `save_issue` response before use'* ]]
  [[ "$text" == *'the identifier matches `^<PREFIX>-[0-9]{1,6}$`'* ]]
  [[ "$text" == *'`^https://linear\.app/[A-Za-z0-9_-]+/issue/<ID>(/[A-Za-z0-9_-]*)?$`'* ]]
  [[ "$text" == *'the description carries the full marker'* ]]
  # The old unvalidated reuse must be gone.
  [[ "$text" != *'reuse a hit whose description carries the full marker'* ]]
  # resolve-pr.md references the checks instead of restating them.
  text=$(flat "$RESOLVE_PR")
  [[ "$text" == *'"Linear response checks", which every reused `list_issues` hit and the `save_issue` response must pass'* ]]
}

@test "resolve-pr: the ignored-file marker is minted before resolvers spawn and passed to every verify run" {
  mint=$(grep -n '^### Step 3f: Mint the Ignored-File Marker' "$RESOLVE_PR" | cut -d: -f1)
  clean=$(grep -n '^### Step 2: Check Working Directory' "$RESOLVE_PR" | cut -d: -f1)
  spawn=$(grep -n '^### Step 4: Spawn Parallel Resolvers' "$RESOLVE_PR" | cut -d: -f1)
  [ -n "$mint" ]
  [ "$clean" -lt "$mint" ]
  [ "$mint" -lt "$spawn" ]
  step3f=$(sed -n '/^### Step 3f/,/^### Step 4/p' "$RESOLVE_PR")
  printf '%s\n' "$step3f" | grep -qF 'mktemp -d'
  printf '%s\n' "$step3f" | grep -qF 'touch "$MARK_DIR/ignored-marker"'
  # No trap in the minting call: the trap lives in the consuming call.
  run grep -q '^trap ' <<<"$step3f"
  [ "$status" -eq 1 ]
  step6=$(sed -n '/^### Step 6: Verify, Commit and Push/,/^### Step 7/p' "$RESOLVE_PR")
  printf '%s\n' "$step6" | grep -qF -- '--ignored-since "$MARK_DIR/ignored-marker"'
  printf '%s\n' "$step6" | grep -qF "trap 'rm -rf -- \"\$MARK_DIR\"' EXIT"
  step6flat=$(printf '%s\n' "$step6" | tr '\n' ' ' | tr -s ' ')
  [[ "$step6flat" == *'`--ignored-since` with Step 3f'* ]]
  [[ "$step6flat" == *'required for every run'* ]]
  [[ "$step6flat" == *'**Marker cleanup.**'* ]]
  flat "$RESOLVE_REFS/dispositions.md" | grep -qF -- '`--ignored-since <marker-file>` is required'
}

# The dirty-tree and rate-limit stops must finish the current PR (clean-tree
# check, revert, row) before ending the walk, and name the summary heading.
DIRTY_REF="$BATS_TEST_DIRNAME/../references/review-resolve-stack/dirty-tree-cleanup.md"

@test "resolve-stack: dirty-tree stop uses the shared cleanup, names the summary heading, exits 1" {
  grep -qF 'references/review-resolve-stack/dirty-tree-cleanup.md' "$RESOLVE_STACK"
  grep -q 'aborted at PR #<PR#>: working tree dirty after resolve' "$RESOLVE_STACK"
  grep -q 'revert incomplete' "$RESOLVE_STACK"
  grep -q 'unrecognized changes left in place' "$RESOLVE_STACK"
  grep -q 'not attempted (dirty tree)' "$RESOLVE_STACK"
  grep -q 'go to `### Step 4: Final aggregate summary`' "$RESOLVE_STACK"
  grep -q 'the command exits `1`' "$RESOLVE_STACK"
  run ! grep -q 'go to Step 4' "$RESOLVE_STACK"
}

@test "dirty-tree-cleanup: lists with -z, owns via the files API, and handles both revert branches" {
  grep -qF 'git status --porcelain=v1 -z --untracked-files=all' "$DIRTY_REF"
  grep -qF 'pr-changed-ranges" "<PR#>"' "$DIRTY_REF"
  grep -qF '${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/run-verify-command" --pr "<PR#>" --revert-dirty' "$DIRTY_REF"
  # The unrecognized branch reverts trusted config through the shared predicate,
  # never a model-built path list.
  grep -qF '${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/run-verify-command" --pr "<PR#>" --revert-denied --no-ignored-guard' "$DIRTY_REF"
  run ! grep -qF -- '--revert-only -- ' "$DIRTY_REF"
  grep -qF 'rp_trusted_config' "$DIRTY_REF"
  grep -q 'deniedClean: false' "$DIRTY_REF"
  grep -q 'do NOT run `--revert-dirty`' "$DIRTY_REF"
  grep -q 'treeClean: false' "$DIRTY_REF"
  grep -q 'revert incomplete' "$DIRTY_REF"
  grep -q 'unrecognized changes left in place' "$DIRTY_REF"
  grep -q 'exits non-zero' "$DIRTY_REF"
  grep -q '#973' "$DIRTY_REF"
  # renames: the owned set includes previous_filename; an entry needs both paths owned
  grep -qF 'previous_filename' "$DIRTY_REF"
  grep -qF 'each file'"'"'s `filename` plus its' "$DIRTY_REF"
  tr '\n' ' ' <"$DIRTY_REF" | tr -s ' ' | grep -qF 'owned only when **both** of its paths are owned'
  # a failed ownership lookup leaves every path unrecognized
  grep -qE 'no path is owned through the PR file list' "$DIRTY_REF"
  # agent memory is not trusted config, and the reference says why
  grep -qF 'except `.claude/agent-memory/`' "$DIRTY_REF"
  grep -q 'memory: project' "$DIRTY_REF"
}

@test "dirty-tree-cleanup: previous filenames come from pr-changed-ranges --previous, validated by the script" {
  tr '\n' ' ' <"$DIRTY_REF" | tr -s ' ' | grep -qF 'pr-changed-ranges" --previous "<PR#>"'
  tr '\n' ' ' <"$DIRTY_REF" | tr -s ' ' | grep -qF 'fails the whole call (exit 1, no output)'
  tr '\n' ' ' <"$DIRTY_REF" | tr -s ' ' | grep -qF 'including a `gh` timeout, means the lookup failed'
  # The hand-written gh api / jq projection is gone from the reference.
  run grep -qF 'gh api --paginate' "$DIRTY_REF"
  [ "$status" -eq 1 ]
}

@test "dirty-tree cleanup: each command loads its own byte-identical copy and neither inlines it" {
  stack_copy="$BATS_TEST_DIRNAME/../references/review-resolve-stack/dirty-tree-cleanup.md"
  sweep_copy="$BATS_TEST_DIRNAME/../references/review-sweep-all/dirty-tree-cleanup.md"
  grep -qF 'references/review-resolve-stack/dirty-tree-cleanup.md' "$RESOLVE_STACK"
  grep -qF 'references/review-sweep-all/dirty-tree-cleanup.md' "$SWEEP_ALL"
  # a command never loads another command's reference directory
  run ! grep -qF 'references/review-sweep-all/' "$RESOLVE_STACK"
  run ! grep -qF 'references/review-resolve-stack/' "$SWEEP_ALL"
  # the two copies cannot drift
  cmp -s "$stack_copy" "$sweep_copy" || { echo "the two dirty-tree-cleanup.md copies differ"; false; }
  for f in "$RESOLVE_STACK" "$SWEEP_ALL"; do
    run ! grep -qE -e '--revert-(dirty|only)' "$f"
    run ! grep -qF 'gh pr diff' "$f"
  done
}

@test "resolve-stack: each provider branch checks the tree before it restacks, and the GitHub branch covers no contract" {
  graphite=$(awk '/^#### Graphite/{on=1;next} /^#### GitHub/{on=0} on' "$RESOLVE_STACK")
  github=$(awk '/^#### GitHub/{on=1;next} /^### Step 4/{on=0} on' "$RESOLVE_STACK")
  [ -n "$graphite" ] && [ -n "$github" ]
  g_clean=$(printf '%s\n' "$graphite" | grep -n '3b\. \*\*Clean-tree' | head -1 | cut -d: -f1)
  g_restack=$(printf '%s\n' "$graphite" | grep -n '^4\. \*\*Restack' | head -1 | cut -d: -f1)
  [ -n "$g_clean" ] && [ -n "$g_restack" ] && [ "$g_clean" -lt "$g_restack" ]
  h_clean=$(printf '%s\n' "$github" | grep -n 'clean-tree check' | head -1 | cut -d: -f1)
  h_rebase=$(printf '%s\n' "$github" | grep -n '^4\. \*\*Rebase upstack' | head -1 | cut -d: -f1)
  [ -n "$h_clean" ] && [ -n "$h_rebase" ] && [ "$h_clean" -lt "$h_rebase" ]
  printf '%s\n' "$github" | tr '\n' ' ' | tr -s ' ' | grep -qF 'no-contract rule'
}

@test "resolve-stack: a rate-limited PR is finished before the walk stops" {
  grep -q 'ratelimited=<0|1>' "$RESOLVE_STACK"
  grep -q 'finish \*\*this\*\* PR first' "$RESOLVE_STACK"
  grep -q 'not attempted (rate limit)' "$RESOLVE_STACK"
  grep -q -- '--include-outdated' "$RESOLVE_STACK"
}

@test "sweep-all: the rate-limit stop runs after the clean-tree check, and both stops exit 1" {
  clean=$(grep -n 'Clean-tree check' "$SWEEP_ALL" | head -1 | cut -d: -f1)
  rate=$(grep -n 'Rate-limit stop' "$SWEEP_ALL" | head -1 | cut -d: -f1)
  [ -n "$clean" ] && [ -n "$rate" ] && [ "$clean" -lt "$rate" ]
  grep -qF 'references/review-sweep-all/dirty-tree-cleanup.md' "$SWEEP_ALL"
  grep -q 'go to `### Step 5: End-of-loop' "$SWEEP_ALL"
  grep -q 'Re-pass wait: up to' "$SWEEP_ALL"
  grep -q 'Dirty tree after a sweep' "$SWEEP_ALL"
  grep -q 'Rate-limited PR' "$SWEEP_ALL"
  [ "$(grep -c 'exits `1`' "$SWEEP_ALL")" -ge 2 ]
  run ! grep -q 'go to Step 5' "$SWEEP_ALL"
}

@test "sweep-all: a dirty tree after the cleanup stops project commands and the remaining PRs" {
  grep -qF 'skipped — working tree dirty after PR' "$SWEEP_ALL"
  tr '\n' ' ' <"$SWEEP_ALL" | tr -s ' ' | grep -qF 'Run no further project commands after this stop.'
  grep -qF 'working tree dirty after sweep (patch: <patch>)' "$SWEEP_ALL"
}

@test "resolve-stack, sweep and sweep-all read the same Resolve: contract fields" {
  for f in "$RESOLVE_STACK" "$SWEEP" "$SWEEP_ALL"; do
    grep -q 'ratelimited=' "$f" || { echo "no ratelimited= in $f"; false; }
  done
  # resolve-stack names every field of the line; sweep shows them in its example
  for field in '<r> resolved' '<f> fixed' '<i> issues filed' '<b> blocking' 'push=<' 'verify=<' 'ratelimited=<0|1>'; do
    grep -qF "$field" "$RESOLVE_STACK" || { echo "missing $field in resolve-stack"; false; }
  done
  for field in 'resolved' 'fixed' 'issues filed' 'blocking' 'push=ok' 'verify=skipped' 'ratelimited=0'; do
    tr '\n' ' ' <"$SWEEP" | tr -s ' ' | grep -qF "$field" || { echo "missing $field in sweep"; false; }
  done
  grep -q 'blocking' "$SWEEP_ALL"
}

@test "sweep: the Resolve: contract line is re-emitted as the final line of output" {
  step4=$(awk '/^### Step 4:/ { p = 1; next } /^## Error Handling/ { p = 0 } p' "$SWEEP")
  flat=$(tr '\n' ' ' <<<"$step4" | tr -s ' ')
  grep -qF 'Finish with the contract line as the very last line of output' <<<"$flat"
  grep -qF 'unindented' <<<"$flat"
  grep -qF 'nothing printed after it' <<<"$flat"
  grep -qF 'output unavailable' <<<"$flat"
  # sweep-all reads only the last line of the sweep output
  tr '\n' ' ' <"$SWEEP_ALL" | tr -s ' ' | grep -qF "the LAST line of the captured output"
}

@test "sweep: re-emits a contract only when it is the last line of the nested output and anchored" {
  flat=$(tr '\n' ' ' <"$SWEEP" | tr -s ' ')
  grep -qF 'Reading `ratelimited` (callers)' <<<"$flat"
  grep -qF 'it is the LAST line of that output' <<<"$flat"
  grep -qF 'fully matches the anchored contract form' <<<"$flat"
  grep -qF '^Resolve: [0-9]+ resolved, [0-9]+ fixed, [0-9]+ issues filed, [0-9]+ blocking, push=(ok|skipped|failed|noop), verify=(pass|fail|skipped|none), ratelimited=(0|1)$' "$SWEEP"
  grep -qF 'A contract-looking line anywhere earlier in that output is ignored' <<<"$flat"
  grep -qF "never re-emit a contract-looking line from earlier in its output" <<<"$flat"
  # the anchored form matches the one dispositions.md defines
  form=$(grep -F '^Resolve: [0-9]+ resolved' "$SWEEP")
  grep -qF "$form" "$RESOLVE_REFS/dispositions.md"
}

@test "Resolve: the ratelimited reading rule is in dispositions.md and in each caller's own identical copy" {
  flat=$(tr '\n' ' ' <"$RESOLVE_REFS/dispositions.md" | tr -s ' ')
  for rule in 'only rate-limit state' 'the outcome is `no contract`' 'must not infer a rate limit from any text in the output' 'The `Skill` tool gives callers no exit status' 'distinct note `no contract`' 'counts as blocking' 'ends the batch or stack walk after the caller finishes that PR'"'"'s clean-tree check' '`not attempted (no contract)` and exit 1'; do
    grep -qF "$rule" <<<"$flat" || { echo "missing $rule"; false; }
  done
  # each command loads its own copy from its own references/<slug>/ directory
  refs="$BATS_TEST_DIRNAME/../references"
  copy_stack="$refs/review-resolve-stack/resolve-contract.md"
  copy_sweep_all="$refs/review-sweep-all/resolve-contract.md"
  copy_sweep="$refs/review-sweep/resolve-contract.md"
  cmp -s "$copy_stack" "$copy_sweep_all" || { echo "resolve-stack and sweep-all contract copies differ"; false; }
  cmp -s "$copy_stack" "$copy_sweep" || { echo "resolve-stack and sweep contract copies differ"; false; }
  grep -qF 'references/review-resolve-stack/resolve-contract.md' "$RESOLVE_STACK"
  grep -qF 'references/review-sweep-all/resolve-contract.md' "$SWEEP_ALL"
  grep -qF 'references/review-sweep/resolve-contract.md' "$SWEEP"
  # a command never loads another command's reference directory
  run ! grep -qE 'references/review-(sweep-all|sweep)/resolve-contract' "$RESOLVE_STACK"
  run ! grep -qE 'references/review-(resolve-stack|sweep)/resolve-contract' "$SWEEP_ALL"
  run ! grep -qE 'references/review-(resolve-stack|sweep-all)/resolve-contract' "$SWEEP"
  # the copies carry the producer-side "Reading ratelimited (callers)" rule verbatim
  want=$(awk '/^- \*\*Reading `ratelimited` \(callers\)\.\*\*/ { p = 1 } /^- `\/review:sweep` and `\/review:sweep-all` print/ { p = 0 } p' "$RESOLVE_REFS/dispositions.md" | tr '\n' ' ' | tr -s ' ')
  [ -n "$want" ]
  have=$(tr '\n' ' ' <"$copy_stack" | tr -s ' ')
  [[ "$have" == *"${want% }"* ]] || { echo "the contract copy differs from dispositions.md's reading rule"; false; }
  for f in "$RESOLVE_STACK" "$SWEEP_ALL"; do
    run ! grep -qiE 'HTTP 403/429' "$f"
  done
}

@test "ratelimited is never derived from output text: the marker fallback is gone everywhere" {
  for f in "$RESOLVE_REFS/dispositions.md" "$RESOLVE_STACK" "$SWEEP" "$SWEEP_ALL"; do
    flat=$(tr '\n' ' ' <"$f" | tr -s ' ')
    for gone in 'GitHub API rate limit exceeded' 'GitHub rate limit on' 'poll rate-limited' 'whole-line marker' 'whole-line fallback' 'marker fallback' 'self-verify marker' 'the fallback matches'; do
      run grep -qF "$gone" <<<"$flat"
      [ "$status" -eq 1 ] || { echo "stale '$gone' in $f"; false; }
    done
  done
}

@test "resolve-stack and sweep-all treat a missing contract as no contract, not a rate limit" {
  # the stop is distinct from the rate-limit stop and uses its own note and row text
  flat_stack=$(tr '\n' ' ' <"$RESOLVE_STACK" | tr -s ' ')
  grep -qF 'never infer a rate limit from any text in the output' <<<"$flat_stack"
  grep -qF 'record the PR as `no contract` (a distinct note, not `rate limited`)' <<<"$flat_stack"
  grep -qF 'not attempted (no contract)' <<<"$flat_stack"
  grep -qF 'The cross-check never sets `ratelimited`' <<<"$flat_stack"
  # An inconclusive cross-check may be the call that hit the limit: it ends the walk like a
  # missing contract, without inferring a rate limit from its text.
  grep -qF 'never infers a rate limit from the failure' <<<"$flat_stack"
  grep -qF 'it ends the walk like a missing contract' <<<"$flat_stack"
  [ "$(grep -o 'not attempted (self-verify inconclusive)' <<<"$flat_stack" | wc -l)" -ge 3 ]
  step4=$(awk '/^### Step 4:/ { p = 1; next } /^### Step 5:/ { p = 0 } p' "$SWEEP_ALL")
  flat4=$(tr '\n' ' ' <<<"$step4" | tr -s ' ')
  grep -qF 'Read `ratelimited` only from a valid final contract line' <<<"$flat4"
  grep -qF 'never infer a rate limit from any text in the output: record `no contract` (a distinct note, not `rate limited`)' <<<"$flat4"
  grep -qF '**No-contract stop** — only after item 4' <<<"$flat4"
  grep -qF 'skipped — not attempted (no contract)' <<<"$flat4"
  # item 5b records pending-exit-1 like the other early stops
  [ "$(grep -o 'Record `pending-exit-1`' <<<"$flat4" | wc -l)" -ge 3 ]
  # sweep's fallback line stays distinct from a rate limit
  flat_sweep=$(tr '\n' ' ' <"$SWEEP" | tr -s ' ')
  grep -qF 'says nothing about rate limits' <<<"$flat_sweep"
  grep -qF '`/review:sweep-all` treats it as `no contract`' <<<"$flat_sweep"
}

@test "sweep-all: an open-PR pre-check skips a closed PR and stops when the state is unreadable" {
  step4=$(awk '/^### Step 4:/ { p = 1; next } /^### Step 5:/ { p = 0 } p' "$SWEEP_ALL")
  flat4=$(tr '\n' ' ' <<<"$step4" | tr -s ' ')
  grep -qF '**Open-PR pre-check**' <<<"$flat4"
  grep -qF 'gh pr view <PR#> --json state -q .state' <<<"$flat4"
  grep -qF 'record `state unreadable: <cause>`' <<<"$flat4"
  grep -qF 'skipped — not attempted (state unreadable)' <<<"$flat4"
  run grep -qF 'record `skipped — state unreadable`' <<<"$flat4"
  [ "$status" -eq 1 ]
  grep -qF 'record `skipped — PR closed before sweep`' <<<"$flat4"
  grep -qF 'do NOT invoke the Skill: go to item 6' <<<"$flat4"
  # the pre-check precedes the Skill invocation
  pre=$(grep -n 'Open-PR pre-check' "$SWEEP_ALL" | head -1 | cut -d: -f1)
  inv=$(grep -n '\*\*Invoke sweep\*\*' "$SWEEP_ALL" | head -1 | cut -d: -f1)
  [ "$pre" -lt "$inv" ]
  # Item 1b alone: the unreadable-state stop is pinned to its recording, the
  # Step 5 jump and the no-continue rule, and the rate-limit stop stays apart.
  item1b=${flat4#*'**Open-PR pre-check**'}
  item1b=${item1b%%'**Invoke sweep**'*}
  [ "$(grep -o 'record `pending-exit-1`' <<<"$item1b" | wc -l)" -eq 2 ]
  [ "$(grep -o 'go to `### Step 5: End-of-loop summary table`' <<<"$item1b" | wc -l)" -eq 2 ]
  grep -qF 'When `ratelimited=1`' <<<"$item1b"
  grep -qF 'skipped — not attempted (rate limit)' <<<"$item1b"
  grep -qF 'When `exit` is non-zero and `ratelimited` is not `1`' <<<"$item1b"
  grep -qF '`Outcome` `skipped`, `Skip Reason` `state unreadable` and `Blocking` `?`' <<<"$item1b"
  grep -qF 'record `state unreadable: <cause>`' <<<"$item1b"
  grep -qF 'Do not continue to the next PR.' <<<"$item1b"
  grep -qF "printf 'cause=%s" <<<"$item1b"
  # The intro names the stop.
  grep -qF 'verify-skipped and state-unreadable stops in Step 4' <<<"$(tr '\n' ' ' <"$SWEEP_ALL" | tr -s ' ')"
}

@test "sweep-all: an early stop exits 1 after the summary, even with zero attempts" {
  step4=$(awk '/^### Step 4:/ { p = 1; next } /^### Step 5:/ { p = 0 } p' "$SWEEP_ALL")
  [ "$(grep -c 'Record `pending-exit-1`' <<<"$step4")" -eq 4 ]
  # Item 1b records it too, in lowercase, for the rate-limit and unreadable-state stops.
  [ "$(grep -ci 'record `pending-exit-1`' <<<"$step4")" -ge 6 ]
  grep -qF '**Final exit (every path, including zero attempts):** read `pending-exit-1`.' "$SWEEP_ALL"
  grep -qF 'If set, the command exits `1`; otherwise (`pending-exit-1` unset), exit `0`.' "$SWEEP_ALL"
}

@test "sweep-all: Step 4 Reads its resolve-contract.md before the loop so the ratelimited and no-contract rules are loaded" {
  step4=$(awk '/^### Step 4:/ { p = 1; next } /^### Step 5:/ { p = 0 } p' "$SWEEP_ALL")
  flat4=$(tr '\n' ' ' <<<"$step4" | tr -s ' ')
  grep -qF 'Before the first iteration, Read `${CLAUDE_PLUGIN_ROOT}/references/review-sweep-all/resolve-contract.md`' <<<"$flat4"
  grep -qF 'If the Read fails, stop and report the path.' <<<"$flat4"
  # the Read comes before the loop's per-PR items
  read_pos=${flat4%%Before the first iteration, Read*}
  loop_pos=${flat4%%For each PR in the sorted list*}
  [ "${#read_pos}" -lt "${#loop_pos}" ]
}

@test "resolver agent: no rule permits editing when PR-changed ranges are unknown" {
  text=$(flat "$RESOLVER_AGENT")
  # The old exception (edit the cluster File when PR files is unknown) must be gone.
  [[ "$text" != *"edit only the cluster's \`File\`"* ]]
  # Both surviving rules say: unknown means no edit and unclear, never oos.
  [[ "$text" == *'(when it is `unknown`, edit nothing and propose `unclear`)'* ]]
  [[ "$text" == *'When the bound is `none` or absent'* ]]
  [[ "$text" == *'do not edit: propose `oos` for the thread'* ]]
  [[ "$text" == *'propose `unclear` with evidence `PR ranges unavailable`, never `oos`'* ]]
  clusters=$(flat "$RESOLVE_REFS/clusters.md")
  [[ "$clusters" == *'When the value is `none`, or the path has no range'* ]]
  [[ "$clusters" == *'When the value is `unknown`'* ]]
  [[ "$clusters" == *'proposes `unclear` with evidence `PR ranges unavailable`'* ]]
  text=$(flat "$RESOLVE_PR")
  [[ "$text" == *'pass `unknown` for both, so the resolver edits nothing and proposes `unclear`'* ]]
  disp=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$disp" == *'`PR-changed lines` `unknown` and the proposal is `fixed`, `addressed` or `oos`'* ]]
  [[ "$disp" == *'it becomes `unclear` with evidence `PR ranges unavailable`'* ]]
  [[ "$disp" != *'`unknown` and the proposal is `oos`: it becomes'* ]]
}

@test "resolve-pr: Step 6 pre-checks the edit range before verify, per file, in both modes" {
  text=$(flat "$RESOLVE_PR")
  pre=$(grep -n '^\*\*Range pre-check\.\*\*' "$RESOLVE_PR" | cut -d: -f1)
  ver=$(grep -n '^\*\*Verify\.\*\*' "$RESOLVE_PR" | cut -d: -f1)
  [ -n "$pre" ] && [ -n "$ver" ] && [ "$pre" -lt "$ver" ]
  grep -qF -- 'commit-resolve-fixes" --check-ranges --ranges-from "<ranges-file>" --files-from "<files-file>"' "$RESOLVE_PR"
  [[ "$text" == *'**Non-interactive:** revert the listed files'* ]]
  [[ "$text" == *'**Interactive:** one `AskUserQuestion`'* ]]
  [[ "$text" == *'"Include them / Revert them"'* ]]
  [[ "$text" == *'drops `--ranges-from` from this run'* ]]
  [[ "$text" == *'`unclear` with evidence `edit outside PR-changed lines`'* ]]
  [[ "$text" == *'dropping files afterwards would commit an unverified subset'* ]]
  # The commit call keeps the whole-commit refusal as a backstop.
  [[ "$text" == *'It is a backstop that does not fire after a clean pre-check'* ]]
}

@test "edit range: resolver prompt, clusters.md and the script state the same numeric margin" {
  margin=$(sed -n 's/^RANGE_MARGIN=\([0-9][0-9]*\)$/\1/p' "$SKILLS_DIR/pr-review-workflow/scripts/commit-resolve-fixes")
  [ "$margin" = 3 ]
  agent=$(flat "$RESOLVER_AGENT")
  [[ "$agent" == *"plus at most $margin adjacent lines (\`RANGE_MARGIN\`)"* ]]
  [[ "$agent" == *'propose `oos` with an `oos_reason` naming the needed change'* ]]
  clusters=$(flat "$RESOLVE_REFS/clusters.md")
  [[ "$clusters" == *"plus at most $margin adjacent lines (\`RANGE_MARGIN\` in \`commit-resolve-fixes\`)"* ]]
  [[ "$clusters" == *'the resolver proposes `oos` with an `oos_reason` naming the needed change'* ]]
  [[ "$clusters" != *'minimal adjacent lines'* ]]
  disp=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$disp" == *'widened by `RANGE_MARGIN` (3, a constant in `commit-resolve-fixes`)'* ]]
  [[ "$disp" == *'Non-interactive never includes an out-of-range edit'* ]]
}

@test "resolve-stack and sweep: Read their resolve-contract.md before the walk or nested resolve, stop and report the path on failure" {
  for f in "$RESOLVE_STACK" "$SWEEP"; do
    # Read is an allowed tool, so the imperative Read can run
    awk '/^allowed-tools:/ { p = 1; next } p && /^  - / { print; next } { p = 0 }' "$f" | grep -qx '  - Read' || { echo "Read not in allowed-tools of $f"; false; }
    flat=$(tr '\n' ' ' <"$f" | tr -s ' ')
    case "$f" in *resolve-stack.md) slug=review-resolve-stack ;; *) slug=review-sweep ;; esac
    grep -qF "Read \`\${CLAUDE_PLUGIN_ROOT}/references/$slug/resolve-contract.md\` (the \"Reading \`ratelimited\` (callers)\" section)" <<<"$flat" || { echo "no imperative Read in $f"; false; }
    grep -qF 'If the Read fails, stop and report the path.' <<<"$flat" || { echo "no stop-and-report in $f"; false; }
  done
  # resolve-stack: the Read comes before the walk's per-PR iteration
  flat=$(tr '\n' ' ' <"$RESOLVE_STACK" | tr -s ' ')
  read_pos=${flat%%Before the first iteration, Read*}
  walk_pos=${flat%%For each PR in the base-to-tip list*}
  [ "${#read_pos}" -lt "${#walk_pos}" ]
  grep -qF 'Never parse a final line that fails the anchored form defined there.' <<<"$flat"
  # sweep: the Read comes before the nested /review:resolve invocation
  flat=$(tr '\n' ' ' <"$SWEEP" | tr -s ' ')
  read_pos=${flat%%Before invoking the skill, Read*}
  invoke_pos=${flat%%Invoke the \`Skill\` tool with \`skill: \"review:resolve\"\`*}
  [ "${#read_pos}" -lt "${#invoke_pos}" ]
}

@test "sweep-all: an unknown Blocking row renders the total as <n>+? or unknown, never 0" {
  flat=$(tr '\n' ' ' <"$SWEEP_ALL" | tr -s ' ')
  grep -qF 'render the total as `<n>+?`' <<<"$flat"
  grep -qF 'or `unknown` when no row has a known count' <<<"$flat"
  grep -qF 'Blocking 1+?' "$SWEEP_ALL"
  run ! grep -qF '`?` rows are excluded' "$SWEEP_ALL"
}

@test "pr-review-workflow: SKILL.md stays within 500 lines and points at its local-scripts reference" {
  skill="$BATS_TEST_DIRNAME/../skills/pr-review-workflow/SKILL.md"
  ref="$BATS_TEST_DIRNAME/../skills/pr-review-workflow/references/local-scripts.md"
  [ "$(wc -l <"$skill")" -le 500 ]
  grep -qF 'references/local-scripts.md' "$skill"
  for name in commit-resolve-fixes run-verify-command check-resolve-text; do
    grep -qF "$name" "$ref" || { echo "$name missing from local-scripts.md"; false; }
  done
}

@test "resolve-pr: a timeout stop is recorded in Step 7 and blocks the Step 8 re-pass" {
  text=$(flat "$RESOLVE_PR")
  [[ "$text" == *'keep `ratelimited=0`, but also record `write_stopped=timeout` so Step 8 does not run'* ]]
  [[ "$text" == *'no exit 4 stopped the write phase (neither `ratelimited=1` nor `write_stopped=timeout`)'* ]]
  [[ "$text" == *'report that the re-pass was skipped because the write phase stopped on a timeout'* ]]
  # The old entry condition keyed on a rate limit alone.
  [[ "$text" != *'Run only when the tree is clean, no rate limit was hit,'* ]]
}

@test "dispositions: the re-pass is skipped after any exit 4, rate limit or timeout" {
  text=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$text" == *'The re-pass (Step 8) runs only when no exit 4 stopped the write phase'* ]]
  [[ "$text" == *'(`write_stopped=timeout`) it is skipped'* ]]
  [[ "$text" == *'the re-pass was skipped because the write phase stopped on a timeout'* ]]
}

@test "README: documents the optional yellow-linear routing, dedupe, fallback and text check" {
  text=$(flat "${BATS_TEST_DIRNAME}/../README.md")
  [[ "$text" == *'`yellow-linear` is an optional dependency'* ]]
  [[ "$text" == *'the branch name matches `[A-Z]{2,5}-[0-9]{1,6}`'* ]]
  [[ "$text" == *'may write to Linear through the yellow-linear MCP server'* ]]
  [[ "$text" == *'falls back to GitHub once'* ]]
  [[ "$text" == *'`tracker=github (linear unavailable)`'* ]]
  [[ "$text" == *'`check-resolve-text` before `save_issue`'* ]]
}

@test "dispositions: the prose allowlist is the single source for evidence and oos_reason" {
  text=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$text" == *'**Prose allowlist.** This is the single source.'* ]]
  [[ "$text" == *'before any reply, issue or resolve helper runs'* ]]
  [[ "$text" == *'every character is an ASCII letter, a digit, a space, or one of `. , : ; ! ? '"'"' " ( ) / _ # + -`'* ]]
  [[ "$text" == *'The class has no `@`, backtick, `<`, `>`, `[`, `]`, `{`, `}`, `|`, `\`, `*` or `~`'* ]]
  [[ "$text" == *'contains `://`, `www.`, `mailto:`, `![` or `](` fails'* ]]
  [[ "$text" == *'1 to 200 characters on one line'* ]]
  # Fixed replacement texts and the downgrades that follow them.
  [[ "$text" == *'`evidence` becomes `see the PR diff`'* ]]
  [[ "$text" == *'`oos_reason` becomes `no reason given`'* ]]
  [[ "$text" == *'`addressed` then becomes `unclear`'* ]]
  [[ "$text" == *'`oos` with the replaced reason becomes `unclear`'* ]]
  [[ "$text" == *'says the value was withheld by the prose allowlist; it never prints the value'* ]]
}

@test "dispositions: the known-limits bullet no longer claims mentions can appear in resolver prose" {
  text=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$text" != *'can still carry `@` mentions'* ]]
  [[ "$text" == *'The prose allowlist (see Resolver line) is the mitigation'* ]]
  [[ "$text" == *'mentions, external URLs and markdown images cannot appear in resolver prose'* ]]
}

@test "resolve-pr and the resolver agent point at the dispositions prose allowlist" {
  pr=$(flat "$RESOLVE_PR")
  [[ "$pr" == *"against the contract's prose allowlist before any helper in Step 7 runs"* ]]
  [[ "$pr" == *'report a withheld value by thread, never by content'* ]]
  # The allowlist is stated once, in dispositions.md, not copied here.
  [[ "$pr" != *'mailto:'* ]]
  agent=$(flat "$RESOLVER_AGENT")
  [[ "$agent" == *'including its prose allowlist'* ]]
  [[ "$agent" == *'with no `@`, links, backticks, brackets or Markdown'* ]]
}

@test "write-phase Bash budget covers the worst case at the per-call gh timeout cap" {
  lib="$BATS_TEST_DIRNAME/../lib"
  scripts="$BATS_TEST_DIRNAME/../skills/pr-review-workflow/scripts"
  # The cap is 60 s in every place that parses YELLOW_REVIEW_GH_TIMEOUT.
  grep -q '^GG_MAX_TIMEOUT=60$' "$lib/gh-graphql.sh"
  grep -q '^RG_MAX_TIMEOUT=60$' "$lib/resolve-gh.sh"
  # poll-new-threads bounds a fetch by get-pr-comments' own deadline (below the
  # 60 s hard cap), so --wait + 60 s holds without a per-call timeout.
  grep -q '^FETCH_WINDOW=60$' "$scripts/poll-new-threads"
  grep -q '^FETCH_DEADLINE=55$' "$scripts/poll-new-threads"
  # The outer budget is stated once with its arithmetic, and the command uses it.
  budget=420000
  refs=$(flat "$RESOLVE_REFS/dispositions.md")
  [[ "$refs" == *"own Bash call with a \`timeout\` of $budget ms"* ]]
  [[ "$refs" == *'clamped to 60 s per `gh` call'* ]]
  [[ "$refs" == *'= 280 s'* ]]
  [[ "$refs" == *'= 220 s'* ]]
  [[ "$refs" == *'= 360 s'* ]]
  [[ "$refs" == *'The largest is 360 s; 420 s adds 60 s'* ]]
  pr=$(flat "$RESOLVE_PR")
  [[ "$pr" == *"own Bash call with a \`timeout\` of $budget ms"* ]]
  [[ "$pr" != *'240000'* ]]
  [[ "$refs" != *'240000'* ]]
  # Worst case (file-followup-issue: six calls at the cap) plus margin fits
  # the budget, and the budget fits the Bash tool's 600000 ms maximum.
  worst=$((6 * 60))
  [ "$((worst * 1000))" -lt "$budget" ]
  [ "$budget" -le 600000 ]
  # The six-call count matches the script's own header.
  grep -q 'six gh calls' "$scripts/file-followup-issue"
}

@test "resolve-pr: the read-only fetch calls get a Bash timeout that covers their capped gh calls" {
  text=$(tr '\n' ' ' <"$RESOLVE_PR" | tr -s ' ')
  [[ "$text" == *'Give `get-pr-comments` a Bash tool `timeout` of 300000 ms'* ]]
  [[ "$text" == *'`get-pr-blockers` a timeout of 360000 ms'* ]]
  [[ "$text" == *'bounded at 60 s apiece'* ]]
  [[ "$text" == *'including the `get-pr-blockers` derivation'* ]]
  refs=$(tr '\n' ' ' <"$RESOLVE_REFS/dispositions.md" | tr -s ' ')
  [[ "$refs" == *'`get-pr-blockers` (Step 3) gets its own `timeout` of 360000 ms'* ]]
  [[ "$refs" == *'five `gh` calls'* ]]
  stack=$(tr '\n' ' ' <"$RESOLVE_STACK" | tr -s ' ')
  [[ "$stack" == *'Give this block a Bash tool `timeout` of 300000 ms'* ]]
}

@test "resolve-pr: the marker mint strips a trailing slash from TMPDIR so Step 6 accepts the path" {
  step3f=$(sed -n '/^### Step 3f/,/^### Step 4/p' "$RESOLVE_PR")
  block=$(printf '%s\n' "$step3f" | sed -n '/^```bash$/,/^```$/p' | sed '1d;$d')
  mkdir -p "$BATS_TEST_TMPDIR/tmp"
  TMPDIR="$BATS_TEST_TMPDIR/tmp/" run bash -c "$block"
  [ "$status" -eq 0 ]
  [[ "$output" == "$BATS_TEST_TMPDIR/tmp/resolve-marker."* ]]
  [[ "$output" != *"//"* ]]
  [ -f "$output/ignored-marker" ]
  # The same prefix strip Step 6 applies must leave a plain resolve-marker.* name.
  [ "${output#"$BATS_TEST_TMPDIR/tmp"/}" != "$output" ]
  case "${output#"$BATS_TEST_TMPDIR/tmp"/}" in */*) false ;; esac
}

@test "resolve-pr: a refusal reverts only reported files and asks before touching other changes" {
  step6flat=$(sed -n '/^### Step 6/,/^### Step 7/p' "$RESOLVE_PR" | tr '\n' ' ' | tr -s ' ')
  [[ "$step6flat" == *'--revert-only --files-from "<file>"` (patch saved) on every file a cluster reported under `Files modified`'* ]]
  [[ "$step6flat" == *'--revert-denied'* ]]
  [[ "$step6flat" == *'only dirty paths on the contract deny list'* ]]
  [[ "$step6flat" == *'not proven to be a resolver'* ]]
  [[ "$step6flat" == *'"Revert them / Leave them"'* ]]
  [[ "$step6flat" == *'left in place'* ]]
  # The per-file revert comes first, then --revert-denied with no argument.
  [[ "$step6flat" == *'--revert-only --files-from "<file>"'*'--revert-denied --ignored-since "$MARK_DIR/ignored-marker"` (no file list; patch saved)'* ]]
  # The marker outlives the verify call, so every refusal can pass it.
  [[ "$step6flat" == *'the marker lives until Marker cleanup, so every refusal has it'* ]]
  [[ "$step6flat" == *'`gitignored trusted-config files changed since`'* ]]
  [[ "$step6flat" == *'with `--no-ignored-guard` in place of `--ignored-since`'* ]]
  # The refusal path judges --revert-denied's JSON and names what stays on disk.
  [[ "$step6flat" == *'`deniedClean` is the success signal'* ]]
  [[ "$step6flat" == *'deny-listed edit left on disk (revert incomplete)'* ]]
  # Only trusted config is reverted unasked; the rest of the deny list is asked
  # about or left, and a refusal before the verify call still guards ignored files.
  [[ "$step6flat" == *'`rp_trusted_config` in `lib/resolve-paths.sh`'* ]]
  [[ "$step6flat" == *'the rest of the deny list, such as `.env*`, keys, CI and Docker files, included'* ]]
  [[ "$step6flat" == *'When the refusal came before the verify or `--check-ignored` call below, run that `--check-ignored` call too'* ]]
  [[ "$step6flat" == *'When no call ran at all (a stop before this step, or a declined command) and resolvers ran, first run the `--check-ignored` call above'* ]]
  step9flat=$(sed -n '/^### Step 9/,/^## Error Handling/p' "$RESOLVE_PR" | tr '\n' ' ' | tr -s ' ')
  [[ "$step9flat" == *'**Reverted deny-listed paths**'* ]]
  dispo=$(tr '\n' ' ' <"$RESOLVE_REFS/dispositions.md" | tr -s ' ')
  [[ "$dispo" == *'--revert-denied'* ]]
  [[ "$dispo" == *'reverts only paths on the resolver deny list that are trusted config'* ]]
  [[ "$dispo" == *'`deniedClean` (no deny-listed change remains)'* ]]
  [[ "$dispo" == *'an empty match is `result: "noop"` with no patch'* ]]
}

@test "resolve-pr: keeping the partial edits of a conflicted cluster stops the run and reverts nothing" {
  step5flat=$(sed -n '/^### Step 5/,/^### Step 6/p' "$RESOLVE_PR" | tr '\n' ' ' | tr -s ' ')
  [[ "$step5flat" == *"Keep the resolver's partial edits and stop"* ]]
  [[ "$step5flat" == *'Keep stops the same way but reverts nothing'* ]]
}

@test "resolve-pr: a rate-limited blocker lookup stops before any dispatch or write" {
  step3=$(sed -n '/^### Step 3: /,/^### Step 3b/p' "$RESOLVE_PR" | tr '\n' ' ' | tr -s ' ')
  [[ "$step3" == *'`lookupReason` or `resolutionLookupReason` is `rate_limited`'* ]]
  [[ "$step3" == *'without a resolver dispatch, commit, push, reply or issue'* ]]
  [[ "$step3" == *'`push=skipped, verify=none, ratelimited=1`'* ]]
}

@test "resolve-stack: a verify=skipped contract line ends the walk like a missing contract" {
  flat=$(tr '\n' ' ' <"$RESOLVE_STACK" | tr -s ' ')
  [[ "$flat" == *'A valid contract line with `verify=skipped` is a refusal'* ]]
  [ "$(grep -o 'not attempted (verify skipped)' <<<"$flat" | wc -l)" -ge 1 ]
  dispo=$(tr '\n' ' ' <"$RESOLVE_REFS/dispositions.md" | tr -s ' ')
  [[ "$dispo" == *'`/review:resolve-stack` and `/review:sweep-all` read `verify=skipped` as the stop'* ]]
}

@test "local-scripts: check-resolve-text documents exit 6 for refused text and exit 2 for usage" {
  ref="$BATS_TEST_DIRNAME/../skills/pr-review-workflow/references/local-scripts.md"
  flat=$(tr '\n' ' ' <"$ref" | tr -s ' ')
  [[ "$flat" == *'Exits 6 when text looks like a credential'* ]]
  [[ "$flat" == *'and 2 for a usage error or an unreadable file'* ]]
}

@test "sweep-all: a verify=skipped contract line ends the batch after the clean-tree check" {
  flat=$(tr '\n' ' ' <"$SWEEP_ALL" | tr -s ' ')
  [[ "$flat" == *'`blocking` count `<b>`, `verify` and `ratelimited`'* ]]
  [[ "$flat" == *'5c. **Verify-skipped stop** — only after item 4'* ]]
  [[ "$flat" == *'`skipped — not attempted (verify skipped)`'* ]]
  [[ "$flat" == *'Unless item 1b, 4, 5, 5b or 5c stopped the loop'* ]]
}

@test "sweep-all: no project command after a verify-skipped stop" {
  flat=$(tr '\n' ' ' <"$SWEEP_ALL" | tr -s ' ')
  grep -qF 'no project command may run while that file is on disk.' <<<"$flat"
  run grep -n 'flow:compound' "$SWEEP_ALL"
  [ "$status" -eq 1 ]
}

@test "dispositions: the addressed path:line evidence refuses an option-shaped path segment" {
  DISP="$BATS_TEST_DIRNAME/../references/resolve/dispositions.md"
  tr '\n' ' ' <"$DISP" | tr -s ' ' | grep -q 'no `\.`, `\.\.` or empty segment and no segment starting with `-`'
  tr '\n' ' ' <"$DISP" | tr -s ' ' | grep -q '`-config.yml` is refused'
}

@test "review-pr Step 9a: unattended runs stage learnings, attended runs keep the compounder" {
  KC="$BATS_TEST_DIRNAME/../references/review-pr/knowledge-compounding.md"
  step9a=$(awk '/^## Step 9a:/ { p = 1; next } /^## Step 9b:/ { p = 0 } p' "$KC")
  grep -qF '**In non-interactive mode**, do not spawn any agent' <<<"$step9a"
  grep -qF '| {finding_id, state, fix_sha}]'"'" <<<"$step9a"
  grep -qF 'select(.state != "dismissed" and .state != "stale")' <<<"$step9a"
  grep -qF 'lib/stage-learning.sh" tmpfile' <<<"$step9a"
  grep -qF 'lib/stage-learning.sh" stage <PR> <path>' <<<"$step9a"
  grep -qF 'Never write "verified" or "tests pass"' <<<"$(tr '\n' ' ' <<<"$step9a" | tr -s ' ')"
  # The interactive branch still spawns the compounder with fenced findings.
  grep -qF '**In interactive mode**, spawn the `knowledge-compounder` agent' <<<"$step9a"
  grep -qF -e '--- begin review-findings ---' <<<"$step9a"
  # The staging branch comes before the spawn.
  stage_line=$(grep -n 'In non-interactive mode' <<<"$step9a" | head -1 | cut -d: -f1)
  spawn_line=$(grep -n 'In interactive mode' <<<"$step9a" | head -1 | cut -d: -f1)
  [ "$stage_line" -lt "$spawn_line" ]
}

@test "review-pr: Step 1 says non-interactive mode stages instead of compounding" {
  tr '\n' ' ' <"$REVIEW_PR" | tr -s ' ' | grep -qF 'Step 9a stages findings for the compound-staging drain instead of spawning the gated knowledge-compounder'
}

@test "sweep-all: no end-of-loop compounding pass remains" {
  run grep -n 'flow:compound' "$SWEEP_ALL"
  [ "$status" -eq 1 ]
  run grep -n '^### Step 6' "$SWEEP_ALL"
  [ "$status" -eq 1 ]
  grep -qF 'compound-staging drain; sweep-all runs no compounding pass of its own' "$SWEEP_ALL"
}

# Runs sweep Step 1b's remote selection (lines 'REMOTE=origin' through its
# 'case' guard) against a scratch repo whose remotes are the arguments.
sweep_remote_pick() {
  local repo="$BATS_TEST_TMPDIR/remote-repo" r
  rm -rf "$repo" && git init -q "$repo"
  for r in "$@"; do git -C "$repo" remote add -- "$r" https://example.invalid/x.git; done
  awk '/^REMOTE=origin$/ { p = 1 } p { print } /^case "\$REMOTE" in/ { exit }' "$SWEEP" >"$BATS_TEST_TMPDIR/pick.sh"
  [ "$(wc -l <"$BATS_TEST_TMPDIR/pick.sh")" -eq 3 ]
  TOP="$repo" bash -c 'head_fail() { echo FAIL; exit 2; }; . "$1"; printf "%s\n" "$REMOTE"' _ "$BATS_TEST_TMPDIR/pick.sh"
}

@test "sweep Step 1b: any git-valid sole remote name is accepted, not a character allowlist" {
  for name in team+upstream team@upstream team/up.stream up_stream; do
    run sweep_remote_pick "$name"
    [ "$status" -eq 0 ]
    [ "$output" = "$name" ]
  done
}

@test "sweep Step 1b: several remotes without origin fail; origin wins among several" {
  run sweep_remote_pick a b
  [ "$status" -eq 2 ]
  [ "$output" = FAIL ]
  run sweep_remote_pick a origin
  [ "$status" -eq 0 ]
  [ "$output" = origin ]
}

@test "sweep Step 1b: an option-shaped remote name is refused, and fetch passes it after --" {
  run sweep_remote_pick -x
  [ "$status" -eq 2 ]
  [ "$output" = FAIL ]
  grep -qF 'fetch -q --no-tags -- "$REMOTE"' "$SWEEP"
}

# Runs sweep Step 1b's existing-path guard (the fenced block that starts at
# 'p="$TOP/yellow-plugins.local.md"') in a scratch repo, under bash and zsh
# noclobber when zsh is present.
sweep_unignored_guard() {
  local repo="$BATS_TEST_TMPDIR/guard-repo" sh="${2:-bash}"
  rm -rf "$repo" && git init -q "$repo"
  git -C "$repo" config status.showUntrackedFiles no
  case "$1" in
    file) printf 'resolve_pr:\n  verify_command: x\n' >"$repo/yellow-plugins.local.md" ;;
    symlink) ln -s /nonexistent-target "$repo/yellow-plugins.local.md" ;;
    absent) ;;
  esac
  awk '/^p="\$TOP\/yellow-plugins.local.md"$/ { p = 1 } p { print } p && /^fi$/ { exit }' "$SWEEP" >"$BATS_TEST_TMPDIR/guard.sh"
  [ "$(wc -l <"$BATS_TEST_TMPDIR/guard.sh")" -eq 5 ]
  (cd "$repo" && "$sh" -c 'setopt noclobber 2>/dev/null; set -C; TOP=$(git rev-parse --show-toplevel); . "$1"; echo CONTINUE' _ "$BATS_TEST_TMPDIR/guard.sh")
}

@test "sweep Step 1b: an existing unignored config file or symlink stops before the snapshot, an absent one continues" {
  # status.showUntrackedFiles=no hides the file from the Step 1 clean-tree check.
  run sweep_unignored_guard file
  [ "$status" -eq 1 ]
  [[ "$output" == *'exists untracked and unignored on this branch'* ]]
  [[ "$output" != *CONTINUE* ]]
  run sweep_unignored_guard symlink
  [ "$status" -eq 1 ]
  run sweep_unignored_guard absent
  [ "$status" -eq 0 ]
  [ "$output" = CONTINUE ]
  if command -v zsh >/dev/null 2>&1; then
    run sweep_unignored_guard file zsh
    [ "$status" -eq 1 ]
    run sweep_unignored_guard absent zsh
    [ "$status" -eq 0 ]
  fi
  # The guard sits after the tracked-abort and before the snapshot call.
  guard=$(grep -n '^p="\$TOP/yellow-plugins.local.md"$' "$SWEEP" | cut -d: -f1)
  snap=$(grep -n 'guard-local-config" snapshot' "$SWEEP" | head -1 | cut -d: -f1)
  [ -n "$guard" ] && [ "$guard" -lt "$snap" ]
}
