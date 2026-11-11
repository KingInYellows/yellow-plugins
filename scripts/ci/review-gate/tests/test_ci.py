"""Tests for the review-gate CI driver. They spend nothing: `claude` is the
review-gate eval's stand-in, and git history is a throwaway repo per test.

Run: python3 -m unittest discover scripts/ci/review-gate/tests
"""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TESTS)
REPO = os.path.realpath(os.path.join(ROOT, "..", "..", ".."))
STANDIN = os.path.join(REPO, "scripts", "eval", "review-gate", "tests", "fixtures", "bin", "claude")

spec = importlib.util.spec_from_file_location("review_gate_ci", os.path.join(ROOT, "ci.py"))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)

GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@example.invalid", "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_CONFIG_NOSYSTEM": "1"}


def git(repo, *args):
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True,
                          env={**os.environ, **GIT_ENV}).stdout.strip()


def commit(repo, message, files):
    for path, text in files.items():
        full = os.path.join(repo, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)
    return git(repo, "rev-parse", "HEAD")


POLICY = json.dumps({"version": 1, "default_tier": "medium", "low_max_lines": 300, "rules": [
    {"tier": "high", "why": "ci", "paths": [".github/workflows/*"]},
    {"tier": "low", "why": "docs", "paths": ["docs/*"]},
]})


class SelectTest(unittest.TestCase):
    def test_low_tier_runs_the_two_low_hunters(self):
        self.assertEqual(ci.select_hunters("low", ["docs/a.md"], 3, "+x\n"),
                         ["correctness-reviewer", "project-compliance-reviewer"])

    def test_medium_adds_by_path_and_diff(self):
        got = ci.select_hunters("medium", ["plugins/p/commands/x.md", "plugins/p/tests/x.bats"], 50,
                                "+  try {\n")
        self.assertEqual(got[:4], list(ci.ALWAYS))
        for name in ("plugin-contract-reviewer", "pattern-recognition-specialist", "pr-test-analyzer",
                     "silent-failure-hunter"):
            self.assertIn(name, got)
        self.assertNotIn("adversarial-reviewer", got)
        self.assertNotIn("security-reviewer", got)

    def test_removed_lines_do_not_trigger(self):
        self.assertNotIn("silent-failure-hunter",
                         ci.select_hunters("medium", ["a.py"], 5, "-try:\n--- a/try.py\n"))

    def test_high_adds_the_high_set(self):
        got = ci.select_hunters("high", [".github/workflows/x.yml"], 10, "")
        for name in ("adversarial-reviewer", "reliability-reviewer", "security-reviewer"):
            self.assertIn(name, got)

    def test_every_name_is_a_review_gate_persona(self):
        with open(os.path.join(REPO, "plugins", "yellow-review", "workflows", "review-gate.js"),
                  encoding="utf-8") as handle:
            body = handle.read()
        for name in ci.ORDER:
            self.assertIn("'%s'" % name, body)


