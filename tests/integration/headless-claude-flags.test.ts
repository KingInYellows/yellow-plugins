/**
 * Every headless Claude run this repository starts carries a model pin, a
 * dollar cap and JSON output (CLAUDE-309). Unpinned, `claude -p` runs on the
 * user's default model; uncapped, a looping run is bounded only by its
 * timeout; without JSON output nothing records `total_cost_usd`.
 *
 * A call site is a line that starts a print-mode run: a shell command
 * (`claude -p …`, `"$CLAUDE_BIN" -p …`) or an argv list (`["claude", "-p", …`).
 * Prose that only names `claude -p` does not match. The flags must sit in
 * the statement around the line.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['plugins', 'scripts', '.github'];
const SCAN_EXT = /\.(sh|bash|py|js|mjs|cjs|ts|ya?ml|md|bats)$/;
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'fixtures',
  'tests',
  '.git',
]);
const REQUIRED_FLAGS = ['--model', '--max-budget-usd', '--output-format'];

// Lines that match the call-site pattern but start no run from this repo.
const NOT_A_CALL_SITE: Record<string, string> = {
  'plugins/yellow-core/agents/workflow/staging-promoter.md':
    'prose: tells the agent which flags its parent drain was started with',
  'plugins/yellow-core/skills/multi-host-fleet/SKILL.md':
    "example of a user's own CI step; the skill ships no runner",
};

const SHELL_CALL =
  /(?:\bclaude|"\$\{?CLAUDE_BIN\}?")\s+(?:-p|--print)\s+["'$-]/;
const ARGV_CALL = /\[\s*["']?claude["']?\s*,\s*["'](?:-p|--print)["']/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return SCAN_EXT.test(name) && name !== 'CHANGELOG.md' ? [path] : [];
  });
}

interface CallSite {
  where: string;
  statement: string;
}

function callSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const dir of SCAN_DIRS) {
    for (const path of files(join(ROOT, dir))) {
      const rel = relative(ROOT, path).split(sep).join('/');
      if (rel in NOT_A_CALL_SITE) continue;
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(#|\/\/|\*)/.test(line)) return;
        if (!SHELL_CALL.test(line) && !ARGV_CALL.test(line)) return;
        sites.push({
          where: `${rel}:${i + 1}`,
          statement: lines.slice(Math.max(0, i - 2), i + 9).join('\n'),
        });
      });
    }
  }
  return sites;
}

const sites = callSites();

describe('headless claude call sites', () => {
  it('finds the known call sites', () => {
    const where = sites.map((s) => s.where.replace(/:\d+$/, ''));
    for (const expected of [
      'plugins/yellow-core/hooks/scripts/session-start.sh',
      'plugins/yellow-core/commands/compound/review-staged.md',
      'scripts/eval/model-swap/run-one.sh',
      'scripts/eval/review-gate/eval.py',
      'scripts/eval/thermonuclear-fixtures/eval.py',
    ]) {
      expect(where).toContain(expected);
    }
  });

  it.each(REQUIRED_FLAGS)('passes %s at every call site', (flag) => {
    const missing = sites
      .filter((s) => !s.statement.includes(flag))
      .map((s) => s.where);
    expect(missing).toEqual([]);
  });

  it('keeps every exemption pointing at a real file', () => {
    for (const rel of Object.keys(NOT_A_CALL_SITE)) {
      expect(statSync(join(ROOT, rel)).isFile(), rel).toBe(true);
    }
  });
});

describe('claude-code-action workflows', () => {
  const dir = join(ROOT, '.github', 'workflows');
  const workflows = readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
    .filter(({ text }) => /uses:\s*anthropics\/claude-code-action@/.test(text));

  it('finds the action workflows', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  // A dollar cap for these jobs is CLAUDE-323 (R7.4).
  it('pins the model in claude_args', () => {
    for (const { name, text } of workflows) {
      const args = text.slice(text.search(/^\s*claude_args:/m));
      expect(args, name).toMatch(/^\s*claude_args:[\s\S]{0,40}--model \S+/m);
    }
  });
});
