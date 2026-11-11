#!/usr/bin/env python3
"""Run the yellow-review:review-gate workflow headless on one pull request in
CI (plans/risk-tiered-review-pipeline.md, Phase 3; CLAUDE-235).

  ci.py prepare --work DIR --pr-dir DIR --repo O/N --pr N --base SHA --head SHA --policy-ref SHA
  ci.py run     --work DIR [--claude BIN] [--model M] [--timeout S]
  ci.py render  --work DIR --mode shadow|advisory [--run-url URL]
  ci.py post    --work DIR

The reviewer (plugins, this script, the risk policy and REVIEW.md) comes from
the default branch, so a pull request cannot weaken its own review. The run
uses the eval's exact `claude -p` argv (scripts/eval/review-gate/eval.py
headless_argv), so CI runs the reviewer the eval scores. Only `post` touches
GitHub, and the `claude` run never sees a GitHub token.

A result is `complete` only when the eval would grade it: a hunter that
returned null (a usage-limit failure in `-p`), an empty run or a malformed
result is `incomplete`, never clean. The review never approves or blocks.
Stdlib only.
"""
import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REVIEWER = os.path.realpath(os.path.join(HERE, "..", "..", ".."))
EVAL = os.path.join(REVIEWER, "scripts", "eval", "review-gate", "eval.py")
REDACT_LIB = os.path.join(REVIEWER, "plugins", "yellow-core", "lib", "compound-staging.sh")
REDACT_FAILED = "[REDACTED: sanitization failed]"
WITHHELD = "[withheld: redaction unavailable]"
CLASSIFY = os.path.join(REVIEWER, "plugins", "yellow-review", "skills", "pr-review-workflow",
                        "scripts", "classify-risk")
MARKER = "<!-- yellow-review:review-gate-ci -->"
SHA = re.compile(r"^[0-9a-f]{40}$")
REPO_NAME = re.compile(r"^[\w.-]+/[\w.-]+$")
MAX_ROWS = 15


def load_eval():
    spec = importlib.util.spec_from_file_location("review_gate_eval", EVAL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                          check=True).stdout


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=1, sort_keys=True)
    os.replace(tmp, path)


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


# --- hunter selection ---------------------------------------------------------
#
# A deterministic, path-and-diff subset of /review:pr Step 4. CI has no
# yellow-plugins.local.md, ledger or learnings pass, so no overrides apply.

ORDER = (
    "project-compliance-reviewer", "correctness-reviewer", "maintainability-reviewer",
    "project-standards-reviewer", "plugin-contract-reviewer", "pattern-recognition-specialist",
    "security-reviewer", "adversarial-reviewer", "reliability-reviewer", "silent-failure-hunter",
    "pr-test-analyzer", "architecture-strategist",
)
ALWAYS = ORDER[:4]
# review-gate.js runs only these at the low tier and skips any other name.
LOW_TIER = ("correctness-reviewer", "project-compliance-reviewer")
PLUGIN_SURFACE = re.compile(
    r"^plugins/[^/]+/(\.claude-plugin/plugin\.json$|agents/.+\.md$|commands/.+\.md$"
    r"|skills/.+/SKILL\.md$|hooks/)")
TEST_FILE = re.compile(r"(^|/)(tests?|__tests__)/|(^|/)[^/]*(test|spec)[^/]*$", re.I)
TRUST_BOUNDARY = re.compile(
    r"\.(sh|bash|zsh)$|(^|/)hooks/|^plugins/[^/]+/lib/|/scripts/[^/.]+$|^scripts/|^\.github/workflows/")
FALLBACK = re.compile(
    r"^\+(?!\+\+).*(\b(try|catch|except|rescue|recover)\b|\|\| null|\?\? undefined|\bor None\b)",
    re.M)


def select_hunters(tier, changed, lines, diff_text):
    if tier == "low":
        return list(LOW_TIER)
    picked = set(ALWAYS)
    if any(PLUGIN_SURFACE.search(f) for f in changed):
        picked |= {"plugin-contract-reviewer", "pattern-recognition-specialist"}
    if any(TEST_FILE.search(f) for f in changed):
        picked.add("pr-test-analyzer")
    if any(TRUST_BOUNDARY.search(f) for f in changed):
        picked.add("security-reviewer")
    if FALLBACK.search(diff_text):
        picked.add("silent-failure-hunter")
    if lines is not None and lines > 200:
        picked.add("adversarial-reviewer")
    if len(changed) >= 10 and len({f.split("/", 1)[0] for f in changed}) >= 3:
        picked.add("architecture-strategist")
    if tier == "high":
        picked |= {"adversarial-reviewer", "reliability-reviewer", "security-reviewer"}
    return [name for name in ORDER if name in picked]


