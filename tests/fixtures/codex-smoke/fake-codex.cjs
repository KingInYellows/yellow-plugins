#!/usr/bin/env node
// A process-level protocol fixture. Real CLI receipts are a separate gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const scenario = '__SCENARIO__';
const source = __SOURCE_ROOT__;
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
assert.equal(process.env.SMOKE_SECRET, undefined);
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(process.env.HTTPS_PROXY, undefined);
assert.equal(process.env.XDG_RUNTIME_DIR, undefined);
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.notEqual(process.env.HOME, process.env.CODEX_HOME);
assert.ok(process.env.HOME.startsWith(path.dirname(home) + '/'));
assert.ok(process.cwd().startsWith(path.dirname(home) + '/'));
assert.ok(
  fs
    .readFileSync(path.join(home, 'config.toml'), 'utf8')
    .includes('remote_plugin = false')
);
function emit(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}
if (args.includes('--version')) {
  console.log('codex-cli ' + (scenario === 'version' ? '0.156.0' : '0.157.0'));
  process.exit(0);
}
assert.deepEqual(args.slice(0, 2), ['--disable', 'remote_plugin']);
const pluginVersion = JSON.parse(
  fs.readFileSync(
    path.join(source, 'plugins/yellow-core/.codex-plugin/plugin.json'),
    'utf8'
  )
).version;
const installedPath = path.join(
  home,
  'plugins/cache/yellow-plugins/yellow-core',
  pluginVersion
);
if (args.includes('marketplace')) {
  emit({});
  process.exit(0);
}
if (args.includes('add')) {
  if (scenario === 'install-error') process.exit(3);
  if (scenario === 'malformed-install') {
    console.log('{');
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(installedPath), { recursive: true });
  fs.cpSync(path.join(source, 'plugins/yellow-core'), installedPath, {
    recursive: true,
  });
  if (scenario === 'symlink') {
    const skill = path.join(installedPath, 'codex/skills/plan-status/SKILL.md');
    fs.unlinkSync(skill);
    fs.symlinkSync(
      path.join(
        source,
        'plugins/yellow-core/codex/skills/plan-status/SKILL.md'
      ),
      skill
    );
  }
  if (scenario === 'bytes')
    fs.appendFileSync(
      path.join(installedPath, 'codex/skills/plan-status/SKILL.md'),
      '\nchanged\n'
    );
  if (scenario === 'resource') {
    fs.writeFileSync(
      path.join(installedPath, 'codex/skills/plan-status/extra.md'),
      'fixture'
    );
  }
  emit({
    pluginId: 'yellow-core@yellow-plugins',
    version: pluginVersion,
    installedPath:
      scenario === 'escape'
        ? path.join(source, 'plugins/yellow-core')
        : installedPath,
  });
  process.exit(0);
}
if (args.includes('list')) {
  if (scenario === 'server-missing') fs.unlinkSync(__filename);
  emit({
    installed: [
      {
        pluginId: 'yellow-core@yellow-plugins',
        version: pluginVersion,
        installed: true,
        enabled: scenario !== 'disabled-plugin',
      },
    ],
  });
  process.exit(0);
}
assert.ok(args.includes('app-server'));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialized') return;
  assert.ok(
    ['initialize', 'skills/list', 'hooks/list'].includes(request.method),
    'No thread, turn, MCP launch, approval, or hook trust method is permitted'
  );
  if (scenario === 'timeout' && request.method === 'initialize') return;
  if (scenario === 'server-exit') process.exit(5);
  if (scenario === 'malformed-rpc') {
    console.log('not-json');
    return;
  }
  if (scenario === 'rpc-error') {
    emit({ id: request.id, error: { code: -32603 } });
    return;
  }
  let result;
  if (request.method === 'initialize') result = { codexHome: home };
  if (request.method === 'skills/list') {
    let skills = JSON.parse(fs.readFileSync(path.join(source, 'catalog/plugins/yellow-core.json'), 'utf8'))
      .targets.codex.skillAllowlist.map((name) => ({
      name: 'yellow-core:' + name,
      pluginId: 'yellow-core@yellow-plugins',
      enabled: true,
      path: path.join(installedPath, 'codex/skills', name, 'SKILL.md'),
    }));
    if (scenario === 'missing-skill') skills.pop();
    if (scenario === 'duplicate-skill') skills.push(skills[0]);
    if (scenario === 'disabled-skill') skills[0].enabled = false;
    if (scenario === 'extra-skill')
      skills.push({
        ...skills[0],
        name: 'yellow-core:source-command-plan-status',
      });
    if (scenario === 'foreign-user-skill')
      skills.push({
        name: 'foreign',
        pluginId: null,
        scope: 'user',
        enabled: true,
        path: path.join(source, 'foreign/SKILL.md'),
      });
    result = { data: [{ cwd: process.cwd(), skills, errors: [] }] };
  }
  if (request.method === 'hooks/list')
    result = {
      data: [
        {
          cwd: process.cwd(),
          hooks:
            scenario === 'extra-hook'
              ? [{ pluginId: 'yellow-core@yellow-plugins' }]
              : [],
          errors: [],
          warnings: scenario === 'warning' ? ['fixture warning'] : [],
        },
      ],
    };
  emit({ id: request.id, result });
});
