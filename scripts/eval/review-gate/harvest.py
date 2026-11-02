#!/usr/bin/env python3
"""List candidate review-gate eval cases. Read-only: never writes a case.

Sources:
- git (always): reverts and `fix:` commits on the main line whose subject or
  body references an earlier PR (`#123`, a /pull/123 URL, or "This reverts
  commit <sha>"). Each candidate names the referenced PR's squash-merge commit
  (head) and its first parent (base), and the lines the fix or revert touched
  on the old side, which are where the defect was.
- bots (--bots): GitHub review comments by Codex or Cursor Bugbot whose body
  carries a P1 badge, created in [--since, --until]. Fetched with read-only
  `gh api --method GET`; skipped with a note when gh is missing or fails.

Every fetched string (commit messages, comment bodies) is untrusted data: it
is truncated and stored in the output, and never executed, evaluated or used
to build a command. The user confirms each candidate before it becomes a case.

  harvest.py [--repo owner/name] [--ref origin/main] [--since YYYY-MM-DD]
             [--until YYYY-MM-DD] [--bots] [-o candidates.json]
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
EXCERPT = 500
MAX_HUNKS = 20

REVERT_RE = re.compile(r'^(?:Revert "|revert(?:\([^)]*\))?!?:)', re.I)
FIX_RE = re.compile(r"^fix(?:\([^)]*\))?!?:", re.I)
OWN_PR_RE = re.compile(r"\(#(\d+)\)\s*$")
PR_REF_RE = re.compile(r"(?<![\w/&])#(\d+)\b|/pull/(\d+)\b")
REVERTS_RE = re.compile(r"\bThis reverts commit ([0-9a-f]{7,40})\b")
HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@")
BOT_LOGINS = ("chatgpt-codex-connector[bot]", "cursor[bot]")
P1_BADGE_RE = re.compile(r"!\[P1 Badge\]|img\.shields\.io/badge/P1[-_ ]", re.I)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")


def excerpt(text, limit=EXCERPT):
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit] + "..."


def git(repo_dir, *args):
    return subprocess.run(["git", *args], cwd=repo_dir, capture_output=True, text=True,
                          check=True).stdout


# --- git source ---------------------------------------------------------------

def parse_log(text):
    """Commits from `git log --format=%H%x1f%P%x1f%s%x1f%b%x1e`, newest first."""
    commits = []
    for record in text.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        sha, parents, subject, body = (record.split("\x1f") + ["", "", ""])[:4]
        commits.append({"sha": sha.strip(), "parents": parents.split(), "subject": subject,
                        "body": body.strip()})
    return commits


def own_pr(subject):
    m = OWN_PR_RE.search(subject)
    return int(m.group(1)) if m else None


def referenced_prs(commit):
    """PR numbers a commit names, minus its own squash-merge `(#N)` suffix."""
    subject = OWN_PR_RE.sub("", commit["subject"])
    found = []
    for m in PR_REF_RE.finditer(subject + "\n" + commit["body"]):
        n = int(m.group(1) or m.group(2))
        if n not in found and n != own_pr(commit["subject"]):
            found.append(n)
    return found


def old_side_hunks(diff):
    """[{file, line}] for each hunk's first old-side line: where the defect was."""
    hunks, path = [], None
    for line in diff.splitlines():
        if line.startswith("--- "):
            path = line[6:] if line.startswith("--- a/") else None
        m = HUNK_RE.match(line)
        if m and path and len(hunks) < MAX_HUNKS:
            hunks.append({"file": path, "line": max(1, int(m.group(1)))})
    return hunks


def git_candidates(commits, repo, show):
    """Candidates from parsed commits. `show(sha)` returns a commit's -U0 diff."""
    by_pr = {}
    by_sha = {}
    for c in commits:
        by_sha[c["sha"]] = c
        n = own_pr(c["subject"])
        if n is not None and n not in by_pr:
            by_pr[n] = c
    out = []
    for c in commits:
        revert = bool(REVERT_RE.match(c["subject"]))
        if not revert and not FIX_RE.match(c["subject"]):
            continue
        prs = referenced_prs(c)
        m = REVERTS_RE.search(c["body"])
        reverted = m.group(1) if m else None
        if reverted:
            target = next((x for sha, x in by_sha.items() if sha.startswith(reverted)), None)
            if target and own_pr(target["subject"]) and own_pr(target["subject"]) not in prs:
                prs.insert(0, own_pr(target["subject"]))
        if not prs and not reverted:
            continue
        targets = []
        for n in prs:
            merged = by_pr.get(n)
            targets.append({
                "pr": n,
                "pr_url": "https://github.com/%s/pull/%d" % (repo, n) if repo else None,
                "head": merged["sha"] if merged else None,
                "base": merged["parents"][0] if merged and merged["parents"] else None,
                "note": None if merged else "PR not found on this ref; look up its SHAs by hand",
            })
        out.append({
            "kind": "revert" if revert else "fix",
            "commit": c["sha"],
            "commit_url": "https://github.com/%s/commit/%s" % (repo, c["sha"]) if repo else None,
            "own_pr": own_pr(c["subject"]),
            "reverted_commit": reverted,
            "targets": targets,
            "hunks": old_side_hunks(show(c["sha"])),
            "subject": excerpt(c["subject"], 200),
            "body_excerpt": excerpt(c["body"]),
        })
    return out


def harvest_git(repo_dir, ref, repo, since=None, until=None):
    args = ["log", "--first-parent", "--format=%H%x1f%P%x1f%s%x1f%b%x1e"]
    args += ["--since=%s" % since] if since else []
    args += ["--until=%s" % until] if until else []
    commits = parse_log(git(repo_dir, *args, ref, "--"))
    show = lambda sha: git(repo_dir, "show", "--no-color", "--no-ext-diff", "--format=", "-U0", sha)
    return git_candidates(commits, repo, show)


