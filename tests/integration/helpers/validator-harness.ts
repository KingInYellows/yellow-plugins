/**
 * Shared test harness for spawning `scripts/validate-agent-authoring.js` as a
 * child process against a fixture plugins/ tree.
 *
 * Each integration test in this directory drives the validator the same way:
 * write fixture agent files to a temp dir, pass the dir via the
 * `VALIDATE_PLUGINS_DIR` env var, capture stdout / stderr / exit status. This
 * module owns that machinery so individual test files can focus on their
 * rule-specific fixtures and assertions.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const VALIDATOR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'validate-agent-authoring.js'
);

export interface ValidatorRun {
  status: number;
  stdout: string;
  stderr: string;
}

export function runValidator(
  pluginsDir: string,
  extraEnv: Record<string, string> = {}
): ValidatorRun {
  try {
    const stdout = execFileSync('node', [VALIDATOR], {
      env: { ...process.env, VALIDATE_PLUGINS_DIR: pluginsDir, ...extraEnv },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return {
      status: e.status,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

export function writeAgent(
  pluginsDir: string,
  pluginRelative: string,
  body: string
): void {
  const fullPath = join(pluginsDir, pluginRelative);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body, 'utf8');
}
