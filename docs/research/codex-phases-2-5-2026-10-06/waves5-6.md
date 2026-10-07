# Waves 5 and 6: bounded remote-agent and orchestration workflows

## Contract before implementation

Wave 5 selects `yellow-cursor`'s existing zero-network delegate dry run, exposed
as the shared `cursor-plan` skill. Wave 6 selects `yellow-codex`'s existing
local status/readiness procedure, exposed as `codex-readiness`. These are useful
preparatory workflows, not remote execution acceptance.

| Contract         | cursor-plan                                                                                                                          | codex-readiness                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inputs           | HTTPS repository URL and task text; optional ref, model, idempotency key and positive max-active                                     | Explicit request to check the CLI and authentication readiness on the canonical host                                                                   |
| Output           | Validated repository/ref/model/idempotency key; `dryRun:true`, `launched:false`, `authentication:unverified`; or stable failure code | CLI version or missing state; sanitized authentication classification; `modelRequest:false`; no inferred account/API access                            |
| Tools            | Terminal, Node >=22.22 <25, installed plugin `dist/cli.js`; structured JSON parser                                                   | Terminal, Codex CLI; bounded process execution and private capture of login status                                                                     |
| Auth             | None needed or probed for the dry run                                                                                                | Native `codex login status` only; API-key presence is configuration evidence, not server authentication proof                                          |
| Mutation         | No network, SDK loading, state write, launch, follow-up, cancellation, archival, PR or downloads                                     | No model request, nested `codex exec`, install, configuration edit, session/process listing or memory write                                            |
| Host differences | Resolve the runtime relative to the installed skill; WSL uses WSL Node; Windows uses native Node; no sibling plugin assumption       | Windows native CLI/login and WSL CLI/login are separate; verify only the requested canonical host                                                      |
| Unsupported      | Remote lifecycle operations, SDK setup, authenticated status, billable launch, implicit memory, recursive delegation                 | Review/rescue/analysis execution inside Codex, token-spend smoke, raw credential/config inspection, monitoring another host without explicit selection |

Required shared skill trees contain `SKILL.md` and flat Markdown references. The
Cursor runtime already ships in `dist/cli.js`; the generated skill may resolve
`../../../dist/cli.js` from `codex/skills/cursor-plan`. Source skills resolve
`../../dist/cli.js`. A missing runtime fails closed rather than reading the
checkout or a sibling installation. No runtime copy or new dependency is needed.
`codex-readiness` requires no plugin-local executable asset.

Proposed Codex allowlists are `yellow-cursor: [cursor-plan]` and
`yellow-codex: [codex-readiness]`. Targets remain disabled until the coordinator
has regenerated artifacts and verified installed-cache discovery, actual model
invocation, prerequisite failures and unrelated-task non-activation. Existing
Cursor exposure of `cursor-delegation` remains unchanged.

## Acceptance tasks

- Cursor success: validate a plan for `https://github.com/example/project`, task
  `Fix the failing unit test`, ref `main`, key `fixture-cursor-plan`. Expect
  dryRun true, launched false, the exact key and no inferred auth.
- Cursor missing auth: repeat with no credentials/SDK and a private empty HOME;
  the offline plan may succeed, but authentication stays unverified.
- Cursor invalid input: an HTTP URL or credential-bearing URL must return
  `CURSOR_INVALID_INPUT` without launch, state writes or network fallback.
- Cursor missing runtime/tool: remove the installed CLI or Node from the fixture
  environment and require a specific missing-prerequisite report, no checkout
  fallback, installation or delegation.
- Cursor unrelated task: arithmetic or unrelated local review must not load
  `cursor-plan` or invoke the Cursor runtime.
- Codex success: on the selected host report the real CLI version and native
  login-status classification. Keep modelRequest false even if logged in.
- Codex missing auth: use an isolated empty login context; report missing auth,
  never authenticated success. No login or model call is authorized by this
  task.
- Codex missing CLI: report missing CLI without installation or delegation.
- Codex unrelated task: arithmetic or unrelated local review must not load
  `codex-readiness` or execute Codex status commands.
- Recursion and budget: no case may spawn a model through `codex exec`, launch a
  cloud agent, retry a failed probe, read/write memory, or inspect credentials.

## Evidence status

Contract recorded before source edits. Deterministic packaged-runtime checks and
static validation are distinct from the coordinator's installed real-model
acceptance. Neither offline planning nor native login presence proves successful
authenticated remote execution.

## Final installed acceptance

The candidate gates passed before target enablement. Final generated-marketplace
receipts: remote-orchestration-final.json. All declared cases passed on Codex
0.157.0. The integrated report distinguishes native operations, live DeepWiki
responses and fixtures; owner authentication metadata and tested project/plugin
hashes remain unchanged. Final support is limited to the selected allowlists.

Additional final authentication-absence evidence: codex-absent-auth-native.json
executes the exact installed reference with an empty native profile, without
owner credential mounting. codex-missing-auth-final.json is a real installed
model case that consumes the sanitized missing-auth result and does not login,
retry or recurse.
