#!/usr/bin/env node
'use strict';

// Discovery-only: never starts a thread, model turn, MCP server, or trusts hooks.
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  lstatSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, relative, isAbsolute } = require('node:path');

const ROOT = resolve(__dirname, '..');
const CLI_VERSION = '0.157.0';
const LIMIT = 4 * 1024 * 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GLOBAL_ARGS = ['--disable', 'remote_plugin'];
const HELP = [
  'Usage: node scripts/smoke-codex-plugin-install.js [options]',
  'Isolated local installation and app-server discovery, pinned Codex ' +
    CLI_VERSION,
  '--plugin <name>     Select one Codex-enabled plugin',
  '--dry-run           Print inventory without invoking Codex or creating state',
  '--keep-temp         Preserve the disposable profile for inspection',
  '--ci                Missing CLI is a failure (also enabled by CI)',
  '--timeout-ms <n>    Per-command/request deadline, 100..60000 (default 20000)',
  '--help              Print this help',
  'CODEX_BIN overrides the executable; no credentials or user config are copied.',
  'Exit codes: 0 passed/dry-run/local explicit skip; 1 failed; 2 usage/CI missing CLI.',
  'No model turns, skill invocation, hook execution/trust, or MCP connection proof.',
].join('\n');

function check(value, message) {
  if (!value) throw new Error(message);
}

function within(root, path) {
  check(typeof path === 'string', 'Missing path');
  const base = realpathSync(root);
  const rel = relative(base, resolve(path));
  check(
    rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel),
    'Path escapes expected root'
  );
  let cursor = base;
  for (const part of rel.split('/').filter(Boolean)) {
    cursor = join(cursor, part);
    check(!lstatSync(cursor).isSymbolicLink(), 'Symlink in expected path');
  }
  return realpathSync(path);
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function skillFiles(root) {
  const files = [];
  for (const name of readdirSync(root).sort()) {
    const path = within(root, join(root, name));
    if (name === 'agents') {
      const policy = require('./lib/generate/skill-policy').readSkillPolicy(
        root
      );
      check(policy, 'Missing invocation policy');
      files.push('agents/openai.yaml');
    } else if (name === 'SKILL.md') {
      check(lstatSync(path).isFile(), 'Skill body is not a file');
      files.push(name);
    } else {
      check(
        name === 'references' && lstatSync(path).isDirectory(),
        'Unexpected skill resource'
      );
      for (const ref of readdirSync(path).sort()) {
        check(
          /^[a-zA-Z0-9_][a-zA-Z0-9_-]*\.md$/.test(ref),
          'Unsafe reference name'
        );
        check(
          lstatSync(within(path, join(path, ref))).isFile(),
          'Reference is not a file'
        );
        files.push('references/' + ref);
      }
    }
  }
  check(files.includes('SKILL.md'), 'Missing skill body');
  return files;
}

function parseArgs(args) {
  const options = {
    ci: Boolean(process.env.CI && !['0', 'false'].includes(process.env.CI)),
    timeout: 20000,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--keep-temp':
        options.keepTemp = true;
        break;
      case '--ci':
        options.ci = true;
        break;
      case '--plugin':
        check(
          !options.plugin && NAME.test(args[i + 1] || ''),
          'Invalid --plugin'
        );
        options.plugin = args[++i];
        break;
      case '--timeout-ms':
        check(/^\d+$/.test(args[i + 1] || ''), 'Invalid --timeout-ms');
        options.timeout = Number(args[++i]);
        check(
          options.timeout >= 100 && options.timeout <= 60000,
          'Invalid --timeout-ms'
        );
        break;
      default:
        throw new Error('Unknown argument');
    }
  }
  return options;
}

function isolatedEnvironment(scratch) {
  // An allowlist deliberately drops auth, proxies, NODE_OPTIONS, inherited
  // provider settings, SSH agents, and XDG_RUNTIME_DIR / desktop keyring buses.
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  for (const [key, dir] of Object.entries({
    HOME: 'home',
    CODEX_HOME: 'codex',
    XDG_CONFIG_HOME: 'config',
    XDG_CACHE_HOME: 'cache',
    XDG_DATA_HOME: 'data',
    XDG_STATE_HOME: 'state',
    TMPDIR: 'tmp',
  })) {
    env[key] = join(scratch, dir);
    mkdirSync(env[key], { mode: 0o700 });
  }
  env.TMP = env.TEMP = env.TMPDIR;
  writeFileSync(
    join(env.CODEX_HOME, 'config.toml'),
    'cli_auth_credentials_store = "file"\n[features]\nremote_plugin = false\n',
    { mode: 0o600 }
  );
  return env;
}

const children = new Set();
function stop(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.once(signal, () => {
    for (const child of children) stop(child);
    process.exit(code);
  });
}

