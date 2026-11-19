#!/usr/bin/env node
// hook-cost-bench.js — measures wall-clock latency and injected context for
// every command hook in catalog/plugins/*.json (CLAUDE-313). Results and
// method: docs/audits/2026-11-19-hook-cost-audit.md.
//
// Each hook runs N+2 times, serially, with a representative stdin envelope;
// the first two runs are warm-up (the first is reported as first_ms).
// Prints a JSON array of rows to stdout, one line per hook to stderr.
//
// Environment:
//   REPO        marketplace checkout (catalog/ + plugins/). Several hooks
//               refuse a CLAUDE_PLUGIN_ROOT outside HOME, so copy the repo
//               under BENCH_HOME/.claude/plugins/marketplaces/ first.
//   PROJ        scratch git checkout used as the session cwd. Hooks write
//               state into it (.ruvector/), so never point it at a real repo.
//   BENCH_HOME  throwaway HOME. Keep `claude` off PATH, or the yellow-core
//               SessionStart hook can start a real (paid) drain.
//   BENCH_STUB_CLAUDE=1
//               opt-in for the yellow-core "drain dispatched" row: puts a
//               no-op `claude` stub (written under BENCH_HOME) on the hooks'
//               PATH, so a due drain dispatches to the stub and spends
//               nothing. A real `claude` on PATH is still refused.
//   N           measured runs per hook (default 20); ONLY  regex filter.
//
// Scenario tuples are [name, input, seed?, opts?]. opts.plugins limits the
// scenario to those plugins, opts.prep(env) runs untimed before every run,
// and opts.measure(i) returns false for runs that take another code path.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = process.env.REPO; // plugin source tree
const PROJ = process.env.PROJ; // scratch project checkout used as cwd
const HOME = process.env.BENCH_HOME;
const N = Number(process.env.N || 20);
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

if (!REPO || !PROJ || !HOME) {
  process.stderr.write('hook-cost-bench: set REPO, PROJ and BENCH_HOME\n');
  process.exit(2);
}

// 60-record synthetic transcript for the Stop hook's capture.
const transcript = path.join(HOME, 'transcript.jsonl');
if (!fs.existsSync(transcript)) {
  const lines = [];
  for (let i = 0; i < 60; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    lines.push(
      JSON.stringify({
        type: role,
        message: { role, content: `message ${i} ` + 'lorem ipsum '.repeat(40) },
      })
    );
  }
  fs.writeFileSync(transcript, lines.join('\n') + '\n');
}
// The yellow-core SessionStart hook starts a paid `claude -p` drain when
// staged entries are due and `claude` resolves on PATH. Refuse to run then.
const onPath = (process.env.PATH || '')
  .split(path.delimiter)
  .some((d) => d && fs.existsSync(path.join(d, 'claude')));
if (onPath) {
  process.stderr.write(
    'hook-cost-bench: `claude` is on PATH; remove it so no drain can start\n'
  );
  process.exit(2);
}
const env0 = { ...process.env, HOME, CLAUDE_PROJECT_DIR: PROJ };
// yellow-core honours test-only drain overrides when BATS_VERSION is set; the
// bench must measure the production path, so it is always removed.
delete env0.BATS_VERSION;
if (process.env.BENCH_STUB_CLAUDE === '1') {
  const stubDir = path.join(HOME, 'bench-stub-bin');
  fs.mkdirSync(stubDir, { recursive: true });
  const stub = path.join(stubDir, 'claude');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  env0.PATH = `${stubDir}${path.delimiter}${env0.PATH || ''}`;
}

const big = 'x'.repeat(60000);
const base = {
  session_id: 'bench-0001',
  transcript_path: transcript,
  cwd: PROJ,
};
const S = (o) => JSON.stringify({ ...base, ...o });
const bashPre = (cmd) =>
  S({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: cmd },
  });
const bashPost = (cmd, out) =>
  S({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: cmd },
    tool_response: { stdout: out, stderr: '', interrupted: false },
  });
// Co-edit pairs need the same files edited together in 3+ sessions.
// Pairs come from consecutive edits in one session, so README.md sits between
// each partner. RUN_ID keeps session ids fresh across repeated invocations.
const coeditCycle = [
  'README.md',
  'CLAUDE.md',
  'README.md',
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
];

const edit = (ev, file = 'README.md', sid = base.session_id) =>
  S({
    session_id: sid,
    hook_event_name: ev,
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(PROJ, file),
      old_string: 'a',
      new_string: 'b',
    },
    tool_response: { success: true },
  });
const RUN_ID = `${process.pid}-${Date.now()}`;
const pairEdit = (i) =>
  edit(
    'PostToolUse',
    coeditCycle[i % coeditCycle.length],
    `bench-pair-${RUN_ID}-${Math.floor(i / coeditCycle.length)}`
  );
