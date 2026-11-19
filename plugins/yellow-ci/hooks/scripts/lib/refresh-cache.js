#!/usr/bin/env node
'use strict';

// Detached background refresh for the yellow-ci SessionStart result cache
// (CLAUDE-369). session-start-core.js's scheduleRefresh starts it with the
// session's cwd and env and no stdio, then exits; this process runs the
// network calls (`gh auth status`, `gh run list`) and writes the cache that
// the next session start reads. argv[2], when given, is the refresh marker
// scheduleRefresh claimed; it is removed on exit so the next start can
// refresh again. Tests run this file directly to fill the cache.

const fs = require('fs');

const { refreshCache } = require('./session-start-core.js');

const marker = process.argv[2];
try {
  const { stderr } = refreshCache({ cwd: process.cwd(), env: process.env });
  if (stderr.length) process.stderr.write(stderr.join('\n') + '\n');
} catch (err) {
  process.stderr.write(
    `[yellow-ci] Warning: cache refresh error: ${String((err && err.message) || err)}\n`
  );
} finally {
  if (marker) {
    try { fs.rmSync(marker, { force: true }); } catch { /* best effort */ }
  }
}
