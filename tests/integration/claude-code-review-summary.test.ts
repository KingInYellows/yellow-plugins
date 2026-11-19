/**
 * The Claude Code Review summary comment is defined in three places
 * (CLAUDE-365): the format in .github/claude-code-review/code-review.md, the
 * Bash guard's allow regex in bash-guard.sh, and the skip-marker check in
 * claude-code-review.yml. An edit to one alone would silently block the
 * summary (the guard denies it) or re-review every push (the marker check
 * never matches). The optional not-reviewed line (CLAUDE-371) is held to
 * the same rule. This test builds the comment exactly as code-review.md
 * describes it, runs the real guard on it, and checks the workflow looks for
 * the same heading and marker.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const DOC = readFileSync(
  join(ROOT, '.github/claude-code-review/code-review.md'),
  'utf8'
);
const GUARD = join(ROOT, '.github/claude-code-review/bash-guard.sh');
const WORKFLOW = readFileSync(
  join(ROOT, '.github/workflows/claude-code-review.yml'),
  'utf8'
);

const REPO = 'KingInYellows/yellow-plugins';
const PR = '4242';
const SHA = 'a'.repeat(40);
const URL = `https://github.com/${REPO}/pull/${PR}`;

const home = mkdtempSync(join(tmpdir(), 'ccr-guard-'));
mkdirSync(join(home, '.claude', 'hooks'), { recursive: true });
const targetFile = join(home, '.claude', 'hooks', 'claude-code-review-target');
// The gate writes the not-reviewed count as a fourth field; an older
// workflow leaves it out.
function setTarget(count?: number): void {
  writeFileSync(
    targetFile,
    `${REPO} ${PR} ${SHA}${count === undefined ? '' : ` ${count}`}\n`
  );
}
setTarget();
afterAll(() => rmSync(home, { recursive: true, force: true }));

function guard(command: string): number | null {
  const r = spawnSync('bash', [GUARD], {
    input: JSON.stringify({ tool_input: { command } }),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  return r.status;
}

// The example block in code-review.md: "## Code review", a blank line, the
// no-issues line, a blank line, the marker.
const example = DOC.match(
  /\n---\n\n(## Code review\n\n.+\n\n<!-- claude-code-review head=<sha> -->)\n\n---\n/
);
const foundLine = DOC.match(
  /replace the middle line with `(Found <n> issue\(s\);[^`]*)`/
);

const notReviewedLine = DOC.match(
  /add the line `(<n> changed file\(s\) were not reviewed:[^`]*)` after the middle line/
);

function summary(middle: string, extra?: string): string {
  const [heading, , , , marker] = example![1].split('\n');
  const body = extra ? [middle, '', extra] : [middle];
  return [heading, '', ...body, '', marker.replace('<sha>', SHA)].join('\n');
}

describe('Claude Code Review summary wording', () => {
  it('code-review.md documents both summary variants', () => {
    expect(example).not.toBeNull();
    expect(foundLine).not.toBeNull();
  });

  it('the guard allows the no-issues summary exactly as documented', () => {
    const middle = example![1].split('\n')[2];
    expect(guard(`gh pr comment ${URL} --body '${summary(middle)}'`)).toBe(0);
    expect(guard(`gh pr comment ${PR} --body '${summary(middle)}'`)).toBe(0);
  });

  it('the guard allows the issues-found summary exactly as documented', () => {
    const middle = foundLine![1].replace('<n>', '3');
    expect(guard(`gh pr comment ${URL} --body '${summary(middle)}'`)).toBe(0);
  });

  it('the guard allows the not-reviewed line after either middle line', () => {
    expect(notReviewedLine).not.toBeNull();
    const extra = notReviewedLine![1].replace('<n>', '2');
    const none = example![1].split('\n')[2];
    const found = foundLine![1].replace('<n>', '1');
    for (const middle of [none, found]) {
      expect(
        guard(`gh pr comment ${URL} --body '${summary(middle, extra)}'`)
      ).toBe(0);
    }
    // Only a number may stand for <n>, and the line goes after the middle one.
    expect(
      guard(
        `gh pr comment ${URL} --body '${summary(none, notReviewedLine![1])}'`
      )
    ).toBe(2);
    expect(guard(`gh pr comment ${URL} --body '${summary(extra, none)}'`)).toBe(
      2
    );
  });

  it('the guard requires the not-reviewed line with the gate count, and only then', () => {
    const none = example![1].split('\n')[2];
    const line = (k: number) => notReviewedLine![1].replace('<n>', String(k));
    const post = (extra?: string) =>
      guard(`gh pr comment ${URL} --body '${summary(none, extra)}'`);
    try {
      setTarget(0);
      expect(post()).toBe(0);
      expect(post(line(2))).toBe(2);
      setTarget(2);
      expect(post(line(2))).toBe(0);
      expect(post()).toBe(2);
      expect(post(line(3))).toBe(2);
      setTarget(Number.NaN);
      expect(post()).toBe(2);
    } finally {
      setTarget();
    }
  });

  it('the guard still blocks other wording, another head and a $ in the body', () => {
    const middle = example![1].split('\n')[2];
    expect(
      guard(`gh pr comment ${URL} --body '${summary(`${middle} Extra.`)}'`)
    ).toBe(2);
    expect(
      guard(
        `gh pr comment ${URL} --body '${summary(middle).replace(SHA, 'b'.repeat(40))}'`
      )
    ).toBe(2);
    expect(guard(`gh pr comment ${URL} --body "${summary('$GH_TOKEN')}"`)).toBe(
      2
    );
  });

  it('the guard allows every gh pr diff flag code-review.md names', () => {
    for (const flag of ['--name-only', '--patch', '--color=never']) {
      expect(DOC).toContain(`\`${flag}\``);
      expect(guard(`gh pr diff ${PR} ${flag}`)).toBe(0);
    }
  });

  it('the workflow skip check looks for the same heading and marker', () => {
    const [heading, , , , marker] = example![1].split('\n');
    expect(WORKFLOW).toContain(`select(.body | startswith("${heading}"))`);
    expect(WORKFLOW).toContain(
      `export MARKER="${marker.replace('<sha>', '$HEAD_SHA')}"`
    );
  });
});
