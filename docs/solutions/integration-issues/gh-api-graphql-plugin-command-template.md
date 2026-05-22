---
title: 'Six required elements for gh api graphql calls in plugin commands'
date: 2026-05-21
category: integration-issues
track: knowledge
problem: gh api graphql calls in plugin commands drift toward silent failures, fork-PR token surprises, and SC2016 noise without a standard template
tags: [gh-cli, github-actions, graphql, plugin-authoring, fork-pr, jq, shellcheck]
components: [yellow-core, gh-cli]
---

## Context

Several plugin commands and CI workflows in this repo invoke
`gh api graphql` for read queries against GitHub — closing-issue traversal,
merge-queue status, draft-PR detection, label inspection. Across reviews of
five separate PRs (#305, the recent `validate-solutions-advisory` job, and
others) the same six failure modes have shown up:

1. The script breaks when run on a fork PR because the token is read-only
   and the script doesn't tolerate that gracefully.
2. Variables get interpolated into the GraphQL query string via bash
   concatenation, leaking shell metacharacters into the GraphQL parser.
3. Server-side filtering with `--jq` is skipped, the entire response is
   piped to a separate jq invocation, and the failure path loses the
   underlying exit code.
4. ShellCheck flags `$owner`/`$repo` inside the single-quoted GraphQL
   string as SC2016 (likely unexpanded variable), the linter is silenced
   with `# shellcheck disable=SC2016` on the same line as the string, and
   the disable then applies to the wrong region.
5. `gh` exit code is captured only on one of the two `gh` calls in the
   script (typically the `gh api graphql` but not `gh repo view`), and
   stderr is dropped.
6. `.data.repository == null` is not guarded in jq — a token without
   visibility into the target repo returns a null `repository` field, and
   jq access on a null produces a confusing downstream error instead of a
   clean soft-skip.

Authors keep re-deriving the safe pattern from scratch when adding a new
`gh api graphql` call. This doc is the canonical reference; copy it.

## Guidance

A safe `gh api graphql` call in a plugin command or workflow has **six**
elements. All six must co-occur — dropping any one re-introduces one of
the failure modes above.

### 1. Soft-skip gate

Bracket the call with two checks so missing `gh` or unauthenticated tokens
degrade to a notice, not a failure. This is mandatory in any path that
runs on fork PRs (`GITHUB_TOKEN` is forced read-only there) or on
contributor machines without `gh auth login`.

```bash
if ! command -v gh >/dev/null 2>&1; then
  echo "::notice::gh CLI not available; skipping"
  exit 0
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "::notice::gh CLI not authenticated; skipping"
  exit 0
fi
```

### 2. `-f` flags for variables — never string interpolation

GraphQL variables go through `-f key=value` (string) or `-F key=value`
(numeric/boolean), which `gh api graphql` forwards as typed JSON variables
the GraphQL server validates. Never concatenate a shell variable into the
query body — at best it's a quoting nightmare, at worst it's an
injection.

```bash
# WRONG — shell vars leak into the GraphQL parser
gh api graphql -f query="query{repository(owner:\"$OWNER\",name:\"$REPO\"){...}}"

# RIGHT — typed variables, server-side substitution
gh api graphql \
  -f query='query($owner:String!,$repo:String!,$pr:Int!){...}' \
  -f owner="$OWNER" \
  -f repo="$REPO" \
  -F pr="$PR_NUMBER"
```

Use `-F` (capital) for numeric/boolean values. Use `-f` (lowercase) for
strings. Mixing them silently coerces to string and the schema can
reject it.

### 3. `--jq` for server-side filtering

`gh api --jq '<expr>'` filters the response on the gh side and preserves
the underlying HTTP exit code. Piping into a separate `jq` invocation
masks the `gh` exit code because `set -o pipefail` is often not set in
the calling context.

Prefer:

```bash
COUNT="$(gh api graphql -f query='...' --jq '.data.repository.pullRequest.commits.totalCount')"
```

Over:

```bash
RAW="$(gh api graphql -f query='...')"
COUNT="$(printf '%s' "$RAW" | jq -r '.data.repository.pullRequest.commits.totalCount')"  # gh exit lost
```

When the post-processing is complex enough to warrant a separate jq
invocation, capture `gh`'s exit code explicitly (see element 5).

### 4. SC2016 disable on a separate line

ShellCheck's SC2016 warns when a single-quoted string contains a `$VAR`
that looks like a shell variable but won't be expanded. GraphQL variables
(`$owner`, `$repo`, `$pr`) inside the query string trigger this. The fix
is to disable SC2016 — but place the disable directive on a **separate
line above** the query, with an explanation comment. Inline disables on
the same line as the string trip SC1073 (parser confusion).

