import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

// CLAUDE-392: `claude plugin list --json` applies project/local overrides
// only for its current directory, so every plugin surface must read it
// through the generated plugin_list_json helper, which runs from the
// repository root. `--available` (version drift) and `--help` do not read
// enablement and are allowed.
const ROOT = join(__dirname, '..', '..');
const PLUGINS = join(ROOT, 'plugins');
const BEGIN = '# >>> generated: plugin-list-json ';
const END = '# <<< generated: plugin-list-json <<<';
// A command position: line start, `$(`, a pipe, `&&`, `;`, or `if [!]`.
const DIRECT =
  /(^\s*|\$\(|\|\s*|&&\s*|;\s*|\bif\s+(!\s*)?)claude plugin list(?![^\n]*--(available|help))/;

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...markdownFiles(p));
    else if (name.endsWith('.md') || name.endsWith('.sh')) out.push(p);
  }
  return out;
}

function directCalls(text: string, isShell = false): string[] {
  const hits: string[] = [];
  let inHelper = false;
  // A .sh file is code throughout; Markdown is code only inside fences.
  let inFence = isShell;
  for (const line of text.split('\n')) {
    if (!isShell && /^\s*```/.test(line)) inFence = !inFence;
    if (line.includes(BEGIN)) inHelper = true;
    const code = line.replace(/^\s*#.*$/, '');
    if (inFence && !inHelper && DIRECT.test(code)) {
      hits.push(line.trim());
    }
    if (line.includes(END)) inHelper = false;
  }
  return hits;
}

describe('plugin_list_json usage', () => {
  it('no plugin shell block calls `claude plugin list` directly', () => {
    const offenders: string[] = [];
    for (const file of markdownFiles(PLUGINS)) {
      const shell = file.endsWith('.sh');
      for (const hit of directCalls(readFileSync(file, 'utf8'), shell)) {
        offenders.push(`${relative(ROOT, file)}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every call site passes a non-empty repository root', () => {
    const files = markdownFiles(PLUGINS).filter((f) =>
      readFileSync(f, 'utf8').includes(BEGIN)
    );
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const name = relative(ROOT, file);
      const blocks = text.split(BEGIN).length - 1;
      // Every use of the helper, minus its own definition line.
      const uses = (
        text.match(/(?<![\w$])plugin_list_json\b(?!\(\))[^\n]*/g) ?? []
      ).filter((use) => !use.startsWith('plugin_list_json()'));
      expect(uses.length, name).toBeGreaterThanOrEqual(blocks);
      for (const use of uses) {
        expect(use, name).toMatch(/^plugin_list_json "(?!")[^"\n]*"/);
      }
    }
  });

  it('scans .sh files as code without fences', () => {
    expect(directCalls('claude plugin list --json', true)).toHaveLength(1);
    expect(directCalls('claude plugin list --json')).toHaveLength(0);
  });

  it('flags a direct call outside the helper', () => {
    const md = ['```bash', 'x=$(claude plugin list --json)', '```'].join('\n');
    expect(directCalls(md)).toHaveLength(1);
  });
});
