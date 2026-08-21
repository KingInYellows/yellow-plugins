#!/usr/bin/env node
'use strict';

// `node entrypoint-claude.js --hook <name>` is platform-uniform — no
// Windows-specific branching needed, unlike the old direct
// `bash .../check-*.sh` invocation, which never worked on Windows. Step 6
// populates the generated Codex hook config's `commandWindows` field with
// this same command string on that basis.

const { formatClaudeOutput } = require('./lib/envelope.js');
const { runHook } = require('./lib/run-hook.js');

runHook(process.argv.slice(2), formatClaudeOutput).catch((err) => {
  process.stderr.write(String((err && err.stack) || err) + '\n');
  process.exitCode = 1;
});