```bash
# shellcheck disable=SC2016
# SC2016: the `$owner`/`$repo`/`$pr` tokens are GraphQL variable
# references resolved server-side from `-f` flags, NOT shell variables
# we want expanded locally.
GQL_QUERY='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){title}}}'
```

### 5. Symmetric exit-code capture across all `gh` calls

If the script invokes both `gh repo view` AND `gh api graphql`, capture
the exit code and stderr of **both**. Dropping one means a malformed repo
context produces a confusing GraphQL error instead of the precise origin
error.

```bash
REPO_INFO="$(gh repo view --json owner,name 2>&1)"
GH_RC=$?
if [ $GH_RC -ne 0 ]; then
  echo "::notice::gh repo view failed (rc=$GH_RC): $REPO_INFO"
  exit 0
fi

API_OUTPUT="$(gh api graphql -f query='...' 2>&1)"
API_RC=$?
if [ $API_RC -ne 0 ]; then
  echo "::notice::gh api graphql failed (rc=$API_RC): $API_OUTPUT"
  exit 0
fi
```

### 6. jq null-repository guard

GitHub's GraphQL API returns `.data.repository = null` when the token
lacks visibility into the target repo (e.g., a fork PR's
`GITHUB_TOKEN` querying a private base, a token without the right
scopes, or the repo was deleted between trigger and check). Without an
explicit jq guard, downstream field access on the null object produces a
confusing error rather than a clean soft-skip.

```bash
RESULT="$(printf '%s' "$API_OUTPUT" | jq -r '
  if .data.repository == null then
    "REPO_NULL"
  elif .data.repository.pullRequest == null then
    "PR_NULL"
  else
    .data.repository.pullRequest.title
  end
')"

case "$RESULT" in
  REPO_NULL)
    echo "::notice::GraphQL returned null repository (token scope or visibility); skipping"
    exit 0
    ;;
  PR_NULL)
    echo "::notice::PR not visible via GraphQL; skipping"
    exit 0
    ;;
esac
```

## Why This Matters

Each element addresses a distinct failure surface, and the failures
silently degrade rather than fail-loud:

- Missing element 1 → fork PR breaks CI for the contributor with no
  actionable error.
- Missing element 2 → quoting bugs that only surface on values
  containing apostrophes, quotes, or backticks.
- Missing element 3 → swallowed HTTP errors; the script proceeds with
  empty data and writes nonsense.
- Missing element 4 → ShellCheck CI noise that gets globally suppressed,
  hiding real bugs.
- Missing element 5 → asymmetric error reporting; one `gh` call's
  failure looks like the other's.
- Missing element 6 → cryptic jq error instead of "your token can't see
  this repo."

The "repository visibility" gap (element 6) is particularly load-bearing
for advisory CI jobs that run on fork PRs — the
`validate-solutions-advisory` job and the merge-queue detection in PR
#305 both hit this when a fork token returns a null repository field.

## When to Apply

Use this template every time you:

- Add a new `gh api graphql` call to a plugin command markdown body
- Add a new GitHub Actions step that runs `gh api graphql`
- Modify an existing script that calls `gh api graphql` and you notice
  any of the six elements missing

Do NOT use this template for `gh api repos/...` REST calls — they have
their own failure modes (rate-limit headers, pagination) that aren't
addressed here.

## Examples

This pattern is in production use in:

- `.github/workflows/validate-schemas.yml` —
  `validate-solutions-advisory` job (advisory; full 6-element
  implementation for the closing-issues label check; canonical live
  reference for the `closingIssuesReferences` query shape)
- `plugins/yellow-core/commands/workflows/compound.md` — `gh pr view`
  call in `--in-pr` mode (REST-style, doesn't need the full template but
  borrows elements 1, 5)

## References

- [GitHub Automatic Token Authentication](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)
  — fork PR token scope behavior (element 1, element 6)
- [GitHub Community Discussion #24706](https://github.com/orgs/community/discussions/24706)
  — `closingIssuesReferences` semantics + `IssuesConnection` nullable
- [gh manual: api command](https://cli.github.com/manual/gh_api)
  — `-f` / `-F` / `--jq` flag semantics (elements 2, 3)
- ShellCheck wiki: [SC2016](https://www.shellcheck.net/wiki/SC2016) and
  [SC1073](https://www.shellcheck.net/wiki/SC1073) (element 4)
