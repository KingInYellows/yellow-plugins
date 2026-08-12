/**
 * Integration test for RULE 18 — namespaced `skill:` dispatch resolution in
 * scripts/validate-agent-authoring.js.
 *
 * A `skill: "<namespace>:<command>"` dispatch must resolve to a command
 * somewhere under plugins/ that declares `name: <namespace>:<command>` in its
 * frontmatter. Unresolvable targets fail at runtime with no other signal.
 *
 * RULE 17 cannot cover this: its SKILL_REF_RE character class excludes the
 * colon, so namespaced values have never matched it. That gap was found while
 * renaming the `workflows:` command namespace to `flow:` — nine live dispatch
 * targets would have silently stopped resolving, and nothing would have
 * flagged them.
 *
 * The distinguishing cases below are the ones that make this rule different
 * from RULE 17, and each is a place a naive implementation goes wrong:
 *   - cross-plugin dispatch is LEGAL (the common case, not an error);
 *   - the whole body is in scope, not just a "## Usage" section;
 *   - fenced syntax examples must not be mistaken for live dispatch;
 *   - bare (un-namespaced) names belong to RULE 17 and must not double-report.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

/**
 * The retired namespace, assembled rather than written literally.
 *
 * scripts/validate-flow-namespace.js bans that token everywhere outside its
 * permanent exclusions, and a test fixture is not an exclusion — allowlisting
 * this file would leave the migration unable to reach its terminal
 * empty-allowlist state. Same concatenation idiom as
 * scripts/exercise-flow-namespace-gate.sh and validate-solutions.js.
 */
const OLD_NS = `${'workflow'}s`;

/** A command that DECLARES a namespaced name (a valid dispatch target). */
function targetCommand(name: string): string {
  return `---
name: ${name}
description: 'Fixture target command. Use when testing RULE 18.'
allowed-tools:
  - Bash
---

# ${name}

Fixture body.
`;
}

/** A command whose body DISPATCHES to \`target\`. */
function callerCommand(target: string, opts: { fenced?: boolean } = {}): string {
  const dispatch = opts.fenced
    ? ['```text', `Invoke the Skill tool with skill: "${target}"`, '```'].join('\n')
    : `Invoke the \`Skill\` tool with \`skill: "${target}"\`.`;
  return `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

Some prose well away from any "## Usage" heading, mirroring the multi-phase
orchestrators where namespaced dispatch actually appears.

${dispatch}
`;
}

