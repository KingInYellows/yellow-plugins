#!/usr/bin/env python3
"""List candidate review-gate eval cases. Read-only: never writes a case.

Sources:
- git (always): reverts and `fix:` commits on the main line, committed in
  [--since, --until] (UTC days), whose subject or body references an earlier
  PR (`#123`, a /pull/123 URL, or "This reverts commit <sha>"). Each candidate
  names the referenced PR's squash-merge commit (head) and its first parent
  (base). `hunks` are the old-side lines the fix or revert touched, relative
  to the fix's parent (`hunks_relative_to`); each target's `hunks_at_head`
  maps them onto that target's head, which is where the defect was.
- bots (--bots): GitHub review comments by Codex or Cursor Bugbot whose body
  carries a P1 badge, created in [--since, --until]. Fetched with read-only
  `gh api --method GET`; skipped with a note when gh is missing or fails.
  With --reviewed, each one says whether a recorded review of the same PR at
  the same head came before it (`review: "missed"`), and --misses-only keeps
  just those.
- ci (--ci): GitHub Actions push runs on the default branch that failed in
  [--since, --until] after the same workflow's previous run passed. Each is
  tied to the commit it ran on, that commit's squash-merged PR, and the lines
  the PR changed at its head.

Every fetched string (commit messages, comment bodies, workflow and job names)
is untrusted data: it is truncated and stored in the output, and never
executed, evaluated or used to build a command. The user confirms each
candidate before it becomes a case.

  harvest.py [--repo owner/name] [--ref origin/main] [--branch main]
             [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--bots] [--ci]
             [--reviewed PATH ...] [--misses-only] [-o candidates.json]
"""

import argparse
import datetime
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
HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
BOT_LOGINS = ("chatgpt-codex-connector[bot]", "cursor[bot]")
P1_BADGE_RE = re.compile(r"!\[P1 Badge\]|img\.shields\.io/badge/P1[-_ ]", re.I)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CI_RED = ("failure", "timed_out")
CI_GREEN = ("success",)
CI_LOOKBACK_DAYS = 7


def excerpt(text, limit=EXCERPT):
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit] + "..."


def git(repo_dir, *args):
    return subprocess.run(["git", *args], cwd=repo_dir, capture_output=True, text=True,
                          check=True).stdout


# --- git source ---------------------------------------------------------------

LOG_FORMAT = "%H%x1f%P%x1f%ct%x1f%s%x1f%b%x1e"


