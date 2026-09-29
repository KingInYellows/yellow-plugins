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
 * `zsh -n` is a syntax backstop, not a compatibility proof: it passes most
 * silent bash/zsh differences (word splitting, noclobber, 1-based arrays).
 * scripts/validate-shell-compat.js covers those.
 *
 * Scope matches validate-shell-compat.js (plugin sources only; generated
 * codex/cursor skill copies, tests/ and CHANGELOG.md are excluded).
 *
 * zsh missing: prints a skip warning and exits 0 locally, but exits 1 when
 * CI=true so the CI job cannot silently check nothing.
 *
 * Usage: node scripts/check-shell-parse.js [--report]
 *   --report  print findings but always exit 0 (rollout mode)
 * VALIDATE_SHELL_COMPAT_ROOT overrides the repo root.
 * SHELL_PARSE_ZSH / SHELL_PARSE_BASH override the shell binaries (tests).
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Same scope and fence reading as the lint, so both layers see the same blocks.
const { extractRawFencedBlocks } = require('./lib/markdown-fences');
const { listMarkdownFiles, SHELL_LANGS } = require('./validate-shell-compat');

const TAG = '[check-shell-parse]';
// Per shell driver: ~800 `-n` parses take seconds; a stuck parser must not
// hold a required CI job until its job-level timeout.
const PARSE_TIMEOUT_MS = 120000;

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

function parseAll(bin, flags, files) {
  const result = spawnSync(
    'bash',
    ['--norc', '--noprofile', '-c', DRIVER, 'driver', bin, flags, ...files],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: PARSE_TIMEOUT_MS,
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

function run(root, { zsh = 'zsh', bash = 'bash' } = {}) {
  const blocks = [];
  for (const rel of listMarkdownFiles(root)) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const block of extractRawFencedBlocks(content)) {
      if (SHELL_LANGS.has(block.lang)) blocks.push({ rel, block });
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-parse-'));
  try {
    const files = blocks.map(({ block }, i) => {
      const file = path.join(dir, `block-${i}.sh`);
      fs.writeFileSync(file, `${block.body}\n`);
      return file;
    });
    const bashResult = parseAll(bash, '--norc --noprofile', files);
    const zshResult = parseAll(zsh, '-f', files);
    const failures = [];
    let bothFail = 0;
    blocks.forEach(({ rel, block }, i) => {
      const bashOk = bashResult.status.get(i);
      const zshOk = zshResult.status.get(i);
      if (bashOk && zshOk === false) {
        failures.push({
          file: rel,
          line: block.startLine,
          error: (zshResult.errors.get(i) || '').replace(
            /^.*?block-\d+\.sh:/,
            'line '
          ),
        });
      } else if (bashOk === false && zshOk === false) {
        bothFail++;
      }
    });
    return { blocks: blocks.length, bothFail, failures };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const report = argv.includes('--report');
  const root = process.env.VALIDATE_SHELL_COMPAT_ROOT
    ? path.resolve(process.env.VALIDATE_SHELL_COMPAT_ROOT)
    : path.join(__dirname, '..');
  const zsh = process.env.SHELL_PARSE_ZSH || 'zsh';
  const bash = process.env.SHELL_PARSE_BASH || 'bash';

  if (!shellAvailable(zsh)) {
    if (process.env.CI === 'true') {
      console.error(
        `${TAG} ERROR: zsh not found (${zsh}); install it in this CI job (apt-get install zsh).`
      );
      return 1;
    }
    console.warn(
      `${TAG} SKIP: zsh not found (${zsh}); the zsh parse check runs in CI.`
    );
    return 0;
  }

  const result = run(root, { zsh, bash });
  const summary = `${result.blocks} shell block(s) parsed; ${result.bothFail} fail both shells (templates/pseudo-code, ignored)`;
  if (result.failures.length === 0) {
    console.log(`${TAG} OK: ${summary}.`);
    return 0;
  }
  const out = report ? console.log : console.error;
  out(
    `${TAG} ${report ? 'REPORT' : 'FAILED'}: ${result.failures.length} block(s) parse in bash but not in zsh; ${summary}.`
  );
  for (const f of result.failures) out(`  ${f.file}:${f.line} — ${f.error}`);
  out(
    `${TAG} Rewrite the construct so both shells accept it, or run the block in bash: bash /dev/fd/3 3<<'TAG' … TAG.`
  );
  return report ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { run };
