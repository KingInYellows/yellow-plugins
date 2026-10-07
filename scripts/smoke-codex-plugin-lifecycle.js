#!/usr/bin/env node
'use strict';

// Optional real-host acceptance. No model semantics or authenticated MCP claims.
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VERSION = '0.157.0';
const LIMIT = 4 * 1024 * 1024;
const TIMEOUT = 30000;
const GLOBAL = ['--disable', 'remote_plugin'];
const COMMANDS = ['git push', 'gt modify -m "bad message"'];

function check(ok, message) {
  if (!ok) throw new Error(message);
}
function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
}
function run(bin, args, env, cwd) {
  const result = spawnSync(bin, args, {
    env,
    cwd,
    encoding: 'utf8',
    timeout: TIMEOUT,
    maxBuffer: LIMIT,
    killSignal: 'SIGKILL',
  });
  check(
    !result.error && result.status === 0,
    'Command failed: ' + path.basename(bin)
  );
  return result.stdout.trim();
}
function stop(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function rpc(env, cwd) {
  const child = spawn('/runtime/codex', [...GLOBAL, 'app-server'], {
    env,
    cwd,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const events = [];
  const pending = new Map();
  const listeners = new Set();
  let sequence = 0,
    buffer = '',
    bytes = 0,
    failure;
  function fail(error) {
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
      } else if (message.method && message.id !== undefined) {
        // Fail closed: never automatically approve a server request.
        return fail(new Error('Unexpected approval or other server request'));
      } else if (message.method) {
        events.push(message);
        for (const listener of listeners) listener();
      }
    }
  });
  function request(method, params) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('RPC timeout: ' + method));
      }, TIMEOUT);
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
  function wait(predicate) {
    const found = events.find(predicate);
    if (found) return Promise.resolve(found);
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('Event timeout')), TIMEOUT);
      function done(error, value) {
        clearTimeout(timer);
        listeners.delete(listener);
        if (error) reject(error);
        else resolve(value);
      }
      function listener(error) {
        if (error) return done(error);
        const value = events.find(predicate);
        if (value) done(null, value);
      }
      listeners.add(listener);
    });
  }
  return {
    events,
    request,
    wait,
    async initialize() {
      const result = await request('initialize', {
        clientInfo: { name: 'yellow_lifecycle_smoke', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      check(result.codexHome === env.CODEX_HOME, 'Profile isolation mismatch');
      child.stdin.write(
        JSON.stringify({ method: 'initialized', params: {} }) + '\n'
      );
    },
    async close() {
      stop(child);
      if (child.exitCode === null && child.signalCode === null)
        await new Promise((resolve) => child.once('exit', resolve));
    },
  };
}

function responseFixture() {
  let calls = 0;
  const commands = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > LIMIT) req.destroy();
    });
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v1/responses') {
        res.writeHead(404);
        res.end();
        return;
      }
      let request;
      try {
        request = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const offered = (request.tools || []).flatMap((tool) =>
        tool.type === 'namespace' ? tool.tools : [tool]
      );
      const tool = offered.find((t) =>
        ['exec_command', 'shell_command', 'shell'].includes(t.name)
      );
      const index = calls++;
      const responseId = 'resp_fixture_' + index;
      let output;
      if (index < COMMANDS.length) {
        check(tool, 'No shell tool offered');
        const command = COMMANDS[index];
        commands.push({ name: tool.name, command });
        const args =
          tool.name === 'exec_command'
            ? { cmd: command, login: false, yield_time_ms: 1000 }
            : tool.name === 'shell_command'
              ? { command, workdir: process.cwd(), timeout_ms: 1000 }
              : {
                  command: ['bash', '-c', command],
                  workdir: process.cwd(),
                  timeout_ms: 1000,
                };
        output = [
          {
            id: 'fc_fixture_' + index,
            type: 'function_call',
            status: 'completed',
            name: tool.name,
            call_id: 'call_fixture_' + index,
            arguments: JSON.stringify(args),
          },
        ];
      } else {
        output = [
          {
            id: 'msg_fixture_' + index,
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Fixture complete.',
                annotations: [],
              },
            ],
          },
        ];
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (type, data) =>
        res.write(
          'event: ' +
            type +
            '\ndata: ' +
            JSON.stringify({ type, ...data }) +
            '\n\n'
        );
      emit('response.created', {
        response: {
          id: responseId,
          object: 'response',
          status: 'in_progress',
          output: [],
        },
      });
      for (let i = 0; i < output.length; i++) {
        emit('response.output_item.added', {
          output_index: i,
          item: output[i],
        });
        emit('response.output_item.done', { output_index: i, item: output[i] });
      }
      emit('response.completed', {
        response: {
          id: responseId,
          object: 'response',
          status: 'completed',
          output,
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      res.end();
    });
  });
  return {
    server,
    commands,
    reset() {
      calls = 0;
      commands.length = 0;
    },
  };
}

