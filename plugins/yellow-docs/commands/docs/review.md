---
description: "Multi-persona review of a planning document (PRD, brainstorm, spec, ADR) using 6 always-applicable personas plus 1 conditional adversarial reviewer. Each persona returns structured findings; the orchestrator aggregates with a confidence-rubric gate."
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
  - AskUserQuestion
---

# /docs:review

Run a multi-persona review of a planning document at `$ARGUMENTS`.

## Inputs

- `$ARGUMENTS` — path to the document to review (PRD, brainstorm, spec,
  ADR, plan, or design doc). Required.

## Workflow

### Step 1: Validate path

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
DOC_PATH="$ARGUMENTS"

if [ -z "$DOC_PATH" ]; then
  printf '[/docs:review] Error: document path required\n' >&2
  exit 1
fi

if printf '%s' "$DOC_PATH" | grep -qE '(^~|\.\.)'; then
  printf '[/docs:review] Error: invalid path — no ~ or ..\n' >&2
  exit 1
fi

# Resolve to absolute path inside project
case "$DOC_PATH" in
  /*) FULL_PATH="$DOC_PATH" ;;
  *)  FULL_PATH="$PROJECT_ROOT/$DOC_PATH" ;;
esac

if [ ! -f "$FULL_PATH" ]; then
  printf '[/docs:review] Error: file not found at %s\n' "$DOC_PATH" >&2
  exit 1
fi

if [ -L "$FULL_PATH" ]; then
  printf '[/docs:review] Error: symlinks not permitted\n' >&2
  exit 1
fi
```

If validation fails, stop with the printed error.

### Step 2: Estimate document size and risk

Count words and detect domain risk signals:

```bash
WORD_COUNT=$(wc -w < "$FULL_PATH")
RISK_HITS=$(grep -ciE '\b(auth|authz|payment|billing|migration|compliance|cryptography|pii|external api)\b' "$FULL_PATH" || true)
REQ_COUNT=$(grep -cE '^- \[ \]|^[0-9]+\.|^R[0-9]+' "$FULL_PATH" || true)
```

Use these to decide whether to invoke the conditional `adversarial-document-reviewer`:

- Invoke if `WORD_COUNT > 1000` OR `REQ_COUNT >= 5` OR `RISK_HITS >= 1`.
- Otherwise, skip adversarial; the 6 always-applicable personas are
  sufficient for short or low-stakes documents.

### Step 3: Learnings pre-pass (optional)

If yellow-research is installed, invoke `learnings-researcher` via Task to
surface prior `docs/solutions/` entries relevant to the document's domain.
Inject the result as advisory context into each persona prompt:

```text
Task: learnings-researcher
subagent_type: "yellow-core:research:learnings-researcher"
Input: { document_path, document_text }
Goal: Find prior solutions docs relevant to this document's domain
run_in_background: false
```

If yellow-research isn't installed, skip silently (graceful degradation).

### Step 4: Dispatch personas in parallel

Issue all selected Task invocations in a **single response** so they
execute concurrently. Always-applicable personas (6):

```text
Task: coherence-reviewer
subagent_type: "yellow-docs:review:coherence-reviewer"
Input: { document_path, document_text, learnings_context }
run_in_background: true

Task: design-lens-reviewer
subagent_type: "yellow-docs:review:design-lens-reviewer"
Input: { document_path, document_text, learnings_context }
run_in_background: true

Task: feasibility-reviewer
subagent_type: "yellow-docs:review:feasibility-reviewer"
Input: { document_path, document_text, learnings_context }
run_in_background: true

Task: product-lens-reviewer
subagent_type: "yellow-docs:review:product-lens-reviewer"
Input: { document_path, document_text, learnings_context }
run_in_background: true

Task: scope-guardian-reviewer
subagent_type: "yellow-docs:review:scope-guardian-reviewer"
Input: { document_path, document_text, learnings_context }
run_in_background: true

Task: security-lens-reviewer
subagent_type: "yellow-docs:review:security-lens-reviewer"
Input: { document_path, document_text, learnings_context }
run_in_background: true
```

If selected by Step 2's gate:

```text
Task: adversarial-document-reviewer
subagent_type: "yellow-docs:review:adversarial-document-reviewer"
Input: { document_path, document_text, learnings_context, depth }
run_in_background: true
```

Where `depth` = `"quick"` for documents under 1000 words and no risk
signals, `"standard"` for medium documents, `"deep"` for documents over
3000 words OR more than 10 requirements OR high-stakes domains.

### Step 5: Wait gate + collect findings

Wait for all background tasks to complete via TaskOutput. Read each
agent's result.

### Step 6: Confidence-rubric gate

Apply the confidence-rubric gate (matches Wave 2 yellow-review pattern):

- **Suppress findings with `confidence < 75`** — except `safe_auto`
  findings (which always emit at confidence 100 by definition) and P0
  findings at `confidence ≥ 50`.
- Group surviving findings by persona for the report.

### Step 7: Render report

Output a structured report:

```markdown
# Document Review: $ARGUMENTS

**Word count:** X
**Persona count:** 6 always-applicable + (1 adversarial if invoked)
**Findings (post-gate):** N

## Findings by Persona

### coherence-reviewer (M findings)
[per-finding rendering with section, severity, confidence, finding, fix]

### design-lens-reviewer (M findings)
…

[continue for all invoked personas]

## Safe-Auto Patches (if any)

[renderable as suggested edits the user can accept or reject]

## Suppressed Findings Summary

[one-line per suppressed finding: persona, confidence, brief reason]
```

### Step 8: Optional safe-auto application

If any findings have `autofix_class: safe_auto`, prompt via
AskUserQuestion: "Apply N safe-auto fixes?" with options
"Apply all / Review each / Skip".

### Step 9: Compound (optional)

If yellow-core is installed, offer to compound new learnings via
`/workflows:compound`. Skip silently if not installed.

## Graceful Degradation

- If `learnings-researcher` is unavailable: skip Step 3; continue without
  prior-context injection.
- If any persona Task fails: log to stderr (`[/docs:review] Warning:
  <persona> unavailable`); continue with remaining personas. Do not block
  the whole review on a single failure.
- If all personas fail: report failure and exit non-zero.

## Done State

Report rendered to stdout with non-suppressed findings grouped by persona.
Optional safe-auto fixes applied if user confirmed. Optional compound
hand-off offered.

## References

- Persona definitions: `plugins/yellow-docs/agents/review/*.md`
- Confidence rubric (integer anchors): mirrors Wave 2 yellow-review
  pattern; see `plugins/yellow-review/commands/review/review-pr.md` for
  the canonical aggregation logic.
- Upstream snapshot (locked SHA): `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/agents/`
