# Compact-return schema

The block below is the single source of the compact-return schema that Wave 2
persona reviewers return (pr-review-workflow "Finding Output Format"). A
subagent cannot read this file at dispatch, so each persona carries an inline
copy, and `scripts/validate-compact-return-schema.js` (in
`pnpm validate:schemas`) checks every copy under `plugins/*/agents/` and
`plugins/*/skills/` against it. A copy keeps the same keys in the same order
with the same value types and the same `rule` and `scope` placeholders. It may
narrow `severity`, `autofix_class` and `owner` to a subset, put its own values
in `reviewer`, `category`, `confidence` and the free-text placeholders, and add
extension keys after `suggested_fix`. Change the contract here first, then each
copy the validator names.

<!-- compact-return-schema:begin -->

```json
{
  "reviewer": "<name>",
  "findings": [
    {
      "title": "<short actionable summary>",
      "severity": "P0|P1|P2|P3",
      "category": "<reviewer category>",
      "rule": "<slug from the injected rule-vocabulary>",
      "scope": "<enclosing dotted symbol path or nearest markdown heading>",
      "file": "<repo-relative path>",
      "line": 42,
      "confidence": 75,
      "autofix_class": "safe_auto|gated_auto|manual|advisory",
      "owner": "review-fixer|downstream-resolver|human|release",
      "requires_verification": true,
      "pre_existing": false,
      "suggested_fix": "<one-sentence concrete fix or null>"
    }
  ],
  "residual_risks": [],
  "testing_gaps": []
}
```

<!-- compact-return-schema:end -->

Persona copies also carry the notes below verbatim between the matching
`compact-return-notes` markers; the validator requires them byte-identical to
this block.

<!-- compact-return-notes:begin -->

`line` must be an integer — the 1-based line number of the finding in `file`;
the `42` above is an example value, not a literal.

`rule` is a slug from the `<rule-vocabulary>` block the orchestrator injects for
your `category` (`unclassified` when none fits); `scope` is the enclosing dotted
symbol path at `line` (e.g. `handlers.createUser`); in a prose file, use the
nearest markdown heading only when it is unique in the file, otherwise the full
`Parent > Child` heading path. In that path, escape a literal `>` inside one
heading's own text as `\>` and double any `\`: `## A > B` under `# Parent` is
`Parent > A \> B`.

`residual_risks` and `testing_gaps` are aggregator-populated demotion buckets —
always emit them as empty arrays (see pr-review-workflow "Finding Output
Format").

<!-- compact-return-notes:end -->
