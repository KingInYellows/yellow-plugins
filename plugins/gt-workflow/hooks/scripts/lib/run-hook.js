'use strict';

const { snakeToCamelEnvelope } = require('./envelope.js');
const { checkCommitMessage } = require('./policy-check-commit-message.js');
const { checkGitPush } = require('./policy-check-git-push.js');

const HOOK_EVENTS = {
  'check-git-push': 'PreToolUse',
  'check-commit-message': 'PostToolUse',
};

const POLICIES = {
  'check-git-push': checkGitPush,
  'check-commit-message': checkCommitMessage,
};

function parseHookArg(argv) {
  const idx = argv.indexOf('--hook');
  if (idx === -1 || idx === argv.length - 1) {
    throw new Error('Missing required --hook <check-git-push|check-commit-message> argument');
  }
  const name = argv[idx + 1];
  if (!HOOK_EVENTS[name]) {
    throw new Error(`Unknown --hook value "${name}"`);
  }
  return name;
}

function readStdin(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/**
 * Shared read-stdin / parse / policy-dispatch flow for both entrypoints.
 * `formatOutput(hookEvent, result)` is the only host-specific piece.
 *
 * Malformed JSON preserves each hook's original fail-open/fail-closed
 * direction rather than a blanket rule: check-git-push.sh allows through
 * silently (exit 0, no output); check-commit-message.sh skips validation
 * but still emits `{"continue": true}`.
 *
 * A syntactically-valid-but-non-object JSON payload (e.g. a bare `null`)
 * parses successfully and so must be caught separately from the
 * try/catch above — passing it straight to a policy function crashes on
 * `envelope.command`/`envelope.toolInput` (review-caught regression,
 * PR #661). Routed through the same fail-open/fail-closed branch as a
 * parse failure, since both represent "the hook received something it
 * cannot use as an envelope."
 */
async function runHook(argv, formatOutput) {
  const hookName = parseHookArg(argv);
  const hookEvent = HOOK_EVENTS[hookName];
  const policy = POLICIES[hookName];

  const raw = await readStdin(process.stdin);

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    envelope = undefined;
  }

  if (envelope === null || typeof envelope !== 'object') {
    if (hookName === 'check-git-push') {
      return;
    }
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    return;
  }

  const camelEnvelope = snakeToCamelEnvelope(envelope);
  const result = policy(camelEnvelope);
  formatOutput(hookEvent, result);
}

module.exports = { runHook };
