#!/usr/bin/env node
'use strict';

// `node entrypoint-codex.js --hook <name>` is platform-uniform — see
// entrypoint-claude.js's header comment for the rationale shared by both
// entrypoints.

const { formatCodexOutput } = require('./lib/envelope.js');
const { runHook } = require('./lib/run-hook.js');

runHook(process.argv.slice(2), formatCodexOutput).catch((err) => {
  process.stderr.write(String((err && err.stack) || err) + '\n');
  process.exitCode = 1;
});
