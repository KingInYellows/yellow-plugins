// Child-process driver for the HTTPS downgrade fixture (packed-sdk-transport
// test). It runs in its own process so the test's self-signed certificate is
// trusted only here, via NODE_EXTRA_CA_CERTS. It installs the shipped fetch
// guard, connects the real pinned SDK with the shipped client options, and
// issues one create through the pure create-config builder. Prints one JSON
// line: the classified outcome and whether a POST was dispatched.
//
// argv: <compiled dist dir> <SDK entry file> <baseUrl>
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const [distDir, sdkEntry, baseUrl] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const guard = require(path.join(distDir, 'fetch-guard.js'));
const adapter = require(path.join(distDir, 'sdk-adapter.js'));
const sdk = await import(pathToFileURL(sdkEntry).href);

let dispatched = false;
guard.installFetchGuard({
  allowedOrigins: [new URL(baseUrl).origin],
  readTimeoutMs: 30000,
  onPostDispatch: () => {
    dispatched = true;
  },
});
const { options } = adapter.buildClientOptions(sdk, {
  apiKey: 'dummy-jules-test-key',
  baseUrl,
});
const client = sdk.connect(options);
try {
  await client.session(
    adapter.buildCreateSessionConfig({
      prompt: 'p',
      owner: 'octo',
      repo: 'repo',
      baseBranch: 'main',
      title: 't',
    })
  );
  process.stdout.write(`${JSON.stringify({ ok: true, dispatched })}\n`);
} catch (err) {
  const phase = dispatched ? 'after-dispatch' : 'pre-dispatch';
  const code = adapter.classifyAdapterError(sdk, err, phase).code;
  process.stdout.write(`${JSON.stringify({ ok: false, dispatched, code })}\n`);
}
