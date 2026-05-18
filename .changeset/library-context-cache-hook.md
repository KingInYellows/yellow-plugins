---
'yellow-research': minor
---

feat(yellow-research): SessionStart context7 cache pre-warm hook

Adds an asynchronous SessionStart pre-warm of the context7 library docs
cache so common library queries don't burn the anonymous global pool.
Merged into the existing `hooks/write-credential-status.sh` (background
subshell, fire-and-forget) so SessionStart cost stays under the ~3s UX
budget — yellow-morph `prewarm-morph.sh` precedent.

**Cache shape** at `${CLAUDE_PLUGIN_DATA}/context7-cache-<md5_of_project_dir>.json`:

- `tier1` — `library-name → {library_id, fetched_at}` (24h TTL, capped at
  top 5 libs from project lockfiles)
- `tier2` — `library-id|topic → {docs, fetched_at}` (4h TTL, max 50;
  reserved for future lazy population on cache miss)
- `lockfile_fingerprint` — mtimes of all detected lockfiles for
  invalidation tracking
- `schema: "1"` for forward-compatibility

**Lockfile support:** package-lock.json, pnpm-lock.yaml, yarn.lock,
Cargo.lock, go.sum, requirements.txt (+ package.json fallback).

**Auth:** uses `CONTEXT7_API_KEY` as `Authorization: Bearer` when set;
anonymous otherwise. Anonymous quota is 200 req/hr global pool (per live
`ratelimit-limit` header on context7's HTTP API, 2026-05-17).

**HTTP API** verified live: `GET https://context7.com/api/v1/search?query=<name>`
returns `{results: [{id: "/owner/repo", ...}]}`. The MCP server (used by
agents at runtime) is unaffected — the hook hits the HTTP API directly
since shell hooks can't invoke MCP tools.

**Safety:** atomic-rename writes (yellow-ci precedent), idempotent re-source
guard, no `set -e`, fire-and-forget background subshell so hook errors
never block session start. Skips cleanly when curl/jq missing,
CLAUDE_PLUGIN_DATA unset, no lockfile, or cache fresh (< 24h).

14 bats tests cover: no-lockfile skip, CLAUDE_PLUGIN_DATA-unset skip,
anonymous warm, authenticated warm, fresh-cache skip, corrupted-cache
rewrite, lockfile scanning for package.json + Cargo.lock, pre-warm cap,
atomic write, idempotent re-source.
