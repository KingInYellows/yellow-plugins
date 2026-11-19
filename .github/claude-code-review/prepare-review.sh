#!/usr/bin/env bash
# Builds the Claude Code Review inputs from the checkout (CLAUDE-371). The
# workflow's gate step installs this script from the default branch, like the
# Bash guard, so a PR cannot change what it checks, and runs it from the root
# of the checkout, which is GitHub's merge of the PR head into its base.
#
# It does three things, in this order:
# 1. Lists the paths the PR adds or changes. For a stacked child PR, whose
#    base is its parent's branch, that includes the paths the parent PRs add:
#    they are in the checkout too, and the parent's own review may be skipped
#    (CLAUDE-373).
# 2. Fails (exit 1) when one of those paths, or a directory above it, is a
#    symlink that leaves the checkout or enters .git. Read deny rules check
#    symlink targets, but refuse these links anyway. Only changed paths are
#    checked: one such link already on the default branch would otherwise fail
#    every PR's review (CLAUDE-365).
# 3. Writes the whole diff to .claude-code-review/pr.diff for the agent to read
#    in pages, and the number of changed files it cannot review (no patch from
#    GitHub, binary, or past GitHub's 3000-file list) to
#    .claude-code-review/not-reviewed-count. Those files are named in a job
#    warning, and the review summary says how many there were.
#
# Environment: GH_TOKEN, REPO, PR_NUMBER, DEFAULT_BRANCH, BASE_REF (the PR's
# base branch) and CHANGED_COUNT (the PR's changed_files). The caller has
# already checked that HEAD^2 is the PR head and that .claude-code-review is a
# fresh directory.
set -euo pipefail

: "${REPO:?}" "${PR_NUMBER:?}" "${DEFAULT_BRANCH:?}" "${BASE_REF:?}" "${CHANGED_COUNT:?}"
out=.claude-code-review
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# gh api with three tries, so one transient API error does not fail the job.
# A 404, or a 406 for a diff too large to return, is not retried.
gh_api() {
  local try
  for try in 1 2 3; do
    if gh api "$@" > "$tmp/gh-api.out" 2> "$tmp/gh-api.err"; then
      cat "$tmp/gh-api.out"
      return 0
    fi
    if grep -qE 'HTTP 40[46]' "$tmp/gh-api.err"; then
      break
    fi
    if [ "$try" -lt 3 ]; then sleep $((try * 5)); fi
  done
  cat "$tmp/gh-api.err" >&2
  return 1
}

# 1. Changed paths, from fixed commits so a push during this step cannot
# change the list, and with no 3000-file cap. NUL-separated, so a filename
# holding a newline stays one entry. HEAD^1 is the base branch tip.
git diff --no-renames --name-only -z --diff-filter=d HEAD^1 HEAD \
  > "$tmp/changed-paths.bin"
if [ "$BASE_REF" != "$DEFAULT_BRANCH" ]; then
  # A stacked child PR: HEAD^1 is the parent branch, so also list what the
  # checkout changes against the default branch. Its tip, not the merge base:
  # the checkout has depth 2, and the tip only adds paths the default branch
  # changed since the stack forked, which are in the checkout as well. The
  # token goes in through the environment for this one command, never into
  # .git/config, which the review agent could read.
  auth=$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)
  GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=http.https://github.com/.extraheader \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth" \
    git fetch --quiet --no-tags --depth=1 origin \
    "+refs/heads/$DEFAULT_BRANCH:refs/claude-code-review/default"
  git diff --no-renames --name-only -z --diff-filter=d \
    refs/claude-code-review/default HEAD >> "$tmp/changed-paths.bin"
fi

# 2. Symlink scan.
python3 -I - "$tmp/changed-paths.bin" <<'PY'
import os, sys
root = os.path.realpath(".")
git = os.path.join(root, ".git")
with open(sys.argv[1], "rb") as fh:
    paths = {p.decode("utf-8", "surrogateescape") for p in fh.read().split(b"\0") if p}
bad = set()
for rel in paths:
    parts = rel.split("/")
    for i in range(1, len(parts) + 1):
        p = os.path.join(root, *parts[:i])
        if os.path.islink(p):
            t = os.path.realpath(p)
            if os.path.commonpath([root, t]) != root or os.path.commonpath([git, t]) == git:
                bad.add("/".join(parts[:i]))
for b in sorted(bad):
    print(f"::error::symlink leaves the checkout: {b!r}")
sys.exit(1 if bad else 0)
PY

# 3. The diff file. gh pr diff output is cut off in the tool result on a large
# PR, and the Bash guard allows no pipe or redirect to page it. When GitHub
# refuses the diff as too large, build it from each file's patch.
if gh_api -H 'Accept: application/vnd.github.diff' \
    "repos/$REPO/pulls/$PR_NUMBER" > "$out/pr.diff"; then
  source=full
else
  echo "::notice::the full diff is too large for one request; building it per file"
  gh_api --paginate "repos/$REPO/pulls/$PR_NUMBER/files" --jq '.[]' \
    > "$tmp/files.jsonl"
  source=files
fi

# Writes the per-file diff when needed, then counts and names the files the
# agent cannot review. Names are printed with repr(), so a newline or "::" in
# a filename cannot start another workflow command.
python3 -I - "$source" "$tmp/files.jsonl" "$out/pr.diff" \
  "$out/not-reviewed-count" "$CHANGED_COUNT" <<'PY'
import json, re, sys
source, files, diff, count_file, changed = sys.argv[1:6]
skipped = []
if source == "files":
    with open(files, encoding="utf-8") as fh, open(diff, "w", encoding="utf-8") as out:
        for line in fh:
            if not line.strip():
                continue
            f = json.loads(line)
            name = f["filename"]
            out.write(f"diff --git a/{f.get('previous_filename') or name} b/{name}\n")
            out.write(f"status: {f.get('status')}\n")
            if f.get("patch"):
                out.write(f["patch"] + "\n")
            else:
                out.write("(no patch from GitHub: binary or too large; not reviewed)\n")
                skipped.append(name)
        over = int(changed) - 3000
        if over > 0:
            out.write(f"({over} more changed files: GitHub lists only 3000; not reviewed)\n")
else:
    over = 0
    current = None
    with open(diff, encoding="utf-8", errors="surrogateescape") as fh:
        for line in fh:
            if line.startswith("diff --git "):
                # git quotes a name holding special characters: "b/odd\tname".
                m = re.search(r' "?b/(.*?)"?$', line.rstrip("\n"))
                current = m.group(1) if m else line[11:].rstrip("\n")
            elif current and (line.startswith("Binary files ") or line.startswith("GIT binary patch")):
                skipped.append(current)
                current = None
total = len(skipped) + max(over, 0)
with open(count_file, "w") as fh:
    fh.write(f"{total}\n")
if total:
    names = ", ".join(repr(n) for n in skipped)
    extra = f" and {over} more past GitHub's 3000-file list" if over > 0 else ""
    print(f"::warning::{total} changed file(s) not reviewed (binary or no patch from GitHub): {names}{extra}")
PY
