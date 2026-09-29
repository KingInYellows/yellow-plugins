#!/usr/bin/env node

/**
 * check-shell-parse.js
 *
 * Differential syntax check for fenced shell blocks in plugin markdown.
 * Every block tagged bash/sh/shell is parsed with `bash -n` and `zsh -n`;
 * a block FAILS only when bash accepts it and zsh rejects it. Template
 * blocks with `<PLACEHOLDER>` tokens and pseudo-code fail both shells, so
 * they are skipped without an allowlist or a markdown edit.
 *
 * The body of each Tier 2 wrapper (`bash /dev/fd/3 3<<'TAG'`) is data to
 * zsh, so it is also parsed on its own with `bash -n` and fails when bash
 * rejects it.
 *
 * `zsh -n` is a syntax backstop, not a compatibility proof: it passes most
 * silent bash/zsh differences (word splitting, noclobber, 1-based arrays).
 * scripts/validate-shell-compat.js covers those.
 *
 * Scope matches validate-shell-compat.js (plugin sources only; generated
 * codex/cursor skill copies, tests/ and CHANGELOG.md are excluded).
 *
 * zsh missing: prints SKIP and exits 0 locally — a SKIP verifies nothing.
 * It exits 1 instead when SHELL_COMPAT_REQUIRE_ZSH=1 or CI is set (to
 * anything but '', 'false' or '0'), so a CI job cannot silently check
 * nothing. Finding zero blocks also exits 1.
 *
 * Usage: node scripts/check-shell-parse.js
 * VALIDATE_SHELL_COMPAT_ROOT overrides the repo root.
 * SHELL_PARSE_ZSH / SHELL_PARSE_BASH override the shell binaries and
 * SHELL_PARSE_TIMEOUT_MS the per-driver timeout (tests).
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Same scope and fence reading as the lint, so both layers see the same blocks.
const { extractRawFencedBlocks } = require('./lib/markdown-fences');
const {
  findFdWrappers,
  listMarkdownFiles,
  SHELL_LANGS,
} = require('./validate-shell-compat');

const TAG = '[check-shell-parse]';
// Per shell driver: ~800 `-n` parses take seconds; a stuck parser must not
// hold a required CI job until its job-level timeout.
const PARSE_TIMEOUT_MS = 120000;

function isTruthy(value) {
  return value !== undefined && !['', 'false', '0'].includes(value);
}

function zshRequired(env) {
  return env.SHELL_COMPAT_REQUIRE_ZSH === '1' || isTruthy(env.CI);
}

function shellAvailable(bin) {
  const result = spawnSync(bin, ['-c', 'exit 0'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

// Parse every block file with one driver process: for each file it runs
// `<bin> <flags> -n <file>` and prints "<index> 0|1", plus "<index> err <text>"
// with the first error line. One driver per shell keeps the check at a few
// seconds for ~900 blocks. zsh runs with -f so the contributor's ~/.zshrc
// cannot change the result; bash with --norc --noprofile likewise.
const DRIVER = [
  'bin=$1; flags=$2; shift 2',
  'i=0',
  'for f in "$@"; do',
  '  if err=$("$bin" $flags -n "$f" 2>&1); then',
  '    printf "%s 0\\n" "$i"',
  '  else',
  '    printf "%s 1\\n" "$i"',
  '    printf \'%s err %s\\n\' "$i" "${err%%$\'\\n\'*}"',
  '  fi',
  '  i=$((i+1))',
  'done',
].join('\n');

function parseAll(bin, flags, files, timeout) {
  const result = spawnSync(
    'bash',
    ['--norc', '--noprofile', '-c', DRIVER, 'driver', bin, flags, ...files],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout,
      killSignal: 'SIGKILL',
    }
  );
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(
      `${bin} parse driver ${result.signal ? `killed by ${result.signal}` : `exited ${result.status}`}`
    );
  }
  const status = new Map();
  const errors = new Map();
  for (const line of result.stdout.split('\n')) {
    const m = /^(\d+) (?:(0|1)|err (.*))$/.exec(line);
    if (!m) continue;
    const index = Number(m[1]);
    if (m[2] !== undefined) status.set(index, m[2] === '0');
    else errors.set(index, m[3]);
  }
  // Every block must get a verdict; a hole would read as "not a failure".
  if (status.size !== files.length) {
    throw new Error(
      `${bin} parse driver reported ${status.size} of ${files.length} blocks`
    );
  }
  return { status, errors };
}

// The body of every fd-3 wrapper in a block, with the markdown line it
// starts on. An unclosed wrapper is reported instead of parsed.
function wrapperBodies(rel, block, failures) {
  const lines = block.body.split('\n');
  const bodies = [];
  for (const { open, close, tag } of findFdWrappers(lines)) {
    if (close === -1) {
      failures.push({
        file: rel,
        line: block.startLine + 1 + open,
        error: `wrapper tag ${tag} is never closed`,
      });
      continue;
    }
    let body = lines.slice(open + 1, close);
    if (/<<-/.test(lines[open])) body = body.map((l) => l.replace(/^\t+/, ''));
    bodies.push({
      rel,
      line: block.startLine + 2 + open,
      body: body.join('\n'),
    });
  }
  return bodies;
}

function run(
  root,
  { zsh = 'zsh', bash = 'bash', timeout = PARSE_TIMEOUT_MS } = {}
) {
  const blocks = [];
  const failures = [];
  const wrapped = [];
  for (const rel of listMarkdownFiles(root)) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const block of extractRawFencedBlocks(content)) {
      if (!SHELL_LANGS.has(block.lang)) continue;
      blocks.push({ rel, block });
      wrapped.push(...wrapperBodies(rel, block, failures));
    }
  }
  if (blocks.length === 0) {
    throw new Error(`no shell blocks found under ${root}/plugins`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-parse-'));
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `${text}\n`);
    return file;
  };
  try {
    const files = blocks.map(({ block }, i) =>
      write(`block-${i}.sh`, block.body)
    );
    const wrappedFiles = wrapped.map((w, i) =>
      write(`wrapped-${i}.sh`, w.body)
    );
    const bashResult = parseAll(bash, '--norc --noprofile', files, timeout);
    const zshResult = parseAll(zsh, '-f', files, timeout);
    let bothFail = 0;
    blocks.forEach(({ rel, block }, i) => {
      const bashOk = bashResult.status.get(i);
      const zshOk = zshResult.status.get(i);
      if (bashOk && zshOk === false) {
        failures.push({
          file: rel,
          line: block.startLine,
          error: (
            zshResult.errors.get(i) || 'zsh -n failed with no message'
          ).replace(/^.*?block-\d+\.sh:/, 'line '),
        });
      } else if (bashOk === false && zshOk === false) {
        bothFail++;
      }
    });
    if (wrappedFiles.length > 0) {
      const wrappedResult = parseAll(
        bash,
        '--norc --noprofile',
        wrappedFiles,
        timeout
      );
      wrapped.forEach((w, i) => {
        if (wrappedResult.status.get(i)) return;
        failures.push({
          file: w.rel,
          line: w.line,
          error: `bash wrapper body: ${(wrappedResult.errors.get(i) || '').replace(/^.*?wrapped-\d+\.sh: /, '')}`,
        });
      });
    }
    return {
      blocks: blocks.length,
      wrapped: wrapped.length,
      bothFail,
      failures,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main(env = process.env) {
  const root = env.VALIDATE_SHELL_COMPAT_ROOT
    ? path.resolve(env.VALIDATE_SHELL_COMPAT_ROOT)
    : path.join(__dirname, '..');
  const zsh = env.SHELL_PARSE_ZSH || 'zsh';
  const bash = env.SHELL_PARSE_BASH || 'bash';

  if (!shellAvailable(zsh)) {
    if (zshRequired(env)) {
      console.error(
        `${TAG} ERROR: zsh not found (${zsh}); install it (apt-get install zsh) — CI or SHELL_COMPAT_REQUIRE_ZSH=1 requires it.`
      );
      return 1;
    }
    console.warn(
      `${TAG} SKIP: zsh not found (${zsh}); nothing was verified. The check runs in CI.`
    );
    return 0;
  }

  let result;
  try {
    const timeout = Number(env.SHELL_PARSE_TIMEOUT_MS) || PARSE_TIMEOUT_MS;
    result = run(root, { zsh, bash, timeout });
  } catch (err) {
    console.error(`${TAG} ERROR: ${err.message}`);
    return 1;
  }
  const summary = `${result.blocks} shell block(s) and ${result.wrapped} wrapper body(ies) parsed; ${result.bothFail} fail both shells (templates/pseudo-code, ignored)`;
  if (result.failures.length === 0) {
    console.log(`${TAG} OK: ${summary}.`);
    return 0;
  }
  console.error(
    `${TAG} FAILED: ${result.failures.length} block(s) parse in bash but not in zsh, or are wrapper bodies bash rejects; ${summary}.`
  );
  for (const f of result.failures) {
    console.error(`  ${f.file}:${f.line} — ${f.error}`);
  }
  console.error(
    `${TAG} Rewrite the construct so both shells accept it, or run the block in bash: bash /dev/fd/3 3<<'TAG' … TAG.`
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { run, main, zshRequired };