function summarizeControl(events, stubs, trusted) {
  const completed = events
    .filter((e) => e.method === 'hook/completed')
    .map((e) => e.params.run);
  const started = events
    .filter((e) => e.method === 'hook/started')
    .map((e) => e.params.run);
  const push = stubs.filter((s) => s.bin === 'git' && s.args[0] === 'push');
  const modify = stubs.filter((s) => s.bin === 'gt' && s.args[0] === 'modify');
  const items = events
    .filter((e) => e.method === 'item/completed')
    .map((e) => e.params.item);
  const commands = items.filter((i) => i.type === 'commandExecution');
  check(
    modify.length === 1,
    'gt modify control did not reach stub exactly once'
  );
  check(push.length === (trusted ? 0 : 1), 'git push trust control mismatch');
  if (trusted) {
    for (const event of ['sessionStart', 'preToolUse', 'postToolUse']) {
      check(
        started.some((r) => r.eventName === event),
        'Missing started hook: ' + event
      );
      check(
        completed.some((r) => r.eventName === event),
        'Missing completed hook: ' + event
      );
    }
    check(
      completed.some(
        (r) =>
          r.eventName === 'preToolUse' &&
          r.status === 'blocked' &&
          r.entries.some((entry) => /git push/.test(entry.text))
      ),
      'Missing push denial evidence'
    );
    check(
      completed.some(
        (r) =>
          r.eventName === 'postToolUse' &&
          r.entries.some((entry) => /conventional commits/.test(entry.text))
      ),
      'Missing commit warning'
    );
    check(
      started.length === 4 && completed.length === 4,
      'Unexpected hook event count'
    );
    check(
      completed.every(
        (r) =>
          ['completed', 'blocked'].includes(r.status) &&
          started.some((s) => s.id === r.id)
      ),
      'Hook completion mismatch'
    );
    check(
      commands.length === 1 &&
        commands[0].command.includes('gt modify') &&
        commands[0].exitCode === 0,
      'Trusted command execution mismatch'
    );
  } else {
    check(
      commands.length === 2 && commands.every((c) => c.exitCode === 0),
      'Untrusted command execution mismatch'
    );
    check(
      started.length === 0 && completed.length === 0,
      'Untrusted hook unexpectedly executed'
    );
  }
  return {
    trusted,
    pushStubCalls: push.length,
    modifyStubCalls: modify.length,
    hookStarted: started.length,
    hookCompleted: completed.length,
    commands,
  };
}

