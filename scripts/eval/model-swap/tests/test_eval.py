"""Offline tests for the model-swap harness pieces the eval corpus relies on.

Run: python3 -m unittest discover -s scripts/eval/model-swap/tests
Nothing here calls a model.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import eval as harness  # noqa: E402


def sh(*args, cwd):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


class FilesPassTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.wt = self.tmp.name
        sh("git", "init", "-q", cwd=self.wt)
        os.makedirs(os.path.join(self.wt, "plans"))
        for path, text in (("plans/old.md", "## Acceptance Criteria\nold\n"),
                           ("docs/security.md", "boundary\n"),
                           ("lib/a.sh", "trap \"rmdir '$LOCK'\" EXIT\n")):
            os.makedirs(os.path.dirname(os.path.join(self.wt, path)), exist_ok=True)
            with open(os.path.join(self.wt, path), "w", encoding="utf-8") as handle:
                handle.write(text)
        sh("git", "add", "-A", cwd=self.wt)
        sh("git", "-c", "user.name=t", "-c", "user.email=t@example.invalid",
           "commit", "-q", "-m", "base", cwd=self.wt)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, path, text):
        with open(os.path.join(self.wt, path), "w", encoding="utf-8") as handle:
            handle.write(text)

    def test_changed_ignores_files_already_in_the_tree(self):
        plan = {"files": [{"glob": "plans/*.md", "changed": True, "count": 1,
                           "match": ["Acceptance Criteria"]}]}
        self.assertFalse(harness.files_pass(plan, self.wt))
        self.write("plans/new.md", "## Acceptance Criteria\nnew\n")
        self.assertTrue(harness.files_pass(plan, self.wt))
        self.write("plans/second.md", "## Acceptance Criteria\n")
        self.assertFalse(harness.files_pass(plan, self.wt))

    def test_added_ignores_edits_to_existing_files(self):
        plan = {"files": [{"glob": "plans/*.md", "changed": "added", "count": 1,
                           "match": ["Acceptance Criteria"]}]}
        self.write("plans/old.md", "## Acceptance Criteria\nold, edited\n")
        self.assertFalse(harness.files_pass(plan, self.wt))
        self.assertTrue(harness.files_pass(dict(plan, files=[dict(plan["files"][0], changed=True)]),
                                           self.wt))
        self.write("plans/new.md", "## Acceptance Criteria\nnew\n")
        self.assertTrue(harness.files_pass(plan, self.wt))

    def test_count_zero_asserts_a_file_was_left_alone(self):
        oos = {"files": [{"glob": "docs/security.md", "changed": True, "count": 0}]}
        self.assertTrue(harness.files_pass(oos, self.wt))
        self.write("docs/security.md", "boundary, edited\n")
        self.assertFalse(harness.files_pass(oos, self.wt))

    def test_count_zero_without_changed_still_needs_no_match(self):
        none = {"files": [{"glob": "missing/*.md", "count": 0}]}
        self.assertTrue(harness.files_pass(none, self.wt))
        present = {"files": [{"glob": "docs/security.md", "count": 0}]}
        self.assertFalse(harness.files_pass(present, self.wt))
        legacy = {"files": [{"glob": "missing/*.md"}]}
        self.assertFalse(harness.files_pass(legacy, self.wt))

    def test_content_only_judges_regexes_on_unchanged_files(self):
        fixed = {"files": [{"glob": "lib/a.sh", "changed": True, "count": 1,
                            "match": ["trap '[^'\\n]*\"\\$LOCK\""], "not": ["trap \"rmdir '\\$LOCK'"]}]}
        self.assertFalse(harness.files_pass(fixed, self.wt, content_only=True))
        # Unchanged in git, but its content matches: content_only still passes.
        clean = {"files": [{"glob": "docs/security.md", "changed": True, "count": 1,
                            "match": ["boundary"]}]}
        self.assertTrue(harness.files_pass(clean, self.wt, content_only=True))
        self.assertFalse(harness.files_pass(clean, self.wt))
        self.write("lib/a.sh", "trap 'rmdir \"$LOCK\"' EXIT\n")
        self.assertTrue(harness.files_pass(fixed, self.wt, content_only=True))
        self.assertTrue(harness.files_pass(fixed, self.wt))

    def test_deleting_a_left_alone_file_fails(self):
        oos = {"files": [{"glob": "docs/security.md", "changed": True, "count": 0}]}
        os.remove(os.path.join(self.wt, "docs/security.md"))
        changed, removed = harness.changed_files(self.wt)
        gone = os.path.join(self.wt, "docs/security.md")
        self.assertNotIn(gone, changed)
        self.assertIn(gone, removed)
        self.assertFalse(harness.files_pass(oos, self.wt))

    def test_renaming_a_left_alone_file_away_fails(self):
        oos = {"files": [{"glob": "docs/*.md", "changed": True, "count": 0}]}
        sh("git", "mv", "docs/security.md", "security.txt", cwd=self.wt)
        self.assertFalse(harness.files_pass(oos, self.wt))

    def test_deleting_an_unrelated_file_does_not_fail(self):
        oos = {"files": [{"glob": "docs/security.md", "changed": True, "count": 0}]}
        os.remove(os.path.join(self.wt, "lib/a.sh"))
        self.assertTrue(harness.files_pass(oos, self.wt))


class SymlinkOnPathTest(unittest.TestCase):
    def test_finds_a_symlinked_parent_directory(self):
        with tempfile.TemporaryDirectory() as wt, tempfile.TemporaryDirectory() as outside:
            os.symlink(outside, os.path.join(wt, "references"))
            os.makedirs(os.path.join(wt, "plugins", "x"))
            self.assertEqual(harness.symlink_on_path(wt, "references/contract.md"), "references")
            self.assertIsNone(harness.symlink_on_path(wt, "plugins/x/contract.md"))


class AgentToolsTest(unittest.TestCase):
    def test_command_reads_allowed_tools_without_mcp_or_questions(self):
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
            handle.write("---\nname: x\nallowed-tools:\n  - Bash\n  - Read\n  - AskUserQuestion\n"
                         "  - mcp__plugin_x__y\n  - Agent\n---\nbody\n")
        try:
            self.assertEqual(harness.agent_tools(handle.name, command=True), "Bash,Read,Agent")
            self.assertEqual(harness.agent_tools(handle.name), "")
        finally:
            os.remove(handle.name)

    def test_agent_tools_unchanged(self):
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
            handle.write("---\nname: x\ntools:\n  - Read\n  - Edit\n---\nbody\n")
        try:
            self.assertEqual(harness.agent_tools(handle.name), "Read,Edit")
        finally:
            os.remove(handle.name)


class CheckSpecTest(unittest.TestCase):
    def spec(self, **case):
        return {"configs": {}, "agents": {}, "prompt_commit": "b" * 40,
                "prompts": [{"id": "c1", **case}]}

    def test_commits_must_be_full_shas(self):
        for spec in (dict(self.spec(), prompt_commit="b07eb1e"),
                     dict(self.spec(), prompt_commit="--upload-pack=x"),
                     self.spec(selfcheck={"fix": "-c", "paths": ["a"]}),
                     self.spec(selfcheck={"fix": "a" * 39, "paths": ["a"]}),
                     dict(self.spec(), replays=[{"id": "r", "commit": "--all", "plants": []}])):
            with self.assertRaises(SystemExit):
                harness.check_spec(spec)
        harness.check_spec(self.spec(selfcheck={"fix": "a" * 40, "paths": ["a"]}))
        harness.check_spec(dict(self.spec(), replays=[{"id": "r", "commit": "31d1fb8", "plants": []}]))

    def test_lookalike_paths_must_be_repo_relative(self):
        with self.assertRaises(SystemExit):
            harness.check_spec(self.spec(selfcheck={"fix": "a" * 40, "paths": ["a"],
                                                    "lookalikes": [{"path": "../a", "append": "x"}]}))
        with self.assertRaises(SystemExit):
            harness.check_spec(self.spec(selfcheck={"fix": "a" * 40, "paths": ["a"],
                                                    "alternates": [{"path": "../a", "append": "x"}]}))

    def test_an_entry_without_a_commit_is_unsafe_not_a_crash(self):
        for spec in (dict(self.spec(), replays=[{"id": "r", "plants": []}]),
                     dict(self.spec(), scans=[{"id": "s", "files": []}]),
                     self.spec(source={"path": "a.md"})):
            with self.assertRaises(SystemExit) as err:
                harness.check_spec(spec)
            self.assertIn("unsafe spec values", str(err.exception))

    def test_tree_must_be_a_full_sha(self):
        with self.assertRaises(SystemExit):
            harness.check_spec(self.spec(tree="main"))
        harness.check_spec(self.spec(tree="a" * 40))

    def test_plugin_names_are_single_directory_names(self):
        for name in ("yellow-core:evil", "a/b"):
            spec = self.spec()
            spec["agents"] = {"a": {"file": "a.md", "plugins": [name]}}
            with self.assertRaises(SystemExit):
                harness.check_spec(spec)

    def test_selfcheck_paths_must_be_repo_relative(self):
        for sc in ({"fix": "a" * 40, "paths": ["/etc/passwd"]}, {"fix": "a" * 40, "paths": ["../x"]},
                   {"doc": "../x.md"}):
            with self.assertRaises(SystemExit):
                harness.check_spec(self.spec(selfcheck=sc))

    def test_overlay_and_plugins_must_be_repo_relative(self):
        for agent in ({"file": "a.md", "overlay": ["../x"]}, {"file": "a.md", "plugins": ["../x"]}):
            spec = self.spec()
            spec["agents"] = {"a": agent}
            with self.assertRaises(SystemExit):
                harness.check_spec(spec)


def commit_all(repo, msg):
    sh("git", "add", "-A", cwd=repo)
    sh("git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", msg,
       cwd=repo)
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True,
                          text=True).stdout.strip()


class TempRepo(unittest.TestCase):
    """A throwaway repository standing in for the checkout (harness.REPO)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = os.path.join(self.tmp.name, "repo")
        self.work = os.path.join(self.tmp.name, "work")
        os.makedirs(self.repo)
        sh("git", "init", "-q", cwd=self.repo)
        self.saved = harness.REPO
        harness.REPO = self.repo
        self.addCleanup(self.restore)

    def restore(self):
        harness.REPO = self.saved
        for handle in harness.LOCKS:
            handle.close()
        harness.LOCKS.clear()
        self.tmp.cleanup()

    def write(self, path, text):
        full = os.path.join(self.repo, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(text)


class CheckTest(TempRepo):
    """eval.py check against a two-commit incident: buggy tree, then the fix."""

    def setUp(self):
        super().setUp()
        self.write("a.md", "---\nname: a\ntools:\n  - Read\n---\nbody\n")
        self.write("lib/kill.ts", "if (child.exitCode !== null) return;\n")
        self.tree = commit_all(self.repo, "buggy")
        self.write("lib/kill.ts", "if (!groupKill && child.exitCode !== null) return;\n")
        self.fix = commit_all(self.repo, "fix")

    def spec(self, **sc):
        selfcheck = {"fix": self.fix, "paths": ["lib/kill.ts"],
                     "reply": "THREAD T1 | disposition=fixed", **sc}
        return {"prompt_commit": self.fix,
                "configs": {"pinned": [{"model": "m", "effort": "e", "reps": 1}]},
                "agents": {"r": {"file": "a.md", "kind": "prompt", "configs": "pinned",
                                 "isolated": True, "prompt": "{context}",
                                 "expect": {"c1": {"match": ["^THREAD T1\\b.*disposition=fixed"],
                                                   "files": [{"glob": "lib/kill.ts",
                                                              "changed": True, "count": 1,
                                                              "match": ["exitCode"],
                                                              "not": ["if \\((?:(?!groupKill)[^;{}])*"
                                                                      "exitCode[^;{}]*\\)\\s*return"]}]}}}},
                "prompts": [{"id": "c1", "tree": self.tree, "incident": "test", "text": "fix it",
                             "selfcheck": selfcheck}]}

    def check(self, spec):
        path = os.path.join(self.tmp.name, "spec.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(spec, handle)
        try:
            harness.check([path], self.work)
        except SystemExit as err:
            return str(err)
        finally:
            for handle in harness.LOCKS:
                handle.close()
            harness.LOCKS.clear()
        return ""

    def test_a_sound_case_passes(self):
        self.assertEqual(self.check(self.spec()), "")

    def test_a_grader_the_buggy_tree_passes_is_reported(self):
        spec = self.spec()
        spec["agents"]["r"]["expect"]["c1"]["files"][0]["not"] = []
        self.assertIn("already pass before the fix", self.check(spec))

    def test_a_lookalike_the_grader_accepts_is_reported(self):
        la = {"path": "lib/kill.ts", "old": "if (!groupKill && child.exitCode !== null)",
              "new": "if ((child.exitCode !== null) && !groupKillDisabled)", "why": "x"}
        self.assertEqual(self.check(self.spec(lookalikes=[la])), "")
        spec = self.spec(lookalikes=[dict(la, new="if (child.exitCode != null)")])
        self.assertEqual(self.check(spec), "")
        loose = self.spec(lookalikes=[dict(la, new="if (child.exitCode != null)")])
        loose["agents"]["r"]["expect"]["c1"]["files"][0]["not"] = ["exitCode !== null\\) return"]
        self.assertIn("pass on lookalikes[0]", self.check(loose))
        self.assertIn("matches 0 times", self.check(self.spec(lookalikes=[dict(la, old="nope")])))

    def test_lookalike_append_bad_path_and_restore(self):
        la = {"path": "lib/kill.ts", "append": "if (child.exitCode !== null) return;\n", "why": "x"}
        self.assertEqual(self.check(self.spec(lookalikes=[la])), "")
        self.assertIn("is not a file in the tree",
                      self.check(self.spec(lookalikes=[dict(la, path="lib/missing.ts")])))
        twice = {"path": "lib/kill.ts", "old": "exitCode", "new": "x"}
        spec = self.spec(lookalikes=[dict(la, append="exitCode\n"), twice])
        # Each look-alike starts from the restored file: `old` matches once, not twice.
        self.assertNotIn("matches 2 times", self.check(spec))

    def test_reply_fixtures_prove_the_reply_regexes(self):
        self.assertIn("no recorded `reply`", self.check(self.spec(reply=None)))
        self.assertIn("fail on the recorded `reply`",
                      self.check(self.spec(reply="THREAD T1 | disposition=unclear")))
        self.assertIn("pass on reply_fails[0]",
                      self.check(self.spec(reply_fails=["THREAD T1 | disposition=fixed, again"])))
        self.assertEqual(self.check(self.spec(reply_fails=["THREAD T2 | disposition=fixed"])), "")

    def test_an_alternate_fix_the_grader_rejects_is_reported(self):
        alt = {"path": "lib/kill.ts", "old": "!groupKill && ", "new": "!groupKill &&\n  ",
               "why": "split"}
        self.assertEqual(self.check(self.spec(alternates=[alt])), "")
        bad = dict(alt, new="process.platform === 'win32' && ", why="platform guard")
        self.assertIn("fail on alternates[0] (platform guard)", self.check(self.spec(alternates=[bad])))
        self.assertIn("alternates[0] `old` matches 0 times",
                      self.check(self.spec(alternates=[dict(alt, old="nope")])))
        with open(os.path.join(self.repo, "lib/kill.ts"), encoding="utf-8") as handle:
            before = handle.read()
        self.check(self.spec(alternates=[bad]))
        with open(os.path.join(self.repo, "lib/kill.ts"), encoding="utf-8") as handle:
            self.assertEqual(handle.read(), before)

    def test_edits_on_a_protects_case_are_reported(self):
        edit = {"path": "lib/kill.ts", "append": "x\n", "why": "x"}
        for key in ("alternates", "lookalikes"):
            spec = self.spec(**{key: [edit]})
            sc = spec["prompts"][0]["selfcheck"]
            del sc["fix"], sc["paths"]
            sc["protects"] = ["lib/kill.ts"]
            self.assertIn("`lookalikes` and `alternates` need a `fix` or `doc` selfcheck",
                          self.check(spec))


class PrepareRunTest(TempRepo):
    def setUp(self):
        super().setUp()
        self.write("a.md", "---\nname: a\ntools:\n  - Read\n  - Bash\n---\nbody\n")
        self.write("ov/contract.md", "contract v1\n")
        self.write("plugins/p/x.md", "plugin v1\n")
        self.commit = commit_all(self.repo, "base")
        self.spec_path = os.path.join(self.tmp.name, "spec.json")

    def prepare(self, agent=None, **case):
        agent = agent or {}
        spec = {"prompt_commit": self.commit,
                "configs": {"pinned": [{"model": "m", "effort": "e", "reps": 1}]},
                "agents": {"r": {"file": "a.md", "kind": "prompt", "configs": "pinned",
                                 "isolated": True, "overlay": ["ov/contract.md"],
                                 "prompt": "{context}", "expect": {"c1": {"match": ["x"]}}, **agent}},
                "prompts": [{"id": "c1", "incident": "t",
                             **({} if "source" in case else {"text": "hi"}), **case}]}
        with open(self.spec_path, "w", encoding="utf-8") as handle:
            json.dump(spec, handle)
        harness.prepare(self.spec_path, self.work)
        for handle in harness.LOCKS:
            handle.close()
        harness.LOCKS.clear()

    def test_an_interrupted_prepare_leaves_no_matrix(self):
        self.prepare()
        self.assertTrue(os.path.isfile(os.path.join(self.work, "matrix.tsv")))
        with self.assertRaises(subprocess.CalledProcessError):
            self.prepare(source={"commit": self.commit, "path": "missing.md"})
        self.assertFalse(os.path.exists(os.path.join(self.work, "matrix.tsv")))
        with self.assertRaises(SystemExit) as err:
            harness.read_matrix(self.work)
        self.assertIn("prepare has not finished", str(err.exception))

    def test_run_stops_when_the_checkout_changed_since_prepare(self):
        self.prepare()
        for path in ("ov/contract.md", "a.md"):
            self.write(path, "edited\n")
            with self.assertRaises(SystemExit) as err:
                harness.run(self.work, 1, False)
            self.assertIn("changed since prepare", str(err.exception))
            for handle in harness.LOCKS:
                handle.close()
            harness.LOCKS.clear()
            self.prepare()

    def test_fixture_parts_cover_runner_inputs(self):
        agent = {"file": "a.md", "overlay": ["ov/contract.md"]}
        base = harness.fixture_parts(agent, "0")
        self.assertNotEqual(base, harness.fixture_parts(agent, "1"))
        self.assertNotEqual(base, harness.fixture_parts(dict(agent, plugins=["p"]), "0"))
        self.write("ov/contract.md", "contract v2\n")
        self.assertNotEqual(base, harness.fixture_parts(agent, "0"))
        plugin = {"file": "a.md", "plugins": ["p"], "fixtures": ["plugins/p"]}
        before = harness.fixture_parts(plugin, "0")
        self.write("plugins/p/x.md", "plugin v2\n")
        self.assertNotEqual(before, harness.fixture_parts(plugin, "0"))
        # Agents outside the corpus keep their old fingerprints: no runner or Bash part.
        self.assertEqual(harness.fixture_parts({"file": "a.md"}, "0"),
                         harness.fixture_parts({"file": "a.md"}, "1"))

    def test_a_second_process_on_the_work_dir_stops(self):
        harness.lock_work(self.work)
        holder = subprocess.Popen([sys.executable, "-c",
                                   "import sys; sys.path.insert(0, %r); import eval as h; "
                                   "h.lock_work(%r)" % (os.path.dirname(harness.__file__), self.work)],
                                  stderr=subprocess.PIPE, text=True)
        _, err = holder.communicate(timeout=60)
        self.assertNotEqual(holder.returncode, 0)
        self.assertIn("in use by another eval.py process", err)

    def lock_held_elsewhere(self):
        probe = subprocess.run([sys.executable, "-c",
                                "import sys; sys.path.insert(0, %r); import eval as h; "
                                "h.lock_work(%r)" % (os.path.dirname(harness.__file__), self.work)],
                               capture_output=True, text=True, timeout=60)
        return probe.returncode != 0 and "in use by another eval.py process" in probe.stderr

    def release(self):
        for handle in harness.LOCKS:
            handle.close()
        harness.LOCKS.clear()

    def test_grade_and_check_take_the_lock(self):
        self.prepare()
        harness.lock_work(self.work)
        holder = harness.LOCKS[:]
        harness.LOCKS.clear()
        for cmd in (["grade", self.work], ["check", self.work, self.spec_path]):
            res = subprocess.run([sys.executable, harness.__file__, *cmd], capture_output=True,
                                 text=True, timeout=60)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("in use by another eval.py process", res.stderr)
        harness.LOCKS.extend(holder)

    def stub_runner(self, body):
        here = os.path.join(self.tmp.name, "here")
        os.makedirs(here, exist_ok=True)
        stub = os.path.join(here, "run-one.sh")
        with open(stub, "w", encoding="utf-8") as handle:
            handle.write("#!/usr/bin/env bash\n" + body)
        os.chmod(stub, 0o755)
        saved = harness.HERE
        harness.HERE = here
        self.addCleanup(setattr, harness, "HERE", saved)

    def test_run_marks_corpus_rows_untrusted(self):
        log = os.path.join(self.tmp.name, "env.log")
        self.stub_runner('printf "%%s %%s\\n" "$2" "$EVAL_UNTRUSTED" >>%s\n' % json.dumps(log))
        self.prepare()
        harness.run(self.work, 1, False)
        self.release()
        with open(log, encoding="utf-8") as handle:
            self.assertEqual(handle.read().split()[1], "1")
        os.remove(log)
        # An agent with neither `overlay` nor `plugins` runs trusted.
        self.prepare(agent={"overlay": []})
        spec_path = os.path.join(self.work, "spec.json")
        with open(spec_path, encoding="utf-8") as handle:
            spec = json.load(handle)
        del spec["agents"]["r"]["overlay"]
        spec.pop("eval_inputs", None)
        with open(spec_path, "w", encoding="utf-8") as handle:
            json.dump(spec, handle)
        harness.run(self.work, 1, False)
        self.release()
        with open(log, encoding="utf-8") as handle:
            self.assertEqual(handle.read().split()[1], "0")

    def test_the_lock_outlives_a_killed_run_while_its_child_lives(self):
        pidfile = os.path.join(self.tmp.name, "child.pid")
        # The stub leaves a child behind, as claude would be after eval.py dies.
        self.stub_runner("sleep 30 &\necho $! >%s\n" % json.dumps(pidfile))
        self.prepare()
        harness.run(self.work, 1, False)
        with open(pidfile, encoding="utf-8") as handle:
            child = int(handle.read())
        self.addCleanup(lambda: subprocess.run(["kill", str(child)], capture_output=True))
        self.release()  # eval.py's own handle is gone, as after a forced exit
        self.assertTrue(self.lock_held_elsewhere())
        os.kill(child, 15)
        for _ in range(100):
            if not self.lock_held_elsewhere():
                break
        else:
            self.fail("lock still held after the child exited")


class WriteAtomicTest(unittest.TestCase):
    def test_replaces_the_file_whole_and_leaves_no_temp(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "matrix.tsv")
            harness.write_atomic(path, "old\n")
            harness.write_atomic(path, "new\n")
            with open(path, encoding="utf-8") as handle:
                self.assertEqual(handle.read(), "new\n")
            self.assertEqual(os.listdir(d), ["matrix.tsv"])

    def test_a_failed_write_keeps_the_old_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "matrix.tsv")
            harness.write_atomic(path, "old\n")
            with self.assertRaises(TypeError):
                harness.write_atomic(path, None)
            with open(path, encoding="utf-8") as handle:
                self.assertEqual(handle.read(), "old\n")


class RunOneGuardTest(unittest.TestCase):
    """run-one.sh's untrusted-checkout guard, with a stub `claude` that records its argv."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = self.tmp.name
        self.bin = os.path.join(d, "bin")
        os.makedirs(self.bin)
        stub = os.path.join(self.bin, "claude")
        with open(stub, "w", encoding="utf-8") as handle:
            handle.write("#!/usr/bin/env bash\nprintf '%s\\n' \"$@\" >\"$ARGV_OUT\"\n"
                         "printf '{\"result\":\"ok\"}'\n")
        os.chmod(stub, 0o755)
        self.agent = os.path.join(d, "agent.md")
        with open(self.agent, "w", encoding="utf-8") as handle:
            handle.write("---\nname: a\ntools:\n  - Read\n  - Bash\n---\nbody\n")
        self.prompt = os.path.join(d, "prompt.txt")
        with open(self.prompt, "w", encoding="utf-8") as handle:
            handle.write("hi\n")
        self.wt = os.path.join(d, "wt")
        os.makedirs(self.wt)

    def argv(self, **env):
        out = os.path.join(self.tmp.name, "argv-%d" % len(os.listdir(self.tmp.name)))
        full = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"], ARGV_OUT=out,
                    EVAL_FINGERPRINT="fp", **env)
        for name in ("EVAL_ALLOW_BASH", "EVAL_UNTRUSTED", "EVAL_PLUGIN_DIRS"):
            if name not in env:
                full.pop(name, None)
        res = subprocess.run([os.path.join(harness.HERE, "run-one.sh"), os.path.join(self.tmp.name, "out"),
                              "row", self.agent, self.wt, "m", "e", self.prompt, "Read,Bash"],
                             env=full, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        os.remove(os.path.join(self.tmp.name, "out", "row.json"))
        with open(out, encoding="utf-8") as handle:
            return handle.read().splitlines()

    def flag(self, argv, name):
        return argv[argv.index(name) + 1] if name in argv else None

    def test_plugin_runs_get_no_bash_and_no_hooks(self):
        argv = self.argv(EVAL_PLUGIN_DIRS=self.tmp.name)
        self.assertEqual(self.flag(argv, "--tools"), "Read")
        self.assertEqual(self.flag(argv, "--disallowedTools"), "Bash")
        self.assertEqual(self.flag(argv, "--settings"), '{"disableAllHooks":true}')
        self.assertIn("--plugin-dir", argv)

    def test_untrusted_agent_runs_get_no_bash(self):
        argv = self.argv(EVAL_UNTRUSTED="1")
        self.assertEqual(self.flag(argv, "--tools"), "Read")
        self.assertEqual(self.flag(argv, "--disallowedTools"), "Bash")
        self.assertIn("--system-prompt-file", argv)
        self.assertNotIn("Bash", self.flag(argv, "--allowedTools"))

    def test_allow_bash_and_legacy_rows_keep_bash(self):
        for env in ({"EVAL_UNTRUSTED": "1", "EVAL_ALLOW_BASH": "1"},
                    {"EVAL_PLUGIN_DIRS": self.tmp.name, "EVAL_ALLOW_BASH": "1"}, {}):
            argv = self.argv(**env)
            self.assertEqual(self.flag(argv, "--tools"), "Read,Bash")
            self.assertNotIn("--disallowedTools", argv)


if __name__ == "__main__":
    unittest.main()
