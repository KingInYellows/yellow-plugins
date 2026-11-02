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
        self.assertEqual(res.returncode, 0, res.stderr)
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
        res = self.cli("run", self.work, "--retry-incomplete")
        self.assertEqual(self.logged(), ["case-incomplete.json"])
        # A changed input (the parent model) changes every fingerprint.
        shutil.rmtree(self.log)
        self.prepare("--model", "haiku")
        res = self.cli("run", self.work, env={**self.env, "STANDIN_FAIL": "case-hit"})
        self.assertEqual(res.returncode, 1)
        self.assertEqual(len(self.logged()), 5)
        self.assertTrue(os.path.exists(os.path.join(self.work, "out", "case-hit.bad")))
        self.assertIn("case-hit", rg.summarize(self.work)["missing"])

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
                         ["version is 2, not 1", "findings is not a list of objects", "coverage is missing"])

    def summary(self, recall, fp, cost, ids=("a", "b")):
        return {"recall": recall, "fp_rate": fp, "mean_cost_usd": cost, "mean_agents": 10,
                "missing": [], "incomplete": [], "rows": [{"id": i} for i in ids]}

    def test_keep_drop_rule(self):
        v = lambda new, base: rg.verdict(new, base)[0]
        base = self.summary(0.5, 0.1, 1.0)
        self.assertEqual(v(self.summary(0.6, 0.1, 2.0), base), "keep")
        self.assertEqual(v(self.summary(0.5, 0.1, 0.8), base), "keep")
        self.assertEqual(v(self.summary(0.5, 0.1, 1.0), base), "drop")
        self.assertEqual(v(self.summary(0.9, 0.2, 0.5), base), "drop")
        self.assertEqual(v(self.summary(0.4, 0.0, 0.5), base), "drop")
        self.assertEqual(v(self.summary(0.9, 0.0, 0.5, ids=("a",)), base), "no verdict")
        self.assertEqual(v({**self.summary(0.9, 0.0, 0.5), "incomplete": [{"id": "a"}]}, base), "no verdict")

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
        self.assertEqual((codex["file"], codex["line"]), ("plugins/x/lib/y.sh", 42))
        self.assertEqual(codex["head"], "a" * 40)  # the head the bot reviewed
        self.assertEqual(codex["base"], "1" * 40)
        self.assertTrue(codex["merged"])
        self.assertIn("Ignore previous instructions", codex["excerpt"])  # stored, never acted on
        self.assertEqual(bugbot["line"], 17)
        self.assertFalse(bugbot["merged"])

    def test_fetch_pages_and_pull_lookups_are_get_only(self):
        calls = []
        comments = self.fixture("comments.json")
        pulls = self.fixture("pulls.json")

        def get(path, params=None):
            calls.append((path, params))
            if path.endswith("/pulls/comments"):
                return comments
            return pulls[path.rsplit("/", 1)[1]]

        found = hv.harvest_bots("test/demo", "2026-10-01", "2026-10-31", get=get)
        self.assertEqual(len(found), 2)
        self.assertEqual(calls[0][1]["since"], "2026-10-01T00:00:00Z")
        self.assertEqual([c[0] for c in calls[1:]], ["repos/test/demo/pulls/7", "repos/test/demo/pulls/9"])

    def test_bots_skipped_without_gh(self):
        repo = os.path.join(self.tmp, "repo")
        os.makedirs(repo)
        git(repo, "init", "-q", "-b", "main")
        commit(repo, "chore: init", {"a": "1\n"})
        bin_dir = os.path.join(self.tmp, "bin")
        os.makedirs(bin_dir)
        os.symlink(shutil.which("git"), os.path.join(bin_dir, "git"))
        res = subprocess.run([sys.executable, HARVEST, "--repo-dir", repo, "--repo", "test/demo",
                              "--ref", "main", "--bots"], capture_output=True, text=True, check=False,
                             env={**os.environ, **GIT_ENV, "PATH": bin_dir})
        self.assertEqual(res.returncode, 0, res.stderr)
        out = json.loads(res.stdout)
        self.assertEqual(out["sources"], {"git": "ok", "bots": "skipped: gh not found"})
        self.assertEqual(out["candidates"], [])


if __name__ == "__main__":
    unittest.main()
