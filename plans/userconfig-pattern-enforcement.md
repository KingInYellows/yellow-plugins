# Feature: `userConfigEntry.pattern` schema field for input regex constraints

## Problem Statement

PR #396 (`yellow-composio` bundles HTTP MCP via userConfig) introduced the first
plugin in this repo to read user-supplied secrets and URLs into an HTTP MCP
server's `url` and `X-API-Key` header. A reviewer (greptile, P1 security) flagged
that `composio_api_key` is `sensitive: true` (keychain-backed) but is sent as the
`X-API-Key` header to whatever URL the user enters in `composio_mcp_url`. With
no schema-level constraint enforcing an `https://` prefix, a user who pastes
`http://mcp.composio.dev/...` (or any non-TLS URL) leaks the keychain-protected
credential in cleartext on the wire. The advisory text in the description
(`"Only https://mcp.composio.dev/* URLs are expected"`) is documentation, not
enforcement.

Adding `"pattern": "^https://"` to the `composio_mcp_url` userConfig entry
would close this gap. But the local schema's `userConfigEntry` definition uses
`additionalProperties: false` and does not list `pattern` — so writing it
directly into `plugin.json` fails `pnpm validate:plugins` with an
"additional property not allowed" AJV error. This blocks the security fix on
PR #396 and on any future plugin needing input-format enforcement (numeric
ranges, file path constraints, vendor-specific token prefixes).

The right fix is at the schema layer: add `pattern` to the `userConfigEntry`
definition, gate it to string-typed values, and add a hand-rolled rule
(`scripts/validate-plugin.js` RULE 10) so the constraint is also enforced when
the schema is bypassed (validate-plugin.js does NOT AJV-load the schema — see
the userConfig type+title drift doc).

## Linear Issues

(none — no Linear issue tracker integration on this work)

## Current State

- **Schema** (`schemas/plugin.schema.json`, `definitions.userConfigEntry`):
  - Properties: `type`, `title`, `description`, `default`, `required`,
    `sensitive`
  - `required: ["type", "title"]`
  - `additionalProperties: false`
  - `type` enum: `string|number|boolean|directory|file`
  - Has an `allOf` block of `if/then` constraints linking `default` shape to
    `type` (strings keep string defaults, numbers keep numeric defaults, etc.) —
    this is the established pattern for type-conditional schema rules.

- **Validator** (`scripts/validate-plugin.js`):
  - Hand-rolled, does NOT AJV-load `schemas/plugin.schema.json`.
  - RULE 9 (line 856–878 region) — `validateUserConfigEntries` walks both
    top-level `userConfig` and `channels[].userConfig`, requiring `type` and
    `title`. Same loop is the natural place to add `pattern` validation.
  - `USER_CONFIG_TYPES` Set at line 65–69 — module-scope, mirrors the
    schema enum.

- **Tests** (`tests/integration/validate-plugin.test.ts`):
  - Fixture-based: each test writes a `plugin.json` to a temp dir, runs the
    validator as a child process, asserts on exit code (0/1/2) and stderr.
  - Existing block "PR-A" added by an earlier hardening PR — RULE 7 tests live
    here.

- **Plugin manifests** (`plugins/*/.claude-plugin/plugin.json`):
  - 4 plugins currently have `userConfig` (yellow-devin, yellow-research,
    yellow-morph, yellow-semgrep) — none use `pattern`.
  - PR #396's `yellow-composio` adds 2 more keys (`composio_mcp_url`,
    `composio_api_key`) — also no pattern (deferred pending this PR).