def parse_log(text):
    """Commits from `git log --format=LOG_FORMAT`, newest first. `day` is the
    committer date as a UTC YYYY-MM-DD."""
    commits = []
    for record in text.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        sha, parents, stamp, subject, body = (record.split("\x1f") + ["", "", "", ""])[:5]
        day = (datetime.datetime.fromtimestamp(int(stamp), datetime.timezone.utc).date().isoformat()
               if stamp.strip().isdigit() else "")
        commits.append({"sha": sha.strip(), "parents": parents.split(), "day": day, "subject": subject,
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
    hunks, path, header = [], None, False
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            # A `--- ` line names the file only here, before the first @@; in
            # a hunk it is a removed line such as `-- comment`.
            path, header = None, True
            continue
        if header and line.startswith("--- "):
            path = line[6:] if line.startswith("--- a/") else None
            continue
        m = HUNK_RE.match(line)
        if m:
            header = False
            if path and len(hunks) < MAX_HUNKS:
                hunks.append({"file": path, "line": max(1, int(m.group(1)))})
    return hunks


def parse_diff(diff):
    """Per-file entries of a -U0 diff: [{old, new, hunks: [(old_start,
    old_count, new_start, new_count)]}]. `old` is None for an added file and
    `new` None for a deleted one; renames carry both paths."""
    entries, cur, header = [], None, False
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            m = re.match(r"^diff --git a/(.+) b/(.+)$", line)
            cur = {"old": m.group(1) if m else None, "new": m.group(2) if m else None, "hunks": []}
            entries.append(cur)
            header = True
            continue
        if cur is None:
            continue
        if header:
            # File names come from these lines only before the first @@: in a
            # hunk, `--- x` is a removed line such as `-- comment`.
            if line.startswith("--- "):
                cur["old"] = line[6:] if line.startswith("--- a/") else None
                continue
            if line.startswith("+++ "):
                cur["new"] = line[6:] if line.startswith("+++ b/") else None
                continue
            if line.startswith("rename from "):
                cur["old"] = line[len("rename from "):]
                continue
            if line.startswith("rename to "):
                cur["new"] = line[len("rename to "):]
                continue
        m = HUNK_RE.match(line)
        if m:
            header = False
            cur["hunks"].append((int(m.group(1)), int(m.group(2) or 1), int(m.group(3)), int(m.group(4) or 1)))
    return entries


def new_side_hunks(diff):
    """[{file, line}] for each hunk's first new-side line: the lines a commit
    changed, at that commit. A pure deletion names the line after the gap."""
    hunks = []
    for entry in parse_diff(diff):
        if not entry["new"]:
            continue
        for _, _, new_start, new_count in entry["hunks"]:
            if len(hunks) < MAX_HUNKS:
                hunks.append({"file": entry["new"], "line": max(1, new_start + (0 if new_count else 1))})
    return hunks


def map_back(entries, path, line):
    """Map `line` of `path` on the new side of a diff to its old side.
    Returns (old_path, old_line, note); old_line is None when the line itself
    changed or the file did not exist on the old side."""
    entry = next((e for e in entries if e["new"] == path), None)
    if entry is None:
        return path, line, None
    if entry["old"] is None:
        return None, None, "file not at target head"
    shift = 0
    for old_start, old_count, new_start, new_count in entry["hunks"]:
        if new_count and new_start <= line < new_start + new_count:
            return entry["old"], None, "line changed between target head and fix parent"
        if (new_count and new_start + new_count <= line) or (not new_count and new_start < line):
            shift += old_count - new_count
    return entry["old"], line + shift, None


def hunks_at(hunks, between, head, parent):
    """Map old-side `hunks` (lines at the fix's parent) onto `head`.
    `between(a, b)` returns the -U0 rename-aware diff from a to b."""
    if not head or not parent:
        return None
    entries = parse_diff(between(head, parent)) if head != parent else []
    out = []
    for h in hunks:
        path, line, note = map_back(entries, h["file"], h["line"])
        item = {"file": path or h["file"], "line": line}
        if note:
            item["note"] = note
        out.append(item)
    return out


def git_candidates(commits, repo, show, since=None, until=None, between=None):
    """Candidates from parsed commits. `show(sha)` returns a commit's -U0 diff.
    The PR and revert lookups use every commit; only the fix or revert itself
    must fall in [since, until], so a recent fix to an old PR keeps its SHAs.
    With `between`, each target also gets `hunks_at_head`."""
    by_pr = {}
    by_sha = {}
    for c in commits:
        by_sha[c["sha"]] = c
        n = own_pr(c["subject"])
        if n is not None and n not in by_pr:
            by_pr[n] = c
    out = []
    for c in commits:
        if (since and c["day"] < since) or (until and c["day"] > until):
            continue
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
        hunks = old_side_hunks(show(c["sha"]))
        parent = c["parents"][0] if c["parents"] else None
        targets = []
        for n in prs:
            merged = by_pr.get(n)
            target = {
                "pr": n,
                "pr_url": "https://github.com/%s/pull/%d" % (repo, n) if repo else None,
                "head": merged["sha"] if merged else None,
                "base": merged["parents"][0] if merged and merged["parents"] else None,
                "note": None if merged else "PR not found on this ref; look up its SHAs by hand",
            }
            if between is not None:
                target["hunks_at_head"] = hunks_at(hunks, between, target["head"], parent)
            targets.append(target)
        out.append({
            "kind": "revert" if revert else "fix",
            "commit": c["sha"],
            "commit_url": "https://github.com/%s/commit/%s" % (repo, c["sha"]) if repo else None,
            "own_pr": own_pr(c["subject"]),
            "reverted_commit": reverted,
            "targets": targets,
            "hunks": hunks,
            "hunks_relative_to": parent,
            "subject": excerpt(c["subject"], 200),
            "body_excerpt": excerpt(c["body"]),
        })
    return out


def read_history(repo_dir, ref):
    """(commits, show, between) for a checkout. The whole first-parent
    history: the dates filter candidates, not the merged PRs they point to."""
    commits = parse_log(git(repo_dir, "log", "--first-parent", "--format=" + LOG_FORMAT, ref, "--"))
    show = lambda sha: git(repo_dir, "show", "--no-color", "--no-ext-diff", "--format=", "-U0", sha)
    cache = {}

    def between(a, b):
        if (a, b) not in cache:
            cache[(a, b)] = git(repo_dir, "diff", "--no-color", "--no-ext-diff", "-M", "-U0", a, b, "--")
        return cache[(a, b)]

    return commits, show, between


def harvest_git(repo_dir, ref, repo, since=None, until=None, history=None):
    commits, show, between = history or read_history(repo_dir, ref)
    return git_candidates(commits, repo, show, since, until, between)


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
            # The line and head the bot reviewed, as a pair; the PR's later
            # head (commit_id, line) may have moved or fixed it.
            "line": c.get("original_line") if c.get("original_commit_id") else c.get("line"),
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


def harvest_bots(repo, since, until, max_pages=50, get=gh_get):
    """(candidates, truncated). Pages newest first and stops once a page
    reaches comments created before --since, so a cap only ever drops the
    oldest comments, and `truncated` says when it did."""
    comments, truncated = [], False
    for page in range(1, max_pages + 1):
        params = {"sort": "created", "direction": "desc", "per_page": 100, "page": page}
        if since:
            params["since"] = since + "T00:00:00Z"
        batch = get("repos/%s/pulls/comments" % repo, params)
        comments += batch
        oldest = min((str(c.get("created_at") or "")[:10] for c in batch if isinstance(c, dict)), default="")
        if len(batch) < 100 or (since and oldest and oldest < since):
            break
    else:
        truncated = True
    pulls = {}
    for c in bot_candidates(comments, {}, since, until):
        if c["pr"] is not None and c["pr"] not in pulls:
            pulls[c["pr"]] = get("repos/%s/pulls/%d" % (repo, c["pr"]))
    return bot_candidates(comments, pulls, since, until), truncated


# --- reviewed heads ------------------------------------------------------------

def epoch(stamp):
    """UTC epoch seconds of an ISO-8601 time, or None. A time with no zone is
    read as UTC."""
    try:
        t = datetime.datetime.fromisoformat(str(stamp).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=datetime.timezone.utc)
    return t.timestamp()


def review_record(pr, head, at):
    """A validated {pr, head, at} or None."""
    try:
        pr = int(pr)
    except (TypeError, ValueError):
        return None
    head = str(head or "").lower()
    when = epoch(at)
    if pr <= 0 or not SHA_RE.match(head) or when is None:
        return None
    return {"pr": pr, "head": head, "at": when}


def load_reviewed(path):
    """Recorded reviews as [{pr, head, at}]. `path` is either a JSON list of
    {pr, head, at} records, or a review-ledger findings directory
    (`<git-common-dir>/yellow-review/findings`), whose `observation` records
    carry the PR, the head the review ran on, and when. Bad records are
    skipped."""
    raw = []
    if os.path.isdir(path):
        for name in sorted(os.listdir(path)):
            if not name.endswith(".jsonl"):
                continue
            with open(os.path.join(path, name), encoding="utf-8") as handle:
                for line in handle:
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(rec, dict) and rec.get("type") == "observation":
                        raw.append((rec.get("pr"), rec.get("head_sha"), rec.get("at")))
    else:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, list):
            raise ValueError("%s: expected a JSON list of {pr, head, at}" % path)
        raw = [(r.get("pr"), r.get("head"), r.get("at")) for r in data if isinstance(r, dict)]
    out = [review_record(*r) for r in raw]
    return [r for r in out if r]


def tag_reviewed(candidates, reviews):
    """Set `review` on each bot-p1 candidate: "missed" when a recorded review
    of the same PR at the same head came at or before the comment (the
    reviewer saw that code and the bot still found a P1), "reviewed-later"
    when the only reviews of that head came after, and "no-record" when none
    is recorded. `reviewed_at` is the earliest review of that head."""
    by_key = {}
    for r in reviews:
        by_key.setdefault((r["pr"], r["head"]), []).append(r["at"])
    for c in candidates:
        if c.get("kind") != "bot-p1":
            continue
        times = sorted(by_key.get((c.get("pr"), str(c.get("head") or "").lower()), []))
        posted = epoch(c.get("created_at"))
        if not times:
            c["review"], c["reviewed_at"] = "no-record", None
            continue
        c["reviewed_at"] = datetime.datetime.fromtimestamp(times[0], datetime.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ")
        c["review"] = "missed" if posted is not None and times[0] <= posted else "reviewed-later"
    return candidates


# --- ci source --------------------------------------------------------------------

def ci_candidates(runs, commits, repo, show, branch, since=None, until=None, jobs=None):
    """Candidates from Actions runs (the /actions/runs `workflow_runs` shape):
    push runs on `branch` that failed in [since, until] after the same
    workflow's previous decided run passed. A failure with no earlier run in
    the list has `previous: "unknown"`; one after another failure is dropped,
    since the break came earlier. `jobs` maps a run id to its failed jobs."""
    by_sha = {c["sha"]: c for c in commits}
    groups = {}
    for r in runs:
        if not isinstance(r, dict) or r.get("event") != "push" or r.get("head_branch") != branch:
            continue
        if r.get("status") != "completed":
            continue
        groups.setdefault(r.get("workflow_id"), []).append(r)
    out = []
    for group in groups.values():
        group.sort(key=lambda r: (int(r.get("run_number") or 0), str(r.get("created_at") or "")))
        previous = None
        for r in group:
            conclusion = r.get("conclusion")
            if conclusion not in CI_RED + CI_GREEN:
                continue
            before, previous = previous, conclusion
            if conclusion not in CI_RED or before in CI_RED:
                continue
            day = str(r.get("created_at") or "")[:10]
            if (since and day < since) or (until and day > until):
                continue
            sha = str(r.get("head_sha") or "")
            commit = by_sha.get(sha)
            n = own_pr(commit["subject"]) if commit else None
            out.append({
                "kind": "ci-failure",
                "workflow": excerpt(r.get("name"), 100),
                "run_url": r.get("html_url"),
                "run_id": r.get("id"),
                "created_at": r.get("created_at"),
                "conclusion": conclusion,
                "previous": "success" if before else "unknown",
                "commit": sha,
                "commit_url": "https://github.com/%s/commit/%s" % (repo, sha) if repo and sha else None,
                "pr": n,
                "pr_url": "https://github.com/%s/pull/%d" % (repo, n) if repo and n else None,
                "head": sha if commit else None,
                "base": commit["parents"][0] if commit and commit["parents"] else None,
                "hunks": new_side_hunks(show(sha)) if commit else [],
                "failed_jobs": (jobs or {}).get(r.get("id"), []),
                "note": None if commit else "commit not on this ref's first-parent history",
            })
    out.sort(key=lambda c: str(c["created_at"] or ""), reverse=True)
    return out


def failed_jobs(payload):
    """[{job, steps}] for the failed jobs in an /actions/runs/<id>/jobs reply."""
    out = []
    for j in (payload or {}).get("jobs") or []:
        if isinstance(j, dict) and j.get("conclusion") in CI_RED:
            steps = [excerpt(s.get("name"), 100) for s in j.get("steps") or []
                     if isinstance(s, dict) and s.get("conclusion") in CI_RED]
            out.append({"job": excerpt(j.get("name"), 100), "steps": steps[:5]})
    return out[:10]


def harvest_ci(repo, branch, since, until, commits, show, max_pages=20, get=gh_get):
    """(candidates, truncated). Reads push runs on `branch` from
    CI_LOOKBACK_DAYS before --since, so the first failure in range can see
    the run before it, then fetches the failed jobs of each candidate."""
    created = None
    if since:
        start = (datetime.date.fromisoformat(since) - datetime.timedelta(days=CI_LOOKBACK_DAYS)).isoformat()
        created = "%s..%s" % (start, until) if until else ">=" + start
    elif until:
        created = "<=" + until
    runs, truncated = [], False
    for page in range(1, max_pages + 1):
        params = {"branch": branch, "event": "push", "status": "completed", "per_page": 100, "page": page}
        if created:
            params["created"] = created
        batch = (get("repos/%s/actions/runs" % repo, params) or {}).get("workflow_runs") or []
        runs += batch
        if len(batch) < 100:
            break
    else:
        truncated = True
    found = ci_candidates(runs, commits, repo, show, branch, since, until)
    jobs = {}
    for c in found:
        if isinstance(c["run_id"], int):
            jobs[c["run_id"]] = failed_jobs(get("repos/%s/actions/runs/%d/jobs" % (repo, c["run_id"]),
                                                {"filter": "latest", "per_page": 100}))
    return ci_candidates(runs, commits, repo, show, branch, since, until, jobs), truncated


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
    ap.add_argument("--branch", help="default branch the CI source reads (default: --ref without origin/)")
    ap.add_argument("--bots", action="store_true", help="also read Codex/Bugbot P1 review comments via gh")
    ap.add_argument("--ci", action="store_true", help="also read post-merge Actions failures via gh")
    ap.add_argument("--reviewed", action="append", default=[], metavar="PATH",
                    help="recorded reviews: a JSON list of {pr, head, at}, or a review-ledger findings dir")
    ap.add_argument("--misses-only", action="store_true",
                    help="keep only bot P1s posted after a recorded review of the same head")
    ap.add_argument("-o", "--output", help="write here instead of stdout (never under cases/ or controls/)")
    a = ap.parse_args(argv)
    repo_dir = os.path.abspath(a.repo_dir)
    repo = a.repo or origin_repo(repo_dir)
    branch = a.branch or re.sub(r"^origin/", "", a.ref)
    if a.misses_only and not (a.bots and a.reviewed):
        sys.exit("harvest: --misses-only needs --bots and --reviewed")
    for value, rx, name in ((a.since, DATE_RE, "--since"), (a.until, DATE_RE, "--until"),
                            (repo, REPO_RE, "--repo"), (a.ref, REF_RE, "--ref"), (branch, REF_RE, "--branch")):
        if value is not None and not rx.match(value):
            sys.exit("harvest: bad %s value %r" % (name, value))
    for value, name in ((a.since, "--since"), (a.until, "--until")):
        if value is not None:
            try:
                datetime.date.fromisoformat(value)
            except ValueError:
                sys.exit("harvest: %s %r is not a real date" % (name, value))
    if a.since and a.until and a.since > a.until:
        sys.exit("harvest: --since %s is after --until %s" % (a.since, a.until))
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
    reviews = []
    for path in a.reviewed:
        try:
            reviews += load_reviewed(path)
        except (OSError, ValueError) as err:
            sys.exit("harvest: cannot read --reviewed %s: %s" % (path, err))
    try:
        history = read_history(repo_dir, a.ref)
        result["candidates"] += harvest_git(repo_dir, a.ref, repo, a.since, a.until, history)
    except subprocess.CalledProcessError as err:
        sys.exit("harvest: git %s failed: %s" % (" ".join(err.cmd[1:3]), (err.stderr or "").strip()))
    result["sources"]["git"] = "ok"
    if not a.bots:
        result["sources"]["bots"] = "off (pass --bots)"
    elif not repo:
        result["sources"]["bots"] = "skipped: no owner/name; pass --repo"
    elif not shutil.which("gh"):
        result["sources"]["bots"] = "skipped: gh not found"
    else:
        try:
            found, truncated = harvest_bots(repo, a.since, a.until)
            result["candidates"] += found
            result["sources"]["bots"] = ("truncated: hit the page cap; comments older than the last "
                                         "page were not read, narrow --since" if truncated else "ok")
        except (RuntimeError, ValueError, TypeError) as err:
            result["sources"]["bots"] = "skipped: %s" % err
    if a.reviewed:
        tag_reviewed(result["candidates"], reviews)
        result["sources"]["reviewed"] = "%d reviews from %d path(s)" % (len(reviews), len(a.reviewed))
        if a.misses_only:
            result["candidates"] = [c for c in result["candidates"]
                                    if c["kind"] != "bot-p1" or c.get("review") == "missed"]
    if not a.ci:
        result["sources"]["ci"] = "off (pass --ci)"
    elif not repo:
        result["sources"]["ci"] = "skipped: no owner/name; pass --repo"
    elif not shutil.which("gh"):
        result["sources"]["ci"] = "skipped: gh not found"
    else:
        try:
            found, truncated = harvest_ci(repo, branch, a.since, a.until, history[0], history[1])
            result["candidates"] += found
            result["sources"]["ci"] = ("truncated: hit the page cap; older runs were not read, "
                                       "narrow --since" if truncated else "ok")
        except (RuntimeError, ValueError, TypeError, AttributeError) as err:
            result["sources"]["ci"] = "skipped: %s" % err
        except subprocess.CalledProcessError as err:
            result["sources"]["ci"] = "skipped: git %s failed" % " ".join(err.cmd[1:3])
    text = json.dumps(result, indent=1) + "\n"
    if a.output:
        with open(a.output, "w", encoding="utf-8") as handle:
            handle.write(text)
        print("harvest: %d candidates -> %s" % (len(result["candidates"]), a.output), file=sys.stderr)
    else:
        sys.stdout.write(text)
    for name in ("bots", "ci"):
        if result["sources"][name].startswith(("skipped", "truncated")):
            print("harvest: %s source %s" % (name, result["sources"][name]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
