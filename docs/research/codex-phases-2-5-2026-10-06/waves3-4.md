# Waves 3 and 4: bounded shared workflows

Status: complete after installed candidate acceptance and final regression. The
following records the pre-edit contract, followed by source and runtime
evidence.

## Wave 3: yellow-debt complexity scan

- Input: one repository-relative source file or directory, maximum 20 files and
  2,000 lines; reject traversal, absolute paths, escaping symlinks, secret
  files, binaries and generated/dependency trees.
- Output: inline scanner schema 2.0 using the existing complexity-scanner fields
  and scoring anchors. No audit report or todo writes. Measurements remain
  explicitly heuristic.
- Tools: Python 3 with directory descriptors/no-follow opens and a host process
  facility that accepts separate stdin. The executable snapshot program lives in
  the flat reference, takes structured JSON on stdin, validates before reading,
  bounds content and emits line-numbered source snapshots. It adds no script
  asset or dependency install. No jq/yq, Graphite, MCP or sibling plugin.
- Auth: none. Missing snapshot facilities returns error with zero inspected
  files. Windows-native hosts without the required facilities are unsupported.
- Mutations: none. Fixes, triage, state transitions and Linear sync unsupported.
- Host differences: resolve installed flat references relative to SKILL.md; run
  repository tooling in its authoritative environment.
- Proposed allowlist: `debt-complexity-scan`; omit Claude SessionStart hooks.
- Acceptance: installed source/reference reads, concrete bounded findings,
  missing-tool refusal, invalid-path refusal, unrelated nonactivation, unchanged
  fixture and installed bytes. Packaging tests are not model acceptance.

## Wave 4: yellow-research public repository Q&A

- Input: public `owner/repository` plus one question. Validate both components
  against `[A-Za-z0-9_.-]+` and reject dot-only components, URLs, traversal,
  private repositories and local-code upload requests.
- Output: inline answer, repository, evidence sources, indexing/recency limits,
  and `success|unavailable|auth-required|unsupported|error` status.
- Tools: discover DeepWiki repository Q&A/documentation tools and use their
  advertised schemas. The integration is the existing no-auth HTTP endpoint
  `https://mcp.deepwiki.com/mcp`; no credential-bearing sources.
- Auth: none expected. On unexpected authentication error, report auth-required
  and stop; never launch OAuth or inspect credentials.
- Mutations: none; no local-code uploads, research files or async paid tasks.
- Host differences: discover actual tool names. Codex needs a target-specific
  HTTP MCP map with only DeepWiki; never copy the full Claude server map.
- Proposed allowlist: `research-public-repo`; omit credential-status hook.
- Unsupported: private/unindexed repositories, absent tools, auth challenges,
  service errors and latest-revision claims without evidence.
- Acceptance: installed skill plus actual public DeepWiki response, missing-tool
  and auth-required controls, unrelated nonactivation, unchanged fixtures.
  Missing-auth output alone never establishes success.

## Integration ownership

The root owns emitter/schema changes, target enablement, generation and
installed runtime gates. This work adds shared source skills with flat markdown
references, affected plugin docs, dedicated packaging tests, fixture cases and
one changeset. It adds no scripts, assets, dependencies or credential mappings.

## Source verification on October 6, 2026

- WSL Node 22.22.0, pnpm 8.15.0 and existing Python 3.12.3 observed.
- `pnpm exec vitest run tests/integration/codex-waves-analysis-integration.test.ts`
  passed 19 tests. The suite runs the actual Python program extracted from the
  shipped reference: valid source/line-number reads, traversal/absolute paths,
  leading hyphens, control/shell characters, dot components, secret filenames,
  leaf/ancestor symlinks, file/line limits and synthetic credential redaction.
  Actual source bytes remain unchanged. Packaging tests resolve the exact flat
  reference from isolated outputs with no checkout siblings present. Two
  fixture-schema checks verify the one-repository input against current
  `ask_wiki_question` and advertised historical `ask_question` shapes; these are
  contract checks, not live invocation evidence.
- `pnpm validate:agents` passed with existing unrelated authoring advisories;
  `pnpm lint:plugins` passed with zero errors/warnings. Focused ESLint and
  Prettier checks passed. Both descriptions remain one physical line.
- This source verification does not replace root-owned installed discovery,
  model activation or actual public DeepWiki response acceptance.

## Observed DeepWiki contract drift

The coordinator's October 6 live initialize/tools-list probe reported DeepWiki
2.14.3 and advertised `ask_wiki_question`, `read_wiki_contents` and
`read_wiki_structure`. The historical `ask_question` name was absent despite
remaining in official documentation. The current Q&A schema accepts `repoName`
as a string or array and `question` as a string. The shared skill uses the
advertised current name, sends exactly one public repository as a string and
allows the historical alias only when advertised by the connected server. This
discovery receipt is not yet a successful live repository question.

## Final installed acceptance

The candidate gates passed before target enablement. Final generated-marketplace
receipts: analysis-final.json and research-final.json /
research-negative-final.json. All declared cases passed on Codex 0.157.0. The
integrated report distinguishes native operations, live DeepWiki responses and
fixtures; owner authentication metadata and tested project/plugin hashes remain
unchanged. Final support is limited to the selected allowlists.