- **Prior art**:
  - The `userConfigEntry.title` + `type` requirement was enforced via the
    same schema-tightening + RULE 9 hand-roll combination — see
    `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
    and `docs/brainstorms/2026-05-05-plugin-manifest-userconfig-validator-drift-brainstorm.md`.
  - That doc documents the empirical reality that the local schema and
    Claude Code's remote validator can drift silently and the right
    posture is "tighten local first, file an issue for the remote if
    behavior diverges."

## Proposed Solution

Add `pattern` as an optional schema-level property on `userConfigEntry`,
enforced for `string`-typed values (and conditionally for `directory`/`file`
path-shape values when set), with a corresponding hand-rolled RULE 10 in
`scripts/validate-plugin.js` so the constraint also fires from the script
path that does not AJV-load the schema. Then apply the pattern to PR #396's
`composio_mcp_url` (and any other already-shipped userConfig entries that
benefit) in a follow-up commit on the same branch.

### Key design decisions

**D1. Enum scope of `pattern`.** Restrict pattern enforcement to
`type ∈ {string, directory, file}`. Numbers and booleans cannot meaningfully
carry a regex constraint at the value-shape level (numbers should use
`minimum`/`maximum`; booleans only have two values). Directory and file are
included because path-format constraints (e.g.,
`^[A-Za-z0-9_-]+$` for safe slug-like paths) are a real use case.

**D2. Pattern is optional, not required.** Existing 4 plugins (and PR #396's
2 keys) ship without it. Making it optional is the only backward-compatible
choice — and `pattern` is only correct for some keys (URL, file path),
not all (description text, freeform IDs).

**D3. Local enforcement only — no claim about remote validator behavior.**
Per the userConfig type+title drift solutions doc, the Anthropic remote
validator (`claude doctor`) may or may not honor `pattern`. The schema and
RULE 10 enforce locally; if the remote silently ignores `pattern`, local CI
is still the right backstop because every PR runs `pnpm validate:plugins`.
Document this empirical question in the changeset.

**D4. `if/then` block in `allOf` for type-gated pattern rejection.**
Mirror the existing allOf pattern that links `default` shape to `type`. Add a
sibling `if/then` block that says: "if `type ∈ {number, boolean}`, then the
schema must NOT contain `pattern`." This catches `pattern` misuse on
unsupported types via AJV alone.

**D5. RULE 10 in validate-plugin.js does the same work hand-rolled.**
Mirroring RULE 9, walk both top-level and `channels[].userConfig`, validate
that:
- `pattern` is a string when present
- `pattern` compiles as a JavaScript regex (via `new RegExp(pattern)` in a
  try/catch — same engine as runtime substitution)
- `pattern` is only set when `type` is one of `{string, directory, file}`
- when `default` is present alongside `pattern`, the default itself matches
  the pattern (catches "pattern says ^https:// but default is http://...")

**D6. Document the security cross-link.** The pattern field's primary motivating
case is the `composio_mcp_url` cleartext-credential risk. The plan ships
the schema enablement only — applying `^https://` to PR #396's plugin.json
happens in a sibling commit on this branch (or a follow-up PR), gated by
PR #396 merging first. Document this ordering.

### Why this approach (vs alternatives)

- **Approach A — manifest-only (write `pattern` into composio plugin.json,
  add it to schema lazily):** Already tried in the PR #396 resolver pass;
  fails CI because of `additionalProperties: false`. Not viable.
- **Approach B — schema only (no RULE 10):** Would work for plugin manifests
  read via AJV-loaded paths (`tests/integration/example-files-schema.test.ts`)
  but `validate-plugin.js` does not AJV-load. The userConfig type+title
  brainstorm doc explicitly notes this and that's why RULE 9 was added.
  Skipping the hand-rolled rule would repeat the same gap.
- **Approach C — schema + RULE 10 (this plan):** Matches established repo
  doctrine. Both validation paths agree.

## Implementation Plan

### Phase 1: Schema change

- [ ] **1.1** — In `schemas/plugin.schema.json` `definitions.userConfigEntry.properties`,
  add a `pattern` property:
  ```json
  "pattern": {
    "type": "string",
    "minLength": 1,
    "description": "Regular expression (JavaScript syntax) the user-supplied value must match. Enforced at install time by the Claude Code remote validator (when supported) AND locally by scripts/validate-plugin.js RULE 10. Only valid when type is one of: string, directory, file."
  }
  ```
- [ ] **1.2** — Extend the `allOf` block with an `if/then` rule rejecting
  `pattern` when `type ∈ {number, boolean}`:
  ```json
  {
    "if": {
      "properties": { "type": { "enum": ["number", "boolean"] } },
      "required": ["type"]
    },
    "then": { "properties": { "pattern": false } }
  }
  ```

