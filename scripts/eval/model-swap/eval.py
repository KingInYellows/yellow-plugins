#!/usr/bin/env python3
"""Model-swap eval for agent routing changes (docs/research/model-routing-policy.md).

Grades each candidate model against golden findings, not a model judge:

- replay: a merged PR is checked out at its merge commit, compared with its
  parent, and has defects planted into it. A run "finds" a plant when one
  finding names the plant's file and hits every regex in its `match` list.
- scan: a scanner runs over unchanged files; the golden set is every
  function lizard reports over the spec's CCN or length limit.

  eval.py prepare <spec.json> <work-dir>   worktrees, diffs, prompts, matrix
  eval.py run <work-dir> [-j N] [--dry-run] run the matrix (spends usage)
  eval.py grade <work-dir>                 recall, cost and latency tables

prepare and grade spend nothing. run calls run-one.sh once per matrix row
and skips rows that already have output.
"""

import argparse
import collections
import concurrent.futures
import csv
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = subprocess.run(["git", "-C", HERE, "rev-parse", "--show-toplevel"],
                      capture_output=True, text=True, check=True).stdout.strip()


def git(*args, cwd=REPO):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True,
                          text=True, check=True).stdout


def worktree(path, commit):
    if not os.path.isdir(path):
        git("worktree", "add", "--quiet", "--detach", path, commit)


def fresh_worktree(path, commit):
    """Recreate path at commit, so a changed spec never reuses an old tree."""
    if os.path.isdir(path):
        git("worktree", "remove", "--force", path)
    worktree(path, commit)


def fingerprint(*parts):
    """Hash of every run input; run-one.sh only reuses an output that carries it."""
    h = hashlib.sha256()
    for part in parts:
        if isinstance(part, str) and os.path.isfile(part):
            with open(part, "rb") as handle:
                part = handle.read().decode("utf-8", "replace")
        h.update(json.dumps(part, sort_keys=True).encode("utf-8") + b"\0")
    return h.hexdigest()[:16]


def plant(wt, p):
    path = os.path.join(wt, p["file"])
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    if p.get("fold_description"):
        # Turn a one-line quoted `description:` into a folded >- scalar.
        m = re.search(r'^description: "(.*)"$', text, re.M)
        if not m:
            sys.exit("prepare: no quoted description in %s" % p["file"])
        words = m.group(1).split(" ")
        half = len(words) // 2
        new = "description: >-\n  %s\n  %s" % (" ".join(words[:half]), " ".join(words[half:]))
        text = text[:m.start()] + new + text[m.end():]
    else:
        if text.count(p["old"]) != 1:
            sys.exit("prepare: anchor for %s matches %d times" % (p["file"], text.count(p["old"])))
        text = text.replace(p["old"], p["new"])
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def system_prompt_with_skills(aid, agent, work):
    """Agent file with preloaded skills appended, as `skills:` frontmatter does."""
    if not agent.get("preload_skills"):
        return os.path.join(REPO, agent["file"])
    out = os.path.join(work, "prompts", "system-%s.md" % aid)
    with open(os.path.join(REPO, agent["file"]), encoding="utf-8") as handle:
        text = handle.read()
    for skill in agent["preload_skills"]:
        with open(os.path.join(REPO, skill), encoding="utf-8") as handle:
            body = handle.read().split("\n---\n", 1)[-1]
        text += "\n\n# Preloaded skill: %s\n\n%s" % (os.path.basename(os.path.dirname(skill)), body)
    with open(out, "w", encoding="utf-8") as handle:
        handle.write(text)
    return out


REVIEW_PROMPT = """You are reviewing a pull request in the repository at the current working directory; the PR's changes are already applied to the files there. The full PR diff is at {patch} (read it first). Changed files:
{files}

No <standards-paths> or <rule-vocabulary> block is supplied (standalone usage); use "unclassified" for rule. Review the changes per your instructions and return your findings."""

SCAN_PROMPT = """Run your scan for a /debt:audit. Read .debt/file-list.txt for the files to scan (scan only those files) and write your findings to .debt/scanner-output/{name}.json per the v2.0 schema. When done, reply with a one-line summary."""


SAFE_NAME = r"[A-Za-z0-9][A-Za-z0-9_.-]*"


