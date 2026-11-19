#!/usr/bin/env node
'use strict';

/**
 * Runs Claude Code's own validator, `claude plugin validate --strict`, on the
 * marketplace and on every plugin (CLAUDE-323, roadmap R7.4).
 *
 * The in-repo validators check our schemas; this checks what Claude Code
 * itself accepts. The two differ in both directions
 * (docs/plugin-validation-guide.md "Claude Code strict validation"), so
 * findings we accept on purpose are listed in
 * scripts/claude-plugin-validate-known.json. Any other error or warning fails.
 * A known entry that matches nothing is reported, so the list does not go
 * stale silently.
 *
 * Usage:
 *   node scripts/validate-claude-plugin-strict.js [--claude <bin>]
 *
 * CI installs a pinned CLI (validate-schemas.yml, claude-plugin-validate);
 * locally it uses `claude` from PATH, so a newer CLI may report more.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const KNOWN_FILE = path.join(__dirname, 'claude-plugin-validate-known.json');

/** Every error and warning in one `--json` report, with repo-relative files. */
function collectFindings(report, root = ROOT) {
  const out = [];
  const sections = [report.manifest, ...(report.contents || [])];
  for (const sec of sections) {
    if (!sec) continue;
    const file = path
      .relative(root, sec.file || '')
      .split(path.sep)
      .join('/');
    for (const level of ['errors', 'warnings']) {
      for (const f of sec[level] || []) {
        out.push({
          level: level === 'errors' ? 'error' : 'warning',
          file,
          path: f.path || '',
          message: f.message || '',
        });
      }
    }
  }
  return out;
}

function matches(entry, finding) {
  if (entry.level && entry.level !== finding.level) return false;
  if (!finding.message.includes(entry.messageIncludes)) return false;
  return new RegExp(entry.file).test(finding.file);
}

/**
 * Splits findings into known and unknown, and lists known entries that
 * matched nothing.
 */
function classify(findings, known) {
  const used = new Set();
  const unknown = [];
  let knownCount = 0;
  for (const f of findings) {
    const hit = known.find((k) => matches(k, f));
    if (hit) {
      used.add(hit.id);
      knownCount += 1;
    } else {
      unknown.push(f);
    }
  }
  const stale = known.filter((k) => !used.has(k.id)).map((k) => k.id);
  return { unknown, knownCount, stale };
}

function targets(root = ROOT) {
  const list = ['.'];
  const dir = path.join(root, 'plugins');
  for (const name of fs.readdirSync(dir).sort()) {
    if (fs.existsSync(path.join(dir, name, '.claude-plugin', 'plugin.json'))) {
      list.push(`plugins/${name}`);
    }
  }
  return list;
}

function runValidator(bin, target) {
  const r = spawnSync(
    bin,
    ['plugin', 'validate', '--strict', '--json', target],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (r.error) throw new Error(`could not run ${bin}: ${r.error.message}`);
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    throw new Error(
      `${target}: validator printed no JSON report (exit ${r.status})\n${r.stderr || r.stdout}`
    );
  }
  return { status: r.status, report };
}

function main(argv) {
  let bin = 'claude';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--claude' && argv[i + 1]) {
      bin = argv[i + 1];
      i += 1;
    } else {
      console.error(
        `validate-claude-plugin-strict: unknown argument ${argv[i]}`
      );
      return 2;
    }
  }
  const known = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')).known;
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  console.log(`Using ${bin} ${(version.stdout || '').trim()}`);

  const all = [];
  let failed = false;
  for (const t of targets()) {
    const { status, report } = runValidator(bin, t);
    const findings = collectFindings(report);
    all.push(...findings);
    // --strict exits 1 on warnings we accept, so only a failure with nothing
    // to explain it is an error on its own.
    if (status !== 0 && findings.length === 0) {
      console.error(
        `::error::${t}: validator exited ${status} with no error or warning listed`
      );
      failed = true;
    }
  }

  const { unknown, knownCount, stale } = classify(all, known);
  for (const f of unknown) {
    console.error(
      `::error file=${f.file}::${f.level} (${f.path || 'root'}): ${f.message}`
    );
  }
  for (const id of stale) {
    console.log(
      `::warning::known difference "${id}" no longer occurs; remove it from ${path.relative(ROOT, KNOWN_FILE)}`
    );
  }
  console.log(
    `${all.length} finding(s): ${knownCount} known, ${unknown.length} new`
  );
  return failed || unknown.length > 0 ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { collectFindings, classify, targets };
