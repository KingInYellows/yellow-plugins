"""Offline tests for the model-swap harness pieces the eval corpus relies on.

Run: python3 -m unittest discover -s scripts/eval/model-swap/tests
Nothing here calls a model.
"""

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

    def test_count_zero_asserts_a_file_was_left_alone(self):
        oos = {"files": [{"glob": "docs/security.md", "changed": True, "count": 0}]}
        self.assertTrue(harness.files_pass(oos, self.wt))
        self.write("docs/security.md", "boundary, edited\n")
        self.assertFalse(harness.files_pass(oos, self.wt))

    def test_count_zero_without_changed_still_needs_no_match(self):
        none = {"files": [{"glob": "missing/*.md", "count": 0}]}
        self.assertTrue(harness.files_pass(none, self.wt))
        legacy = {"files": [{"glob": "missing/*.md"}]}
        self.assertFalse(harness.files_pass(legacy, self.wt))

    def test_content_only_judges_regexes_on_unchanged_files(self):
        fixed = {"files": [{"glob": "lib/a.sh", "changed": True, "count": 1,
                            "match": ["trap '[^'\\n]*\"\\$LOCK\""], "not": ["trap \"rmdir '\\$LOCK'"]}]}
        self.assertFalse(harness.files_pass(fixed, self.wt, content_only=True))
        self.write("lib/a.sh", "trap 'rmdir \"$LOCK\"' EXIT\n")
        self.assertTrue(harness.files_pass(fixed, self.wt, content_only=True))
        self.assertTrue(harness.files_pass(fixed, self.wt))

    def test_a_deleted_file_is_not_a_changed_match(self):
        oos = {"files": [{"glob": "docs/*.md", "changed": True, "count": 0}]}
        os.remove(os.path.join(self.wt, "docs/security.md"))
        self.assertTrue(harness.files_pass(oos, self.wt))


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
        return {"configs": {}, "agents": {}, "prompts": [{"id": "c1", **case}]}

    def test_tree_must_be_a_full_sha(self):
        with self.assertRaises(SystemExit):
            harness.check_spec(self.spec(tree="main"))
        harness.check_spec(self.spec(tree="a" * 40))

    def test_overlay_and_plugins_must_be_repo_relative(self):
        for agent in ({"file": "a.md", "overlay": ["../x"]}, {"file": "a.md", "plugins": ["../x"]}):
            spec = self.spec()
            spec["agents"] = {"a": agent}
            with self.assertRaises(SystemExit):
                harness.check_spec(spec)


if __name__ == "__main__":
    unittest.main()