function command(bin, args, options) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(bin, args, {
      ...options,
      timeout: undefined,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let output = '';
    let bytes = 0;
    let failure;
    const timer = setTimeout(() => {
      failure = new Error('CLI command timed out');
      stop(child);
    }, options.timeout);
    child.stdout.setEncoding('utf8');
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > LIMIT) {
          failure = new Error('CLI output limit exceeded');
          stop(child);
        } else if (stream === child.stdout) output += chunk;
      });
    }
    child.on('error', (error) => {
      failure = new Error('CLI could not start');
      failure.code = error.code;
      failure.missingCodex =
        error.code === 'ENOENT' && options.isCodex === true;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      children.delete(child);
      if (failure || code !== 0)
        reject(failure || new Error('CLI command failed'));
      else resolveCommand(output);
    });
  });
}

async function discover(bin, options, timeout) {
  const child = spawn(bin, [...GLOBAL_ARGS, 'app-server'], {
    ...options,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout.setEncoding('utf8');
  const pending = new Map();
  let sequence = 0;
  let buffer = '';
  let bytes = 0;
  let failure;
  const fail = (error) => {
    failure = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.on('error', () => fail(new Error('App-server failed to start')));
  child.on('exit', () => fail(new Error('App-server exited before response')));
  child.stdin.on('error', () => fail(new Error('App-server input closed')));
  child.stderr.on('data', () => {}); // Drain without recording arbitrary diagnostics.
  child.stdout.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > LIMIT) {
      fail(new Error('App-server output limit exceeded'));
      stop(child);
      return;
    }
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        fail(new Error('Malformed app-server JSON'));
        return;
      }
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if (message.error || !Object.hasOwn(message, 'result')) {
          waiter.reject(new Error('App-server RPC failed: ' + waiter.method));
        } else waiter.resolve(message.result);
      } else if (message.id !== undefined && message.method) {
        // Discovery should not ask for approval or credentials.
        fail(new Error('Unexpected app-server request'));
      }
    }
  });
  function request(method, params) {
    if (failure) return Promise.reject(failure);
    return new Promise((resolveRequest, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('App-server request timed out: ' + method));
      }, timeout);
      pending.set(id, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          resolveRequest(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  try {
    const initialization = await request('initialize', {
      clientInfo: { name: 'yellow_plugins_smoke', version: '0.1.0' },
    });
    check(
      realpathSync(initialization.codexHome) ===
        realpathSync(options.env.CODEX_HOME),
      'App-server did not use isolated CODEX_HOME'
    );
    child.stdin.write(
      JSON.stringify({ method: 'initialized', params: {} }) + '\n'
    );
    const skills = await request('skills/list', {
      cwds: [options.cwd],
      forceReload: true,
    });
    const hooks = await request('hooks/list', { cwds: [options.cwd] });
    return { skills, hooks };
  } finally {
    child.stdin.end();
    stop(child);
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((done) => child.once('exit', done));
    }
    children.delete(child);
  }
}

