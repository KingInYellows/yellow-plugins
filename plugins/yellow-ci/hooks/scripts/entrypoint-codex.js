#!/usr/bin/env node
'use strict';

// Codex entrypoint for the yellow-ci SessionStart hook. Invoked as
// `node entrypoint-codex.js`. SessionStart output is identical on both hosts
// (R36), so this shares `formatSessionStartOutput` with entrypoint-claude.js —
// the two entrypoints are intentionally byte-equivalent, kept separate for the
// per-host entrypoint convention (and referenced independently by the inline
// hooks block in .claude-plugin/plugin.json / hooks/codex-hooks.json).
// Codex 0.157.0 lifecycle coverage verifies delivery after trusting the
// disposable installed definition hash; untrusted controls remain idle.
// Historical 0.144.x inert behavior does not describe that newer runtime.
// See docs/codex-distribution.md for version-specific evidence and limits.

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
