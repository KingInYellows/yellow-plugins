#!/usr/bin/env node
'use strict';

// Credential bytes are never read by this harness. Only Codex sees a read-only
// bind of its existing native auth store. Model reads use an exact allowlist.
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const VERSION = '0.157.0';
const LIMIT = 4 * 1024 * 1024;
const DEADLINE = 120000;
function check(ok, message) {
  if (!ok) throw new Error(message);
}
function sha(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function save(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
}
function snapshot(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      check(!entry.isSymbolicLink(), 'Symlink in fixture');
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        check(entry.isFile(), 'Non-file fixture');
        result[path.relative(root, file)] = sha(file);
      }
    }
  }
  visit(root);
  return result;
}
function allowedRead(file, allowlist) {
  check(
    typeof file === 'string' && allowlist.has(file),
    'Read outside allowlist'
  );
  check(
    fs.realpathSync(file) === file && fs.lstatSync(file).isFile(),
    'Read alias or non-file'
  );
  return fs.readFileSync(file, 'utf8');
}
function modelReadPath(file, allowlist) {
  if (allowlist.has(file)) return file;
  check(
    typeof file === 'string' &&
      !file.startsWith('/') &&
      !file.startsWith('-') &&
      !file.split('/').includes('..') &&
      /^[a-zA-Z0-9._/-]+$/.test(file),
    'Read outside allowlist'
  );
  const candidates = [...allowlist].filter(
    (candidate) =>
      candidate.endsWith('/project/' + file) || candidate.endsWith('/' + file)
  );
  const target = candidates.length === 1 ? candidates[0] : undefined;
  check(target && allowlist.has(target), 'Read outside allowlist');
  return target;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}