async function main() {
  let options;
  let marketplace;
  let selected;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(HELP);
      return;
    }
    marketplace = json(join(ROOT, '.agents/plugins/marketplace.json'));
    check(NAME.test(marketplace.name), 'Invalid marketplace name');
    selected = marketplace.plugins.filter(
      (p) => !options.plugin || p.name === options.plugin
    );
    check(selected.length > 0, 'Plugin not in Codex marketplace');
    for (const plugin of selected) {
      check(
        NAME.test(plugin.name) &&
          plugin.source.source === 'local' &&
          plugin.source.path === './plugins/' + plugin.name,
        'Invalid local plugin source'
      );
    }
  } catch (error) {
    console.error('usage error: ' + error.message);
    process.exitCode = 2;
    return;
  }
  const report = {
    status: 'dry-run',
    cliVersion: CLI_VERSION,
    marketplace: marketplace.name,
    plugins: selected.map((p) => p.name),
    runtime: {
      skillInvocation: 'not-tested',
      hookExecution: 'not-tested',
      mcpConnection: 'not-tested',
      authentication: 'not-tested',
    },
    failures: [],
  };
  if (options.dryRun) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  let scratch;
  try {
    check(process.platform === 'linux', 'Run this harness in Linux/WSL');
    scratch = mkdtempSync(join(tmpdir(), 'yellow-codex-smoke-'));
    const env = isolatedEnvironment(scratch);
    const cwd = join(scratch, 'project');
    mkdirSync(cwd, { mode: 0o700 });
    const childOptions = { env, cwd, timeout: options.timeout };
    const bin = process.env.CODEX_BIN || 'codex';
    const version = (
      await command(bin, ['--version'], { ...childOptions, isCodex: true })
    ).trim();
    check(
      version === 'codex-cli ' + CLI_VERSION,
      'Unsupported Codex CLI version'
    );
    report.sourceRevision = (
      await command('git', ['-C', ROOT, 'rev-parse', 'HEAD'], childOptions)
    ).trim();
    report.sourceDirty = Boolean(
      (
        await command(
          'git',
          ['-C', ROOT, 'status', '--porcelain'],
          childOptions
        )
      ).trim()
    );
    report.environment = {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
    };
    await command(
      bin,
      [...GLOBAL_ARGS, 'plugin', 'marketplace', 'add', ROOT, '--json'],
      childOptions
    );
    report.installed = [];
    for (const plugin of selected) {
      const source = within(ROOT, join(ROOT, 'plugins', plugin.name));
      const manifest = json(
        within(source, join(source, '.codex-plugin/plugin.json'))
      );
      check(manifest.skills === './codex/skills', 'Unexpected skill root');
      const receipt = JSON.parse(
        await command(
          bin,
          [
            ...GLOBAL_ARGS,
            'plugin',
            'add',
            plugin.name + '@' + marketplace.name,
            '--json',
          ],
          childOptions
        )
      );
      check(
        receipt.pluginId === plugin.name + '@' + marketplace.name &&
          receipt.version === manifest.version,
        'Install identity/version mismatch'
      );
      const installedPath = within(
        join(env.CODEX_HOME, 'plugins/cache'),
        receipt.installedPath
      );
      const installedManifest = json(
        within(installedPath, join(installedPath, '.codex-plugin/plugin.json'))
      );
      check(
        JSON.stringify(manifest) === JSON.stringify(installedManifest),
        'Installed manifest differs'
      );
      const skillsRoot = within(
        installedPath,
        join(installedPath, manifest.skills)
      );
      const hookExpectations = [];
      if (manifest.hooks) {
        const hookPath = within(
          installedPath,
          join(installedPath, manifest.hooks)
        );
        check(
          readFileSync(hookPath).equals(
            readFileSync(within(source, join(source, manifest.hooks)))
          ),
          'Installed hook config differs'
        );
        for (const [event, groups] of Object.entries(json(hookPath).hooks)) {
          for (const group of groups)
            for (const hook of group.hooks) {
              check(hook.type === 'command', 'Unsupported hook handler');
              hookExpectations.push({
                eventName: event[0].toLowerCase() + event.slice(1),
                sourcePath: hookPath,
                matcher: group.matcher,
                command: hook.command.replaceAll(
                  '$' + '{CLAUDE_PLUGIN_ROOT}',
                  installedPath
                ),
                timeoutSec: hook.timeout,
              });
            }
        }
      }
      let mcp = null;
      if (manifest.mcpServers) {
        if (typeof manifest.mcpServers === 'object') {
          require('./lib/generate/skill-policy').validatePublicMcp(
            manifest.mcpServers
          );
          mcp = {
            declared: true,
            servers: Object.keys(manifest.mcpServers),
            startup: 'not-tested',
            authentication: 'public-no-auth',
          };
        } else {
          const mcpPath = within(
            installedPath,
            join(installedPath, manifest.mcpServers)
          );
          check(
            readFileSync(mcpPath).equals(
              readFileSync(within(source, join(source, manifest.mcpServers)))
            ),
            'Installed MCP declaration differs'
          );
          const config = json(mcpPath);
          mcp = {
            declared: manifest.mcpServers,
            serverNames: Object.keys(config.mcpServers || config),
            registration: 'not-tested',
            connection: 'not-tested',
            authentication: 'not-tested',
          };
        }
      }
      const catalog = json(
        join(ROOT, 'catalog/plugins', plugin.name + '.json')
      );
      const allowlist = [...catalog.targets.codex.skillAllowlist].sort();
      check(
        catalog.targets.codex.enabled === true &&
          JSON.stringify(
            readdirSync(within(source, join(source, manifest.skills))).sort()
          ) === JSON.stringify(allowlist),
        'Source skill tree differs from catalog allowlist'
      );
      check(
        JSON.stringify(readdirSync(skillsRoot).sort()) ===
          JSON.stringify(allowlist),
        'Installed skill tree differs from catalog allowlist'
      );
      const artifactHash = createHash('sha256').update(
        JSON.stringify(installedManifest)
      );
      const expected = allowlist.map((name) => {
        check(NAME.test(name), 'Unsafe skill name');
        const sourceSkill = within(source, join(source, manifest.skills, name));
        const installedSkill = within(skillsRoot, join(skillsRoot, name));
        const files = skillFiles(sourceSkill);
        check(
          JSON.stringify(files) === JSON.stringify(skillFiles(installedSkill)),
          'Installed skill resources differ'
        );
        for (const file of files) {
          const bytes = readFileSync(join(installedSkill, file));
          check(
            bytes.equals(readFileSync(join(sourceSkill, file))),
            'Installed skill resource bytes differ'
          );
          artifactHash.update(name + '/' + file + '\0').update(bytes);
        }
        return {
          name: plugin.name + ':' + name,
          path: join(installedSkill, 'SKILL.md'),
        };
      });
      report.installed.push({
        pluginId: receipt.pluginId,
        version: receipt.version,
        installedPath,
        expected,
        hookExpectations,
        mcp,
        manifestAndSkillSha256: artifactHash.digest('hex'),
      });
    }
    const listing = JSON.parse(
      await command(
        bin,
        [...GLOBAL_ARGS, 'plugin', 'list', '--json'],
        childOptions
      )
    );
    check(
      Array.isArray(listing.installed) &&
        listing.installed.length === selected.length,
      'Installed plugin inventory mismatch'
    );
    for (const plugin of report.installed) {
      check(
        listing.installed.some(
          (p) =>
            p.pluginId === plugin.pluginId &&
            p.version === plugin.version &&
            p.installed === true &&
            p.enabled === true
        ),
        'Installed plugin not enabled/listed'
      );
    }
    const discovery = await discover(bin, { env, cwd }, options.timeout);
    check(
      discovery.skills.data?.length === 1 && discovery.hooks.data?.length === 1,
      'Unexpected discovery response'
    );
    const skills = discovery.skills.data[0];
    const hooks = discovery.hooks.data[0];
    check(skills.cwd === cwd && hooks.cwd === cwd, 'Discovery cwd mismatch');
    check(
      skills.errors?.length === 0 &&
        hooks.errors?.length === 0 &&
        hooks.warnings?.length === 0,
      'Discovery reported errors or warnings'
    );
    check(
      Array.isArray(skills.skills) && Array.isArray(hooks.hooks),
      'Missing discovery rows'
    );
    for (const skill of skills.skills.filter((s) => !s.pluginId)) {
      check(skill.scope === 'system', 'Unexpected non-plugin skill');
      within(join(env.CODEX_HOME, 'skills/.system'), skill.path);
    }
    report.loadedSkills = skills.skills
      .filter((s) => s.pluginId)
      .map((s) => ({
        name: s.name,
        pluginId: s.pluginId,
        path: s.path,
        enabled: s.enabled,
      }));
    const expected = report.installed.flatMap((p) =>
      p.expected.map((s) => ({ ...s, pluginId: p.pluginId }))
    );
    for (const skill of expected) {
      const matches = report.loadedSkills.filter(
        (s) =>
          s.pluginId === skill.pluginId &&
          s.name === skill.name &&
          s.path === skill.path &&
          s.enabled === true
      );
      if (matches.length !== 1)
        report.failures.push('Missing/duplicate/disabled skill: ' + skill.name);
    }
    for (const skill of report.loadedSkills) {
      if (
        !expected.some(
          (s) =>
            s.pluginId === skill.pluginId &&
            s.name === skill.name &&
            s.path === skill.path
        )
      )
        report.failures.push('Unexpected exposed skill: ' + skill.name);
    }
    const hookExpectations = report.installed.flatMap((p) =>
      p.hookExpectations.map((h) => ({ ...h, pluginId: p.pluginId }))
    );
    check(
      hooks.hooks.length === hookExpectations.length,
      'Discovered hook inventory mismatch'
    );
    for (const expectedHook of hookExpectations) {
      const matches = hooks.hooks.filter(
        (h) =>
          Object.entries(expectedHook).every(
            ([key, value]) => h[key] === value
          ) &&
          h.handlerType === 'command' &&
          h.source === 'plugin' &&
          h.enabled === true &&
          h.trustStatus === 'untrusted' &&
          /^sha256:[a-f0-9]{64}$/.test(h.currentHash)
      );
      check(matches.length === 1, 'Hook discovery/trust mismatch');
    }
    report.hooks = hooks.hooks.map((h) => ({
      pluginId: h.pluginId,
      eventName: h.eventName,
      enabled: h.enabled,
      trustStatus: h.trustStatus,
      sourcePath: h.sourcePath,
      currentHash: h.currentHash,
    }));
    report.status = report.failures.length ? 'failed' : 'passed';
    if (report.failures.length) process.exitCode = 1;
  } catch (error) {
    const absent = error.missingCodex === true;
    report.status = absent && !options.ci ? 'skipped' : 'failed';
    report.failures.push(
      error instanceof SyntaxError ? 'Malformed CLI JSON' : error.message
    );
    process.exitCode = absent ? (options.ci ? 2 : 0) : 1;
  } finally {
    if (scratch) {
      report.scratch = scratch;
      report.scratchRetained = Boolean(options.keepTemp);
      if (!options.keepTemp) rmSync(scratch, { recursive: true, force: true });
    }
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(() => {
  console.error('Unexpected smoke harness failure');
  process.exitCode = 1;
});