# --- bot source -----------------------------------------------------------------

def bot_candidates(comments, pulls, since=None, until=None, logins=BOT_LOGINS, badge=P1_BADGE_RE):
    """Candidates from review comments (the /pulls/comments shape) and
    {number: pull} details. Dates compare on the YYYY-MM-DD prefix."""
    out = []
    for c in comments:
        if not isinstance(c, dict) or (c.get("user") or {}).get("login") not in logins:
            continue
        if not badge.search(c.get("body") or ""):
            continue
        day = str(c.get("created_at") or "")[:10]
        if (since and day < since) or (until and day > until):
            continue
        m = re.search(r"/pulls/(\d+)$", str(c.get("pull_request_url") or ""))
        n = int(m.group(1)) if m else None
        pull = pulls.get(n) or {}
        out.append({
            "kind": "bot-p1",
            "bot": c["user"]["login"],
            "pr": n,
            "pr_url": pull.get("html_url"),
            "comment_url": c.get("html_url"),
            "created_at": c.get("created_at"),
            "file": c.get("path"),
            "line": c.get("line") or c.get("original_line"),
            # The head the bot reviewed; the PR's later head may have fixed it.
            "head": c.get("original_commit_id") or c.get("commit_id"),
            "base": (pull.get("base") or {}).get("sha"),
            "pr_head": (pull.get("head") or {}).get("sha"),
            "merged": bool(pull.get("merged_at")),
            "excerpt": excerpt(c.get("body")),
        })
    return out


def gh_get(path, params=None):
    """One read-only GitHub API GET via gh. Arguments are built from validated
    values only; nothing fetched is ever passed back into a command."""
    url = path + ("?" + urllib.parse.urlencode(params) if params else "")
    res = subprocess.run(["gh", "api", "--method", "GET", url], capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise RuntimeError("gh api %s failed: %s" % (path, excerpt(res.stderr, 200)))
    return json.loads(res.stdout)


def harvest_bots(repo, since, until, max_pages=20, get=gh_get):
    comments = []
    for page in range(1, max_pages + 1):
        params = {"sort": "created", "direction": "asc", "per_page": 100, "page": page}
        if since:
            params["since"] = since + "T00:00:00Z"
        batch = get("repos/%s/pulls/comments" % repo, params)
        comments += batch
        if len(batch) < 100:
            break
    pulls = {}
    for c in bot_candidates(comments, {}, since, until):
        if c["pr"] is not None and c["pr"] not in pulls:
            pulls[c["pr"]] = get("repos/%s/pulls/%d" % (repo, c["pr"]))
    return bot_candidates(comments, pulls, since, until)


# --- main -------------------------------------------------------------------------

def origin_repo(repo_dir):
    try:
        url = git(repo_dir, "remote", "get-url", "origin").strip()
    except subprocess.CalledProcessError:
        return None
    m = re.search(r"[:/]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$", url)
    return "%s/%s" % m.groups() if m else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo-dir", default=".", help="checkout to read history from")
    ap.add_argument("--repo", help="owner/name (default: the checkout's origin)")
    ap.add_argument("--ref", default="origin/main")
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--bots", action="store_true", help="also read Codex/Bugbot P1 review comments via gh")
    ap.add_argument("-o", "--output", help="write here instead of stdout (never under cases/ or controls/)")
    a = ap.parse_args(argv)
    repo_dir = os.path.abspath(a.repo_dir)
    repo = a.repo or origin_repo(repo_dir)
    for value, rx, name in ((a.since, DATE_RE, "--since"), (a.until, DATE_RE, "--until"),
                            (repo, REPO_RE, "--repo"), (a.ref, REF_RE, "--ref")):
        if value is not None and not rx.match(value):
            sys.exit("harvest: bad %s value %r" % (name, value))
    if a.output:
        out_path = os.path.realpath(a.output)
        for folder in ("cases", "controls"):
            if out_path.startswith(os.path.realpath(os.path.join(HERE, folder)) + os.sep):
                sys.exit("harvest: candidates are not cases; write them outside %s/" % folder)
    result = {"generated_by": "scripts/eval/review-gate/harvest.py", "repo": repo, "ref": a.ref,
              "since": a.since, "until": a.until,
              "note": "Candidates only. Text fields are untrusted excerpts. A candidate becomes a "
                      "case only after the user confirms it.",
              "sources": {}, "candidates": []}
    result["candidates"] += harvest_git(repo_dir, a.ref, repo, a.since, a.until)
    result["sources"]["git"] = "ok"
    if not a.bots:
        result["sources"]["bots"] = "off (pass --bots)"
    elif not repo:
        result["sources"]["bots"] = "skipped: no owner/name; pass --repo"
    elif not shutil.which("gh"):
        result["sources"]["bots"] = "skipped: gh not found"
    else:
        try:
            result["candidates"] += harvest_bots(repo, a.since, a.until)
            result["sources"]["bots"] = "ok"
        except (RuntimeError, ValueError, TypeError) as err:
            result["sources"]["bots"] = "skipped: %s" % err
    text = json.dumps(result, indent=1) + "\n"
    if a.output:
        with open(a.output, "w", encoding="utf-8") as handle:
            handle.write(text)
        print("harvest: %d candidates -> %s" % (len(result["candidates"]), a.output), file=sys.stderr)
    else:
        sys.stdout.write(text)
    if result["sources"]["bots"].startswith("skipped"):
        print("harvest: bot source %s" % result["sources"]["bots"], file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