def check_spec(spec):
    """Reject spec values that would read or write outside the repo or worktrees.

    Ids, models and efforts become path components under <work>; agent, skill,
    plant and scan files must be plain repo-relative paths.
    """
    names = [*spec["agents"], *(r["id"] for r in spec["replays"]), *(s["id"] for s in spec["scans"]),
             *(c[k] for cs in spec["configs"].values() for c in cs for k in ("model", "effort"))]
    bad = [n for n in names if not isinstance(n, str) or not re.fullmatch(SAFE_NAME, n) or ".." in n]
    paths = [*(a["file"] for a in spec["agents"].values()),
             *(f for a in spec["agents"].values() for f in a.get("preload_skills", [])),
             *(p["file"] for r in spec["replays"] for p in r["plants"]),
             *(f for s in spec["scans"] for f in s["files"])]
    bad += [f for f in paths if not isinstance(f, str) or os.path.isabs(f)
            or os.path.normpath(f) != f or f.split("/")[0] == ".."]
    if bad:
        sys.exit("prepare: unsafe spec values (names must match %s; files must be "
                 "relative paths without ..): %s" % (SAFE_NAME, ", ".join(map(str, bad))))


def agent_tools(path):
    """The `tools:` frontmatter as a comma list: block list, flow list or plain string."""
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    end = text.find("\n---", 3)
    lines = text[4:end].splitlines() if text.startswith("---\n") and end > 0 else []
    for i, line in enumerate(lines):
        m = re.match(r"tools:\s*(.*)$", line)
        if not m:
            continue
        value = re.sub(r"\s+#.*$", "", m.group(1)).strip()
        if value:
            items = value.strip("[]").split(",")
        else:
            items = []
            for item in lines[i + 1:]:
                im = re.match(r"\s+-\s*(.*)$", item)
                if not im:
                    break
                items.append(re.sub(r"\s+#.*$", "", im.group(1)))
        return ",".join(t.strip().strip("'\"") for t in items if t.strip())
    return ""


def prepare(spec_path, work):
    with open(spec_path, encoding="utf-8") as handle:
        spec = json.load(handle)
    check_spec(spec)
    for sub in ("wt", "prompts", "out"):
        os.makedirs(os.path.join(work, sub), exist_ok=True)
    rows = []
    for r in spec["replays"]:
        wt = os.path.join(work, "wt", "replay", r["id"])
        fresh_worktree(wt, r["commit"])
        try:
            for p in r["plants"]:
                plant(wt, p)
        except BaseException:
            # A half-planted tree would look prepared to the next run.
            git("worktree", "remove", "--force", wt)
            raise
        patch = os.path.join(work, "prompts", r["id"] + ".patch")
        with open(patch, "w", encoding="utf-8") as handle:
            # Fenced like any untrusted input (AGENTS.md): a replayed diff is data.
            handle.write("--- begin replay diff (reference only) ---\n%s--- end replay diff ---\n"
                         % git("diff", "HEAD^", cwd=wt))
        files = git("diff", "--name-only", "HEAD^", cwd=wt)
        with open(os.path.join(work, "prompts", r["id"] + ".txt"), "w", encoding="utf-8") as handle:
            handle.write(REVIEW_PROMPT.format(patch=patch, files=files))
    for aid, agent in spec["agents"].items():
        sys_prompt = system_prompt_with_skills(aid, agent, work)
        for c in spec["configs"][agent["configs"]]:
            for rep in range(1, c["reps"] + 1):
                if agent["kind"] == "replay":
                    for r in spec["replays"]:
                        prompt = os.path.join(work, "prompts", r["id"] + ".txt")
                        rows.append(["%s-%s-%s-%s-r%d" % (aid, r["id"], c["model"], c["effort"], rep),
                                     sys_prompt, os.path.join(work, "wt", "replay", r["id"]), c["model"], c["effort"],
                                     prompt, aid, r["id"],
                                     fingerprint(agent, r, c["model"], c["effort"], sys_prompt, prompt,
                                                 os.path.join(work, "prompts", r["id"] + ".patch"))])
                    continue
                for s in spec["scans"]:
                    rid = "%s-%s-%s-%s-r%d" % (aid, s["id"], c["model"], c["effort"], rep)
                    wt = os.path.join(work, "wt", "scan", rid)  # scanners write, so one tree per run
                    fresh_worktree(wt, s["commit"])
                    os.makedirs(os.path.join(wt, ".debt", "scanner-output"), exist_ok=True)
                    with open(os.path.join(wt, ".debt", "file-list.txt"), "w", encoding="utf-8") as handle:
                        handle.write("\n".join(s["files"]) + "\n")
                    name = os.path.splitext(os.path.basename(agent["file"]))[0]
                    prompt = os.path.join(work, "prompts", "scan-%s.txt" % name)
                    with open(prompt, "w", encoding="utf-8") as handle:
                        handle.write(SCAN_PROMPT.format(name=name))
                    rows.append([rid, sys_prompt, wt, c["model"], c["effort"], prompt, aid, s["id"],
                                 fingerprint(agent, s, c["model"], c["effort"], sys_prompt, prompt)])
    dupes = sorted({r[0] for r in rows if [x[0] for x in rows].count(r[0]) > 1})
    if dupes:
        sys.exit("prepare: these run ids collide; rename an agent or target id: %s" % ", ".join(dupes))
    with open(os.path.join(work, "matrix.tsv"), "w", encoding="utf-8") as handle:
        handle.writelines("\t".join(row) + "\n" for row in rows)
    with open(os.path.join(work, "spec.json"), "w", encoding="utf-8") as handle:
        json.dump(spec, handle, indent=1)
    print("prepared %d runs in %s/matrix.tsv" % (len(rows), work))