// Three full cycles (three sessions) qualify all three README partners.
const pairSeed = Array.from({ length: coeditCycle.length * 3 }, (_, i) =>
  pairEdit(i + coeditCycle.length * 1000)
);
const ss = S({ hook_event_name: 'SessionStart', source: 'startup' });
// yellow-ci caches its `gh run list` result per cwd, so back-to-back runs are
// cache hits. Clearing the result cache (new and legacy locations) and any
// refresh marker before every run measures the cache-miss path instead.
// A refresh started by the previous run is waited for (its marker, refresh-<key>
// without an extension, is removed when it ends) so it cannot repopulate the
// cache after this prep and turn the next run into a hit. Untimed.
const sleepMs = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitCiRefresh = (env) => {
  const marker = /^refresh-[0-9a-f]+$/;
  for (let waited = 0; waited < 20000; waited += 50) {
    let names = [];
    try {
      names = fs.readdirSync(env.CLAUDE_PLUGIN_DATA);
    } catch {
      return;
    }
    if (!names.some((n) => marker.test(n))) return;
    sleepMs(50);
  }
};
const clearCiCache = (env) => {
  waitCiRefresh(env);
  const dirs = [
    env.CLAUDE_PLUGIN_DATA,
    path.join(env.HOME, '.cache/yellow-ci'),
  ];
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names)
      if (/^(last-check-|refresh-)/.test(n))
        fs.rmSync(path.join(dir, n), { force: true, recursive: true });
  }
};

const catalog = {};
for (const f of fs.readdirSync(path.join(REPO, 'catalog/plugins'))) {
  const j = JSON.parse(fs.readFileSync(path.join(REPO, 'catalog/plugins', f)));
  catalog[f.replace(/\.json$/, '')] = j;
}
function findHooks(o, out) {
  if (o && typeof o === 'object') {
    if (
      o.hooks &&
      typeof o.hooks === 'object' &&
      !Array.isArray(o.hooks) &&
      !out.length
    ) {
      for (const [ev, arr] of Object.entries(o.hooks)) {
        if (!Array.isArray(arr)) continue;
        for (const m of arr)
          for (const h of m.hooks || [])
            out.push({ ev, matcher: m.matcher || '*', ...h });
      }
      if (out.length) return out;
    }
    for (const v of Object.values(o)) findHooks(v, out);
  }
  return out;
}

const scenarios = {
  PreToolUse: {
    Bash: [
      ['ls', bashPre('ls -la')],
      ['git push', bashPre('git push origin HEAD')],
      ['long cmd', bashPre('echo ' + 'y'.repeat(4000) + ' && git status')],
    ],
    // A new session each run, so the once-per-session suggestion fires.
    Edit: [
      [
        'edit, 3 known partners',
        (i) => edit('PreToolUse', 'README.md', `bench-pre-${RUN_ID}-${i}`),
        pairSeed,
      ],
    ],
  },
  PostToolUse: {
    Bash: [
      ['ls 1KB out', bashPost('ls -la', 'z'.repeat(1000))],
      [
        'git commit',
        bashPost(
          'git commit -m "feat: add thing"',
          '[main abc123] feat: add thing'
        ),
      ],
      ['60KB out', bashPost('cat big.log', big)],
    ],
    // One session, one file: no partner, so no pair is recorded.
    // README.md alternates with a partner, so every run records a pair,
    // except the first edit of each new session id, which is not timed.
    Edit: [
      [
        'edit, same file',
        edit('PostToolUse', 'README.md', `bench-same-${RUN_ID}`),
      ],
      [
        'edit, pairs recorded',
        pairEdit,
        pairSeed,
        { measure: (i) => i % coeditCycle.length !== 0 },
      ],
    ],
  },
  SessionStart: {
    '*': [
      // yellow-ci: the first warm-up run is a miss that starts a refresh;
      // waiting for it (untimed) makes every timed run a cache hit. A no-op
      // for plugins without refresh markers.
      ['startup', ss, [], { prep: waitCiRefresh }],
      [
        'startup, cache miss',
        ss,
        [],
        { plugins: ['yellow-ci'], prep: clearCiCache },
      ],
    ],
  },
  Stop: {
    '*': [['stop', S({ hook_event_name: 'Stop', stop_hook_active: false })]],
  },
  PreCompact: {
    '*': [
      [
        'auto',
        S({
          hook_event_name: 'PreCompact',
          trigger: 'auto',
          custom_instructions: '',
        }),
      ],
    ],
  },
};

