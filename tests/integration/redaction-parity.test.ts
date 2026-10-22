/**
 * Parity gate for the two shell secret redactors:
 *
 * - yellow-ci `hooks/scripts/lib/redact.sh` `redact_secrets` (CI logs), plus
 *   the copies of its sed pipeline inlined in the ci-diagnose and
 *   ci-runner-health references, which Codex loads without the hooks lib;
 * - yellow-core `lib/compound-staging.sh` `cs_redact_secrets` (session text
 *   staged to disk).
 *
 * The engines stay separate on purpose: yellow-ci's is a GNU-sed BRE pipeline
 * with provenance sentinels and quoted-value rules, yellow-core's is a
 * portable ERE pipeline with an awk stage. What must match is the set of
 * credential shapes each one catches. A labelled rule (`[REDACTED:<label>]`)
 * added to one side fails here until the other side gains it or the label is
 * listed below with its reason. Unlabelled rules are covered by the corpus.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const CI_LIB = 'plugins/yellow-ci/hooks/scripts/lib/redact.sh';
const CORE_LIB = 'plugins/yellow-core/lib/compound-staging.sh';
const CI_INLINE_COPIES = [
  'plugins/yellow-ci/skills/ci-diagnose/references/fetch-logs.md',
  'plugins/yellow-ci/skills/ci-diagnose/references/resolve-run.md',
  'plugins/yellow-ci/skills/ci-runner-health/references/investigation.md',
  'plugins/yellow-ci/skills/ci-runner-health/references/ssh-probes.md',
];

// Labels only one redactor emits, with the reason. Keep this short.
const CI_ONLY_LABELS: Record<string, string> = {
  // yellow-core redacts quoted JSON-style values with a plain [REDACTED].
  quoted:
    'shell-quoted values with whitespace; yellow-core has its own quoted-key rules',
};
const CORE_ONLY_LABELS: Record<string, string> = {};

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** Body of a top-level shell function, from `name() {` to the closing `}`. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`\n${name}() {\n`);
  expect(start, `${name}() not found`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end);
}

function labels(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/REDACTED:([a-z0-9-]+)\]/g)].map((m) => m[1])
  );
}

/** Runs of consecutive `-e` sed script lines, trimmed. */
function sedBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*-e /.test(line)) {
      cur.push(line.trim());
    } else if (cur.length) {
      blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks.filter((b) => b.some((l) => l.includes('REDACTED')));
}

function redact(lib: string, fn: string, input: string): string {
  const res = spawnSync(
    'bash',
    ['-c', `. "$1"; ${fn}`, 'bash', join(ROOT, lib)],
    {
      input,
      encoding: 'utf8',
    }
  );
  expect(res.status, res.stderr).toBe(0);
  return res.stdout;
}

