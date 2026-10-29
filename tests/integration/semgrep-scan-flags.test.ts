/**
 * yellow-semgrep always scans with `--metrics off`, and semgrep refuses
 * `--config auto` when metrics are off ("Cannot create auto config when
 * metrics are off", seen on 1.182.1). Pin the flag set so a full scan never
 * goes back to `--config auto` (CLAUDE-195).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, it, expect } from 'vitest';

const PLUGIN = join(__dirname, '..', '..', 'plugins', 'yellow-semgrep');
const FULL_SCAN_CONFIG = '--config "${YELLOW_SEMGREP_CONFIG:-p/default}"';

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

const scanLines = markdownFiles(PLUGIN).flatMap((path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => /\bsemgrep scan --/.test(line))
    .map((line) => ({ where: relative(PLUGIN, path), line }))
);

describe('yellow-semgrep scan flags', () => {
  it('finds the scan invocations', () => {
    expect(scanLines.length).toBeGreaterThan(5);
  });

  it('never uses --config auto', () => {
    for (const { where, line } of scanLines) {
      expect(line, where).not.toMatch(/--config[ =]["']?auto\b/);
    }
  });

  it('passes --metrics off and an explicit config on every scan', () => {
    for (const { where, line } of scanLines) {
      expect(line, where).toContain('--metrics off');
      expect(line, where).toMatch(
        /--config "(r\/\$\{CHECK_ID\}|r\/\{check_id\}|\$\{YELLOW_SEMGREP_CONFIG:-p\/default\})"/
      );
    }
  });

  it('adds the target rule to the verifier scan', () => {
    const verifier = scanLines.filter(
      ({ where }) => where === 'agents/semgrep/scan-verifier.md'
    );
    expect(verifier.length).toBeGreaterThan(0);
    for (const { line } of verifier) {
      expect(line).toContain(FULL_SCAN_CONFIG);
      expect(line).toContain('--config "r/${CHECK_ID}"');
    }
  });

  it('runs full scans and the post-fix verifier with the shared default', () => {
    for (const file of [
      'commands/semgrep/scan.md',
      'agents/semgrep/scan-verifier.md',
    ]) {
      expect(readFileSync(join(PLUGIN, file), 'utf8'), file).toContain(
        FULL_SCAN_CONFIG
      );
    }
  });
});