# --- prepare ------------------------------------------------------------------

def classify(pr_dir, base, head, policy_ref):
    """classify-risk with the policy at the default branch's tip. A failure
    reviews at high, the fail-closed tier."""
    res = subprocess.run([CLASSIFY, "--policy-ref", policy_ref, base, head], cwd=pr_dir,
                         capture_output=True, text=True, check=False)
    try:
        risk = json.loads(res.stdout) if res.returncode == 0 else None
    except ValueError:
        risk = None
    if not isinstance(risk, dict) or risk.get("tier") not in ("low", "medium", "high"):
        return {"tier": "high", "policy": "error", "lines": None,
                "error": (res.stderr.strip() or "no output")[:300]}
    return risk


def prepare(work, pr_dir, repo, pr, base, head, policy_ref):
    for name, value in (("base", base), ("head", head), ("policy-ref", policy_ref)):
        if not SHA.match(value):
            sys.exit("prepare: --%s must be a 40-character commit SHA" % name)
    if not REPO_NAME.match(repo):
        sys.exit("prepare: --repo must be owner/name")
    pr_dir = os.path.realpath(pr_dir)
    prompts = os.path.join(os.path.realpath(work), "prompts")
    if re.search(r"[,()\s]", prompts):
        sys.exit("prepare: work dir %s has a comma, parenthesis or space" % prompts)
    os.makedirs(prompts, exist_ok=True)
    merge_base = git(pr_dir, "merge-base", base, head).strip()
    span = "%s...%s" % (base, head)
    diff_text = git(pr_dir, "diff", "--no-color", "--no-ext-diff", span)
    diff_path = os.path.join(prompts, "pr.diff")
    with open(diff_path, "w", encoding="utf-8") as handle:
        handle.write(diff_text)
    changed = [f for f in git(pr_dir, "diff", "--name-only", span).splitlines() if f]
    risk = classify(pr_dir, base, head, policy_ref)
    try:
        review_md = git(pr_dir, "show", "%s:REVIEW.md" % policy_ref)
    except subprocess.CalledProcessError:
        review_md = None
    include = select_hunters(risk["tier"], changed, risk.get("lines"), diff_text)
    args = {
        "repo": repo, "pr": pr, "base": merge_base, "head": head, "tier": risk["tier"],
        "diff_path": diff_path, "repo_root": pr_dir, "changed_files": changed,
        "review_md": review_md, "include": include, "exclude": [], "dismissed": [],
    }
    write_json(os.path.join(prompts, "args.json"), args)
    write_json(os.path.join(work, "meta.json"), {
        "repo": repo, "pr": pr, "head": head, "base": merge_base, "pr_dir": pr_dir,
        "risk": risk, "include": include, "files": len(changed),
    })
    print("prepared PR #%d at %s: tier %s, %d files, hunters %s"
          % (pr, head[:12], risk["tier"], len(changed), ", ".join(include)))
    return 0


# --- run ----------------------------------------------------------------------

def run(work, claude, model, timeout):
    ev = load_eval()
    meta = read_json(os.path.join(work, "meta.json"))
    prompts = os.path.join(os.path.realpath(work), "prompts")
    with open(os.path.join(prompts, "args.json"), encoding="utf-8") as handle:
        args_text = handle.read().strip()
    argv = ev.headless_argv(claude, model, prompts, REVIEWER, args_text, budget=ev.max_budget_usd())
    try:
        res = subprocess.run(argv, cwd=meta["pr_dir"], env=ev.run_env(), capture_output=True,
                             text=True, timeout=timeout, check=False)
        rc, stdout, stderr = res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        rc, stdout, stderr = 124, "", "timed out after %ss" % timeout
    except OSError as err:
        rc, stdout, stderr = 127, "", "could not start %s: %s" % (claude, err)
    # Diagnostics only, never uploaded; redacted all the same.
    with open(os.path.join(work, "claude.err"), "w", encoding="utf-8") as handle:
        handle.write(redact_strings([stderr or ""])[0])
    result = classify_run(ev, rc, stdout, stderr)
    result["reason"], result["workflow"] = redact([result["reason"], result["workflow"]])
    if result["status"] == "complete" and WITHHELD in json.dumps(result["workflow"]):
        # Withheld text is not a reviewed result: never let it read as clean.
        result["status"] = "incomplete"
        result["reason"] = "finding text withheld: credential redaction failed"
    write_json(os.path.join(work, "result.json"), result)
    print("review-gate: %s%s" % (result["status"], ": " + result["reason"] if result["reason"] else ""))
    # A run that never produced a result fails the step so the check shows it.
    # Findings and incomplete coverage never do: the review does not block.
    return 1 if result["status"] == "error" else 0


