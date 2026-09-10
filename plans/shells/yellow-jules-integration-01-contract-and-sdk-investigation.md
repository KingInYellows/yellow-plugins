---
spec: plans/specs/yellow-jules-integration.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62]
depends_on: []
---

# Plan: Contract, Capability Matrix, and Isolated SDK Investigation (PR1)

## Context

Before any runtime code exists, the integration needs a committed contract and
hard evidence about the vendor SDK. Revision 2 of the integration plan lives
outside the repository today; this shell brings its load-bearing sections into
`docs/yellow-jules/`, defines the versioned provider-CLI contract every later
shell implements, and runs a zero-spend investigation of the published
`@google/jules-sdk@0.2.0` artifact against a local fake HTTP server. Its
verdict on the four transport criteria (clean-install load, explicit flag
serialization, disable-able retries, isolatable storage) decides whether PR2
ships an SDK adapter or a REST adapter, and which module strategy the plugin
build uses.

Nothing here touches the marketplace: no plugin directory, no catalog entry,
no provider-router or consumer change, no live Jules session.

## Produces

- Accepted integration plan document, reconciled to the current checkout, with
  the explicit "why Jules" motivation statement
- Versioned provider-CLI contract v1 (subcommands, JSON shapes, error codes,
  exit codes, redaction rules)
- Vendor capability matrix with per-row evidence labels
- Illustrative request/response fixtures, marked illustrative
- SDK investigation record: registry metadata, tarball integrity and local
  hash, actual exports and types, clean-install result with lifecycle scripts
  disabled and recorded Node version, ESM load result, captured
  create/reply/approve request bodies, retry-configuration behavior, storage
  side effects, remaining unknowns
- Transport verdict (SDK adapter or REST adapter) and module-strategy verdict
  (plugin-local ESM or CJS with dynamic import) recorded in the contract doc
- Autonomy boundaries and acceptance criteria section
- Reusable throwaway harness notes for the fake HTTP server, to be productized
  by the next shell

## Consumes

- Brainstorm doc and spec decisions — from existing codebase
- `plugins/yellow-cursor/` adapter, resolver, and CLI contract as the pattern
  reference — from existing codebase
- Registry result (`npm view` shows `latest: 0.2.0`), recorded in the
  brainstorm doc as registry evidence only — from existing codebase

## Covers Spec Requirements

- R3 (partial: investigation-verdict)
- R6 (partial: strategy-selection)
- R49 (partial: evidence-labels)
- R54
- R55
- R56
- R57

## Implementation Steps (High-Level)

1. **Reconcile the plan document** — bring revision 2's sections 5, 6, 14, 17
   into the repository, reconciled against the checkout, with the motivation
   statement (spec R56) and the enumeration-site checklist for PR2 sourced
   from spec R23/R24 and R25 (not the brainstorm's provisional line numbers).
2. **Write the provider-CLI contract v1** — subcommands, argument shapes, JSON
   output envelope, error-code table with retryable and recovery fields, exit
   codes, redaction guarantees, unsupported-capability responses.
3. **Build the capability matrix** — one row per vendor behavior the runtime
   relies on, each labeled documented, source-inspected, packed-artifact-tested,
   or live-observed, with citations.
4. **Run the isolated investigation** — fetch registry metadata and tarball,
   record integrity and hash, install into a temporary data directory with
   scripts disabled and no monorepo modules, load under the candidate module
   strategy, capture requests against a loopback fake server with dummy
   credentials, exercise retry configuration and storage isolation.
5. **Record the verdicts** — transport and module strategy decisions with
   evidence, plus explicit remaining unknowns.
6. **Validate and package** — run the docs-affecting validators, add a
   changeset if any plugin file changed (expected: none), confirm the PR1
   exclusion list holds, route the branch through the active stack provider.

## Open Questions

- Module strategy is decided by this shell's evidence, not in advance (spec
  Open Question 1).
- Whether the pinned SDK exposes generated-file artifacts is answered by the
  capability matrix here (spec Open Question 3).
- Exact Jules API-key environment variable name: confirm from vendor auth
  docs and record in the contract.
