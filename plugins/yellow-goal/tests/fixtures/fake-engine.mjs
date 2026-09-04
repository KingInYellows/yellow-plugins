// Portable fake executable: Node preloads this file in the CLI and its child.
// The CLI runs normally; the child exits here before Node loads any entry file.
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

if (process.argv[1] !== process.env.FAKE_GOAL_CLI_PATH) {
  const mode = process.env.FAKE_GOAL_GEN_MODE ?? 'ok';
  const version = process.env.FAKE_GOAL_GEN_VERSION ?? '0.1.0';
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const fail = (code, message, status) => {
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
    process.exit(status);
  };
  if (mode === 'empty') process.exit(0);
  if (mode === 'unparseable') {
    process.stdout.write('not-json\n');
    process.exit(0);
  }
  if (mode === 'usage') fail('USAGE_ERROR', 'unknown command', 2);
  if (mode === 'fail') fail('INTERNAL', 'engine boom', 1);
  if (mode === 'mismatch') {
    emit({ engineVersion: version });
    process.exit(0);
  }
  if (mode !== 'ok') fail('USAGE_ERROR', 'unknown fake mode', 2);
  const args = process.argv.slice(1);
  args[0] = basename(args[0] ?? '');
  if (!args.includes('--json')) {
    process.stdout.write('non-json output (missing --json)\n');
    process.exit(0);
  }
  if (args[0] === 'version') emit({ engineVersion: version });
  else if (args[0] === 'request' && args[1] === 'create') {
    const index = args.indexOf('--output');
    if (index >= 0)
      writeFileSync(args[index + 1], '{"goal":"install smoke"}\n');
    emit({ requestId: 'req_fake' });
  } else if (args[0] === 'request' && args[1] === 'validate') {
    emit({ valid: process.env.FAKE_GOAL_GEN_VALID !== 'false' });
  } else fail('USAGE_ERROR', 'unknown command', 2);
  process.exit(0);
}
