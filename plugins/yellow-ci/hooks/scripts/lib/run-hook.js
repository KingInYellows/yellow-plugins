'use strict';

const { snakeToCamelEnvelope } = require('./envelope.js');
const { runSessionStart } = require('./session-start-core.js');

// Bound stdin to 64KB. The bash hook ignored stdin entirely; the Node port
// reads it only to stay well-behaved (a SessionStart payload is tiny) and must
// not buffer unbounded input or blow the 3s budget.
const MAX_STDIN_BYTES = 65536;

function readStdin(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on('data', (chunk) => {
      if (total >= MAX_STDIN_BYTES) return;
      const remaining = MAX_STDIN_BYTES - total;
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total = MAX_STDIN_BYTES;
      } else {
        chunks.push(chunk);
        total += chunk.length;
      }
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/**
 * Shared read-stdin / run / format flow for both entrypoints.
 * `formatOutput(result)` is the only host-specific seam — though for
 * SessionStart it is identical on both hosts (R36).
 *
 * SessionStart is fail-OPEN and must ALWAYS emit valid JSON and never block
 * startup (mirrors session-start.sh's `set -uo pipefail` with a guaranteed
 * `json_exit` on every path). So:
 *  - stdin is parsed defensively; a malformed OR bare-`null` payload
 *    (JSON.parse('null') succeeds and `typeof null === 'object'`, so it is
 *    guarded explicitly) does NOT change behavior — the SessionStart logic
 *    reads cwd/$HOME/`gh`, not the envelope.
 *  - any unexpected error is swallowed and turned into an empty-message
 *    result, so the caller still emits `{"continue": true}`.
 */
async function runHook(formatOutput) {
  let result;
  try {
    const raw = await readStdin(process.stdin);
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      envelope = undefined;
    }
    // JSON.parse('null') / non-object payloads: guard before normalizing.
    if (envelope !== null && typeof envelope === 'object') {
      snakeToCamelEnvelope(envelope); // R35 normalization (unused by SessionStart)
    }
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