> **Implementation deviation note (2026-05-06):** the original plan
> body proposed `"then": { "not": { "required": ["pattern"] } }`. AJV
> strict mode rejects that formulation as `strictRequired` (the
> property name appearing in `required` must also be declared in the
> local schema's `properties`, even inside a `not` clause). The
> `properties: { pattern: false }` idiom (a `false` schema means
> "always invalid") is both stricter AND AJV-strict-mode-friendly.
> The shipped code uses the latter.

<!-- deepen-plan: codebase -->
> **Codebase:** The existing `allOf` at `schemas/plugin.schema.json` lines
> 34–55 has 5 `if/then` blocks, all using `{ "type": { "const": "<x>" } }` +
> a positive `then.properties.default` constraint. The proposed 6th block
> uses `enum` (not `const`) and `then.not.required` (negative, not positive).
> This is valid draft-07 but is structurally different from the existing 5 —
> worth a leading-comment in the schema diff so future readers see the
> intent. Confirmed: `additionalProperties: false` is at line 33.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** AJV/JSON Schema draft-07 idiomatic guidance — the proposed
> `if/then` shape is the canonical pattern. **Critical:** the `if` clause
> MUST include `"required": ["type"]` as written; without it, an entry with
> no `type` field would match the `if` (because `properties` without
> `required` does not assert presence) and would incorrectly be forbidden
> from having `pattern`. Plan has this correct.
> Alternatives considered: `dependentSchemas` (wrong tool — fires on
> property *presence*, not value), `oneOf` per-type subschemas (5× more
> schema text; only worth it for per-type pattern format validation).
> See: <https://ajv.js.org/json-schema.html#if-then-else>
<!-- /deepen-plan -->

- [ ] **1.3** — Run `jq empty schemas/plugin.schema.json` to confirm valid JSON
  (no trailing-comma drift on `additionalProperties: false` block).
- [ ] **1.4** — Run `pnpm validate:schemas` and confirm it passes (no
  existing manifest is invalidated; pattern is purely additive).

**Verification:** `pnpm test:integration -- example-files-schema` continues to
pass against the test fixtures under `tests/integration/`. AJV reports `pattern`
as accepted.

### Phase 2: Hand-rolled RULE 10 in `validate-plugin.js`

- [ ] **2.1** — Read the full RULE 9 source at
  `scripts/validate-plugin.js:856–878` to extract the `validateUserConfigEntries`
  helper signature and structure.

<!-- deepen-plan: codebase -->
> **Codebase:** Line numbers in this plan are off — `validateUserConfigEntries`
> is defined at **line 866** (not 808); RULE 9 leading comment block starts
> at **line 856** (correct); top-level call site at **line 903**;
> `channels[i].userConfig` call site at **line 908** (NOT 844–851 as the
> plan body says). The full RULE 9 region is **lines 856–911**. Module-scope
> `VALID_USER_CONFIG_TYPES` Set is at **lines 71–77**. Update Phase 2.1
> reference and Phase 2.3 line range, and the "Validator entry point" line
> in the References section, before reading those files during work.
<!-- /deepen-plan -->

- [ ] **2.2** — Add RULE 10 inside `validateUserConfigEntries` (or as a sibling
  helper called from the same loop). For each entry:
  - If `pattern` is present:
    - Reject if `typeof pattern !== 'string'` or `pattern.length === 0`.
    - Reject if `type` is not in `{string, directory, file}` —
      include the offending key path in the error message.
    - Compile via `new RegExp(pattern)` inside `try/catch`; on
      `SyntaxError`, report the regex compile error verbatim.
    - If `default` is also present and is a string, test it against the
      compiled regex; if it doesn't match, report:
      `userConfig.<key>: default "<value>" does not match pattern "<regex>"`.

<!-- deepen-plan: external -->
> **Research:** AJV's default `pattern`-failure error is
> `"must match pattern \"<regex>\""` — functional but opaque for plugin
> authors. Two options for clearer messages:
> 1. **`ajv-errors` package** — adds an `errorMessage` keyword
>    (<https://github.com/ajv-validator/ajv-errors>). Requires `allErrors:
>    true` on the AJV instance. Best when errors surface directly to end
>    users.
> 2. **Post-process AJV's error array** in `validate-plugin.js` — map
>    `keyword === 'pattern'` errors to a human-readable template. No new
>    dependency, sufficient for validator scripts where you control output.
>
> **Recommended for this plan:** option 2 (post-process). RULE 10 already
> hand-rolls the validation, so the error message is fully under our
> control without pulling in `ajv-errors`. Phase 2.2's existing
> `userConfig.<key>: default "<value>" does not match pattern "<regex>"`
> format is exactly the right shape.
<!-- /deepen-plan -->

- [ ] **2.3** — Wire calls in both invocations (top-level
  `validateUserConfigEntries(manifest.userConfig, 'userConfig')` at
  `scripts/validate-plugin.js:903` and the `channels[i].userConfig` loop
  at `scripts/validate-plugin.js:908`, both inside the RULE 9 region
  ending at line 911 — see codebase annotation on Phase 2.1).
- [ ] **2.4** — Update the "RULE 9: userConfig entries must declare `type` and
  `title`" leading comment block to also mention RULE 10's pattern semantics
  so a future maintainer sees both rules together.

**Verification:** `pnpm validate:plugins` continues to pass on all existing
plugins (no plugin uses `pattern` yet, so no false positives). Manual test:
write a fixture plugin with `"type": "number", "pattern": "^[0-9]+$"` —
RULE 10 must reject it.

### Phase 3: Integration tests

- [ ] **3.1** — In `tests/integration/validate-plugin.test.ts`, add a
  describe block "PR-B: userConfig pattern field (RULE 10)" with the
  following cases (mirror the PR-A fixture-based pattern):
  - Accept: `type: "string"` + `pattern: "^https://"` + `default: "https://example.com"` — exit 0
  - Reject: `type: "string"` + `pattern` not a string (e.g., `pattern: 123`) — exit 1, stderr mentions "must be string"
  - Reject: `type: "number"` + `pattern: "^[0-9]+$"` — exit 1, stderr mentions "pattern only valid for type ∈ {string, directory, file}"
  - Reject: `type: "string"` + `pattern: "[unclosed"` (invalid regex) — exit 1, stderr mentions regex compile error
  - Reject: `type: "string"` + `pattern: "^https://"` + `default: "http://example.com"` — exit 1, stderr mentions "default does not match pattern"

<!-- deepen-plan: codebase -->
> **Codebase:** PR-A describe block confirmed at
> `tests/integration/validate-plugin.test.ts:316–645`. Append the new
> "PR-B" block directly after line 645. Use the existing scaffolding:
> `mkdtempSync(join(tmpdir(), 'yellow-validate-plugin-new-'), ...)` in
> `beforeEach`; plugin name MUST match the temp dir basename
> (`test-plugin`) per RULE 2; `writePluginManifest(pluginDir, manifest)`
> writes `.claude-plugin/plugin.json`; `runValidator(pluginDir)` returns
> `{ status, stdout, stderr }` from `spawnSync('node', [VALIDATOR,
> pluginDir])`. `VALID_BASE_MANIFEST` is at lines 101–107
> (`{ name: 'test-plugin', description, author, version }`) — start each
> case from `{ ...VALID_BASE_MANIFEST, userConfig: { ... } }`.
<!-- /deepen-plan -->

- [ ] **3.2** — In `tests/integration/example-files-schema.test.ts` (or the
  AJV-loaded fixture path it covers), add at minimum one positive case
  exercising the schema's accept-pattern path so we know AJV is loading
  the new property.

<!-- deepen-plan: codebase -->
> **Codebase:** `tests/integration/example-files-schema.test.ts` AJV-loads
> `schemas/plugin.schema.json` via `AjvValidatorFactory.loadSchemaFromFile`
> (lines 35, 62–66) and iterates all `examples/plugin*.json` files
> (lines 77–94). It already has a `'semverRange custom keyword (PR-B)'`
> describe block at line 97 — DO NOT name the new block "PR-B" here
> (collision); call it **`'userConfigEntry.pattern field (PR-C)'`** or
> similar. The lowest-friction positive case is to add `"pattern":
> "^https://"` to the existing `userConfig.api_endpoint` entry in
> `examples/plugin-extended.example.json` (line 53 of that fixture) —
> the existing fixture loop will validate it automatically. Then add a
> dedicated synthetic-schema describe block for the negative cases
> (number+pattern rejected, etc.) the same way the semverRange PR-B
> block does.
<!-- /deepen-plan -->

- [ ] **3.3** — Run `pnpm test:integration` and confirm both files pass.

### Phase 4: Apply to PR #396 (sibling commit on this branch)

This phase ships a commit on this branch — independent of PR #396's merge
state — applying `pattern: "^https://"` to `composio_mcp_url`. The commit
references PR #396 in its body but does not stack on PR #396.

If PR #396 is still open when this branch is ready:
- Add a comment on PR #396 noting that this branch enables the schema
  field and the `^https://` enforcement can be added to `composio_mcp_url`
  in a follow-up commit on this branch (rather than re-opening PR #396).

If PR #396 has merged:
- Apply the change directly here on this branch.

- [ ] **4.1** — Decide based on PR #396 merge state at implementation time.

<!-- deepen-plan: codebase -->
> **Codebase:** This branch (`agent/feat/userconfig-pattern-enforcement`)
> was created off `main` BEFORE PR #396's tip commit. In the current
> working tree, `plugins/yellow-composio/.claude-plugin/plugin.json` does
> NOT have a `userConfig` field at all — the composio userConfig keys
> live on the sibling branch `agent/feat/yellow-composio-bundle-mcp`
> (PR #396, tip `eb8315a9`). Phase 4 cannot be executed in the current
> working tree as-is. Three implementation paths:
> 1. **Wait for PR #396 to merge to `main`**, then `gt sync` this branch
>    so the composio userConfig appears, then apply Phase 4 here.
> 2. **Stack this branch on top of `agent/feat/yellow-composio-bundle-mcp`**
>    via `gt move --onto agent/feat/yellow-composio-bundle-mcp` (rebase),
>    then apply Phase 4. Use this if PR #396 is blocked.
> 3. **Skip Phase 4 entirely** and ship Phases 1–3 as a "schema enablement
>    only" PR. Add the `^https://` pattern to composio in a follow-up PR
>    once #396 has merged.
> Phase 4.1 should be rewritten as a "decision gate" that picks one of
> these three paths. Recommended at planning time: option 1 (wait for #396
> to merge) — Phases 1–3 stand on their own as a schema-features patch.
<!-- /deepen-plan -->

- [ ] **4.2** — Apply the pattern to `plugins/yellow-composio/.claude-plugin/plugin.json`
  (`composio_mcp_url.pattern = "^https://"`).
- [ ] **4.3** — Re-run `pnpm validate:plugins` to confirm the pattern is
  accepted now that the schema supports it.

### Phase 5: Solutions doc + memory

- [ ] **5.1** — Write
  `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md`
  documenting:
  - The motivating cleartext-credential incident (PR #396 review).
  - The schema-vs-validator-script split that requires both Phase 1 and
    Phase 2 changes.
  - The empirical question of remote validator support for `pattern`
    (treat as locally-enforced; document if/when the remote behavior is
    confirmed).
  - The migration recipe for existing plugins to add `pattern` if they
    want input enforcement.
- [ ] **5.2** — Append a one-line entry to the
  `Plugin Manifest Validation` section of the auto-memory `MEMORY.md`
  index pointing to the new solutions doc.

### Phase 6: Changeset, validation, commit

- [ ] **6.1** — Run `pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`
  (the CI baseline gate).
- [ ] **6.2** — `pnpm changeset` — bump type `patch` for any plugins whose
  manifests change in Phase 4 (just `yellow-composio` if applied here).
  No changeset for the schema/script change alone (those are repo-root
  files, not versioned plugins).
- [ ] **6.3** — Create the commit(s):
  - One commit for Phase 1+2+3 (schema + validator + tests).
  - One commit for Phase 4 (composio pattern application) if applied here.
  - One commit for Phase 5 (solutions doc + memory).
  - One commit for Phase 6.2 (changeset).
- [ ] **6.4** — `gt submit --no-interactive`.

## Technical Specifications

### Files to Modify

- `schemas/plugin.schema.json` — add `pattern` to `userConfigEntry.properties`,
  add `if/then` rejecting `pattern` for number/boolean types.
- `scripts/validate-plugin.js` — add RULE 10 inside the existing
  `validateUserConfigEntries` helper (line ~808–850).
- `tests/integration/validate-plugin.test.ts` — new "PR-B: userConfig
  pattern" describe block with 5 cases.
- `tests/integration/example-files-schema.test.ts` — at least one positive
  fixture case for AJV-side pattern handling.
- `plugins/yellow-composio/.claude-plugin/plugin.json` — apply
  `pattern: "^https://"` to `composio_mcp_url` (Phase 4 — conditional).
- `MEMORY.md` (auto-memory) — index entry pointing to the new solutions doc.

### Files to Create

- `docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md`
  — solutions doc documenting the schema extension and the empirical
  question of remote validator support.
- `.changeset/userconfig-pattern-field.md` — changeset for the
  yellow-composio patch bump (only if Phase 4 is applied on this branch).

### Dependencies

None. The change uses only existing AJV (already in `package.json`) and
JavaScript's built-in `RegExp` constructor for compile validation. No new
package deps.

## Acceptance Criteria

1. **Schema accepts `pattern`** — `pnpm validate:schemas` passes after
   Phase 1; AJV reports `pattern` as a recognized property of
   `userConfigEntry`.
2. **Validator script rejects misuse** — RULE 10 fires with a clear error
   message for each of the 4 reject cases listed in 3.1 (non-string,
   wrong type, invalid regex, default-pattern mismatch).
3. **Existing plugins still pass** — `pnpm validate:plugins` exits 0 on
   the current state of `plugins/*` after the schema and validator
   changes (no plugin uses `pattern` yet, so all should remain valid).
4. **Composio cleartext-credential risk closed (Phase 4)** — when the
   pattern is applied, `pnpm validate:plugins` accepts the new manifest
   AND a synthetic test of `http://` for `composio_mcp_url` is rejected
   at install time (verified via fixture).
5. **CI baseline gate passes** — `pnpm validate:schemas && pnpm test:unit
   && pnpm lint && pnpm typecheck` exits 0.
6. **Solutions doc shipped** — new doc exists at the path in 5.1, indexed
   in `MEMORY.md`.

## Edge Cases

- **`pattern` is a non-RegExp string at runtime.** Some users may write an
  ECMAScript-incompatible regex (e.g., POSIX bracket expressions). RULE 10
  compiles via `new RegExp` so JavaScript's compile error is the source of
  truth — no need to reinvent.
- **`default` is undefined when `pattern` is set.** Allowed — the default-
  vs-pattern check only fires when both fields are present.
- **`pattern` on `directory` or `file` types.** Allowed by the schema's
  `if/then` rule (number/boolean are excluded; string/directory/file are
  the implicit allow-set). A plugin author setting
  `pattern: "^[A-Za-z0-9_-]+$"` on a `directory` userConfig entry to
  enforce safe slug names is a legitimate use.
- **Empty pattern string.** Rejected by `minLength: 1` in the schema and
  the `pattern.length === 0` guard in RULE 10.
- **Remote validator silently ignores `pattern`.** Documented in the
  solutions doc as an empirical risk. Local enforcement still helps —
  every PR runs the script. If users hit `claude doctor` errors that
  indicate the remote DOES enforce pattern with stricter rules, the
  remote behavior catches what local misses; if the remote silently
  ignores, local is still right.

<!-- deepen-plan: external -->
> **Research:** Anthropic's Claude Code remote validator behavior on
> `pattern` is empirically unverified — no public plugin in the
> observable ecosystem (as of 2026-05) has shipped a `pattern` userConfig
> field. The yellow-composio PR is the first known attempt. **Empirical
> test recipe** (run after Phase 1+2 land):
> 1. Push the schema + RULE 10 to a test branch with a fresh plugin that
>    sets `"pattern": "^https://"` on a userConfig key.
> 2. `pnpm validate:schemas` locally — must pass.
> 3. `/plugin marketplace add <test-plugin>` in a clean Claude Code
>    environment.
> 4. `claude doctor` — if it passes, the remote accepts `pattern` as a
>    field (silently or with enforcement, TBD).
> 5. Set a userConfig value violating the pattern. If Claude Code
>    surfaces an error → remote enforces. If accepts silently → remote
>    ignores. Either way, local enforcement catches it via RULE 10
>    before publish.
> Document the result in the solutions doc Phase 5.1 produces.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** `validate-plugin.js` does NOT AJV-load
> `schemas/plugin.schema.json` (the plan asserts this — confirmed). The
> explicit statement lives in the validate-plugin.js source comment at
> lines 856–864 (RULE 9 leading comment), not in the
> `userconfig-type-title-remote-validator-drift.md` solutions doc itself.
> The doc documents the symptom (remote-vs-local drift) and the
> resolution pattern (schema tightening + hand-rolled rule). When
> citing the architectural rationale, reference both:
> `scripts/validate-plugin.js:856–864` (the source-of-truth comment)
> AND the solutions doc (the symptom-and-pattern documentation).
<!-- /deepen-plan -->

- **Channels-scoped `userConfig` (`channels[].userConfig`)** — RULE 9's
  loop already covers this. RULE 10 must follow the exact same wiring
  (call `validateUserConfigEntries` for every channel, with a
  `pathPrefix` like `channels[i].userConfig` so error messages locate
  the offending key).

## Performance Considerations

- RULE 10 adds at most one `new RegExp(pattern)` compile per userConfig
  entry per plugin. Across the entire repo (currently 5 plugins with
  userConfig × ~3 keys average) that's ~15 regex compiles per CI run —
  negligible.
- AJV `if/then` blocks are O(N) on the keyword count; adding one more
  block to the existing 5 is irrelevant at the scale of plugin
  manifests (small, hand-edited files).

## Security Considerations

- The whole point of `pattern` is to add a defensive constraint. The
  immediate beneficiary is `composio_mcp_url` (PR #396 P1), but any
  future plugin handling user-supplied URLs, file paths, or
  vendor-prefixed tokens benefits.
- **Do not log the actual user-supplied value when reporting a pattern
  mismatch at install time.** RULE 10 reports the pattern and a hint
  (e.g., "value did not match pattern"), never the value itself —
  important when the value is `sensitive: true`. The default-vs-pattern
  check at validate-plugin time is safe to report verbatim because the
  default is a manifest-author-supplied test value, not user input.

<!-- deepen-plan: external -->
> **Research:** ReDoS (catastrophic backtracking) risk for plugin-author-
> supplied regex is **low** in this threat model. The compile path is
> one-shot at validation time, not a hot path; ReDoS requires both an
> adversarial regex AND an adversarial input length to manifest. The
> plugin-author trust boundary is the same as `npm install` — if a
> plugin author wrote a malicious regex, you have bigger problems.
> AJV itself does NOT guard pattern strings, nor do `semantic-release`,
> `lerna`, or `Renovate` in their config validators. **Optional
> defense-in-depth (NOT required for this PR):** wire the
> [`safe-regex`](https://www.npmjs.com/package/safe-regex) npm package
> into RULE 10 — emit a warning (not a hard failure) for high-star-height
> patterns. Defer until evidence of recurring ReDoS-shaped patterns.
> Reference: <https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS>
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** No in-repo "input-validation regex catalog" exists. The
> closest precedents:
> - `schemas/plugin.schema.json` itself uses `pattern` on `name`
>   (`^[a-z0-9-]+$` line 99), `version` (`^[0-9]+\.[0-9]+\.[0-9]+$`
>   line 106), and `relativeDir`/`relativeFile` (lines 60, 65) — these
>   are the in-repo idioms.
> - `plugins/yellow-ci/skills/ci-conventions/references/security-patterns.md`
>   documents shell-script *redaction* regexes for `sk-`, `ghp_`,
>   `github_pat_`, `AKIA`, `Bearer` — different use case (output
>   filtering vs input validation) but the token-shape examples are
>   directly transferable. The Phase 5.1 solutions doc should reuse
>   the schema's own patterns as the worked examples and reference
>   security-patterns.md for token-shape inspiration.
<!-- /deepen-plan -->

### Common pattern recipes (for the Phase 5.1 solutions doc)

<!-- deepen-plan: external -->
> **Research:** Production-grade regex shapes for common userConfig
> input types — drawn from npm `package.json` schema, GitHub Actions
> input validation, and Renovate config. Always anchor with `^` and
> `$`.
>
> **HTTPS-only URL** (the immediate composio case):
> `^https://[^\s/$.?#].[^\s]*$`
>
> **Vendor-prefixed API keys:**
> | Vendor | Pattern |
> |---|---|
> | OpenAI `sk-...` | `^sk-[A-Za-z0-9_-]{20,}$` |
> | Anthropic `sk-ant-...` | `^sk-ant-[A-Za-z0-9_-]{20,}$` |
> | Composio `cog_...` | `^cog_[A-Za-z0-9_-]{16,}$` |
> | GitHub PAT (classic) | `^ghp_[A-Za-z0-9]{36}$` |
> | GitHub PAT (fine-grained) | `^github_pat_[A-Za-z0-9_]{82}$` |
> | Generic | `^[A-Za-z0-9_\-]{20,}$` |
>
> **Filesystem path (anti-traversal):**
> `^[A-Za-z0-9_\-./]+$` combined with `not: { pattern: "\\.\\." }` to
> reject `..` segments without relying on lookaheads (some JSON Schema
> engines do not support lookaheads).
<!-- /deepen-plan -->

## Migration & Rollback

- **Migration:** None required for existing plugins. `pattern` is purely
  additive. Plugin authors can adopt it incrementally.
- **Rollback:** If the schema change causes unexpected issues, revert the
  Phase 1 and Phase 2 commits. `pattern` becomes unrecognized again
  (rejected by `additionalProperties: false`) but no plugin depends on
  it being recognized except yellow-composio (Phase 4) — which would
  also be rolled back as part of the same revert.

## References

- **PR #396 review thread (motivating case):** greptile P1 finding on
  `plugins/yellow-composio/.claude-plugin/plugin.json:20-25`. Comment ID
  `PRRT_kwDOQ3SUys6AIYpq`. Skipped during PR #396 resolve pass with the
  rationale "needs schema-level work."
- **Prior art (same pattern, type+title):**
  `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md`
  and
  `docs/brainstorms/2026-05-05-plugin-manifest-userconfig-validator-drift-brainstorm.md`.
- **Schema entry point:** `schemas/plugin.schema.json` →
  `definitions.userConfigEntry`.
- **Validator entry point:** `scripts/validate-plugin.js` →
  `validateUserConfigEntries` (RULE 9 region, lines 856–911 — function
  body at line 866; top-level call site line 903; channels call site
  line 908). RULE 10 goes in the same helper or as a peer in the same
  loop. **The "line ~856–878" range used elsewhere in this plan is
  wrong — see the codebase annotation under Phase 2.1.**

- **AJV / JSON Schema reference docs:**
  - <https://ajv.js.org/json-schema.html#if-then-else>
  - <https://json-schema.org/draft-07/json-schema-validation.html>
  - <https://github.com/ajv-validator/ajv-errors>
  - <https://www.npmjs.com/package/safe-regex> (optional ReDoS guard)
  - <https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS>
- **Test conventions:** `tests/integration/validate-plugin.test.ts`
  (PR-A block — fixture-based) and
  `tests/integration/example-files-schema.test.ts` (AJV-loaded fixtures).
- **Repo doctrine on schema-vs-script split:**
  `CLAUDE.md` (project section "High-Level Architecture" → "Schemas") and
  the userConfig brainstorm doc Decision 4 implementation note.
- **Auto-memory index:** `MEMORY.md` "Plugin Manifest Validation" section.