def classify_run(ev, rc, stdout, stderr):
    """complete, incomplete or error, with the eval's own gradability rule."""
    try:
        cli = json.loads(stdout)
    except ValueError:
        cli = None
    if isinstance(cli, list):
        cli = next((m for m in reversed(cli) if isinstance(m, dict) and m.get("type") == "result"),
                   None)
    cost = {k: cli.get(k) for k in ("total_cost_usd", "num_turns", "duration_ms")
            if isinstance(cli, dict) and k in cli}
    wf = ev.parse_workflow(cli.get("result")) if isinstance(cli, dict) else None
    if rc != 0 or not isinstance(cli, dict) or cli.get("is_error") or wf is None:
        if rc != 0:
            tail = (stderr or "").strip().splitlines()
            why = "claude exited %d%s" % (rc, ": " + tail[-1] if tail else "")
        elif isinstance(cli, dict) and isinstance(cli.get("result"), str):
            why = "no workflow result in the reply: " + cli["result"].strip()[:200]
        else:
            why = "no workflow result in the reply"
        return {"status": "error", "reason": str(why)[:300], "workflow": wf, "cli": cost}
    why = ev.ungradable(wf)
    return {"status": "incomplete" if why else "complete", "reason": why or "",
            "workflow": wf, "cli": cost}


# --- redaction ----------------------------------------------------------------
# Hunters read untrusted code and may quote a credential they found. Every
# model-authored string goes through yellow-core's cs_redact_secrets (the
# filter review-ledger.sh uses) before result.json, the job summary or the
# comment exist. Fail closed: a string redaction cannot vouch for is withheld.

SCHEMA_KEY = re.compile(r"[a-z_]{1,32}\Z")


def _scrub(text):
    # Invisible format characters inside a token defeat the patterns; the
    # record separator and NUL would break the batch framing; a lone
    # surrogate cannot be encoded for the filter at all.
    return "".join(" " if ch in "\x1e\x00" else ch for ch in text
                   if unicodedata.category(ch) not in ("Cf", "Cs"))


def _redact_run(text):
    try:
        res = subprocess.run(["bash", "-c", 'source "$1" && cs_redact_secrets', "_", REDACT_LIB],
                             input=text, capture_output=True, text=True, timeout=60, check=False)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0 or REDACT_FAILED in res.stdout:
        return None
    return res.stdout


def _redact_batch(strings):
    """One cs_redact_secrets run over all strings; None when framing breaks."""
    out = _redact_run("".join(s + "\n\x1e\n" for s in strings))
    parts = out.split("\n\x1e\n")[:-1] if out is not None else []
    return parts if len(parts) == len(strings) else None


def redact_strings(strings):
    """Redacted copies in input order. The filter matches known credential
    shapes line by line, so a string whose whitespace-folded text still
    matches one (a token split across lines or spaces) is withheld."""
    if not strings:
        return []
    clean = [_scrub(s) for s in strings]
    red = _redact_batch(clean)
    if red is None:
        # A multi-line range (a PEM block) can swallow a separator: one at a time.
        red = []
        for s in clean:
            one = _redact_run(s + "\n")
            red.append(WITHHELD if one is None else one[:-1] if one.endswith("\n") else one)
    folded = [re.sub(r"\s+", "", s) for s in red]
    again = _redact_batch(folded)
    if again is None:
        return [WITHHELD] * len(red)
    return [r if a == f else WITHHELD for r, f, a in zip(red, folded, again)]


