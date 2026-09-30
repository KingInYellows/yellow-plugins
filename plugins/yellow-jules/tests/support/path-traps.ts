/**
 * R51: real tools on PATH are replaced by failing traps. Each stub logs its
 * name and argv to a file inside the trap directory and exits 97; every
 * suite that spawns processes asserts the log is empty afterwards.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const TRAPPED_TOOLS = [
  'claude',
  'codex',
  'gh',
  'gt',
  'jules',
  'curl',
] as const;

export interface PathTraps {
  readonly dir: string;
  /** PATH with the trap directory first. */
  readonly pathValue: string;
  entries(): string[];
  cleanup(): void;
}

export function createPathTraps(
  basePath: string = process.env['PATH'] ?? ''
): PathTraps {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-traps-'));
  const logFile = path.join(dir, 'trap.log');
  for (const tool of TRAPPED_TOOLS) {
    const script = `#!/bin/sh\nprintf '%s %s\\n' '${tool}' "$*" >> '${logFile}'\nexit 97\n`;
    fs.writeFileSync(path.join(dir, tool), script, { mode: 0o755 });
  }
  return {
    dir,
    pathValue: `${dir}${path.delimiter}${basePath}`,
    entries: () =>
      fs.existsSync(logFile)
        ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
        : [],
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
