'use strict';

const { runSessionStart } = require('./session-start-core.js');

// Bound stdin to 64KB. The bash hook ignored stdin entirely; the Node port
// reads it only to stay well-behaved (a SessionStart payload is tiny) and must
// not buffer unbounded input or blow the 3s budget.
const MAX_STDIN_BYTES = 65536;

// Bound the WAIT itself, not just the byte count: if the host never closes
// its end of stdin (pipe left open, TTY, etc.), 'end' never fires and the
// await would hang past the fail-open budget. The drained payload is
// discarded either way (see runHook), so cutting the wait short is safe.
const STDIN_READ_TIMEOUT_MS = 250;

function readStdin(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const onData = (chunk) => {
      if (total >= MAX_STDIN_BYTES) return;
      const remaining = MAX_STDIN_BYTES - total;
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total = MAX_STDIN_BYTES;
      } else {
        chunks.push(chunk);
        total += chunk.length;
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    const timer = setTimeout(() => {
      cleanup();
      stream.pause();
      if (typeof stream.unref === 'function') stream.unref();
      resolve(Buffer.concat(chunks).toString('utf8'));
    }, STDIN_READ_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * Shared read-stdin / run / format flow for both entrypoints.
 * `formatOutput(result)` is the only host-specific seam — though for
 * SessionStart it is identical on both hosts (R36).
 *
 * SessionStart is fail-OPEN and must ALWAYS emit valid JSON and never block
 * startup (mirrors session-start.sh's `set -uo pipefail` with a guaranteed
 * `json_exit` on every path). Stdin is drained and bounded to 64KB but NOT
 * parsed — the SessionStart logic reads cwd/$HOME/`gh`, not the envelope, so a
 * malformed or bare-`null` payload cannot change behavior (unlike an
 * envelope-consuming hook such as gt-workflow's PreToolUse, which needs the
 * snakeToCamelEnvelope normalization + null guard). Any unexpected error is
 * swallowed into an empty-message result so the caller still emits
 * `{"continue": true}`.
 */
async function runHook(formatOutput) {
  let result;
  try {
    // Drain + bound stdin so the process never hangs on unread input; the
    // payload is intentionally not parsed (the envelope is unused here).
    await readStdin(process.stdin);
    result = runSessionStart({ cwd: process.cwd(), env: process.env });
  } catch (err) {
    process.stderr.write(
      `[yellow-ci] Warning: session-start hook error: ${String((err && err.message) || err)}\n`
    );
    result = { systemMessage: '', stderr: [] };
  }

  if (result.stderr && result.stderr.length) {
    process.stderr.write(result.stderr.join('\n') + '\n');
  }
  formatOutput(result);
}

module.exports = { runHook };