def redact(value):
    """Redact every string, keys included: a model can put text in a key."""
    found = []

    def collect(v):
        if isinstance(v, str):
            found.append(v)
        elif isinstance(v, list):
            for item in v:
                collect(item)
        elif isinstance(v, dict):
            for key, item in v.items():
                if not SCHEMA_KEY.fullmatch(key):
                    collect(key)
                collect(item)

    collect(value)
    red = iter(redact_strings(found))

    def rebuild(v):
        if isinstance(v, str):
            return next(red)
        if isinstance(v, list):
            return [rebuild(item) for item in v]
        if isinstance(v, dict):
            # Schema-shaped keys (lowercase words) carry no credential and
            # are kept, so a failed redaction cannot collapse the structure;
            # any other key is model text and redacted like a value.
            return {key if SCHEMA_KEY.fullmatch(key) else rebuild(key): rebuild(item)
                    for key, item in v.items()}
        return v

    return rebuild(value)


# --- render -------------------------------------------------------------------

CELL_ESCAPES = {"<": "&lt;", ">": "&gt;", "|": "&#124;", "[": "&#91;", "]": "&#93;",
                "\\": "&#92;", "`": "'", "@": "@\u200b"}


def cell(text, limit=160):
    """Model text from a run over untrusted code, made inert for a comment:
    one line, and no HTML, links, mentions, code spans or table breaks."""
    s = re.sub(r"\s+", " ", str(text)).strip()
    s = s[:limit - 1] + "\u2026" if len(s) > limit else s
    s = "".join(CELL_ESCAPES.get(ch, ch) for ch in s.replace("&", "&amp;"))
    # Bare URLs autolink on GitHub; a zero-width space after the scheme or
    # `www.` keeps them as text.
    return re.sub(r"(?i)([a-z][a-z0-9+.-]*:/|www\.)", lambda m: m.group(0) + "\u200b", s)


def as_list(value):
    return value if isinstance(value, list) else []


def path_cell(f):
    path = f.get("file") if isinstance(f.get("file"), str) else "?"
    if not re.fullmatch(r"[A-Za-z0-9._/@+-]+", path):
        path = cell(path, 80)
    line = f.get("line") if isinstance(f.get("line"), int) else "?"
    return "`%s:%s`" % (path, line)


def render(work, mode, run_url=None):
    meta = read_json(os.path.join(work, "meta.json"))
    result_path = os.path.join(work, "result.json")
    result = read_json(result_path) if os.path.exists(result_path) else {
        "status": "error", "reason": "the run step did not finish", "workflow": None, "cli": {}}
    wf = result.get("workflow") if isinstance(result.get("workflow"), dict) else {}
    # A malformed result is already incomplete; never let its shape crash the
    # report that says so.
    findings = [f for f in as_list(wf.get("findings")) if isinstance(f, dict)]
    by = {d: [f for f in findings if f.get("display") == d] for d in ("Important", "Nit", "Pre-existing")}
    cov = wf.get("coverage") if isinstance(wf.get("coverage"), dict) else {}
    status = result["status"]
    risk = meta["risk"]
    out = [MARKER, "### review-gate (%s)" % mode, ""]
    out.append("**Head:** `%s` · **Risk tier:** `%s` · **Hunters:** %s"
               % (meta["head"][:12], risk["tier"], ", ".join("`%s`" % n for n in meta["include"])))
    out.append("")
    if status == "complete":
        out.append("**Result:** %d Important, %d Nit, %d Pre-existing; %d dropped by vote; %s agents."
                   % (len(by["Important"]), len(by["Nit"]), len(by["Pre-existing"]),
                      len(as_list(wf.get("dropped"))), wf.get("agents", "?")))
    elif status == "incomplete":
        failed = [cell(n, 60) for n in as_list(cov.get("failed"))]
        out.append("**Result: incomplete.** Not every reviewer returned, so no finding here means "
                   "nothing about the rest of the change. %s"
                   % ("Failed: %s." % ", ".join(failed) if failed else cell(result["reason"], 200)))
        if findings:
            out.append("")
            out.append("Findings from the reviewers that did return: %d Important, %d Nit, %d Pre-existing."
                       % (len(by["Important"]), len(by["Nit"]), len(by["Pre-existing"])))
    else:
        out.append("**Result: not run.** %s" % cell(result.get("reason") or "unknown error", 240))
    for display in ("Important", "Nit"):
        rows = by[display]
        if not rows:
            continue
        out += ["", "#### %s" % display, "", "| Where | Severity | Finding |", "| --- | --- | --- |"]
        for f in rows[:MAX_ROWS]:
            out.append("| %s | %s | %s |" % (path_cell(f), cell(f.get("severity", "?"), 4),
                                            cell(f.get("title", ""))))
        if len(rows) > MAX_ROWS:
            out.append("")
            out.append("%d more in the run's artifact." % (len(rows) - MAX_ROWS))
    out += ["", "_Advisory only: this review never approves or blocks a merge. Findings come from "
            "the default branch's reviewer; the full JSON is in the run's `review-gate` artifact._"]
    if run_url and re.fullmatch(r"https://github\.com/[\w.-]+/[\w.-]+/actions/runs/\d+(/attempts/\d+)?",
                                run_url):
        out[-1] += " [Run](%s)" % run_url
    status_obj = {"head": meta["head"], "tier": risk["tier"], "status": status,
                  "important": len(by["Important"]) if status != "error" else None}
    out += ["", "<!-- review-gate-status %s -->" % json.dumps(status_obj, sort_keys=True)]
    body = "\n".join(out) + "\n"
    with open(os.path.join(work, "comment.md"), "w", encoding="utf-8") as handle:
        handle.write(body)
    sys.stdout.write(body)
    return 0