def run(work, jobs, dry_run):
    rows = read_matrix(work)
    if dry_run:
        for row in rows:
            print(row[0])
        print("%d runs; nothing spent" % len(rows))
        return
    out = os.path.join(work, "out")

    def one(row):
        rid, sys_prompt, wt, model, effort, prompt = row[:6]
        rc = subprocess.run([os.path.join(HERE, "run-one.sh"), out, rid, sys_prompt, wt,
                             model, effort, prompt, agent_tools(sys_prompt)],
                            env=dict(os.environ, EVAL_FINGERPRINT=row[8])).returncode
        return rid, rc

    failed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        for rid, rc in pool.map(one, rows):
            failed += rc != 0
            print("%s %s" % ("ok  " if rc == 0 else "FAIL", rid), flush=True)
    if failed:
        sys.exit("run: %d of %d runs failed; rerun to retry only those" % (failed, len(rows)))


def read_matrix(work):
    """Rows: id, system prompt, workdir, model, effort, prompt file, agent id, target id, fingerprint."""
    with open(os.path.join(work, "matrix.tsv"), encoding="utf-8") as handle:
        return [line.rstrip("\n").split("\t") for line in handle if line.strip()]


def split_findings(text, as_json):
    """Findings as strings, or None when a compact-JSON reply does not parse."""
    if as_json:
        m = re.search(r"\{.*\}", text, re.S)
        try:
            findings = json.loads(m.group(0))["findings"]
        except (AttributeError, KeyError, TypeError, ValueError):
            return None
        if not isinstance(findings, list) or not all(isinstance(f, dict) for f in findings):
            return None
        return [json.dumps(f) for f in findings]
    return [p for p in re.split(r"(?=\*\*\[P[0-3]\])", text) if p.startswith("**[P")]


def hits(p, finding):
    return p["file"] in finding and all(re.search(rx, finding, re.I) for rx in p["match"])


def lizard_golden(wt, files, limits):
    res = subprocess.run([sys.executable, "-m", "lizard", "--csv", *files], cwd=wt,
                         capture_output=True, text=True)
    if res.returncode not in (0, 1) or not res.stdout:
        sys.exit("grade: lizard failed (pip install lizard): " + res.stderr.strip())
    golden = []
    # NLOC, CCN, token, PARAM, length, location, file, function, long_name, start, end
    for cols in csv.reader(res.stdout.splitlines()):
        ccn, length, path, start = int(cols[1]), int(cols[4]), cols[6], int(cols[9])
        if ccn > limits["ccn_over"] or length > limits["length_over"]:
            golden.append((os.path.normpath(path), start, ccn, length))
    return golden


def scan_hits(golden, scan_file):
    found, unmatched = set(), []
    with open(scan_file, encoding="utf-8") as handle:
        scan = json.load(handle)
    for f in scan.get("findings", []):
        loc = f.get("file") or {}
        path = loc.get("path", "") if isinstance(loc, dict) else str(loc)
        m = re.match(r"(\d+)", str(loc.get("lines", "") if isinstance(loc, dict) else ""))
        line = int(m.group(1)) if m else -1
        matched = {g for g in golden if path.endswith(g[0]) and abs(line - g[1]) <= 3}
        found |= matched
        if not matched:
            unmatched.append(json.dumps(f))
    return found, unmatched


def reject(out, rid, why):
    """Move a result grade cannot use to .bad so the next `run` redoes the row."""
    os.replace(os.path.join(out, rid + ".json"), os.path.join(out, rid + ".bad"))
    print("grade: %s: %s; moved to %s.bad, rerun `run`" % (rid, why, rid), file=sys.stderr)


