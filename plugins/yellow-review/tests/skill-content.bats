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

@test "resolve-pr: the ignored-file marker is minted before resolvers spawn and passed to the unattended verify" {
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
  [[ "$step6flat" == *'required unattended'* ]]
  [[ "$step6flat" == *'**Marker cleanup.**'* ]]
  flat "$RESOLVE_REFS/dispositions.md" | grep -qF -- '`--ignored-since <marker-file>` is required'
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
  [[ "$text" == *'Give both of these read-only calls a Bash tool `timeout` of 300000 ms'* ]]
  [[ "$text" == *'bounded at 60 s apiece'* ]]
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
  [[ "$step6flat" == *'not proven to be a resolver'* ]]
  [[ "$step6flat" == *'"Revert them / Leave them"'* ]]
  [[ "$step6flat" == *'left in place'* ]]
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

@test "dispositions: the addressed path:line evidence refuses an option-shaped path segment" {
  DISP="$BATS_TEST_DIRNAME/../references/resolve/dispositions.md"
  tr '\n' ' ' <"$DISP" | tr -s ' ' | grep -q 'no `\.`, `\.\.` or empty segment and no segment starting with `-`'
  tr '\n' ' ' <"$DISP" | tr -s ' ' | grep -q '`-config.yml` is refused'
}
