# Discoverability check

Loaded by `compound-lifecycle` Step 9 and by `knowledge-compounder` after a
write. Ported from Compound Engineering @ `b405537`
(`skills/ce-compound-refresh/references/discoverability.md`).

The knowledge store only helps agents that know it exists. Sessions without
these plugins (fresh sessions, Codex or Cursor users, collaborators) learn about
it only from the repo's agent-instruction file, so check that file still points
at it.

## 1. Find the instruction files

Start at the directory that holds `docs/solutions/` and walk up to
`git rev-parse --show-toplevel`. At each level, take the first of `AGENTS.md`,
`CLAUDE.md` and `GEMINI.md` that exists. A monorepo whose product lives in a
subdirectory (yellow-goal keeps it in `goal-gen/`) has one at each level; check
them all.

Skip a file whose only content is `@`-includes of another file, and check the
included file instead. If no instruction file exists anywhere on that path,
stop: never create one.

## 2. Assess

Read each file as a newcomer would. It passes when a reader would learn three
things:

- the `docs/solutions/` store exists;
- enough structure to search it (organized by category, with YAML frontmatter
  such as `module`, `tags`, `problem_type`);
- when it is relevant (past bugs, best practices, workflow patterns).

Judge the meaning, not the exact wording. A directory listing entry or one
sentence in a conventions section is enough. If any file on the path passes, the
check passes and you are done.

## 3. Draft the smallest fix

When no file passes, draft one line for the file closest to `docs/solutions/`,
placed in an existing section such as a directory listing or conventions block.
Keep it informational, not imperative: "always search before implementing"
causes redundant reads when a workflow already searches. Calibration:

```text
docs/solutions/  # documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (module, tags, problem_type)
```

## 4. Apply

- Interactive: show the proposed line and the file it goes in, and ask once with
  `AskUserQuestion` (Add line / Skip). Edit only on approval.
- Non-interactive (`mode:autofix`, background runs): never edit an instruction
  file. Report a `recommendation: <file> — <line>` instead.

## 5. CONCEPTS.md

Run the same check for `docs/CONCEPTS.md` only when that file exists. A passing
file tells a reader it is the project's glossary of domain terms. Do not suggest
adopting a glossary the repo has not created.
