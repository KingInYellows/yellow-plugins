#!/usr/bin/env node
'use strict';

// Optional account prerequisite check, separate from installed MCP startup.
// Only the native Graphite CLI reads its existing read-only mounted config.
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
function check(ok, message) {
  if (!ok) throw new Error(message);
}
function classify(stdout) {
  const statuses = [];
  for (const line of stdout.split('\n')) {
    try {
      const item = JSON.parse(line);
      if (
        ['ok', 'no_token', 'invalid_token', 'no_repo_access'].includes(
          item.status
        )
      )
        statuses.push(item.status);
    } catch {
      /* Non-JSON diagnostics are never persisted. */
    }
  }
  check(statuses.length === 1, 'Missing or ambiguous authentication response');
  const observedStatus = statuses[0];
  return {
    observedStatus,
    authenticated: ['ok', 'no_repo_access'].includes(observedStatus),
    repositoryAccess: observedStatus === 'ok',
  };
}
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Usage: node scripts/smoke-codex-graphite-auth.js --use-existing-login\n' +
        'Linux native Graphite check-auth using read-only repository/config mounts.\n' +
        'Credential values and account identity are never persisted by this harness.'
    );
    return;
  }
  check(
    args.length === 1 && args[0] === '--use-existing-login',
    'Explicit native-login choice required'
  );
  check(process.platform === 'linux', 'Linux required');
  const ownerConfig = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'graphite/user_config'
  );
  check(
    fs.lstatSync(ownerConfig).isFile() &&
      !fs.lstatSync(ownerConfig).isSymbolicLink(),
    'Native config unavailable'
  );
  const before = fs.statSync(ownerConfig);
  const pkg = path.join(
    os.homedir(),
    '.local/lib/node_modules/@withgraphite/graphite-cli'
  );
  const version = JSON.parse(
    fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')
  ).version;
  check(version === '1.7.20', 'Graphite version mismatch');
  const git = spawnSync(
    'git',
    ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }
  );
  check(!git.error && git.status === 0, 'Git context unavailable');
  const common = fs.realpathSync(git.stdout.trim());
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'yellow-graphite-auth-')
  );
  const report = {
    status: 'failed',
    harnessSha256: createHash('sha256')
      .update(fs.readFileSync(__filename))
      .digest('hex'),
    recordedAt: new Date().toISOString(),
    graphiteVersion: version,
    command: ['gt', 'internal-only', 'check-auth'],
    credentialHandling: 'native CLI read-only bind; no harness read or copy',
    scratch,
  };
  try {
    for (const dir of [
      'home',
      'config/graphite',
      'cache',
      'data',
      'state',
      'tmp',
    ])
      fs.mkdirSync(path.join(scratch, dir), { recursive: true, mode: 0o700 });
    const invocation = [
      '--die-with-parent',
      '--unshare-user',
      '--unshare-pid',
      '--unshare-ipc',
      '--ro-bind',
      '/usr',
      '/usr',
      '--ro-bind',
      '/lib',
      '/lib',
      '--ro-bind',
      '/lib64',
      '/lib64',
      '--symlink',
      'usr/bin',
      '/bin',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--ro-bind',
      '/etc/resolv.conf',
      '/etc/resolv.conf',
      '--ro-bind',
      '/etc/ssl/certs',
      '/etc/ssl/certs',
      '--ro-bind',
      ROOT,
      ROOT,
      '--ro-bind',
      common,
      common,
      '--ro-bind',
      pkg,
      '/runtime/graphite',
      '--ro-bind',
      process.execPath,
      '/runtime/node',
      '--bind',
      scratch,
      scratch,
      '--ro-bind',
      ownerConfig,
      path.join(scratch, 'config/graphite/user_config'),
      '--chdir',
      ROOT,
      '--clearenv',
    ];
    for (const [key, value] of Object.entries({
      PATH: '/runtime:/usr/bin:/bin',
      LANG: 'C.UTF-8',
      HOME: path.join(scratch, 'home'),
      XDG_CONFIG_HOME: path.join(scratch, 'config'),
      XDG_CACHE_HOME: path.join(scratch, 'cache'),
      XDG_DATA_HOME: path.join(scratch, 'data'),
      XDG_STATE_HOME: path.join(scratch, 'state'),
      TMPDIR: path.join(scratch, 'tmp'),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    }))
      invocation.push('--setenv', key, value);
    invocation.push(
      '/runtime/node',
      '/runtime/graphite/graphite.js',
      'internal-only',
      'check-auth'
    );
    const result = spawnSync('bwrap', invocation, {
      env: { PATH: '/usr/bin:/bin' },
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 1024 * 1024,
      killSignal: 'SIGKILL',
    });
    report.exitCode = result.status;
    check(!result.error && result.status === 0, 'Native auth check failed');
    Object.assign(report, classify(result.stdout));
    check(
      report.authenticated && report.repositoryAccess,
      'Graphite authentication/access prerequisite unmet'
    );
    report.status = 'passed';
  } catch (error) {
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    const after = fs.statSync(ownerConfig);
    report.ownerConfigMetadataUnchanged = [
      'ino',
      'size',
      'mtimeMs',
      'ctimeMs',
    ].every((key) => before[key] === after[key]);
    if (!report.ownerConfigMetadataUnchanged) {
      report.status = 'failed';
      report.failure = 'Owner config metadata changed';
      process.exitCode = 1;
    }
    fs.writeFileSync(
      path.join(scratch, 'result.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 }
    );
    console.log(JSON.stringify(report, null, 2));
  }
}
module.exports = { classify };
if (require.main === module) {
  try {
    main();
  } catch {
    console.error('Graphite auth harness prerequisite failed');
    process.exitCode = 1;
  }
}