// One line per credential shape; `secret` must not survive either redactor.
const CORPUS: Array<{ name: string; line: string; secret: string }> = [
  ['github classic', 'ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github server', 'ghs_', 'abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github oauth', 'gho_', 'abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github refresh', 'ghr_', 'abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github user', 'ghu_', 'abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github fine-grained', 'github_pat_', '11ABCDEFG0123456789_abcdefghij'],
  ['aws AKIA', 'AKIA', 'ABCDEFGHIJKLMNOP'],
  ['aws ASIA', 'ASIA', 'ABCDEFGHIJKLMNOP'],
  ['anthropic', 'sk-ant-api03-', 'abcdefghijklmnopqrstuvwx'],
  ['openai project', 'sk-proj-', 'abcdefghijklmnopqrstuvwx'],
  ['openai legacy', 'sk-', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL'],
  ['slack', 'xoxb-', '1234567890-abcdefgh'],
  ['stripe secret', 'sk_live_', 'abcdefghijklmnopqrstuvwx'],
  ['stripe restricted', 'rk_live_', 'abcdefghijklmnopqrstuvwx'],
  ['huggingface', 'hf_', 'abcdefghijklmnopqrstuvwx'],
  ['tavily', 'tvly-dev-', 'abcdefghijklmnopqrstuvwx'],
  ['perplexity', 'pplx-', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'],
  ['semgrep', 'sgp_', 'abcdefghijklmnopqrstuvwx'],
  ['docker', 'dckr_pat_', 'abcdefghijklmnopqrstuvwxyz012345'],
  ['npm', 'npm_', 'abcdefghijklmnopqrstuvwxyz0123456789'],
  ['pypi', 'pypi-', 'AgEIcHlwaS5vcmcCJGFiY2RlZmdoaWprbG1ub3A'],
].map(([name, prefix, body]) => ({
  name,
  line: `value ${prefix}${body} end`,
  secret: body,
}));
CORPUS.push(
  {
    name: 'aws secret',
    line: 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    secret: 'wJalrXUtnFEMI',
  },
  {
    name: 'jwt',
    line: 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4f',
    secret: 'SflKxwRJ',
  },
  {
    name: 'bearer',
    line: 'Bearer abcdefghijklmnopqrstuvwxyz.1234',
    secret: 'abcdefghijklmnop',
  },
  {
    name: 'authorization basic',
    line: 'Authorization: Basic dXNlcjpwYXNz',
    secret: 'dXNlcjpwYXNz',
  },
  {
    name: 'bare basic',
    line: 'sent Basic dXNlcjpwYXNz1234 ok',
    secret: 'dXNlcjpwYXNz',
  },
  {
    name: 'url userinfo',
    line: 'https://bob:s3cretpass@github.com/x/y',
    secret: 's3cretpass',
  },
  {
    name: 'url param',
    line: 'GET /api?token=abc123def456 HTTP/1.1',
    secret: 'abc123def456',
  },
  {
    name: 'password assignment',
    line: 'password=hunter2hunter2',
    secret: 'hunter2hunter2',
  },
  {
    name: 'pem block',
    line: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
    secret: 'MIIEowIBAAKCAQEA',
  }
);

// Prose and identifiers both redactors must leave alone.
const KEEP = [
  'Basic Authentication is enabled and basic setup works',
  'commit 3f786850e387550fdab836ed7e6dc881de23001b',
  'id 550e8400-e29b-41d4-a716-446655440000',
];

describe('secret redaction parity (yellow-ci <-> yellow-core)', () => {
  const ciBody = functionBody(read(CI_LIB), 'redact_secrets');
  const coreBody = functionBody(read(CORE_LIB), 'cs_redact_secrets');

  it('both redactors emit the same labels, apart from the listed exceptions', () => {
    const ci = labels(ciBody);
    const core = labels(coreBody);
    const ciOnly = [...ci].filter((l) => !core.has(l)).sort();
    const coreOnly = [...core].filter((l) => !ci.has(l)).sort();
    expect(ciOnly).toEqual(Object.keys(CI_ONLY_LABELS).sort());
    expect(coreOnly).toEqual(Object.keys(CORE_ONLY_LABELS).sort());
  });

  it('every inline yellow-ci pipeline copy matches redact.sh', () => {
    const [canonical] = sedBlocks(ciBody);
    for (const file of CI_INLINE_COPIES) {
      const blocks = sedBlocks(read(file));
      expect(
        blocks.length,
        `${file} has no redaction pipeline`
      ).toBeGreaterThan(0);
      // A copy may append the fence-escape rules after the redaction rules.
      for (const block of blocks) {
        expect(block.slice(0, canonical.length), file).toEqual(canonical);
        for (const extra of block.slice(canonical.length)) {
          expect(extra, file).toMatch(/\[ESCAPED\]/);
        }
      }
    }
  });

  it.each(CORPUS)('both redact: $name', ({ line, secret }) => {
    expect(redact(CI_LIB, 'redact_secrets', `${line}\n`)).not.toContain(secret);
    expect(redact(CORE_LIB, 'cs_redact_secrets', `${line}\n`)).not.toContain(
      secret
    );
  });

  it.each(KEEP)('both keep: %s', (line) => {
    expect(redact(CI_LIB, 'redact_secrets', `${line}\n`)).toBe(`${line}\n`);
    expect(redact(CORE_LIB, 'cs_redact_secrets', `${line}\n`)).toBe(
      `${line}\n`
    );
  });
});