function equal(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function assess(test, output, reads, skill, expected, unchanged) {
  check(unchanged, 'Fixture or installed plugin changed');
  if (test.expectedActivation) {
    check(reads.includes(skill.path), 'Installed skill was not activated');
    for (const file of [
      ...Object.keys(expected.open),
      ...Object.keys(expected.archived),
    ])
      check(
        reads.some((read) => read.endsWith('/project/' + file)),
        'Model did not read fixture file'
      );
    const clean = output
      .trim()
      .replace(/^```(?:json)?\s*\n/, '')
      .replace(/\n```$/, '');
    check(
      equal(JSON.parse(clean), expected),
      'Dashboard did not match fixture expectations'
    );
  } else {
    check(reads.length === 0, 'Unrelated prompt read files or activated skill');
    check(output.trim() === test.expectedOutput, 'Unrelated output mismatch');
  }
  return {
    status: 'passed',
    activation: test.attachInstalledSkill
      ? 'attached-installed-skill'
      : reads.includes(skill.path)
        ? 'model-requested-installed-skill-read'
        : 'none',
    outputCorrect: true,
    unchanged: true,
  };
}
function stop(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
function rpc(
  args,
  env,
  allowlist,
  projectFiles,
  observations = {},
  options = {}
) {
  const child = spawn('bwrap', args, {
    env: { PATH: '/usr/bin:/bin' },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const events = [],
    reads = [],
    pending = new Map(),
    listeners = new Set();
  let sequence = 0,
    buffer = '',
    bytes = 0,
    failure,
    closing = false;
  function fail(error) {
    if (closing || failure) return;
    failure = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    for (const listener of listeners) listener(error);
    stop(child);
  }
  child.on('error', () => fail(new Error('App-server startup failed')));
  child.on('exit', () => fail(new Error('App-server exited')));
  child.stdin.on('error', () => fail(new Error('App-server input closed')));
  child.stderr.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > LIMIT) fail(new Error('App-server output limit'));
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > LIMIT) return fail(new Error('App-server output limit'));
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return fail(new Error('Malformed app-server output'));
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if (message.error)
          waiter.reject(new Error('RPC failed: ' + waiter.method));
        else waiter.resolve(message.result);
      } else if (message.id !== undefined) {
        if (message.method !== 'item/tool/call')
          return fail(
            new Error('Unexpected server request; no approvals granted')
          );
        const { tool, arguments: input } = message.params;
        let text;
        try {
          if (tool === 'fixture_read') {
            check(
              input && Object.keys(input).length === 1,
              'Invalid read request'
            );
            const normalized = modelReadPath(
              input.path,
              allowlist,
              projectFiles
            );
            text = allowedRead(normalized, allowlist);
            reads.push(normalized);
          } else if (tool === 'fixture_list') {
            check(
              input && Object.keys(input).length === 0,
              'Invalid list request'
            );
            text = JSON.stringify(projectFiles);
          } else if (tool === 'fixture_observe') {
            check(
              input &&
                Object.keys(input).length === 1 &&
                Object.prototype.hasOwnProperty.call(observations, input.key),
              'Invalid observation'
            );
            text = JSON.stringify(
              options.observe
                ? options.observe(input.key)
                : observations[input.key]
            );
          } else throw new Error('Unapproved dynamic tool');
        } catch (error) {
          events.push({
            method: 'fixture/denied',
            params: {
              tool,
              argumentKeys: Object.keys(input || {}),
              reason: error.message,
            },
          });
          return fail(new Error('Dynamic request rejected: ' + error.message));
        }
        events.push({ method: 'fixture/tool', params: { tool, ...input } });
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            result: {
              contentItems: [{ type: 'inputText', text }],
              success: true,
            },
          }) + '\n'
        );
      } else if (message.method) {
        // Exclude account metadata, rates/balances and raw provider traffic.
        if (
          [
            'item/completed',
            'turn/completed',
            'hook/started',
            'hook/completed',
            'thread/tokenUsage/updated',
          ].includes(message.method)
        ) {
          const item = message.params.item;
          if (
            item &&
            ![
              'userMessage',
              'agentMessage',
              'dynamicToolCall',
              'reasoning',
              ...(options.mcpServer ? ['mcpToolCall'] : []),
            ].includes(item.type)
          )
            return fail(new Error('Unexpected built-in tool: ' + item.type));
          if (item && item.type === 'mcpToolCall') {
            check(
              options.mcpServer &&
                item.server === options.mcpServer &&
                [
                  'ask_question',
                  'ask_wiki_question',
                  'read_wiki_structure',
                  'read_wiki_contents',
                ].includes(item.tool),
              'Unapproved MCP tool'
            );
          }
          if (message.method.startsWith('hook/'))
            return fail(new Error('Unexpected hook execution'));
          events.push(message);
        }
        for (const listener of listeners) listener();
      }
    }
  });
  function request(method, params) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(
        () => fail(new Error('RPC deadline: ' + method)),
        DEADLINE
      );
      pending.set(id, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  function completed(threadId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => fail(new Error('Turn deadline')),
        DEADLINE
      );
      function listener(error) {
        const found = events.find(
          (e) => e.method === 'turn/completed' && e.params.threadId === threadId
        );
        if (!error && !found) return;
        clearTimeout(timer);
        listeners.delete(listener);
        if (error) reject(error);
        else resolve(found.params.turn);
      }
      listeners.add(listener);
      listener(failure);
    });
  }
  return {
    events,
    reads,
    request,
    completed,
    async initialize() {
      const init = await request('initialize', {
        clientInfo: { name: 'yellow_skill_activation', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      check(init.codexHome === env.CODEX_HOME, 'Profile mismatch');
      child.stdin.write(
        JSON.stringify({ method: 'initialized', params: {} }) + '\n'
      );
    },
    close() {
      closing = true;
      stop(child);
    },
  };
}
function command(bin, args, env, cwd) {
  const result = spawnSync(bin, args, {
    env,
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: LIMIT,
    killSignal: 'SIGKILL',
  });
  check(!result.error && result.status === 0, 'CLI setup command failed');
  return result.stdout.trim();
}
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(
      'Usage: node scripts/smoke-codex-skill-activation.js --use-existing-login [--keep-temp]\n' +
        'Requires Linux bwrap, Codex 0.157.0 and a native file auth store.\n' +
        'Auth is read-only bound for native CLI use; never copied or read by this harness.\n' +
        'Only fixture_read/fixture_list tools accepted. No real-profile install or trust changes.'
    );
    return;
  }
  check(
    argv.includes('--use-existing-login') &&
      argv.every((a) => ['--use-existing-login', '--keep-temp'].includes(a)),
    'Explicit --use-existing-login is required'
  );
  check(process.platform === 'linux', 'Linux runtime required');
  const bin = fs.realpathSync(
    process.env.CODEX_BIN || path.join(os.homedir(), '.local/bin/codex')
  );
  const ownerAuth = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'auth.json'
  );
  check(
    fs.lstatSync(ownerAuth).isFile() &&
      !fs.lstatSync(ownerAuth).isSymbolicLink(),
    'Native file auth store unavailable'
  );
  const authBefore = fs.statSync(ownerAuth); // Metadata only; never read/hash credentials.
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'yellow-codex-activation-')
  );
  const report = {
    status: 'failed',
    recordedAt: new Date().toISOString(),
    harnessSha256: sha(__filename),
    scratch,
    credentialHandling:
      'CLI-native-read-only-bind; no credential copy or harness read',
    cases: [],
  };
  let host;
  try {
    const env = {
      PATH: '/runtime:/usr/bin:/bin',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    };
    for (const [key, dir] of Object.entries({
      HOME: 'home',
      CODEX_HOME: 'codex',
      XDG_CONFIG_HOME: 'config',
      XDG_CACHE_HOME: 'cache',
      XDG_DATA_HOME: 'data',
      XDG_STATE_HOME: 'state',
      TMPDIR: 'tmp',
    })) {
      env[key] = path.join(scratch, dir);
      fs.mkdirSync(env[key], { mode: 0o700 });
    }
    const project = path.join(scratch, 'project');
    fs.mkdirSync(project);
    fs.cpSync(
      path.join(ROOT, 'tests/fixtures/codex-activation/plans'),
      path.join(project, 'plans'),
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(env.CODEX_HOME, 'config.toml'),
      'cli_auth_credentials_store = "file"\nweb_search = "disabled"\n[features]\n' +
        'remote_plugin = false\nshell_tool = false\nunified_exec = false\napps = false\n' +
        'browser_use = false\ncomputer_use = false\ncode_mode = false\ncode_mode_host = true\n' +
        'multi_agent = false\nshell_snapshot = false\n'
    );
    check(
      command(bin, ['--version'], env, ROOT) === 'codex-cli ' + VERSION,
      'CLI version mismatch'
    );
    report.cliVersion = VERSION;
    report.revision = command('git', ['rev-parse', 'HEAD'], env, ROOT);
    command(
      bin,
      [
        '--disable',
        'remote_plugin',
        'plugin',
        'marketplace',
        'add',
        ROOT,
        '--json',
      ],
      env,
      ROOT
    );
    const install = JSON.parse(
      command(
        bin,
        [
          '--disable',
          'remote_plugin',
          'plugin',
          'add',
          'yellow-core@yellow-plugins',
          '--json',
        ],
        env,
        ROOT
      )
    );
    check(
      install.pluginId === 'yellow-core@yellow-plugins',
      'Install identity mismatch'
    );
    const installed = fs.realpathSync(install.installedPath);
    check(
      installed.startsWith(env.CODEX_HOME + '/plugins/cache/'),
      'Install outside disposable cache'
    );
    const fixtureBefore = snapshot(project),
      pluginBefore = snapshot(installed);
    report.install = install;
    report.fixtureBefore = fixtureBefore;
    const args = [
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
      bin,
      '/runtime/codex',
      '--ro-bind',
      path.join(path.dirname(bin), 'codex-code-mode-host'),
      '/runtime/codex-code-mode-host',
      '--bind',
      scratch,
      scratch,
      '--ro-bind',
      project,
      project,
      '--ro-bind',
      ownerAuth,
      path.join(env.CODEX_HOME, 'auth.json'),
      '--chdir',
      project,
      '--clearenv',
    ];
    for (const [key, value] of Object.entries(env))
      args.push('--setenv', key, value);
    args.push('/runtime/codex', 'app-server');
    const projectFiles = Object.keys(fixtureBefore).map((f) =>
      path.join(project, f)
    );
    const allowlist = new Set(projectFiles);
    host = rpc(args, env, allowlist, projectFiles);
    await host.initialize();
    const discovery = await host.request('skills/list', {
      cwds: [project],
      forceReload: true,
    });
    const skill = discovery.data
      .flatMap((d) => d.skills)
      .find(
        (s) =>
          s.name === 'yellow-core:plan-status' &&
          s.pluginId === install.pluginId
      );
    check(
      skill && skill.enabled && skill.path.startsWith(installed + '/'),
      'Installed skill missing'
    );
    check(
      sha(skill.path) ===
        sha(
          path.join(
            ROOT,
            'plugins/yellow-core/codex/skills/plan-status/SKILL.md'
          )
        ),
      'Installed skill differs from source'
    );
    allowlist.add(skill.path);
    report.skill = skill;
    save(path.join(scratch, 'discovery.json'), discovery);
    const corpus = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'tests/fixtures/codex-activation/cases.json'),
        'utf8'
      )
    );
    for (const test of corpus.cases) {
      const start = host.events.length,
        readStart = host.reads.length;
      const thread = await host.request('thread/start', {
        cwd: project,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        developerInstructions:
          'Use only fixture_read and fixture_list to read project files or installed skill instructions. ' +
          'No shell, mutation, MCP, network, delegation or other tools are allowed. ' +
          'For plan dashboards return JSON with keys open, archived, archivedCount. ' +
          'open and archived map each relative plan filename to {checked, total, ready}. ' +
          'For other requests follow the requested output format.',
        dynamicTools: [
          {
            type: 'function',
            name: 'fixture_read',
            description: 'Read one allowed project or installed skill file.',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
              additionalProperties: false,
            },
          },
          {
            type: 'function',
            name: 'fixture_list',
            description: 'List read-only project fixture filenames.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
        ],
      });
      check(
        thread.sandbox.type === 'readOnly' && !thread.sandbox.networkAccess,
        'Thread sandbox mismatch'
      );
      report.model = thread.model;
      report.modelProvider = thread.modelProvider;
      const input = [{ type: 'text', text: test.prompt, text_elements: [] }];
      if (test.attachInstalledSkill)
        input.push({ type: 'skill', name: skill.name, path: skill.path });
      const completion = host.completed(thread.thread.id);
      completion.catch(() => {}); // Request failure can precede awaiting completion.
      await host.request('turn/start', { threadId: thread.thread.id, input });
      const turn = await completion;
      check(turn.status === 'completed' && !turn.error, 'Model turn failed');
      const events = host.events.slice(start),
        reads = host.reads.slice(readStart);
      const output = events
        .filter(
          (e) =>
            e.method === 'item/completed' &&
            e.params.item.type === 'agentMessage' &&
            e.params.item.phase === 'final_answer'
        )
        .map((e) => e.params.item.text)
        .join('\n');
      const unchanged =
        equal(snapshot(project), fixtureBefore) &&
        equal(snapshot(installed), pluginBefore);
      const entry = {
        id: test.id,
        prompt: test.prompt,
        attachedSkill: test.attachInstalledSkill,
        threadId: thread.thread.id,
        output,
        reads,
        events,
        unchanged,
      };
      report.cases.push(entry);
      Object.assign(
        entry,
        assess(test, output, reads, skill, corpus.expectedDashboard, unchanged)
      );
      save(path.join(scratch, test.id + '.json'), entry);
    }
    const authAfter = fs.statSync(ownerAuth);
    check(
      authBefore.ino === authAfter.ino &&
        authBefore.size === authAfter.size &&
        authBefore.mtimeMs === authAfter.mtimeMs &&
        authBefore.ctimeMs === authAfter.ctimeMs,
      'Owner credential file metadata changed'
    );
    report.ownerAuthMetadataUnchanged = true;
    report.fixtureAfter = snapshot(project);
    report.status = 'passed';
  } catch (error) {
    if (host) report.failureEvents = host.events;
    report.failure =
      error instanceof SyntaxError ? 'Malformed model/CLI JSON' : error.message;
    process.exitCode = 1;
  } finally {
    if (host) host.close();
    report.scratchRetained =
      argv.includes('--keep-temp') || report.status !== 'passed';
    save(path.join(scratch, 'result.json'), report);
    if (!report.scratchRetained)
      fs.rmSync(scratch, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2));
  }
}
module.exports = {
  assess,
  allowedRead,
  modelReadPath,
  snapshot,
  rpc,
  command,
  sha,
  save,
  equal,
};
if (require.main === module)
  main().catch(() => {
    console.error('Activation harness setup failed');
    process.exitCode = 1;
  });
