"""Tests for the review-gate eval. They spend nothing: `claude` is the stand-in
under fixtures/bin, and git history is a throwaway repo per test.

Run: python3 -m unittest discover scripts/eval/review-gate/tests
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TESTS)
FIXTURES = os.path.join(TESTS, "fixtures")
STANDIN = os.path.join(FIXTURES, "bin", "claude")
EVAL = os.path.join(ROOT, "eval.py")
HARVEST = os.path.join(ROOT, "harvest.py")


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rg = load("review_gate_eval", EVAL)
hv = load("review_gate_harvest", HARVEST)

GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@example.invalid", "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_CONFIG_NOSYSTEM": "1"}


def git(repo, *args):
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True,
                          env={**os.environ, **GIT_ENV}).stdout.strip()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def commit(repo, message, files):
    for path, text in files.items():
        if text is None:
            os.remove(os.path.join(repo, path))
        else:
            write(os.path.join(repo, path), text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def lines(n, changed=None):
    return "".join("%s\n" % (changed.get(i, "line %d" % i) if changed else "line %d" % i)
                   for i in range(1, n + 1))


class Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="review-gate-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)


class SchemaTest(unittest.TestCase):
    def example(self, name):
        with open(os.path.join(ROOT, "cases", "examples", name), encoding="utf-8") as handle:
            return json.load(handle)

    def test_examples_are_valid_and_labelled(self):
        case = self.example("example-unquoted-path.json")
        control = self.example("example-control.json")
        self.assertEqual(rg.validate_item(case, "case"), [])
        self.assertEqual(rg.validate_item(control, "control"), [])
        self.assertTrue(case["example"] and control["example"])

    def test_shipped_cases_and_controls_validate(self):
        # Ships zero confirmed cases; any added later must validate here too.
        for kind, folder in (("case", "cases"), ("control", "controls")):
            path = os.path.join(ROOT, folder)
            for name in os.listdir(path) if os.path.isdir(path) else []:
                if name.endswith(".json"):
                    with open(os.path.join(ROOT, folder, name), encoding="utf-8") as handle:
                        doc = json.load(handle)
                    self.assertEqual(rg.validate_item(doc, kind), [], name)
                    self.assertFalse(doc.get("example"), name)

    def test_invalid_cases_are_rejected(self):
        good = self.example("example-unquoted-path.json")
        bad = [
            ({k: v for k, v in good.items() if k != "confirmed_by"}, "missing confirmed_by"),
            ({**good, "head": "abc123"}, "does not match"),
            ({**good, "extra": 1}, "unknown key extra"),
            ({**good, "tier": "urgent"}, "is not one of"),
            ({**good, "golden": []}, "fewer than 1"),
            ({**good, "golden": [{"file": "/etc/passwd", "line": 1, "match": ["x"]}]}, "does not match"),
            ({**good, "golden": [{"file": "a/../b", "line": 1, "match": ["x"]}]}, "does not match"),
            ({**good, "golden": [{"file": "a", "line": 0, "match": ["x"]}]}, "below 1"),
            ({**good, "golden": [{"file": "a", "line": True, "match": ["x"]}]}, "expected integer"),
            ({**good, "golden": [{"file": "a", "line": 1, "match": ["(unclosed"]}]}, "bad regex"),
            ({**good, "confirmed_at": "2026-13-40"}, "not a calendar date"),
            ({**good, "confirmed_at": "2026-02-30"}, "not a calendar date"),
        ]
        for doc, why in bad:
            errors = rg.validate_item(doc, "case")
            self.assertTrue(any(why in e for e in errors), (why, errors))
        control = self.example("example-control.json")
        self.assertTrue(rg.validate_item({**control, "golden": []}, "control"))

    def test_examples_never_load_as_real_cases(self):
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copy(os.path.join(ROOT, "cases", "examples", "example-unquoted-path.json"), tmp)
            with self.assertRaises(SystemExit):
                rg.load_items(tmp, os.path.join(tmp, "none"))
        kinds = sorted(k for k, _, _ in rg.load_items("", "", examples=True))
        self.assertEqual(kinds, ["case", "control"])


class PipelineTest(Tmp):
    """prepare -> run (stand-in) -> grade on a throwaway repo."""

    def setUp(self):
        super().setUp()
        self.repo = os.path.join(self.tmp, "repo")
        os.makedirs(self.repo)
        git(self.repo, "init", "-q", "-b", "main")
        self.base = commit(self.repo, "chore: base", {"REVIEW.md": "# Review rules at base\n",
                                                       "lib/x.sh": lines(10)})
        self.head = commit(self.repo, "feat: change", {"lib/x.sh": lines(10, {5: "cp $path /tmp"}),
                                                        "REVIEW.md": "# Weakened by the PR\n"})
        self.cases = os.path.join(self.tmp, "cases")
        self.controls = os.path.join(self.tmp, "controls")
        golden = [{"file": "lib/x.sh", "line": 5, "match": [r"unquoted", r"\bpath\b"]}]
        for cid in ("case-hit", "case-miss", "case-incomplete"):
            write(os.path.join(self.cases, cid + ".json"), json.dumps({
                "id": cid, "repo": "test/demo", "pr": 3, "base": self.base, "head": self.head,
                "lane": "correctness", "tier": "medium", "golden": golden, "source": "test",
                "confirmed_by": "tester", "confirmed_at": "2026-11-02"}))
        for cid in ("control-clean", "control-fp"):
            write(os.path.join(self.controls, cid + ".json"), json.dumps({
                "id": cid, "repo": "test/demo", "base": self.base, "head": self.head, "tier": "low",
                "source": "test"}))
        self.work = os.path.join(self.tmp, "work")
        self.log = os.path.join(self.tmp, "log")
        self.results = os.path.join(self.tmp, "results")
        self.env = {**os.environ, "CLAUDE_BIN": STANDIN, "STANDIN_LOG": self.log,
                    "STANDIN_RESPONSES": os.path.join(FIXTURES, "responses")}

    def cli(self, *args, env=None):
        return subprocess.run([sys.executable, EVAL, *args], capture_output=True, text=True,
                              env=env or self.env, check=False)

    def prepare(self, *extra):
        res = self.cli("prepare", self.work, "--cases", self.cases, "--controls", self.controls,
                       "--repo-dir", "test/demo=" + self.repo, *extra)
        self.assertEqual(res.returncode, 0, res.stderr)
        return res

    def logged(self):
        return sorted(os.listdir(self.log)) if os.path.isdir(self.log) else []

    def test_prepare_builds_worktrees_diffs_and_args(self):
        res = self.prepare()
        # The PR edits REVIEW.md, which classify-risk always rates high.
        self.assertIn("classify-risk says high, the control file says low", res.stderr)
        rows = rg.read_matrix(self.work)
        self.assertEqual(sorted(r["id"] for r in rows),
                         ["case-hit", "case-incomplete", "case-miss", "control-clean", "control-fp"])
        row = next(r for r in rows if r["id"] == "case-hit")
        self.assertEqual(git(row["wt"], "rev-parse", "HEAD"), self.head)
        with open(row["args"], encoding="utf-8") as handle:
            args = json.load(handle)
        self.assertEqual(set(args), {"repo", "pr", "base", "head", "tier", "diff_path", "changed_files",
                                     "review_md", "include", "exclude", "dismissed"})
        self.assertEqual((args["repo"], args["pr"], args["tier"]), ("test/demo", 3, "high"))
        self.assertEqual(args["changed_files"], ["REVIEW.md", "lib/x.sh"])
        self.assertEqual(args["review_md"], "# Review rules at base\n")  # base, not the PR's
        self.assertTrue(os.path.isabs(args["diff_path"]))
        with open(args["diff_path"], encoding="utf-8") as handle:
            self.assertIn("+cp $path /tmp", handle.read())

    def test_fingerprint_ignores_grading_fields_and_cwd(self):
        self.prepare()
        before = {r["id"]: r["fingerprint"] for r in rg.read_matrix(self.work)}
        path = os.path.join(self.cases, "case-hit.json")
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)
        doc.update(golden=[{"file": "lib/x.sh", "line": 6, "match": ["other"]}], notes="edited",
                   source="elsewhere", confirmed_by="someone", confirmed_at="2026-11-03")
        write(path, json.dumps(doc))
        # Run prepare from a cwd holding files named like fingerprint inputs.
        for name in ("sonnet", "case", "REVIEW.md"):
            write(os.path.join(self.tmp, name), "decoy\n")
        res = subprocess.run([sys.executable, EVAL, "prepare", self.work, "--cases", self.cases,
                              "--controls", self.controls, "--repo-dir", "test/demo=" + self.repo],
                             cwd=self.tmp, capture_output=True, text=True, env=self.env, check=False)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual({r["id"]: r["fingerprint"] for r in rg.read_matrix(self.work)}, before)
        self.prepare("--model", "haiku")
        self.assertTrue(all(r["fingerprint"] != before[r["id"]] for r in rg.read_matrix(self.work)))

    def test_reviewer_hash_covers_every_loaded_plugin(self):
        root = os.path.join(self.tmp, "fake-repo")
        for name in rg.PLUGINS:
            write(os.path.join(root, "plugins", name, "agents", "a.md"), "agent %s\n" % name)
        with mock.patch.object(rg.ms, "REPO", root):
            before = rg.reviewer_hash()
            self.assertEqual(rg.reviewer_hash(), before)
            for name in rg.PLUGINS:
                path = os.path.join(root, "plugins", name, "agents", "a.md")
                write(path, "edited\n")
                after = rg.reviewer_hash()
                self.assertNotEqual(after, before, name)
                before = after
            # A new file anywhere under a loaded plugin counts too.
            write(os.path.join(root, "plugins", "yellow-review", "skills", "s", "SKILL.md"), "x\n")
            self.assertNotEqual(rg.reviewer_hash(), before)
            # A plugin the run does not load does not.
            before = rg.reviewer_hash()
            write(os.path.join(root, "plugins", "yellow-other", "a.md"), "x\n")
            self.assertEqual(rg.reviewer_hash(), before)

    def test_fingerprint_covers_every_headless_flag(self):
        self.prepare()
        row = rg.read_matrix(self.work)[0]
        args = row["args"]
        diff = args.replace(".args.json", ".diff")
        before = rg.row_fingerprint(args, diff, row["model"], "r")
        self.assertEqual(row["fingerprint"], rg.row_fingerprint(args, diff, row["model"],
                                                                  rg.reviewer_hash()))
        real = rg.headless_argv
        with mock.patch.object(rg, "headless_argv", lambda *a: real(*a) + ["--new-flag"]):
            self.assertNotEqual(rg.row_fingerprint(args, diff, row["model"], "r"), before)
        with mock.patch.object(rg, "DENIED_TOOLS", "Bash"):
            self.assertNotEqual(rg.row_fingerprint(args, diff, row["model"], "r"), before)
        # The command that runs is the one fingerprinted.
        cmd = rg.headless_cmd(row, self.work)
        self.assertEqual(len(cmd), len(rg.headless_argv("<claude>", row["model"], "<p>", "<r>", "<a>")))

    def test_prepare_needs_a_checkout_for_the_repo(self):
        res = self.cli("prepare", self.work, "--cases", self.cases, "--controls", self.controls)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("--repo-dir test/demo=PATH", res.stderr)

    def test_dry_run_spends_nothing_and_shows_the_command(self):
        self.prepare()
        res = self.cli("run", self.work, "--dry-run")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(self.logged(), [])
        self.assertIn("5 rows: 5 would run, 0 current; nothing spent", res.stdout)
        for flag in ("'Workflow(yellow-review:review-gate),Read(./**)", "--permission-mode dontAsk",
                     "--output-format json", "plugins/yellow-review", "plugins/yellow-linear"):
            self.assertIn(flag, res.stdout)

    def test_run_skips_rows_with_current_fingerprint(self):
        self.prepare()
        res = self.cli("run", self.work, "-j", "3")
        # One stub row returns an ungradable workflow: the run says so and exits 1.
        self.assertEqual(res.returncode, 1, res.stderr)
        self.assertIn("1 of 5 runs are incomplete; rerun with --retry-incomplete", res.stderr)
        self.assertEqual(len(self.logged()), 5)
        with open(os.path.join(self.log, "case-hit.json"), encoding="utf-8") as handle:
            argv = json.load(handle)
        self.assertEqual(argv["args"]["head"], self.head)
        self.assertIn("Workflow(yellow-review:review-gate)", ",".join(argv["argv"]))
        out = rg.load_output(self.work, "case-hit")
        self.assertEqual(out["cli"]["total_cost_usd"], 0.25)
        self.assertIsInstance(out["eval_wall_s"], float)
        shutil.rmtree(self.log)
        res = self.cli("run", self.work)
        self.assertEqual(self.logged(), [])
        self.assertEqual(res.stdout.count("skip "), 5)
        # A malformed result (current fingerprint) is incomplete to grade, so it reruns too.
        out_path = os.path.join(self.work, "out", "case-hit.json")
        with open(out_path, encoding="utf-8") as handle:
            out = json.load(handle)
        out["workflow"]["version"] = 2
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(out, handle)
        self.assertIn("case-hit", [i["id"] for i in rg.summarize(self.work)["incomplete"]])
        res = self.cli("run", self.work, "--retry-incomplete")
        self.assertEqual(self.logged(), ["case-hit.json", "case-incomplete.json"])
        # A changed input (the parent model) changes every fingerprint.
        shutil.rmtree(self.log)
        self.prepare("--model", "haiku")
        res = self.cli("run", self.work, env={**self.env, "STANDIN_FAIL": "case-hit"})
        self.assertEqual(res.returncode, 1)
        self.assertEqual(len(self.logged()), 5)
        self.assertTrue(os.path.exists(os.path.join(self.work, "out", "case-hit.bad")))
        self.assertIn("case-hit", rg.summarize(self.work)["missing"])

    def test_run_refuses_rows_whose_inputs_changed_since_prepare(self):
        self.prepare()
        rows = rg.read_matrix(self.work)
        self.assertEqual(rg.stale_rows(rows), [])
        # Edited reviewer files make every row stale.
        with mock.patch.object(rg, "reviewer_hash", lambda: "edited"):
            self.assertEqual(rg.stale_rows(rows), [r["id"] for r in rows])
        # So does an edited diff, for its row only; run spends nothing.
        row = next(r for r in rows if r["id"] == "case-hit")
        with open(row["args"], encoding="utf-8") as handle:
            diff_path = json.load(handle)["diff_path"]
        with open(diff_path, "a", encoding="utf-8") as handle:
            handle.write("+edited\n")
        for extra in ((), ("--dry-run",)):
            res = self.cli("run", self.work, *extra)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("inputs changed since prepare for case-hit; run prepare again", res.stderr)
        self.assertEqual(self.logged(), [])

    def test_grade_counts_recall_fp_and_incomplete(self):
        self.prepare()
        self.cli("run", self.work)
        res = self.cli("grade", self.work, "--date", "2026-11-02", "--results-dir", self.results)
        self.assertEqual(res.returncode, 1, res.stdout)  # an incomplete run fails the grade
        s = rg.summarize(self.work)
        self.assertEqual((s["golden_hit"], s["golden_total"], s["cases_found"]), (1, 2, 1))
        self.assertEqual((s["controls_with_fp"], s["controls_complete"]), (1, 2))
        self.assertEqual(s["recall"], 0.5)
        self.assertEqual(s["fp_rate"], 0.5)
        self.assertEqual([i["id"] for i in s["incomplete"]], ["case-incomplete"])
        self.assertIn("correctness-reviewer", s["incomplete"][0]["why"])
        self.assertEqual(s["agents"], 5 + 4 + 2 + 3)
        with open(os.path.join(self.results, "results-2026-11-02.md"), encoding="utf-8") as handle:
            md = handle.read()
        self.assertIn("| Important recall", md)
        self.assertIn("`case-incomplete`: coverage.failed: correctness-reviewer", md)
        self.assertIn("Possible race on temp file", md)
        with open(os.path.join(self.work, "summary.json"), encoding="utf-8") as handle:
            summary = json.load(handle)
        self.assertEqual(summary["date"], "2026-11-02")
        # An edited golden entry keeps every id but changes the grading set.
        items_path = os.path.join(self.work, "items.json")
        with open(items_path, encoding="utf-8") as handle:
            items = json.load(handle)
        items["case-hit"]["golden"][0]["match"] = ["other"]
        write(items_path, json.dumps(items))
        edited = rg.summarize(self.work)
        self.assertEqual({r["id"] for r in edited["rows"]}, {r["id"] for r in s["rows"]})
        self.assertNotEqual(edited["grading_set"], s["grading_set"])


class GradeMathTest(unittest.TestCase):
    GOLDEN = {"file": "lib/x.sh", "line": 10, "match": [r"unquoted", r"\bpath\b"]}

    def finding(self, **kw):
        base = {"display": "Important", "file": "lib/x.sh", "line": 10, "title": "Unquoted var",
                "suggested_fix": "quote the path"}
        return {**base, **kw}

    def test_finding_matches(self):
        m = rg.finding_matches
        self.assertTrue(m(self.GOLDEN, self.finding()))
        self.assertTrue(m(self.GOLDEN, self.finding(line=13)))
        self.assertTrue(m(self.GOLDEN, self.finding(line=7, file="./lib/x.sh")))
        self.assertFalse(m(self.GOLDEN, self.finding(line=14)))
        self.assertFalse(m(self.GOLDEN, self.finding(display="Nit")))
        self.assertFalse(m(self.GOLDEN, self.finding(display="Pre-existing")))
        self.assertFalse(m(self.GOLDEN, self.finding(file="lib/y.sh")))
        self.assertFalse(m(self.GOLDEN, self.finding(line=None)))
        self.assertFalse(m(self.GOLDEN, self.finding(suggested_fix="add quotes")))  # no \bpath\b

    def test_parse_workflow(self):
        wf = {"version": 1, "findings": [], "coverage": {"failed": []}}
        for text in (json.dumps(wf), "Done.\n```json\n%s\n```" % json.dumps(wf),
                     'Note {"x": 1} then %s' % json.dumps(wf)):
            self.assertEqual(rg.parse_workflow(text), wf)
        self.assertIsNone(rg.parse_workflow('{"error": "Workflow not found"}'))
        self.assertIsNone(rg.parse_workflow(None))
        self.assertEqual(rg.shape_problems({"version": 2, "findings": "x"}),
                         ["version is 2, not 1", "findings is not a list of objects", "coverage is missing",
                          "agents is missing or not a non-negative integer"])

    def test_missing_coverage_failed_or_agents_is_incomplete(self):
        ok = {"version": 1, "findings": [], "coverage": {"failed": []}, "agents": 3}
        self.assertIsNone(rg.ungradable(ok))
        for wf, why in (({**ok, "coverage": {}}, "coverage.failed is missing"),
                        ({**ok, "coverage": {"failed": None}}, "coverage.failed is missing"),
                        ({**ok, "coverage": {"failed": "x"}}, "coverage.failed is missing"),
                        ({k: v for k, v in ok.items() if k != "agents"}, "agents is missing"),
                        ({**ok, "agents": "3"}, "agents is missing"),
                        ({**ok, "agents": 2.5}, "agents is missing"),
                        ({**ok, "agents": True}, "agents is missing"),
                        ({**ok, "agents": -1}, "agents is missing")):
            self.assertIn(why, rg.ungradable(wf) or "", wf)

    def summary(self, recall, fp, agents, cost=1.0, ids=("a", "b")):
        return {"recall": recall, "fp_rate": fp, "mean_cost_usd": cost, "mean_agents": agents,
                "missing": [], "incomplete": [], "rows": [{"id": i} for i in ids]}

    def test_keep_drop_rule(self):
        v = lambda new, base: rg.verdict(new, base)[0]
        base = self.summary(0.5, 0.1, 10)
        self.assertEqual(v(self.summary(0.6, 0.1, 20), base), "keep")
        self.assertEqual(v(self.summary(0.5, 0.1, 8), base), "keep")
        self.assertEqual(v(self.summary(0.5, 0.1, 10), base), "drop")
        self.assertEqual(v(self.summary(0.9, 0.2, 5), base), "drop")
        self.assertEqual(v(self.summary(0.4, 0.0, 5), base), "drop")
        self.assertEqual(v(self.summary(0.9, 0.0, 5, ids=("a",)), base), "no verdict")
        self.assertEqual(v({**self.summary(0.9, 0.0, 5), "incomplete": [{"id": "a"}]}, base), "no verdict")

    def test_different_golden_entries_give_no_verdict(self):
        base = {**self.summary(0.5, 0.1, 10), "grading_set": "aaaa"}
        decision, why = rg.verdict({**self.summary(0.9, 0.0, 5), "grading_set": "bbbb"}, base)
        self.assertEqual(decision, "no verdict")
        self.assertIn("golden", why)
        self.assertEqual(rg.verdict({**self.summary(0.9, 0.0, 5), "grading_set": "aaaa"}, base)[0], "keep")
        a = {"x": {"kind": "case", "golden": [{"file": "f", "line": 1, "match": ["a"]}]}}
        b = {"x": {"kind": "case", "golden": [{"file": "f", "line": 1, "match": ["b"]}]}}
        self.assertNotEqual(rg.grading_set(a), rg.grading_set(b))
        self.assertEqual(rg.grading_set(a), rg.grading_set(json.loads(json.dumps(a))))

    def test_cost_usd_never_decides(self):
        base = self.summary(0.5, 0.1, 10, cost=1.0)
        decision, why = rg.verdict(self.summary(0.5, 0.1, 10, cost=0.1), base)
        self.assertEqual(decision, "drop")
        self.assertIn("reported only", why)

    def test_md_table_pads_columns(self):
        self.assertEqual(rg.md_table(["a", "long head"], [["x|y", 1]]),
                         "| a    | long head |\n| ---- | --------- |\n| x\\|y | 1         |")


class HarvestGitTest(Tmp):
    def test_reverts_and_fixes_that_reference_a_pr(self):
        repo = self.tmp
        git(repo, "init", "-q", "-b", "main")
        commit(repo, "chore: init", {"README.md": "x\n"})
        c1 = commit(repo, "feat: add helper (#10)", {"lib/h.sh": lines(5)})
        c2 = commit(repo, "feat(x): other (#11)", {"lib/o.sh": lines(3)})
        c3 = commit(repo, "fix: quote path in helper (#12)",
                    {"lib/h.sh": lines(5, {2: 'cp "$p" .'})})
        git(repo, "commit", "-q", "--amend", "-m", "fix: quote path in helper (#12)\n\nThe bug came from #10.")
        c3 = git(repo, "rev-parse", "HEAD")
        git(repo, "revert", "--no-edit", c2)
        c4 = git(repo, "rev-parse", "HEAD")
        commit(repo, "fix: typo (#13)", {"README.md": "y\n"})
        commit(repo, "fix!: breaking follow-up to https://github.com/test/demo/pull/11",
               {"README.md": "z\n"})
        found = {c["commit"]: c for c in hv.harvest_git(repo, "main", "test/demo")}
        self.assertEqual(len(found), 3)  # the typo fix names no other PR
        fix = found[c3]
        self.assertEqual(fix["kind"], "fix")
        self.assertEqual(fix["own_pr"], 12)
        self.assertEqual([t["pr"] for t in fix["targets"]], [10])
        self.assertEqual(fix["targets"][0]["head"], c1)
        self.assertEqual(fix["targets"][0]["base"], git(repo, "rev-parse", c1 + "^"))
        self.assertEqual(fix["hunks"], [{"file": "lib/h.sh", "line": 2}])
        self.assertEqual(fix["commit_url"], "https://github.com/test/demo/commit/" + c3)
        revert = found[c4]
        self.assertEqual(revert["kind"], "revert")
        self.assertEqual(revert["reverted_commit"], c2)
        self.assertEqual([t["pr"] for t in revert["targets"]], [11])
        self.assertEqual(revert["hunks"], [{"file": "lib/o.sh", "line": 1}])

    def test_date_range_filters_candidates_not_the_pr_lookup(self):
        repo = self.tmp
        git(repo, "init", "-q", "-b", "main")

        def dated(day, message, files):
            env = {"GIT_AUTHOR_DATE": day + "T12:00:00Z", "GIT_COMMITTER_DATE": day + "T12:00:00Z"}
            with mock.patch.dict(os.environ, env):
                return commit(repo, message, files)

        dated("2026-08-01", "chore: init", {"README.md": "x\n"})
        old_pr = dated("2026-08-02", "feat: add helper (#10)", {"lib/h.sh": lines(5)})
        early = dated("2026-09-15", "fix: first follow-up to #10 (#11)", {"lib/h.sh": lines(5, {1: "a"})})
        recent = dated("2026-10-05", "fix: quote path from #10 (#12)", {"lib/h.sh": lines(5, {2: "b"})})
        late = dated("2026-11-20", "fix: later follow-up to #10 (#13)", {"lib/h.sh": lines(5, {3: "c"})})
        found = hv.harvest_git(repo, "main", "test/demo", since="2026-10-01", until="2026-10-31")
        self.assertEqual([c["commit"] for c in found], [recent])
        target = found[0]["targets"][0]
        self.assertEqual((target["pr"], target["head"], target["note"]), (10, old_pr, None))
        self.assertEqual(target["base"], git(repo, "rev-parse", old_pr + "^"))
        # The range is inclusive, in UTC days.
        found = hv.harvest_git(repo, "main", "test/demo", since="2026-09-15", until="2026-11-20")
        self.assertEqual([c["commit"] for c in found], [late, recent, early])

    def test_removed_dash_dash_line_is_not_a_file_header(self):
        diff = ("diff --git a/q.sql b/q.sql\nindex 1..2 100644\n--- a/q.sql\n+++ b/q.sql\n"
                "@@ -3 +3 @@\n--- old comment\n+-- new comment\n@@ -9,2 +9 @@\n-x\n"
                "diff --git a/new.sh b/new.sh\nnew file mode 100644\n--- /dev/null\n+++ b/new.sh\n"
                "@@ -0,0 +1 @@\n+y\n")
        self.assertEqual(hv.old_side_hunks(diff), [{"file": "q.sql", "line": 3}, {"file": "q.sql", "line": 9}])

    def test_cli_rejects_impossible_or_reversed_dates(self):
        for extra, why in ((["--since", "2026-02-30"], "not a real date"),
                           (["--until", "2026-13-01"], "not a real date"),
                           (["--since", "2026-11-05", "--until", "2026-11-01"], "is after")):
            res = subprocess.run([sys.executable, HARVEST, "--repo-dir", ROOT, "--repo", "test/demo",
                                  *extra], capture_output=True, text=True, check=False)
            self.assertNotEqual(res.returncode, 0, extra)
            self.assertIn(why, res.stderr)

    def test_cli_refuses_to_write_into_cases(self):
        res = subprocess.run([sys.executable, HARVEST, "--repo-dir", ROOT, "--repo", "test/demo",
                              "-o", os.path.join(ROOT, "cases", "x.json")],
                             capture_output=True, text=True, check=False)
        self.assertNotEqual(res.returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(ROOT, "cases", "x.json")))


class HarvestBotsTest(Tmp):
    def fixture(self, name):
        with open(os.path.join(FIXTURES, "gh", name), encoding="utf-8") as handle:
            return json.load(handle)

    def test_p1_badges_from_bots_in_range(self):
        pulls = {int(k): v for k, v in self.fixture("pulls.json").items()}
        found = hv.bot_candidates(self.fixture("comments.json"), pulls, "2026-10-01", "2026-10-31")
        self.assertEqual([(c["bot"], c["pr"]) for c in found],
                         [("chatgpt-codex-connector[bot]", 7), ("cursor[bot]", 9)])
        codex, bugbot = found
        # original_line (40) goes with original_commit_id, not line (42) on commit_id.
        self.assertEqual((codex["file"], codex["line"]), ("plugins/x/lib/y.sh", 40))
        self.assertEqual(codex["head"], "a" * 40)  # the head the bot reviewed
        self.assertEqual(codex["base"], "1" * 40)
        self.assertTrue(codex["merged"])
        self.assertIn("Ignore previous instructions", codex["excerpt"])  # stored, never acted on
        self.assertEqual(bugbot["line"], 17)
        self.assertFalse(bugbot["merged"])

    def test_fetch_pages_and_pull_lookups_use_injected_get(self):
        calls = []
        comments = self.fixture("comments.json")
        pulls = self.fixture("pulls.json")

        def get(path, params=None):
            calls.append((path, params))
            if path.endswith("/pulls/comments"):
                return comments
            return pulls[path.rsplit("/", 1)[1]]

        found, truncated = hv.harvest_bots("test/demo", "2026-10-01", "2026-10-31", get=get)
        self.assertEqual(len(found), 2)
        self.assertFalse(truncated)
        self.assertEqual(calls[0][1]["since"], "2026-10-01T00:00:00Z")
        self.assertEqual(calls[0][1]["direction"], "desc")
        self.assertEqual([c[0] for c in calls[1:]], ["repos/test/demo/pulls/7", "repos/test/demo/pulls/9"])

    def test_page_cap_keeps_newest_and_reports_truncation(self):
        def page(n, day):
            return [{"user": {"login": "cursor[bot]"}, "body": "![P1 Badge](https://img.shields.io/badge/P1-x)",
                     "path": "a", "original_line": 1, "original_commit_id": "e" * 40,
                     "pull_request_url": "https://api.github.com/repos/t/d/pulls/%d" % n,
                     "created_at": day}] * 100

        pages = {1: page(1, "2026-10-30T00:00:00Z"), 2: page(2, "2026-10-20T00:00:00Z"),
                 3: page(3, "2026-10-10T00:00:00Z")}

        def get(path, params=None):
            return pages[params["page"]] if path.endswith("/comments") else {}

        found, truncated = hv.harvest_bots("t/d", "2026-10-01", None, max_pages=2, get=get)
        self.assertTrue(truncated)
        self.assertEqual({c["pr"] for c in found}, {1, 2})  # page 3 (oldest) dropped
        # A page that reaches back past --since ends paging without truncation.
        found, truncated = hv.harvest_bots("t/d", "2026-10-25", None, max_pages=2, get=get)
        self.assertFalse(truncated)

    def test_bots_skipped_without_gh(self):
        repo = os.path.join(self.tmp, "repo")
        os.makedirs(repo)
        git(repo, "init", "-q", "-b", "main")
        commit(repo, "chore: init", {"a": "1\n"})
        bin_dir = os.path.join(self.tmp, "bin")
        os.makedirs(bin_dir)
        os.symlink(shutil.which("git"), os.path.join(bin_dir, "git"))
        res = subprocess.run([sys.executable, HARVEST, "--repo-dir", repo, "--repo", "test/demo",
                              "--ref", "main", "--bots", "--ci"], capture_output=True, text=True, check=False,
                             env={**os.environ, **GIT_ENV, "PATH": bin_dir})
        self.assertEqual(res.returncode, 0, res.stderr)
        out = json.loads(res.stdout)
        self.assertEqual(out["sources"], {"git": "ok", "bots": "skipped: gh not found",
                                          "ci": "skipped: gh not found"})
        self.assertEqual(out["candidates"], [])


class HarvestHeadMappingTest(Tmp):
    def test_fix_hunks_map_onto_each_target_head(self):
        repo = self.tmp
        git(repo, "init", "-q", "-b", "main")
        commit(repo, "chore: init", {"README.md": "x\n"})
        head = commit(repo, "feat: add helpers (#10)", {"lib/h.sh": lines(10), "lib/k.sh": lines(10)})
        # Between #10 and the fix: three lines land at the top of h.sh, line 5
        # of k.sh is rewritten, and k.sh is renamed.
        commit(repo, "feat: header (#11)", {"lib/h.sh": "a\nb\nc\n" + lines(10)})
        commit(repo, "feat: tweak k (#12)", {"lib/k.sh": lines(10, {5: "five"})})
        git(repo, "mv", "lib/k.sh", "lib/m.sh")
        git(repo, "commit", "-q", "-m", "refactor: rename k (#13)")
        parent = git(repo, "rev-parse", "HEAD")
        fix = commit(repo, "fix: follow-up to #10 (#14)", {
            "lib/h.sh": "a\nb\nc\n" + lines(10, {6: "six"}),
            "lib/m.sh": lines(10, {5: "FIVE", 8: "eight"}),
        })
        found = {c["commit"]: c for c in hv.harvest_git(repo, "main", "test/demo")}
        cand = found[fix]
        self.assertEqual(cand["hunks_relative_to"], parent)
        self.assertEqual(sorted((h["file"], h["line"]) for h in cand["hunks"]),
                         [("lib/h.sh", 9), ("lib/m.sh", 5), ("lib/m.sh", 8)])
        target = cand["targets"][0]
        self.assertEqual(target["head"], head)
        at_head = sorted(target["hunks_at_head"], key=lambda h: (h["file"], h["line"] or 0))
        self.assertEqual(at_head, [
            {"file": "lib/h.sh", "line": 6},
            {"file": "lib/k.sh", "line": None, "note": "line changed between target head and fix parent"},
            {"file": "lib/k.sh", "line": 8},
        ])

    def test_map_back_shifts_and_new_files(self):
        diff = ("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -2,0 +3,2 @@\n+x\n+y\n@@ -10 +11,0 @@\n-z\n"
                "diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+q\n")
        entries = hv.parse_diff(diff)
        self.assertEqual(hv.map_back(entries, "f", 2), ("f", 2, None))
        self.assertEqual(hv.map_back(entries, "f", 3)[1], None)  # inserted after head
        self.assertEqual(hv.map_back(entries, "f", 5), ("f", 3, None))
        self.assertEqual(hv.map_back(entries, "f", 11), ("f", 9, None))
        self.assertEqual(hv.map_back(entries, "f", 12), ("f", 11, None))  # past head's deleted line 10
        self.assertEqual(hv.map_back(entries, "n", 1), (None, None, "file not at target head"))
        self.assertEqual(hv.map_back(entries, "other", 7), ("other", 7, None))
        self.assertEqual(hv.new_side_hunks(diff), [{"file": "f", "line": 3}, {"file": "f", "line": 12},
                                                   {"file": "n", "line": 1}])


    def test_quoted_paths_from_real_git(self):
        repo = self.tmp
        git(repo, "init", "-q", "-b", "main")
        commit(repo, "chore: init", {"caf\u00e9.py": lines(3), 'say "hi".sh': lines(3), "a b.sh": lines(3)})
        sha = commit(repo, "fix: edit", {"caf\u00e9.py": lines(3, {2: "x"}), 'say "hi".sh': lines(3, {3: "y"}),
                                         "a b.sh": lines(3, {1: "z"})})
        git(repo, "mv", "caf\u00e9.py", "th\u00e9.py")
        git(repo, "commit", "-q", "-m", "refactor: rename")
        diff = git(repo, "show", "--format=", "-U0", sha)
        self.assertIn('"', diff)  # git quoted both names
        self.assertEqual(sorted((h["file"], h["line"]) for h in hv.new_side_hunks(diff)),
                         [("a b.sh", 1), ("caf\u00e9.py", 2), ('say "hi".sh', 3)])
        self.assertEqual(sorted((h["file"], h["line"]) for h in hv.old_side_hunks(diff)),
                         [("a b.sh", 1), ("caf\u00e9.py", 2), ('say "hi".sh', 3)])
        renamed = hv.parse_diff(git(repo, "diff", "-M", "-U0", sha, "HEAD"))
        self.assertEqual([(e["old"], e["new"]) for e in renamed], [("caf\u00e9.py", "th\u00e9.py")])


class HarvestReviewedTest(Tmp):
    H = "a" * 40

    def bot(self, pr, head, created):
        return {"kind": "bot-p1", "pr": pr, "head": head, "created_at": created}

    def test_tag_reviewed_compares_heads_and_utc_times(self):
        reviews = [hv.review_record(7, self.H, "2026-10-05T10:00:00Z"),
                   hv.review_record(7, self.H, "2026-10-06T10:00:00+02:00")]
        cands = [self.bot(7, self.H, "2026-10-05T10:00:00Z"),        # same second: reviewed first
                 self.bot(7, self.H.upper(), "2026-10-05T09:00:00Z"),  # before every review
                 self.bot(7, "b" * 40, "2026-10-07T00:00:00Z"),       # head never reviewed
                 self.bot(8, self.H, "2026-10-07T00:00:00Z"),         # other PR
                 {"kind": "fix"}]
        hv.tag_reviewed(cands, reviews)
        self.assertEqual([c.get("review") for c in cands],
                         ["missed", "reviewed-later", "no-record", "no-record", None])
        self.assertEqual(cands[0]["reviewed_at"], "2026-10-05T10:00:00Z")

    def test_load_reviewed_from_ledger_dir_and_json(self):
        ledger = os.path.join(self.tmp, "findings")
        write(os.path.join(ledger, "7.jsonl"), "\n".join([
            json.dumps({"v": 1, "type": "observation", "pr": 7, "head_sha": self.H, "at": "2026-10-05T10:00:00Z"}),
            json.dumps({"v": 1, "type": "transition", "head_sha": self.H, "at": "2026-10-05T11:00:00Z"}),
            json.dumps({"v": 1, "type": "observation", "pr": 7, "head_sha": "short", "at": "2026-10-05T10:00:00Z"}),
            "not json",
        ]) + "\n")
        write(os.path.join(ledger, "7.state"), "x\n")
        self.assertEqual([(r["pr"], r["head"]) for r in hv.load_reviewed(ledger)], [(7, self.H)])
        runs = os.path.join(self.tmp, "runs.json")
        write(runs, json.dumps([{"pr": "9", "head": self.H, "at": "2026-10-05T10:00:00"},
                                {"pr": 9, "head": self.H, "at": "yesterday"}]))
        self.assertEqual([(r["pr"], r["at"]) for r in hv.load_reviewed(runs)],
                         [(9, hv.epoch("2026-10-05T10:00:00Z"))])

    def test_cli_misses_only_needs_reviewed(self):
        res = subprocess.run([sys.executable, HARVEST, "--repo-dir", ROOT, "--repo", "test/demo",
                              "--bots", "--misses-only"], capture_output=True, text=True, check=False)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("--misses-only needs", res.stderr)


class HarvestCiTest(Tmp):
    def run_(self, rid, wf, num, conclusion, sha, day, branch="main", event="push"):
        return {"id": rid, "workflow_id": wf, "name": "CI %d" % wf, "run_number": num, "status": "completed",
                "conclusion": conclusion, "head_sha": sha, "head_branch": branch, "event": event,
                "created_at": day + "T12:00:00Z", "html_url": "https://github.com/t/d/actions/runs/%d" % rid}

    def history(self):
        repo = self.tmp
        git(repo, "init", "-q", "-b", "main")
        commit(repo, "chore: init", {"README.md": "x\n"})
        good = commit(repo, "feat: a (#20)", {"lib/a.sh": lines(5)})
        bad = commit(repo, "feat: b (#21)", {"lib/a.sh": lines(5, {4: "broken"})})
        later = commit(repo, "docs: c (#22)", {"README.md": "y\n"})
        return hv.read_history(repo, "main"), good, bad, later

    def test_red_after_green_is_tied_to_the_pr_and_its_lines(self):
        (commits, show, _), good, bad, later = self.history()
        runs = [self.run_(1, 1, 1, "success", good, "2026-10-02"),
                self.run_(2, 1, 2, "failure", bad, "2026-10-03"),
                self.run_(3, 1, 3, "failure", later, "2026-10-04"),     # still red: not a new break
                self.run_(4, 2, 1, "timed_out", good, "2026-10-02"),    # nothing earlier: unknown
                self.run_(5, 2, 2, "cancelled", bad, "2026-10-03"),     # undecided, skipped
                self.run_(6, 2, 3, "success", later, "2026-10-04"),
                self.run_(7, 3, 1, "failure", bad, "2026-10-03", branch="feature"),
                self.run_(8, 3, 2, "failure", bad, "2026-10-03", event="pull_request"),
                self.run_(9, 4, 1, "failure", "f" * 40, "2026-10-03")]  # not on this ref
        found = hv.ci_candidates(runs, commits, "t/d", show, "main", "2026-10-01", "2026-10-31",
                                 jobs={2: [{"job": "test", "steps": ["bats"]}]})
        by_id = {c["run_id"]: c for c in found}
        self.assertEqual(sorted(by_id), [2, 4, 9])
        hit = by_id[2]
        self.assertEqual((hit["pr"], hit["head"], hit["previous"]), (21, bad, "success"))
        self.assertEqual(hit["base"], good)
        self.assertEqual(hit["hunks"], [{"file": "lib/a.sh", "line": 4}])
        self.assertEqual(hit["failed_jobs"], [{"job": "test", "steps": ["bats"]}])
        self.assertEqual(by_id[4]["previous"], "unknown")
        self.assertEqual((by_id[9]["pr"], by_id[9]["hunks"]), (None, []))
        self.assertIn("not on this ref", by_id[9]["note"])
        # The lookback run before --since gives `previous`; it is not a candidate itself.
        found = hv.ci_candidates(runs, commits, "t/d", show, "main", "2026-10-03", "2026-10-03")
        self.assertEqual([c["run_id"] for c in found], [2, 9])

    def test_harvest_ci_queries_with_lookback_and_fetches_failed_jobs(self):
        (commits, show, _), good, bad, _ = self.history()
        calls = []
        runs = [self.run_(2, 1, 2, "failure", bad, "2026-10-03"), self.run_(1, 1, 1, "success", good, "2026-09-28")]
        jobs = {"jobs": [{"name": "lint", "conclusion": "success", "steps": []},
                         {"name": "test", "conclusion": "failure",
                          "steps": [{"name": "setup", "conclusion": "success"},
                                    {"name": "bats", "conclusion": "failure"}]}]}

        def get(path, params=None):
            calls.append((path, params))
            return {"workflow_runs": runs} if path.endswith("/actions/runs") else jobs

        found, truncated = hv.harvest_ci("t/d", "main", "2026-10-01", "2026-10-31", commits, show, get=get)
        self.assertFalse(truncated)
        self.assertEqual(calls[0][1]["created"], "2026-09-24..2026-10-31")
        self.assertEqual((calls[0][1]["branch"], calls[0][1]["event"]), ("main", "push"))
        self.assertEqual(calls[1][0], "repos/t/d/actions/runs/2/jobs")
        self.assertEqual([c["run_id"] for c in found], [2])
        self.assertEqual(found[0]["previous"], "success")
        self.assertEqual(found[0]["failed_jobs"], [{"job": "test", "steps": ["bats"]}])


if __name__ == "__main__":
    unittest.main()