class Flow(unittest.TestCase):
    """prepare -> run (stand-in claude) -> render, in a throwaway repo."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="review-gate-ci-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.pr = os.path.join(self.tmp, "pr")
        os.makedirs(self.pr)
        git(self.pr, "init", "-q", "-b", "main")
        self.main = commit(self.pr, "base", {".github/review-risk.json": POLICY,
                                             "REVIEW.md": "main review rules\n",
                                             "docs/a.md": "a\n"})
        self.work = os.path.join(self.tmp, "work")
        self.env = mock.patch.dict(os.environ, {"STANDIN_LOG": os.path.join(self.tmp, "log"),
                                                "STANDIN_RESPONSES": os.path.join(self.tmp, "resp")})
        self.env.start()
        self.addCleanup(self.env.stop)

    def prepare(self, files):
        git(self.pr, "checkout", "-q", "-B", "feature", self.main)
        head = commit(self.pr, "change", files)
        ci.prepare(self.work, self.pr, "o/r", 7, self.main, head, self.main)
        return head

    def args(self):
        with open(os.path.join(self.work, "prompts", "args.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def test_prepare_uses_the_default_branch_policy_and_review_md(self):
        # The PR lowers its own tier and rewrites REVIEW.md; neither counts.
        weaker = json.dumps({"version": 1, "default_tier": "low", "rules": []})
        self.prepare({".github/review-risk.json": weaker, "REVIEW.md": "anything goes\n",
                      "docs/a.md": "b\n"})
        args = self.args()
        self.assertEqual(args["tier"], "high")
        self.assertEqual(args["review_md"], "main review rules\n")
        self.assertEqual(args["base"], self.main)
        self.assertEqual(args["repo_root"], os.path.realpath(self.pr))
        self.assertEqual(sorted(args["changed_files"]), [".github/review-risk.json", "REVIEW.md", "docs/a.md"])
        self.assertEqual(args["dismissed"], [])

    def test_run_complete(self):
        self.prepare({"docs/a.md": "b\n"})
        self.assertEqual(ci.run(self.work, STANDIN, "sonnet", 60), 0)
        result = ci.read_json(os.path.join(self.work, "result.json"))
        self.assertEqual(result["status"], "complete")
        with open(os.path.join(self.tmp, "log", "pr.json"), encoding="utf-8") as handle:
            call = json.load(handle)
        self.assertEqual(call["args"], self.args())
        argv = call["argv"]
        self.assertIn("Workflow(yellow-review:review-gate)", argv[argv.index("--allowedTools") + 1])
        self.assertIn("Bash", argv[argv.index("--disallowedTools") + 1])
        self.assertEqual(argv[argv.index("--max-budget-usd") + 1], "25")

    def test_a_failed_hunter_is_incomplete_never_clean(self):
        self.prepare({"docs/a.md": "b\n"})
        os.makedirs(os.path.join(self.tmp, "resp"))
        with open(os.path.join(self.tmp, "resp", "pr.json"), "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "tier": "low", "findings": [], "dropped": [], "agents": 1,
                       "coverage": {"ran": ["correctness-reviewer"],
                                    "failed": ["project-compliance-reviewer"], "skipped": []}}, handle)
        ci.run(self.work, STANDIN, "sonnet", 60)
        self.assertEqual(ci.read_json(os.path.join(self.work, "result.json"))["status"], "incomplete")
        with mock.patch("sys.stdout"):
            ci.render(self.work, "shadow")
        with open(os.path.join(self.work, "comment.md"), encoding="utf-8") as handle:
            body = handle.read()
        self.assertIn("incomplete", body)
        self.assertIn("Failed: project-compliance-reviewer.", body)
        self.assertIn('"status": "incomplete"', body)

    def test_a_crashed_run_is_an_error(self):
        self.prepare({"docs/a.md": "b\n"})
        with mock.patch.dict(os.environ, {"STANDIN_FAIL": "pr"}):
            self.assertEqual(ci.run(self.work, STANDIN, "sonnet", 60), 1)
        result = ci.read_json(os.path.join(self.work, "result.json"))
        self.assertEqual(result["status"], "error")
        self.assertIn("exited 1", result["reason"])

    def test_a_timeout_is_an_error(self):
        self.prepare({"docs/a.md": "b\n"})
        slow = os.path.join(self.tmp, "slow-claude")
        with open(slow, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\nsleep 5\n")
        os.chmod(slow, 0o755)
        self.assertEqual(ci.run(self.work, slow, "sonnet", 1), 1)
        result = ci.read_json(os.path.join(self.work, "result.json"))
        self.assertEqual(result["status"], "error")
        self.assertIn("timed out", result["reason"])

    def test_a_quoted_credential_never_reaches_the_outputs(self):
        self.prepare({"docs/a.md": "b\n"})
        token = "ghp_" + "A1b2" * 9
        os.makedirs(os.path.join(self.tmp, "resp"))
        finding = {"display": "Important", "severity": "P1", "file": "docs/a.md", "line": 1,
                   # a zero-width space inside the token must not hide it
                   "title": "hardcoded " + token[:10] + "\u200b" + token[10:],
                   "suggested_fix": "drop " + token}
        with open(os.path.join(self.tmp, "resp", "pr.json"), "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "tier": "low", "findings": [finding], "dropped": [],
                       "agents": 2, "coverage": {"ran": ["correctness-reviewer",
                                                         "project-compliance-reviewer"],
                                                 "failed": [], "skipped": []}}, handle)
        self.assertEqual(ci.run(self.work, STANDIN, "sonnet", 60), 0)
        with mock.patch("sys.stdout"):
            ci.render(self.work, "advisory")
        for name in ("result.json", "comment.md"):
            with open(os.path.join(self.work, name), encoding="utf-8") as handle:
                text = handle.read()
            self.assertNotIn(token[4:], text, name)
            self.assertIn("REDACTED:github-token", text, name)
        self.assertEqual(ci.read_json(os.path.join(self.work, "result.json"))["status"], "complete")

    def test_redaction_failure_withholds_the_text(self):
        with mock.patch.object(ci, "_redact_run", return_value=None):
            self.assertEqual(ci.redact(["a", {"b": ["c"]}, 3]),
                             [ci.WITHHELD, {"b": [ci.WITHHELD]}, 3])

    def test_wrapped_tokens_keys_and_surrogates(self):
        token = "ghp_" + "A1b2" * 9
        wrapped = "see " + token[:20] + "\n" + token[20:]
        out = ci.redact({"title": wrapped, token: "x", "ok": "plain text\nmore", "s": "a\ud800b"})
        text = json.dumps(out)
        self.assertNotIn(token[4:], text)
        self.assertNotIn(token[4:20], text)
        self.assertEqual(out["title"], ci.WITHHELD)
        self.assertEqual(out["ok"], "plain text\nmore")
        self.assertEqual(out["s"], "ab")

    def test_a_failed_redaction_is_incomplete_never_clean(self):
        self.prepare({"docs/a.md": "b\n"})
        with mock.patch.object(ci, "_redact_run", return_value=None):
            self.assertEqual(ci.run(self.work, STANDIN, "sonnet", 60), 0)
        result = ci.read_json(os.path.join(self.work, "result.json"))
        self.assertEqual(result["status"], "incomplete")
        self.assertIn("redaction failed", result["reason"])
        self.assertIn("findings", result["workflow"])

    def test_a_withheld_key_makes_the_run_incomplete(self):
        self.prepare({"docs/a.md": "b\n"})
        token = "ghp_" + "A1b2" * 9
        wrapped = token[:20] + "\n" + token[20:]
        os.makedirs(os.path.join(self.tmp, "resp"))
        with open(os.path.join(self.tmp, "resp", "pr.json"), "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "tier": "low", "findings": [], "dropped": [], "agents": 2,
                       "coverage": {"ran": ["correctness-reviewer", "project-compliance-reviewer"],
                                    "failed": [], "skipped": []},
                       wrapped: "x", "word\n": "y"}, handle)
        ci.run(self.work, STANDIN, "sonnet", 60)
        result = ci.read_json(os.path.join(self.work, "result.json"))
        self.assertEqual(result["status"], "incomplete")
        self.assertIn(ci.WITHHELD, result["workflow"])
        self.assertNotIn(token[4:20], json.dumps(result))
        # a trailing newline is not a schema key, so it goes through redaction
        self.assertIsNone(ci.SCHEMA_KEY.fullmatch("word\n"))

    def test_stderr_is_redacted_before_it_is_saved(self):
        self.prepare({"docs/a.md": "b\n"})
        token = "ghp_" + "A1b2" * 9
        noisy = os.path.join(self.tmp, "noisy-claude")
        with open(noisy, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\necho 'auth failed for %s' >&2\nexit 1\n" % token)
        os.chmod(noisy, 0o755)
        self.assertEqual(ci.run(self.work, noisy, "sonnet", 60), 1)
        for name in ("claude.err", "result.json"):
            with open(os.path.join(self.work, name), encoding="utf-8") as handle:
                self.assertNotIn(token[4:], handle.read(), name)

    def test_render_makes_model_text_inert(self):
        self.prepare({"docs/a.md": "b\n"})
        finding = {"display": "Important", "severity": "P1", "file": "docs/a.md", "line": 1,
                   "title": "ping @someone <img src=x> | [link](http://x) `code`\nnext",
                   "suggested_fix": None}
        ci.write_json(os.path.join(self.work, "result.json"), {
            "status": "complete", "reason": "", "cli": {},
            "workflow": {"version": 1, "tier": "low", "findings": [finding], "dropped": [],
                         "agents": 3, "coverage": {"ran": [], "failed": [], "skipped": []}}})
        with mock.patch("sys.stdout"):
            ci.render(self.work, "advisory", "https://github.com/o/r/actions/runs/5")
        with open(os.path.join(self.work, "comment.md"), encoding="utf-8") as handle:
            body = handle.read()
        self.assertTrue(body.startswith(ci.MARKER))
        row = next(line for line in body.splitlines() if line.startswith("| `docs/a.md:1`"))
        for bad in ("@someone", "<img", "](", "`code`", "http://x"):
            self.assertNotIn(bad, row)
        self.assertIn("next", row)
        self.assertEqual(row.count("|"), 4)
        self.assertIn("1 Important", body)
        self.assertIn("[Run](https://github.com/o/r/actions/runs/5)", body)
        self.assertIn('"important": 1', body)


class RenderMalformedTest(unittest.TestCase):
    def test_malformed_fields_render_as_incomplete(self):
        work = tempfile.mkdtemp(prefix="review-gate-ci-bad-")
        self.addCleanup(shutil.rmtree, work, True)
        ci.write_json(os.path.join(work, "meta.json"), {
            "repo": "o/r", "pr": 7, "head": "a" * 40, "include": ["correctness-reviewer"],
            "risk": {"tier": "low"}})
        ev = ci.load_eval()
        wf = {"version": 1, "findings": 7, "dropped": "x", "agents": 1,
              "coverage": {"ran": [], "failed": 7}}
        result = ci.classify_run(ev, 0, json.dumps({"type": "result", "is_error": False,
                                                    "result": json.dumps(wf)}), "")
        self.assertEqual(result["status"], "incomplete")
        ci.write_json(os.path.join(work, "result.json"), result)
        with mock.patch("sys.stdout"):
            ci.render(work, "advisory")
        with open(os.path.join(work, "comment.md"), encoding="utf-8") as handle:
            body = handle.read()
        self.assertIn("incomplete", body)
        self.assertIn("findings is not a list", body)


class PostTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="review-gate-ci-post-")
        self.addCleanup(shutil.rmtree, self.work, True)
        ci.write_json(os.path.join(self.work, "meta.json"), {"repo": "o/r", "pr": 7, "head": "a" * 40})
        with open(os.path.join(self.work, "comment.md"), "w", encoding="utf-8") as handle:
            handle.write(ci.MARKER + "\nbody\n")

    def test_edits_the_existing_comment(self):
        calls = []

        def fake(*args):
            calls.append(args)
            return {0: "a" * 40 + "\n", 1: "11\n12\n"}.get(len(calls) - 1, "11\n")
        with mock.patch.object(ci, "gh", fake):
            ci.post(self.work)
        self.assertEqual(calls[2][:3], ("-X", "PATCH", "repos/o/r/issues/comments/11"))

    def test_creates_one_when_none_exists(self):
        calls = []

        def fake(*args):
            calls.append(args)
            return "a" * 40 if len(calls) == 1 else ""
        with mock.patch.object(ci, "gh", fake):
            ci.post(self.work)
        self.assertEqual(calls[2][:3], ("-X", "POST", "repos/o/r/issues/7/comments"))

    def test_skips_when_the_head_moved(self):
        calls = []

        def fake(*args):
            calls.append(args)
            return "b" * 40
        with mock.patch.object(ci, "gh", fake):
            ci.post(self.work)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