describe('RULE 18 — namespaced skill: dispatch resolution', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule18-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when the dispatch target declares a matching name (green)', () => {
    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand('flow:work'));
    writeAgent(dir, 'demo-plugin/commands/target.md', targetCommand('flow:work'));
    expect(runValidator(dir).status).toBe(0);
  });

  it('fails when no command declares the dispatched name (red)', () => {
    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand('flow:work'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:work');
  });

  it('catches a stale pre-rename target — the case that motivated the rule', () => {
    // The caller still dispatches the OLD namespace after the target was
    // renamed. This is exactly the nine-dispatch breakage the workflows: ->
    // flow: migration would have shipped unnoticed.
    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand(`${OLD_NS}:spec`));
    writeAgent(dir, 'demo-plugin/commands/target.md', targetCommand('flow:spec'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain(`${OLD_NS}:spec`);
  });

  it('allows cross-plugin dispatch — the target may live in ANY plugin', () => {
    writeAgent(dir, 'caller-plugin/commands/caller.md', callerCommand('flow:compound'));
    writeAgent(dir, 'other-plugin/commands/target.md', targetCommand('flow:compound'));
    expect(runValidator(dir).status).toBe(0);
  });

  it('resolves plugin-qualified SKILL ids, not just commands', () => {
    // `<plugin>:<skill-dir>` is the documented Skill-tool form for plugin
    // skills. An early draft of this rule indexed only commands and would
    // have rejected every legitimate use of it — invisibly, because every
    // current call site in this repo happens to write skill ids bare.
    writeAgent(
      dir,
      'caller-plugin/commands/caller.md',
      callerCommand('other-plugin:some-skill')
    );
    writeAgent(
      dir,
      'other-plugin/skills/some-skill/SKILL.md',
      `---
name: some-skill
description: Fixture plugin skill. Use when testing RULE 18.
---

# some-skill

## What It Does

Fixture body.

## When to Use

Fixture body.

## Usage

Fixture body.
`
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it('resolves a skill by its frontmatter name, not its directory name', () => {
    // `name:` is the runtime identifier; the directory is just where the file
    // lives. When they disagree, only the declared name resolves in a live
    // session — so that is what the index must carry.
    writeAgent(
      dir,
      'caller-plugin/commands/caller.md',
      callerCommand('other-plugin:declared-name')
    );
    writeAgent(
      dir,
      'other-plugin/skills/directory-name/SKILL.md',
      `---
name: declared-name
description: Fixture plugin skill. Use when testing RULE 18.
---

# declared-name

## What It Does

Fixture body.

## When to Use

Fixture body.

## Usage

Fixture body.
`
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it('rejects a skill id built from the directory when the frontmatter name differs', () => {
    // The inverse of the case above, and the reason it matters: indexing the
    // directory would let this stale id pass here and then fail to resolve at
    // runtime — exactly the silent breakage RULE 18 exists to prevent.
    writeAgent(
      dir,
      'caller-plugin/commands/caller.md',
      callerCommand('other-plugin:directory-name')
    );
    writeAgent(
      dir,
      'other-plugin/skills/directory-name/SKILL.md',
      `---
name: declared-name
description: Fixture plugin skill. Use when testing RULE 18.
---

# declared-name

## What It Does

Fixture body.

## When to Use

Fixture body.

## Usage

Fixture body.
`
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('other-plugin:directory-name');
  });

  it('still fails a plugin-qualified id whose skill directory does not exist', () => {
    writeAgent(
      dir,
      'caller-plugin/commands/caller.md',
      callerCommand('other-plugin:no-such-skill')
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('other-plugin:no-such-skill');
  });

  it('ignores dispatch syntax shown inside a code fence', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/caller.md',
      callerCommand('flow:nonexistent', { fenced: true })
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it('does not report bare un-namespaced names (those are RULE 17 territory)', () => {
    // `smart-submit` has no colon, so RULE 18 must not touch it. RULE 17 is
    // scoped to "## Usage" sections and this fixture has none, so neither
    // rule fires and the run is green.
    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand('smart-submit'));
    expect(runValidator(dir).status).toBe(0);
  });

  it('restores to green once the caller is updated to the new name', () => {
    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand(`${OLD_NS}:work`));
    writeAgent(dir, 'demo-plugin/commands/target.md', targetCommand('flow:work'));
    expect(runValidator(dir).status).toBe(1);

    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand('flow:work'));
    expect(runValidator(dir).status).toBe(0);
  });

  /** A caller command whose body dispatches via a single-quoted skill value. */
  function singleQuotedCallerCommand(target: string): string {
    return `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

Some prose well away from any "## Usage" heading, mirroring the multi-phase
orchestrators where namespaced dispatch actually appears.

Invoke the \`Skill\` tool with \`skill: '${target}'\`.
`;
  }

  it('resolves a single-quoted namespaced dispatch just like the double-quoted form', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/caller.md',
      singleQuotedCallerCommand('flow:work')
    );
    writeAgent(dir, 'demo-plugin/commands/target.md', targetCommand('flow:work'));
    expect(runValidator(dir).status).toBe(0);
  });

  it('fails a single-quoted namespaced dispatch that resolves to nothing', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/caller.md',
      singleQuotedCallerCommand('flow:nonexistent')
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
  });

  it('reports a live dispatch sitting between two thematic breaks in the body', () => {
    // The body is sliced free of frontmatter before RULE 18 scans it. If the
    // fence stripper re-ran its leading-`---` frontmatter regex on that body,
    // a body that OPENS with a thematic break and has another one later would
    // look like a second frontmatter block, and everything between the two
    // rules — including this live dispatch — would be deleted before scanning.
    writeAgent(
      dir,
      'demo-plugin/commands/caller.md',
      `---
name: caller
description: 'Fixture caller. Use when testing RULE 18.'
allowed-tools:
  - Bash
---
---

Invoke the Skill tool with skill: "flow:nonexistent" to continue.

---

Trailing prose.
`
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('flow:nonexistent');
  });

  it('reports a malformed colon-bearing dispatch value instead of silently skipping it', () => {
    // `flow:spec.name` falls outside the old narrow `[a-zA-Z0-9_:-]`
    // character class (the stray `.`) — the old regex produced no match at
    // all, so this shape was invisible to the rule even though it cannot
    // resolve to any command and fails at runtime exactly like a typo.
    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand('flow:spec.name'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:spec.name');
  });

  it('ignores an unresolved dispatch example shown inside a tilde fence', () => {
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

~~~text
Invoke the Skill tool with skill: "flow:nonexistent"
~~~
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('ignores an unresolved dispatch example shown inside a four-backtick fence', () => {
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

\`\`\`\`text
Invoke the Skill tool with skill: "flow:nonexistent"

\`\`\`
Even a three-backtick line nested inside a four-backtick fence must not
close it early.
\`\`\`
\`\`\`\`
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('ignores an unresolved dispatch example inside a fence that is never closed (EOF)', () => {
    // The file ends while still "inside" the fence. Per CommonMark an
    // unterminated fenced code block implicitly runs to EOF, so this whole
    // region is fence content, not prose — RULE 18 must not scan it.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

\`\`\`text
Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('ignores an unresolved dispatch example inside a block-quoted fence', () => {
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

> \`\`\`text
> Invoke the Skill tool with skill: "flow:nonexistent"
> \`\`\`
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('ignores an unresolved dispatch example inside a fence nested in an indented list item', () => {
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

- Example:

  \`\`\`text
  Invoke the Skill tool with skill: "flow:nonexistent"
  \`\`\`
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('still reports an unresolvable dispatch in ordinary block-quoted prose with no fence', () => {
    // Negative control for the block-quote fence case above: quoting alone
    // (no fence markers) must not exempt a live dispatch from RULE 18.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

> Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
  });

  it('still reports an unresolvable dispatch that follows a properly closed fence', () => {
    // Negative control for the EOF fix above: content after a REAL closer
    // must still be scanned as live, not swept up by the new EOF handling.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

\`\`\`text
some illustrative example, unrelated
\`\`\`

Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
  });

  it('reports a live top-level dispatch that follows an unclosed fence inside a block quote', () => {
    // The exact regression this round fixes: the fence never gets an
    // explicit closer, but the block quote it lives in ends at the blank
    // line (no `>` marker). Per CommonMark the quote ending also ends the
    // fence scoped inside it, so the dispatch below is genuinely live,
    // top-level prose — not fence content — and must be reported.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

> \`\`\`text
> some fence content still inside the quote, fence never closed

Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
  });

  it('ignores an unresolved dispatch that stays inside the quote after an unclosed fence', () => {
    // Same unclosed fence as above, but this time the quote never drops —
    // every following line still carries its `>` marker, so the fence
    // legitimately runs to EOF (existing behavior) and the dispatch stays
    // hidden.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

> \`\`\`text
> some fence content
> Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('reports a live top-level dispatch that follows a 4-space-indented fence-look-alike', () => {
    // Finding 1 from the 4th review round: a standalone 4-space-indented
    // line is a CommonMark INDENTED CODE BLOCK, not a fence opener — the
    // earlier implementation stripped indentation unconditionally before
    // checking, so this line was misread as a valid (0-indent) opener,
    // which could swallow everything after it as "unclosed fence" content.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

    \`\`\`text
    not a real fence — this is an indented code block
    \`\`\`

Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
  });

  it('reports a live top-level dispatch that follows a 4-space-indented block-quoted fence', () => {
    // Companion to the 4-space-indented case above, for the block-quote
    // path. A block-quote marker may carry at most THREE leading spaces;
    // at four it is an indented code block and the `>` is literal content.
    // An earlier `blockquotePrefixRe` allowed unlimited leading whitespace,
    // so `    > ```text` was read as a depth-1 quote wrapping a 0-indent
    // fence opener — swallowing the live dispatch below as fence content.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

    > \`\`\`text
> Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
  });

  it('still ignores a fence in a block quote indented three spaces or less', () => {
    // Negative control for the rule above: at three leading spaces the
    // block-quote marker is still valid, so the fence is a real fence and
    // the dispatch inside it stays an inert example.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

   > \`\`\`text
   > Invoke the Skill tool with skill: "flow:example-only"
   > \`\`\`
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('ignores an unresolved dispatch in a fence that opens on the list-marker line', () => {
    // A fence may open on the SAME line as its list marker (`- ```text`).
    // CommonMark starts the item's content at the marker's content column,
    // so the fence begins there — not at column 0. An earlier version tested
    // only the enclosing container's column, left the `- ` in place, failed
    // to recognize the opener, and scanned the whole item body as live
    // prose: a false positive on a legitimate illustrative example.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

- \`\`\`text
  Invoke the Skill tool with skill: "flow:example-only"
  \`\`\`
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('ignores an unresolved dispatch in a fence opening on an ordered list marker', () => {
    // Same as above for the `N.` marker form, whose content column differs.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

1. \`\`\`text
   Invoke the Skill tool with skill: "flow:example-only"
   \`\`\`
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('reports a live top-level dispatch that follows an unclosed fence inside a list item', () => {
    // Finding 2 from the 4th review round: the fence opens inside a list
    // item and is never explicitly closed, but the list item ends when the
    // following prose outdents back to column 0. The dispatch below is
    // genuinely live, top-level prose — not fence content — and must be
    // reported.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

- Example:

  \`\`\`text
  Invoke the Skill tool with skill: "flow:example-only"

Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
    expect(stderr).not.toContain('flow:example-only');
  });

  it('ignores an unresolved dispatch that stays inside the list item after an unclosed fence', () => {
    // Same unclosed fence as above, but this time the following line is
    // MORE indented, still within the same list item's content column, so
    // the fence legitimately stays open (runs to EOF) and the dispatch
    // stays hidden — regression guard against over-eagerly closing on any
    // indentation change rather than a genuine outdent.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

- Example:

  \`\`\`text
  Invoke the Skill tool with skill: "flow:example-only"

    Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });

  it('does not let a depth-1 line close a fence opened at depth 2', () => {
    // The fence opens inside a doubly-nested quote (`> >`). The following
    // line drops to a single `>` — a shallower container — so per the
    // "closer must match the opener's depth" rule it cannot close the
    // depth-2 fence; the depth-2 container has simply ended, taking the
    // fence with it. The dispatch that follows, still under `> >`, is
    // ordinary content at that point (not re-captured by any fence) and
    // must be reported, proving the mismatched-depth line was never treated
    // as a valid closer.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

> > \`\`\`text
> > hidden fence content, must not be scanned
> \`\`\`
> > Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
  });
});

describe('RULE 18 — placeholder exemption is scoped to its two known teaching sites', () => {
  // Codex P2 finding: an earlier version exempted "plugin:skill-name" and
  // "yellow-X:skill-name" ANYWHERE under plugins/, so a live command that
  // accidentally copied one of those strings would have silently passed
  // RULE 18 even though nothing resolves it. The fix restricts the
  // exemption to an exact (declaring file, placeholder) allowlist —
  // SKILL_DISPATCH_PLACEHOLDER_ALLOWLIST in scripts/validate-agent-
  // authoring.js — naming the two real prose teaching sites.
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule18-placeholder-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * A read-only reviewer AGENT (not command) whose body dispatches via
   * `target` in prose, matching the frontmatter shape the two real
   * allowlisted files use (`tools:`, not `allowed-tools:` — these live under
   * agents/review/ so W1.5's read-only gate applies).
   */
  function reviewerAgent(target: string): string {
    return `---
name: fixture-reviewer
description: 'Fixture reviewer agent. Use when testing RULE 18.'
model: sonnet
tools:
  - Read
  - Grep
  - Glob
---

# fixture-reviewer

Teaches the plugin-qualified dispatch syntax, e.g.
\`Skill({skill: "${target}"})\`.
`;
  }

  it('reports "plugin:skill-name" when used in a file NOT on the allowlist', () => {
    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand('plugin:skill-name'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('plugin:skill-name');
  });

  it('reports "yellow-X:skill-name" when used in a file NOT on the allowlist', () => {
    writeAgent(dir, 'demo-plugin/commands/caller.md', callerCommand('yellow-X:skill-name'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('yellow-X:skill-name');
  });

  it('still passes for the real plugin-contract-reviewer.md teaching site', () => {
    writeAgent(
      dir,
      'yellow-review/agents/review/plugin-contract-reviewer.md',
      reviewerAgent('plugin:skill-name')
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it('still passes for the real project-compliance-reviewer.md teaching site', () => {
    writeAgent(
      dir,
      'yellow-review/agents/review/project-compliance-reviewer.md',
      reviewerAgent('yellow-X:skill-name')
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it('strict mode fails when a declared allowlist entry file no longer exists', () => {
    // Neither of the two declared sites is present in this fixture tree at
    // all — mirrors RULE 16's "declared sentinel file is missing" case.
    writeAgent(dir, 'demo-plugin/commands/target.md', targetCommand('flow:work'));
    const { status, stderr } = runValidator(dir, {
      VALIDATE_PLACEHOLDER_ALLOWLIST_STRICT: '1',
    });
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('declared placeholder-allowlist entry no longer exists');
    expect(stderr).toContain('plugin-contract-reviewer.md');
    expect(stderr).toContain('project-compliance-reviewer.md');
  });

  it('strict mode fails when a declared site exists but lost its placeholder text', () => {
    writeAgent(
      dir,
      'yellow-review/agents/review/plugin-contract-reviewer.md',
      `---
name: fixture-reviewer
description: 'Fixture reviewer agent. Use when testing RULE 18.'
model: sonnet
tools:
  - Read
  - Grep
  - Glob
---

# fixture-reviewer

No dispatch placeholder text in this body at all.
` // no "plugin:skill-name" text anywhere
    );
    writeAgent(
      dir,
      'yellow-review/agents/review/project-compliance-reviewer.md',
      reviewerAgent('yellow-X:skill-name')
    );
    const { status, stderr } = runValidator(dir, {
      VALIDATE_PLACEHOLDER_ALLOWLIST_STRICT: '1',
    });
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('declared placeholder "plugin:skill-name" no longer appears');
    expect(stderr).toContain('plugin-contract-reviewer.md');
    expect(stderr).not.toContain('project-compliance-reviewer.md: RULE 18');
  });
});

describe('RULE 18 fence model — invalid backtick fence openers are not fences', () => {
  // CommonMark: a BACKTICK fence's info string may not itself contain a
  // backtick (tilde fences have no such restriction). A line like
  // ```` ```lang`suffix ```` is therefore not a fence opener at all — the
  // fence-stripping helper must leave it (and everything after it) as
  // ordinary content, not swallow a live dispatch that follows as
  // "unclosed fence" content.
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule18-fence-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a live dispatch after a backtick opener whose info string contains a backtick', () => {
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

\`\`\`lang\`suffix
this line is not really fence content — the opener above is invalid

Invoke the Skill tool with skill: "flow:nonexistent"
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 18');
    expect(stderr).toContain('flow:nonexistent');
  });

  it('still treats a tilde opener with a backtick in its info string as a valid fence', () => {
    // The backtick restriction is backtick-fence-only; a tilde fence's info
    // string may contain a backtick and the fence still hides its contents.
    const body = `---
name: demo:caller
description: 'Fixture caller command. Use when testing RULE 18.'
allowed-tools:
  - Bash
  - Skill
---

# demo:caller

## Phase 1

~~~lang\`suffix
Invoke the Skill tool with skill: "flow:nonexistent"
~~~
`;
    writeAgent(dir, 'demo-plugin/commands/caller.md', body);
    expect(runValidator(dir).status).toBe(0);
  });
});