function mcpMutationCalls(scratch) {
  const rows = fs
    .readFileSync(path.join(scratch, 'stub-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
  return rows.filter(
    (row) =>
      (row.bin === 'git' &&
        ['push', 'commit', 'reset', 'checkout', 'fetch'].includes(
          row.args[0]
        )) ||
      (row.bin === 'gh' && ['pr', 'api'].includes(row.args[0])) ||
      (row.bin === 'gt' && row.args[0] !== 'mcp')
  );
}

async function inside(scratch) {
  check(
    /^\/tmp\/yellow-codex-lifecycle-[a-zA-Z0-9]+$/.test(scratch),
    'Invalid disposable root'
  );
  const env = {
    PATH: scratch + '/stubs:/runtime:/usr/bin:/bin',
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
    fs.mkdirSync(env[key], { recursive: true, mode: 0o700 });
  }
  env.TMP = env.TEMP = env.TMPDIR;
  env.STUB_LOG = path.join(scratch, 'stub-log.jsonl');
  env.GRAPHITE_DISABLE_TELEMETRY = '1';
  env.GRAPHITE_DISABLE_UPGRADE_PROMPT = '1';
  const cwd = path.join(scratch, 'project');
  fs.mkdirSync(path.join(cwd, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  const fixture = responseFixture();
  await new Promise((resolve) =>
    fixture.server.listen(0, '127.0.0.1', resolve)
  );
  const port = fixture.server.address().port;
  const config = path.join(env.CODEX_HOME, 'config.toml');
  const baseConfig =
    [
      'cli_auth_credentials_store = "file"',
      'mcp_oauth_credentials_store = "file"',
      'model = "fixture"',
      'model_provider = "fixture"',
      'web_search = "disabled"',
      '[features]',
      'remote_plugin = false',
      'shell_snapshot = false',
      '[model_providers.fixture]',
      'name = "Disconnected fixture"',
      'base_url = "http://127.0.0.1:' + port + '/v1"',
      'wire_api = "responses"',
      'requires_openai_auth = false',
      '[plugins."gt-workflow@yellow-plugins".mcp_servers.graphite]',
      'enabled = false',
    ].join('\n') + '\n';
  fs.writeFileSync(config, baseConfig, { mode: 0o600 });
  check(
    run('/runtime/codex', ['--version'], env, cwd) === 'codex-cli ' + VERSION,
    'Unsupported Codex version'
  );
  run(
    '/runtime/codex',
    [...GLOBAL, 'plugin', 'marketplace', 'add', ROOT, '--json'],
    env,
    cwd
  );
  const marketplace = json(
    path.join(ROOT, '.agents/plugins/marketplace.json')
  ).name;
  const installed = [];
  for (const plugin of ['gt-workflow', 'yellow-ci']) {
    installed.push(
      JSON.parse(
        run(
          '/runtime/codex',
          [...GLOBAL, 'plugin', 'add', plugin + '@' + marketplace, '--json'],
          env,
          cwd
        )
      )
    );
  }
  save(path.join(scratch, 'install.json'), installed);
  const artifacts = installed.map((plugin) => {
    const manifest = json(
      path.join(plugin.installedPath, '.codex-plugin/plugin.json')
    );
    const hash = createHash('sha256');
    for (const file of [
      manifest.hooks,
      manifest.mcpServers,
      'hooks/scripts/entrypoint-codex.js',
      ...fs
        .readdirSync(path.join(plugin.installedPath, 'hooks/scripts/lib'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => 'hooks/scripts/lib/' + f),
    ].filter(Boolean)) {
      const installedBytes = fs.readFileSync(
        path.join(plugin.installedPath, file)
      );
      check(
        installedBytes.equals(
          fs.readFileSync(path.join(ROOT, 'plugins', plugin.name, file))
        ),
        'Installed hook/MCP bytes differ'
      );
      hash.update(file).update(installedBytes);
    }
    return { pluginId: plugin.pluginId, hookAndMcpSha256: hash.digest('hex') };
  });
  const report = {
    status: 'failed',
    cliVersion: VERSION,
    scratch,
    installed,
    artifacts,
    controls: [],
    skillActivation: 'not-tested',
    authentication: 'not-tested',
    network: 'disconnected-loopback-only',
  };
  try {
    for (const trusted of [false, true]) {
      fixture.reset();
      fs.writeFileSync(env.STUB_LOG, '');
      const client = rpc(env, cwd);
      try {
        await client.initialize();
        const hooks = await client.request('hooks/list', { cwds: [cwd] });
        save(
          path.join(
            scratch,
            trusted ? 'hooks-trusted.json' : 'hooks-untrusted.json'
          ),
          hooks
        );
        check(
          hooks.data.length === 1 && hooks.data[0].errors.length === 0,
          'Hook discovery errors'
        );
        const metadata = hooks.data[0].hooks;
        check(
          metadata.length === 3 &&
            metadata.every(
              (h) => h.trustStatus === (trusted ? 'trusted' : 'untrusted')
            ),
          'Unexpected hook trust/inventory'
        );
        for (const [name, events] of [
          ['gt-workflow', ['preToolUse', 'postToolUse']],
          ['yellow-ci', ['sessionStart']],
        ]) {
          const plugin = installed.find((p) => p.name === name);
          for (const event of events) {
            check(
              metadata.filter(
                (hook) =>
                  hook.pluginId === plugin.pluginId &&
                  hook.eventName === event &&
                  hook.enabled &&
                  hook.handlerType === 'command' &&
                  hook.sourcePath ===
                    path.join(plugin.installedPath, 'hooks/codex-hooks.json')
              ).length === 1,
              'Unexpected installed hook identity'
            );
          }
        }
        if (!trusted) report.hookDefinitions = metadata;
        const start = await client.request('thread/start', {
          cwd,
          model: 'fixture',
          modelProvider: 'fixture',
          sandbox: 'danger-full-access',
          approvalPolicy: 'never',
          ephemeral: true,
        });
        const threadId = start.thread.id;
        await client.request('turn/start', {
          threadId,
          input: [
            {
              type: 'text',
              text: 'Run the two disposable control commands.',
              text_elements: [],
            },
          ],
        });
        const completed = await client.wait(
          (e) => e.method === 'turn/completed' && e.params.threadId === threadId
        );
        check(
          completed.params.turn.status === 'completed',
          'Fixture turn failed'
        );
        const stubs = fs
          .readFileSync(env.STUB_LOG, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse);
        check(
          !client.events.some(
            (e) =>
              e.method === 'mcpServer/startupStatus/updated' &&
              e.params.name === 'graphite' &&
              e.params.status === 'starting'
          ),
          'Graphite must be disabled during hook controls'
        );
        check(
          !stubs.some((s) => s.bin === 'gt' && s.args[0] === 'mcp'),
          'MCP reached gt stub'
        );
        save(
          path.join(
            scratch,
            trusted ? 'trusted-events.json' : 'untrusted-events.json'
          ),
          client.events
        );
        save(
          path.join(
            scratch,
            trusted ? 'trusted-stubs.json' : 'untrusted-stubs.json'
          ),
          stubs
        );
        report.controls.push(summarizeControl(client.events, stubs, trusted));
        report.controls.at(-1).requestedCommands = [...fixture.commands];
        if (!trusted) {
          const states = metadata
            .map((hook) => {
              check(
                /^sha256:[a-f0-9]{64}$/.test(hook.currentHash),
                'Invalid hook hash'
              );
              return (
                '[hooks.state.' +
                JSON.stringify(hook.key) +
                ']\ntrusted_hash = ' +
                JSON.stringify(hook.currentHash)
              );
            })
            .join('\n');
          fs.appendFileSync(config, '\n' + states + '\n');
        }
      } finally {
        await client.close();
      }
    }
    fs.writeFileSync(
      config,
      fs
        .readFileSync(config, 'utf8')
        .replace(
          '[plugins."gt-workflow@yellow-plugins".mcp_servers.graphite]\nenabled = false',
          '[plugins."gt-workflow@yellow-plugins".mcp_servers.graphite]\nenabled = true'
        )
    );
    const mcpLaunchLog = path.join(scratch, 'mcp-launch.jsonl');
    fs.writeFileSync(
      path.join(scratch, 'stubs/gt'),
      '#!/runtime/node\n' +
        'const fs = require("node:fs");\n' +
        'if (process.argv.length !== 3 || process.argv[2] !== "mcp") process.exit(92);\n' +
        'fs.appendFileSync(' +
        JSON.stringify(mcpLaunchLog) +
        ', JSON.stringify({command:"gt mcp",executable:"/runtime/graphite/graphite.js"})+"\\n");\n' +
        'const child = require("node:child_process").spawn("/runtime/node", ["/runtime/graphite/graphite.js", "mcp"], {env:process.env,stdio:"inherit"});\n' +
        'child.on("error",()=>process.exit(93)); child.on("exit",(code)=>process.exit(code ?? 94));\n',
      { mode: 0o700 }
    );
    report.graphite = {
      version: json('/runtime/graphite/package.json').version,
      executableSha256: createHash('sha256')
        .update(fs.readFileSync('/runtime/graphite/graphite.js'))
        .digest('hex'),
    };
    fs.writeFileSync(env.STUB_LOG, '');
    const mcpClient = rpc(env, cwd);
    try {
      await mcpClient.initialize();
      const start = await mcpClient.request('thread/start', {
        cwd,
        model: 'fixture',
        modelProvider: 'fixture',
        sandbox: 'read-only',
        approvalPolicy: 'never',
        ephemeral: true,
      });
      await mcpClient.wait(
        (e) =>
          e.method === 'mcpServer/startupStatus/updated' &&
          e.params.name === 'graphite' &&
          ['ready', 'failed', 'cancelled'].includes(e.params.status)
      );
      const status = await mcpClient.request('mcpServerStatus/list', {
        threadId: start.thread.id,
      });
      const graphite = status.data.filter((s) => s.name === 'graphite');
      check(
        graphite.length === 1 &&
          graphite[0].pluginId === 'gt-workflow@yellow-plugins',
        'Installed MCP registration mismatch'
      );
      report.mcp = {
        registration: 'observed',
        executable: 'actual-installed-gt-cli',
        gitContext:
          'synthetic-version-repository-paths-and-empty-refs; other-reads-fail',
        profile: 'disposable-no-credentials',
        network: 'disconnected',
        launches: fs
          .readFileSync(mcpLaunchLog, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse),
        status: graphite[0],
        authentication: 'not-proven',
        toolInvocation: 'not-tested',
      };
      save(path.join(scratch, 'mcp-status.json'), status);
      save(path.join(scratch, 'mcp-events.json'), mcpClient.events);
      save(
        path.join(scratch, 'mcp-stubs.json'),
        fs
          .readFileSync(env.STUB_LOG, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse)
      );
    } finally {
      await mcpClient.close();
    }
    check(
      report.mcp.status.runtimeStatus === 'connected' &&
        report.mcp.status.serverInfo?.name === 'gt' &&
        ['run_gt_cmd', 'learn_gt'].every((name) =>
          Object.hasOwn(report.mcp.status.tools, name)
        ) &&
        report.mcp.status.toolsError === null,
      'Actual Graphite MCP startup/tool discovery failed'
    );
    check(
      !mcpMutationCalls(scratch).length,
      'MCP probe attempted a mutation command'
    );
    report.phase1Acceptance = 'partial';
    report.remaining = [
      'model-driven direct/indirect/negative skill activation',
      'authenticated Graphite availability',
    ];
    report.status = 'passed';
  } finally {
    fixture.server.closeAllConnections();
    await new Promise((resolve) => fixture.server.close(resolve));
    save(path.join(scratch, 'result.json'), report);
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--inside') {
    check(
      args.length === 2 && process.env.YELLOW_CODEX_FIXTURE === '1',
      'Internal invocation requires sandbox'
    );
    return inside(args[1]).catch((error) => {
      console.error(error.message);
      process.exit(1); // Fatal setup errors must not leave the loopback server alive.
    });
  }
  check(
    args.every((a) => ['--help', '--dry-run', '--keep-temp'].includes(a)),
    'Invalid argument'
  );
  if (args.includes('--help')) {
    console.log(
      'Usage: node scripts/smoke-codex-plugin-lifecycle.js [--dry-run] [--keep-temp]\nLinux/WSL only; pinned Codex 0.157.0, Node, unshare, bwrap and ip required.\nDisconnected Responses fixture proves hook dispatch, never model skill semantics or Graphite authentication.\nNo real profile access or real mutation commands. Fails closed if isolation is unavailable.'
    );
    return;
  }
  if (args.includes('--dry-run')) {
    console.log(
      JSON.stringify({
        status: 'dry-run',
        controls: ['untrusted', 'trusted'],
        commands: COMMANDS,
        network: 'disconnected',
        skillActivation: 'not-tested',
      })
    );
    return;
  }
  check(process.platform === 'linux', 'Run in Linux/WSL');
  const safeEnv = {
    PATH: process.env.PATH,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  };
  const graphite = path.dirname(
    fs.realpathSync(run('which', ['gt'], safeEnv, ROOT))
  );
  check(
    fs.existsSync(path.join(graphite, 'graphite.js')),
    'Graphite CLI package unavailable'
  );
  const codex = fs.realpathSync(
    run('which', [process.env.CODEX_BIN || 'codex'], safeEnv, ROOT)
  );
  const revision = run('git', ['rev-parse', 'HEAD'], safeEnv, ROOT);
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'yellow-codex-lifecycle-')
  );
  fs.mkdirSync(path.join(scratch, 'stubs'), { mode: 0o700 });
  for (const bin of ['git', 'gt', 'gh']) {
    fs.writeFileSync(
      path.join(scratch, 'stubs', bin),
      '#!/runtime/node\n' +
        'const fs = require("node:fs");\n' +
        'fs.appendFileSync(' +
        JSON.stringify(path.join(scratch, 'stub-log.jsonl')) +
        ', JSON.stringify({bin:' +
        JSON.stringify(bin) +
        ',args:process.argv.slice(2)})+"\\n");\n' +
        (bin === 'gh'
          ? 'process.exitCode = 1;\n'
          : bin === 'git'
            ? 'const args=process.argv.slice(2); if(JSON.stringify(args)===JSON.stringify(["--version"])) console.log("git version 2.43.0");\n' +
              'else if(JSON.stringify(args)===JSON.stringify(["rev-parse","--path-format=absolute","--show-toplevel","--git-common-dir","--git-dir"])) console.log([process.cwd(),process.cwd()+"/.git",process.cwd()+"/.git"].join("\\n"));\n' +
              'else if(JSON.stringify(args)===JSON.stringify(["for-each-ref","--format=%(refname):%(objectname)","refs/branch-metadata/"]) || JSON.stringify(args)===JSON.stringify(["for-each-ref","--format=%(refname:short):%(objectname)","--sort=-committerdate","refs/heads/"])) {}\n' +
              'else if(JSON.stringify(args)===JSON.stringify(["push"])) console.log("DISPOSABLE_STUB"); else process.exitCode=1;\n'
            : 'console.log("DISPOSABLE_STUB");\n'),
      { mode: 0o700 }
    );
  }
  const cliOverlays = ['gt', 'gh']
    .filter((name) => fs.existsSync('/usr/bin/' + name))
    .flatMap((name) => [
      '--ro-bind',
      path.join(scratch, 'stubs', name),
      '/usr/bin/' + name,
    ]);
  const bwrap = [
    '--die-with-parent',
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
    graphite,
    '/runtime/graphite',
    '--ro-bind',
    process.execPath,
    '/runtime/node',
    '--ro-bind',
    codex,
    '/runtime/codex',
    '--ro-bind',
    ROOT,
    ROOT,
    '--bind',
    scratch,
    scratch,
    '--ro-bind',
    path.join(scratch, 'stubs/git'),
    '/usr/bin/git',
    ...cliOverlays,
    '--clearenv',
    '--setenv',
    'YELLOW_CODEX_FIXTURE',
    '1',
    '--setenv',
    'PATH',
    '/runtime:/usr/bin:/bin',
    '--chdir',
    scratch,
    '--',
    '/runtime/node',
    __filename,
    '--inside',
    scratch,
  ];
  const child = spawn(
    'unshare',
    [
      '--user',
      '--map-root-user',
      '--net',
      '--',
      '/bin/bash',
      '-c',
      'ip link set lo up && exec bwrap "$@"',
      'fixture',
      ...bwrap,
    ],
    { env: safeEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let diagnostics = '',
    bytes = 0;
  const timer = setTimeout(() => stop(child), 180000);
  const interrupt = () => stop(child);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMIT) stop(child);
      else diagnostics += chunk;
    });
  let exit;
  try {
    exit = await new Promise((resolve) => {
      child.on('error', () => resolve(-1));
      child.on('close', (code) => resolve(code));
    });
    const file = path.join(scratch, 'result.json');
    const report = fs.existsSync(file) ? json(file) : { status: 'failed' };
    report.recordedAt = new Date().toISOString();
    report.harnessSha256 = createHash('sha256')
      .update(fs.readFileSync(__filename))
      .digest('hex');
    report.sourceRevision = revision;
    report.sourceDirty = Boolean(
      run('git', ['status', '--porcelain'], safeEnv, ROOT)
    );
    report.environment = { node: process.version, platform: process.platform };
    report.scratch = scratch;
    // Failed runs retain recovery evidence. Diagnostics come only from the
    // credential-free sandbox, never the real profile or inherited environment.
    report.scratchRetained = args.includes('--keep-temp') || exit !== 0;
    if (exit !== 0) report.failure = diagnostics.slice(-4000);
    save(path.join(scratch, 'outer-result.json'), report);
    console.log(JSON.stringify(report, null, 2));
    if (!report.scratchRetained)
      fs.rmSync(scratch, { recursive: true, force: true });
    if (exit !== 0 || report.status !== 'passed') process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
module.exports = { summarizeControl };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