function injected(ev, stdout, status, stderr) {
  const r = { ctx: 0, sys: 0, raw: stdout.length };
  // Exit 2 blocks the call; Claude reads its stderr.
  if (status === 2) {
    r.ctx = Buffer.byteLength(stderr || '');
    return r;
  }
  const t = stdout.trim();
  if (!t) return r;
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = null;
  }
  if (!j) {
    // plain stdout: model context for SessionStart / PreCompact
    if (
      ev === 'SessionStart' ||
      ev === 'PreCompact' ||
      ev === 'UserPromptSubmit'
    )
      r.ctx = Buffer.byteLength(t);
    return r;
  }
  const h = j.hookSpecificOutput || {};
  r.ctx =
    Buffer.byteLength(h.additionalContext || '') +
    Buffer.byteLength(
      h.permissionDecisionReason && h.permissionDecision === 'deny'
        ? h.permissionDecisionReason
        : ''
    ) +
    Buffer.byteLength(j.decision === 'block' ? j.reason || '' : '');
  r.sys = Buffer.byteLength(j.systemMessage || '');
  return r;
}

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
const rows = [];
for (const [plugin, j] of Object.entries(catalog)) {
  // PostToolUse first, so the co-edit pairs it records exist for PreToolUse.
  const order = (ev) => (ev === 'PostToolUse' ? 0 : 1);
  const hooks = findHooks(j, []).sort((a, b) => order(a.ev) - order(b.ev));
  // Seeds always go through the recording hook (PostToolUse Edit), so an
  // ONLY filter that skips it still measures a seeded store.
  const recorder = hooks.find(
    (x) =>
      x.type === 'command' &&
      x.ev === 'PostToolUse' &&
      x.matcher.includes('Edit')
  );
  for (const h of hooks) {
    if (h.type !== 'command') continue;
    const key = h.matcher.includes('Bash')
      ? 'Bash'
      : h.matcher.includes('Edit')
        ? 'Edit'
        : '*';
    const scs = (scenarios[h.ev] || {})[key] || [];
    for (const [name, input, seed = [], opts = {}] of scs) {
      const id = `${plugin} ${h.ev} ${name}`;
      if (opts.plugins && !opts.plugins.includes(plugin)) continue;
      if (only && !only.test(id)) continue;
      const root = path.join(REPO, 'plugins', plugin);
      const cmd = h.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root);
      const env = {
        ...env0,
        CLAUDE_PLUGIN_ROOT: root,
        CLAUDE_PLUGIN_DATA: path.join(HOME, '.claude/plugins/data', plugin),
      };
      // Untimed state seeding (co-edit pairs) before the measured runs.
      const seedCmd = recorder
        ? recorder.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root)
        : cmd;
      let seedFailed = 0;
      for (const seedInput of seed) {
        const sr = spawnSync('bash', ['-c', seedCmd], {
          input: seedInput,
          env,
          cwd: PROJ,
          encoding: 'utf8',
          timeout: ((recorder || h).timeout || 60) * 1000,
        });
        if (sr.error || sr.status !== 0) seedFailed++;
      }
      const times = [];
      let last;
      let first;
      let failed = 0;
      // The first two timed-path runs are warm-up; runs that opts.measure
      // rejects still execute (they build state) but are never timed.
      let eligible = 0;
      for (let i = 0; times.length < N; i++) {
        if (opts.prep) opts.prep(env);
        const t0 = process.hrtime.bigint();
        const r = spawnSync('bash', ['-c', cmd], {
          input: typeof input === 'function' ? input(i) : input,
          env,
          cwd: PROJ,
          encoding: 'utf8',
          timeout: (h.timeout || 60) * 1000,
        });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (r.error || (r.status !== 0 && r.status !== 2)) failed++;
        last = r;
        if (opts.measure && !opts.measure(i)) continue;
        if (eligible === 0) first = ms;
        if (eligible >= 2) times.push(ms);
        eligible++;
      }
      const inj = injected(h.ev, last.stdout || '', last.status, last.stderr);
      rows.push({
        plugin,
        script: path
          .basename(
            cmd
              .split(' ')
              .filter((w) => /\.(sh|js)"?$/.test(w))
              .pop() || ''
          )
          .replace(/"/g, ''),
        ev: h.ev,
        matcher: h.matcher,
        scenario: name,
        timeout_s: h.timeout,
        first_ms: +first.toFixed(1),
        p50_ms: +pct(times, 0.5).toFixed(1),
        p95_ms: +pct(times, 0.95).toFixed(1),
        max_ms: +Math.max(...times).toFixed(1),
        ctx_bytes: inj.ctx,
        sys_bytes: inj.sys,
        stdout_bytes: inj.raw,
        exit: last.status,
        failed_runs: failed,
        seed_failed: seedFailed,
        stdout: (last.stdout || '').slice(0, 300),
        stderr: (last.stderr || '').slice(0, 300),
      });
      process.stderr.write(
        `${id}: p50 ${rows.at(-1).p50_ms} p95 ${rows.at(-1).p95_ms} ctx ${inj.ctx} sys ${inj.sys}${failed ? ` FAILED ${failed} run(s)` : ''}${seedFailed ? ` SEED FAILED ${seedFailed}/${seed.length}` : ''}\n`
      );
    }
  }
}
process.stdout.write(JSON.stringify(rows, null, 1));
