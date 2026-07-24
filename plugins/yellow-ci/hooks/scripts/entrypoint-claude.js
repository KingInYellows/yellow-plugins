#!/usr/bin/env node
'use strict';

// Claude Code entrypoint for the yellow-ci SessionStart hook. Invoked as
// `node entrypoint-claude.js` (platform-uniform — the generated Codex hook
// config's `commandWindows` reuses this same command string). SessionStart
// output is identical on both hosts (R36), so this and entrypoint-codex.js
// share `formatSessionStartOutput`.

const { formatSessionStartOutput } = require('./lib/envelope.js');
const { runHook } = require('./lib/run-hook.js');

runHook(formatSessionStartOutput).catch((err) => {
  // Last-resort fail-open: SessionStart must still emit valid JSON and never
  // block startup, even on a fatal error.
  process.stderr.write(
    '[yellow-ci] Warning: session-start hook fatal error: ' + String((err && err.stack) || err) + '\n'
  );
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
  process.exitCode = 0;
});
