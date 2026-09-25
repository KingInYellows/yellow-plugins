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