# --- post ---------------------------------------------------------------------

def gh(*args):
    return subprocess.run(["gh", "api", *args], capture_output=True, text=True, check=True).stdout


def post(work):
    """Create or edit the one sticky comment, found by its marker among this
    workflow's own comments. Skipped when the PR head moved on: a newer run
    owns the comment then."""
    meta = read_json(os.path.join(work, "meta.json"))
    repo, pr = meta["repo"], meta["pr"]
    body_path = os.path.join(work, "comment.md")
    current = gh("repos/%s/pulls/%d" % (repo, pr), "--jq", ".head.sha").strip()
    if current != meta["head"]:
        print("post: PR head is now %s, not %s; leaving the comment to the newer run"
              % (current[:12], meta["head"][:12]))
        return 0
    ids = gh("--paginate", "repos/%s/issues/%d/comments" % (repo, pr), "--jq",
             '.[] | select(.user.login == "github-actions[bot]") '
             '| select(.body | startswith("%s")) | .id' % MARKER).split()
    if ids:
        gh("-X", "PATCH", "repos/%s/issues/comments/%s" % (repo, ids[0]), "-F", "body=@" + body_path,
           "--jq", ".id")
        print("post: edited comment %s" % ids[0])
    else:
        gh("-X", "POST", "repos/%s/issues/%d/comments" % (repo, pr), "-F", "body=@" + body_path,
           "--jq", ".id")
        print("post: created the comment")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--work", required=True)
    p.add_argument("--pr-dir", required=True, help="checkout of the PR head with full history")
    p.add_argument("--repo", required=True)
    p.add_argument("--pr", type=int, required=True)
    p.add_argument("--base", required=True, help="the PR base branch's tip")
    p.add_argument("--head", required=True)
    p.add_argument("--policy-ref", required=True, help="the default branch's tip")
    r = sub.add_parser("run")
    r.add_argument("--work", required=True)
    r.add_argument("--claude", default="claude")
    r.add_argument("--model", default="claude-sonnet-5-5",
                   help="parent session model; it only launches the workflow")
    r.add_argument("--timeout", type=int, default=2700, help="seconds")
    d = sub.add_parser("render")
    d.add_argument("--work", required=True)
    d.add_argument("--mode", choices=("shadow", "advisory"), required=True)
    d.add_argument("--run-url")
    o = sub.add_parser("post")
    o.add_argument("--work", required=True)
    a = ap.parse_args(argv)
    work = os.path.abspath(a.work)
    if a.cmd == "prepare":
        return prepare(work, a.pr_dir, a.repo, a.pr, a.base, a.head, a.policy_ref)
    if a.cmd == "run":
        return run(work, a.claude, a.model, a.timeout)
    if a.cmd == "render":
        return render(work, a.mode, a.run_url)
    return post(work)


if __name__ == "__main__":
    sys.exit(main())
