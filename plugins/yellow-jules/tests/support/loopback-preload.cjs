'use strict';
// Test-only bootstrap, loaded with `node --require` ahead of dist/cli.js.
// It is the only caller of the CLI's test seam: it points the SDK at the
// in-test fake server on 127.0.0.1. The CLI itself never reads a base URL
// from env, config, or argv; this file reads the test's env var instead.
const path = require('node:path');

const baseUrl = process.env.YELLOW_JULES_TEST_BASE_URL;
const cli = process.argv[1];
if (baseUrl && cli) {
  const seam = require(path.join(path.dirname(cli), 'test-seam.js'));
  seam.__setTestTransport({ baseUrl });
}
