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