def grade(work):
    with open(os.path.join(work, "spec.json"), encoding="utf-8") as handle:
        spec = json.load(handle)
    replays = {r["id"]: r for r in spec["replays"]}
    scans = {s["id"]: s for s in spec["scans"]}
    goldens = {}
    recall = collections.defaultdict(lambda: [0, 0])
    usage = collections.defaultdict(lambda: collections.Counter())
    other = []
    missing = []
    out = os.path.join(work, "out")
    for row in read_matrix(work):
        rid, model, effort, aid, target, fp = row[0], row[3], row[4], row[6], row[7], row[8]
        agent = spec["agents"][aid]
        try:
            with open(os.path.join(out, rid + ".json"), encoding="utf-8") as handle:
                d = json.load(handle)
        except (OSError, ValueError):
            d = {}
        if d.get("eval_fingerprint") != fp:
            # Missing, unreadable, or made from inputs this spec no longer has.
            missing.append(rid)
            continue
        key = (aid, model, effort)
        if agent["kind"] == "replay":
            findings = split_findings(d.get("result") or "", agent.get("output") == "json")
            if findings is None:
                reject(out, rid, "malformed JSON findings")
                missing.append(rid + " (malformed JSON findings)")
                continue
            plants = replays[target]["plants"]
            for p in plants:
                if p["lane"] == agent["lane"]:
                    recall[key][0] += any(hits(p, f) for f in findings)
                    recall[key][1] += 1
            unmatched = [f for f in findings if not any(hits(p, f) for p in plants)]
        else:
            limits = agent["golden"]
            gkey = (target, limits["ccn_over"], limits["length_over"])
            if gkey not in goldens:
                wt = os.path.join(work, "wt", "golden", "%s-%s" % (target, scans[target]["commit"]))
                worktree(wt, scans[target]["commit"])
                goldens[gkey] = lizard_golden(wt, scans[target]["files"], limits)
            scan_file = os.path.join(out, rid + ".scan.json")
            try:
                found, unmatched = scan_hits(goldens[gkey], scan_file)
            except (OSError, ValueError, AttributeError, TypeError):
                reject(out, rid, "unreadable scan output")
                missing.append(rid + " (unreadable scan output)")
                continue
            recall[key][0] += len(found)
            recall[key][1] += len(goldens[gkey])
        other.extend((rid, " ".join(f.split())[:300]) for f in unmatched)
        mu = d.get("modelUsage", {}).values()
        usage[key].update(runs=1, cost=d.get("total_cost_usd") or 0, wall=d.get("eval_wall_s") or 0,
                          turns=d.get("num_turns") or 0,
                          tok_in=sum(v.get("inputTokens", 0) + v.get("cacheReadInputTokens", 0)
                                     + v.get("cacheCreationInputTokens", 0) for v in mu))
        usage[key].update(extra=len(unmatched))
    print("| agent | model | effort | recall | non-golden findings | runs | mean cost (USD, API-equiv.) | mean wall s | mean turns | mean input tok |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for key in sorted(usage):
        u, (hit, total) = usage[key], recall[key]
        n = u["runs"]
        print("| %s | %s | %s | %d/%d | %d | %d | %.4f | %.0f | %.1f | %.0fk |" % (
            *key, hit, total, u["extra"], n, u["cost"] / n, u["wall"] / n, u["turns"] / n, u["tok_in"] / n / 1000))
    with open(os.path.join(work, "unmatched-findings.txt"), "w", encoding="utf-8") as handle:
        handle.writelines("%s: %s\n\n" % row for row in other)
    print("\n%d non-golden findings to adjudicate by hand: %s" % (
        len(other), os.path.join(work, "unmatched-findings.txt")))
    if missing:
        # Recall above leaves these runs out of its denominators.
        sys.exit("grade: %d matrix runs have no current result (%s); rerun `run` before trusting recall"
                 % (len(missing), ", ".join(missing)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("spec")
    p.add_argument("work")
    r = sub.add_parser("run")
    r.add_argument("work")
    r.add_argument("-j", "--jobs", type=int, default=6)
    r.add_argument("--dry-run", action="store_true")
    g = sub.add_parser("grade")
    g.add_argument("work")
    a = ap.parse_args()
    work = os.path.abspath(a.work)
    if a.cmd == "prepare":
        prepare(a.spec, work)
    elif a.cmd == "run":
        run(work, a.jobs, a.dry_run)
    else:
        grade(work)


if __name__ == "__main__":
    main()
