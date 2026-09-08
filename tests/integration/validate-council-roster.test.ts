/**
 * Integration test for `scripts/validate-council-roster.js`.
 *
 * Covers the four rules the validator enforces:
 *   D      roster must equal council.md's loop + spawn definition sites
 *   T/C/O  anchored count lint (total / CLI subset / total-minus-one)
 *   R      REDACTION_SOURCES covers every agent shipping the awk program
 *   S      epoch sweep ledger
 *
 * Plus a false-positive regression suite: every string verified NOT to be a
 * reviewer count must keep passing, so a future maintainer cannot quietly
 * loosen a regex.
 *
 * Test parameterization: VALIDATE_COUNCIL_ROSTER_ROOT overrides the project
 * root, so fixtures never touch the real repo.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const VALIDATOR = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'validate-council-roster.js'
);

interface ValidatorRun {
  status: number;
  stdout: string;
  stderr: string;
}

function run(rootDir: string, args: string[] = []): ValidatorRun {
  try {
    const stdout = execFileSync('node', [VALIDATOR, ...args], {
      env: { ...process.env, VALIDATE_COUNCIL_ROSTER_ROOT: rootDir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function writeFile(rootDir: string, relPath: string, body: string): void {
  const full = join(rootDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

interface ReviewerSpec {
  name: string;
  display: string;
  kind: 'in-process' | 'cli';
  awk?: boolean;
}

const BASE_REVIEWERS: ReviewerSpec[] = [
  { name: 'claude', display: 'Claude', kind: 'in-process' },
  { name: 'codex', display: 'Codex', kind: 'cli' },
  { name: 'gemini', display: 'Gemini', kind: 'cli', awk: true },
  { name: 'opencode', display: 'OpenCode', kind: 'cli', awk: true },
];

const COUNCIL_MD = 'plugins/yellow-council/commands/council/council.md';
/**
 * Mirrors SCAN_FILES in the validator. The validator errors on an entry that
 * does not resolve — a renamed doc must not drop out of count coverage
 * silently — so every fixture tree has to provide all of them.
 */
const SCAN_FILES = [
  'plugins/yellow-council/commands/council/council.md',
  'plugins/yellow-council/commands/council/setup.md',
  'plugins/yellow-council/CLAUDE.md',
  'plugins/yellow-council/README.md',
  'plugins/yellow-council/skills/council-patterns/SKILL.md',
  'plugins/yellow-council/skills/council-patterns/references/cross-references.md',
  'plugins/yellow-council/agents/review/claude-reviewer.md',
  'plugins/yellow-council/agents/review/gemini-reviewer.md',
  'plugins/yellow-council/agents/review/opencode-reviewer.md',
  'docs/testing/yellow-council-manual-tests.md',
  'docs/review-surface-routing-protocol.md',
  'docs/security.md',
  'plugins/yellow-codex/CLAUDE.md',
  'plugins/yellow-core/commands/setup/all.md',
];

/** The markers Rule R uses to detect a copy of the canonical redaction awk. */
const CANONICAL_AWK =
  'function strip_deco(s) { }\nfunction cred_hit(re, minlen) { }';
const REDACTION_LIB =
  'plugins/yellow-council/tests/lib/extract-redaction-awk.bash';
const SKILL_MD = 'plugins/yellow-council/skills/council-patterns/SKILL.md';

function agentPath(r: ReviewerSpec): string {
  const owner = r.name === 'codex' ? 'yellow-codex' : 'yellow-council';
  return `plugins/${owner}/agents/review/${r.name}-reviewer.md`;
}

function agentId(r: ReviewerSpec): string {
  const owner = r.name === 'codex' ? 'yellow-codex' : 'yellow-council';
  return `${owner}:review:${r.name}-reviewer`;
}

/** Writes a complete, self-consistent fixture tree. */
function writeFixture(
  root: string,
  opts: {
    reviewers?: ReviewerSpec[];
    loopNames?: string[];
    spawnIds?: string[];
    redactionSources?: string[];
    exceptions?: unknown[];
  } = {}
): void {
  const reviewers = opts.reviewers ?? BASE_REVIEWERS;

  writeFile(
    root,
    'scripts/council-roster.json',
    `${JSON.stringify(
      {
        reviewers: reviewers.map((r) => ({
          name: r.name,
          display: r.display,
          kind: r.kind,
          agent: agentId(r),
          agent_path: agentPath(r),
          ships_redaction_awk: Boolean(r.awk),
        })),
        redaction_extra_sources: [SKILL_MD],
        prose_sites: {},
        exceptions: opts.exceptions ?? [],
      },
      null,
      2
    )}\n`
  );

  const loop = (opts.loopNames ?? reviewers.map((r) => r.name)).join(' ');
  const spawns = (opts.spawnIds ?? reviewers.map((r) => agentId(r)))
    .map((id, i) => `${i + 1}. \`Agent(subagent_type="${id}", prompt=<pack>)\``)
    .join('\n');

  writeFile(
    root,
    COUNCIL_MD,
    `# council\n\nSpawn block:\n\n${spawns}\n\n\`\`\`bash\nfor reviewer in ${loop}; do\n  :\ndone\n\`\`\`\n`
  );

  const sources = opts.redactionSources ?? [
    ...reviewers.filter((r) => r.awk).map((r) => agentPath(r)),
    SKILL_MD,
  ];
  writeFile(
    root,
    REDACTION_LIB,
    `#!/usr/bin/env bash\nREDACTION_SOURCES=(\n${sources
      .map((s) => `  "${s}"`)
      .join('\n')}\n)\n`
  );

  // Reviewer agent files are registered in the ledger unconditionally. An
  // agent declaring ships_redaction_awk must actually carry the markers —
  // Rule R cross-checks the declared flag against file content.
  for (const r of reviewers) {
    writeFile(
      root,
      agentPath(r),
      `# ${r.display} reviewer\n\nA council reviewer.\n${
        r.awk ? `\n${CANONICAL_AWK}\n` : ''
      }`
    );
  }
  writeFile(
    root,
    SKILL_MD,
    `# council-patterns\n\nShared council conventions.\n\n${CANONICAL_AWK}\n`
  );

  // Stub any SCAN_FILES entry not written above.
  for (const rel of SCAN_FILES) {
    if (!existsSync(join(root, rel))) {
      writeFile(root, rel, `# ${rel}\n\nFixture stub.\n`);
    }
  }
}

/** Populate the ledger so exit-0 assertions are not masked by Rule S. */
function stamp(root: string): ValidatorRun {
  return run(root, ['--write-stamps']);
}

describe('validate-council-roster', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'yellow-council-roster-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('rule D — structural cross-check', () => {
    it('passes when roster matches council.md loop and spawn block', () => {
      writeFixture(root);
      stamp(root);

      const { status, stdout } = run(root);

      expect(status).toBe(0);
      expect(stdout).toMatch(/4 reviewers, 3 CLI/);
    });

    it('fails when the loop drops a reviewer', () => {
      writeFixture(root, { loopNames: ['claude', 'codex', 'gemini'] });

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/reviewer loop is "claude codex gemini"/);
    });

    it('fails when the loop reorders reviewers (order is load-bearing)', () => {
      writeFixture(root, {
        loopNames: ['codex', 'claude', 'gemini', 'opencode'],
      });

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/order is load-bearing/);
    });

    it('fails when council.md spawns an agent absent from the roster', () => {
      writeFixture(root, {
        spawnIds: [
          ...BASE_REVIEWERS.map((r) => agentId(r)),
          'yellow-grok:review:grok-reviewer',
        ],
      });

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /yellow-grok:review:grok-reviewer.*not in the roster/
      );
    });

    it('fails when a roster reviewer has no Agent() spawn', () => {
      writeFixture(root, {
        spawnIds: BASE_REVIEWERS.slice(0, 3).map((r) => agentId(r)),
      });

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/no Agent\(\) spawn uses it/);
    });

    it('fails when a spawn is duplicated even though agent membership is unchanged', () => {
      // Set-membership comparison alone would pass here: the duplicate
      // collapses into the same agent id, so every roster reviewer still
      // "has" a spawn and every spawn is still "known". But `/council`
      // would fan out 5 legs for a 4-reviewer roster.
      const ids = BASE_REVIEWERS.map((r) => agentId(r));
      writeFixture(root, { spawnIds: [...ids, ids[0]] });

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/spawn sequence.*does not match roster order/s);
    });

    it('fails when spawns are reordered relative to the roster', () => {
      // Same agent set, different sequence — order is load-bearing because
      // it must equal the roster's declared order, mirroring D1's loop rule.
      const reordered = [
        BASE_REVIEWERS[1],
        BASE_REVIEWERS[0],
        BASE_REVIEWERS[2],
        BASE_REVIEWERS[3],
      ].map((r) => agentId(r));
      writeFixture(root, { spawnIds: reordered });

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/spawn sequence.*does not match roster order/s);
    });

    it('fails when council.md has no reviewer loop at all', () => {
      writeFixture(root);
      writeFile(root, COUNCIL_MD, '# council\n\nNo loop here.\n');

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/expected exactly one .*for reviewer in/);
    });
  });

  describe('rules T/C/O — count lint', () => {
    it('fails on a wrong total claim', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nCouncil has five reviewers.\n'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /docs\/security\.md:3.*TOTAL.*is 5 but roster derives 4/s
      );
    });

    it('fails on a wrong CLI-subset claim', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nThe four CLI reviewers shell out.\n'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/CLI.*is 4 but roster derives 3/s);
    });

    it('fails on a wrong other-than-this-one claim', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nUnlike the other four reviewers.\n'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/OTHER.*is 4 but roster derives 3/s);
    });

    it("fails on setup.md's executable count literals", () => {
      writeFixture(root);
      writeFile(
        root,
        'plugins/yellow-council/commands/council/setup.md',
        `# setup\n\n\`\`\`bash\nprintf '  Reviewers: %d of 5 available\\n' "$READY_COUNT"\nelif [ "$READY_COUNT" -lt 5 ]; then\n\`\`\`\n`
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/T3/);
      expect(stderr).toMatch(/T4/);
    });

    it('fails on a stale N-CLI council phrase', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nThe 4-CLI council fans out.\n'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/C4/);
    });

    it('moves every family expectation when the roster grows — the yellow-grok case', () => {
      const grown: ReviewerSpec[] = [
        ...BASE_REVIEWERS,
        { name: 'grok', display: 'Grok', kind: 'cli' },
      ];

      // Old prose: correct for four, wrong for five.
      writeFixture(root, { reviewers: grown });
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nFour reviewers run.\nThe three CLI reviewers shell out.\n'
      );
      const stale = run(root);
      expect(stale.status).toBe(1);
      expect(stale.stderr).toMatch(/TOTAL.*is 4 but roster derives 5/s);
      expect(stale.stderr).toMatch(/CLI.*is 3 but roster derives 4/s);

      // Updated prose passes against the same grown roster.
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nFive reviewers run.\nThe four CLI reviewers shell out.\n'
      );
      stamp(root);
      expect(run(root).status).toBe(0);
    });
  });

  describe('rule R — redaction coverage', () => {
    it('fails when REDACTION_SOURCES omits an agent shipping the awk program', () => {
      writeFixture(root, {
        redactionSources: [agentPath(BASE_REVIEWERS[2]), SKILL_MD],
      });

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/opencode-reviewer\.md.*never be drift-tested/s);
    });

    it('fails when a REDACTION_SOURCES entry is commented out', () => {
      writeFixture(root);
      // Bash skips a commented-out array element entirely; a naive
      // quoted-string scan must not treat it as still listed.
      const geminiPath = agentPath(BASE_REVIEWERS[2]);
      const opencodePath = agentPath(BASE_REVIEWERS[3]);
      writeFile(
        root,
        REDACTION_LIB,
        `#!/usr/bin/env bash\nREDACTION_SOURCES=(\n  # "${geminiPath}"\n  "${opencodePath}"\n  "${SKILL_MD}"\n)\n`
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/gemini-reviewer\.md.*never be drift-tested/s);
    });
  });

  describe('rule S — epoch sweep ledger', () => {
    it('fails every stamped file when the roster epoch flips', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nCodex and Gemini and OpenCode council.\n'
      );
      stamp(root);
      expect(run(root).status).toBe(0);

      // Add a reviewer; the derived epoch changes and every stamp goes stale.
      const grown = [
        ...BASE_REVIEWERS,
        { name: 'grok', display: 'Grok', kind: 'cli' as const },
      ];
      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      roster.reviewers.push({
        name: 'grok',
        display: 'Grok',
        kind: 'cli',
        agent: agentId(grown[4]),
        agent_path: agentPath(grown[4]),
        ships_redaction_awk: false,
      });
      // agent_path must resolve, or that check fires before Rule S.
      writeFile(root, agentPath(grown[4]), '# Grok reviewer\n');
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /was last swept at roster epoch .* current epoch is/
      );
      expect(stderr).toMatch(/docs\/security\.md/);
    });

    it('fails when a restating file is unregistered', () => {
      writeFixture(root);
      stamp(root);
      writeFile(
        root,
        'docs/new-surface.md',
        '# New\n\nThe council uses Codex and Gemini and OpenCode.\n'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /docs\/new-surface\.md restates the council roster/
      );
    });

    it('fails on a ledger entry that no longer restates the roster', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nCodex and Gemini and OpenCode council.\n'
      );
      stamp(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nNothing about reviewers here.\n'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /no longer.*restates the roster.*remove the entry/s
      );
    });

    it('refuses to write stamps while a count claim still disagrees', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nCouncil has six reviewers.\n'
      );

      const { status, stderr } = run(root, ['--write-stamps']);

      expect(status).toBe(1);
      expect(stderr).toMatch(/refusing to write stamps/);
    });
  });

  describe('exceptions', () => {
    it('suppresses a mismatch on a line matching an exception', () => {
      writeFixture(root, {
        exceptions: [
          {
            file: 'docs/security.md',
            contains: '3-reviewer V1',
            reason: 'historical comparison',
          },
        ],
      });
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nA regression versus the 3-reviewer V1.\n'
      );
      stamp(root);

      expect(run(root).status).toBe(0);
    });

    it('fails when an exception no longer matches any line', () => {
      writeFixture(root, {
        exceptions: [
          { file: 'docs/security.md', contains: 'gone', reason: 'stale' },
        ],
      });
      writeFile(root, 'docs/security.md', '# Security\n\nNothing here.\n');

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/no longer matches any line/);
    });

    it('does not suppress when the exception names a different file', () => {
      writeFixture(root, {
        exceptions: [
          {
            file: 'docs/other.md',
            contains: 'five reviewers',
            reason: 'wrong file',
          },
        ],
      });
      writeFile(root, 'docs/other.md', '# Other\n\nfive reviewers\n');
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nWe have five reviewers.\n'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/docs\/security\.md.*TOTAL/s);
    });
  });

  describe('false-positive regression suite', () => {
    it('leaves every verified non-roster number alone', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        [
          '# Security',
          '',
          'Bare `/council` prints 4-mode help; exit 0.',
          'All four elements are required.',
          'The shape-check exists at FOUR sites.',
          'The reviewer is told four families are authorized.',
          'A 3-line stray counter bounds the window.',
          'Refuse after 3 of these, with pem_stray >= 3.',
          'Requires Bash 4.3+ for associative arrays.',
          'COUNCIL_PATH_MAX_FILES (3) caps --paths.',
          'See Step 3 and Step 4, plus synthesizer rule 4.',
          'Returns a <2-3 sentence summary>.',
          'A finding cited by 2 reviewers is corroborated.',
          'Unique to one reviewer means no corroboration.',
          'Wave 3 reviewers fire after wave 2.',
          'Phase 3 reviewers are conditional.',
          'Build targets are ["claude", "codex"].',
          'PARTIAL: 1 of 3 reviewer CLIs installed.',
          "yellow-review's 14-reviewer Claude pipeline is separate.",
          '',
        ].join('\n')
      );
      stamp(root);

      const { status, stdout } = run(root);

      expect(status).toBe(0);
      expect(stdout).toMatch(/PASS/);
    });
  });

  describe('audit regressions', () => {
    it('epoch covers the whole reviewer record, not just names', () => {
      // Flipping `kind` moves the derived CLI count. When the epoch hashed
      // names only, no stamped file was asked to re-sweep, so a stale doc
      // outside SCAN_FILES passed.
      writeFixture(root);
      writeFile(
        root,
        'docs/CONCEPTS.md',
        '# Concepts\n\nCouncil: Codex, Gemini, OpenCode.\n'
      );
      stamp(root);
      expect(run(root).status).toBe(0);

      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      roster.reviewers.find((r: { name: string }) => r.name === 'codex').kind =
        'in-process';
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/was last swept at roster epoch/);
    });

    it('--write-stamps refuses when a non-count rule fails', () => {
      writeFixture(root, { loopNames: ['claude', 'codex', 'gemini'] });

      const { status, stderr } = run(root, ['--write-stamps']);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /refusing to write stamps while other checks fail/
      );
      expect(stderr).toMatch(/reviewer loop is/);
    });

    it("excludes /council's own committed reports from the ledger", () => {
      writeFixture(root);
      stamp(root);
      writeFile(
        root,
        'docs/council/2026-09-08-review-slug.md',
        '# Council report\n\nReviewers: Codex, Gemini, OpenCode.\n'
      );

      expect(run(root).status).toBe(0);
    });

    it('detects a redaction carrier by content, not by the roster flag', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        `# Security\n\nA copy lives here.\n\n${CANONICAL_AWK}\n`
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/carries the canonical redaction program/);
      expect(stderr).toMatch(/redaction_known_untested/);
    });

    it('fails when a declared redaction flag disagrees with the file', () => {
      writeFixture(root);
      // gemini declares the flag; strip the markers from its agent file.
      writeFile(
        root,
        agentPath(BASE_REVIEWERS[2]),
        '# Gemini reviewer\n\nA council reviewer.\n'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /declares ships_redaction_awk=true but .* does not carry/
      );
    });

    it('rejects a roster exception path that escapes the repo root', () => {
      writeFixture(root, {
        exceptions: [
          { file: '../../etc/passwd', contains: 'root', reason: 'traversal' },
        ],
      });

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/resolves outside the repository root/);
    });

    it('reports a roster entry missing a field without a stack trace', () => {
      writeFixture(root);
      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      delete roster.reviewers[1].agent_path;
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/is missing "agent_path"/);
      expect(stderr).not.toMatch(/ERR_INVALID_ARG_TYPE|at restatesRoster/);
    });

    it('errors when a SCAN_FILES entry does not exist', () => {
      writeFixture(root);
      stamp(root);
      rmSync(join(root, 'docs/review-surface-routing-protocol.md'));

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/SCAN_FILES lists .* which does not exist/);
    });

    it("does not cry wolf on yellow-review's own persona counts", () => {
      // A proximity window was tried and reverted: it failed legitimate
      // yellow-review sentences whenever the plugin name sat more than a few
      // words from the numeral. Skipping the line is the documented trade.
      // The guard is line-scoped, so a yellow-review count wrapped onto the
      // line after its plugin name is still flagged — both live cases in the
      // repo are single-line.
      writeFixture(root);
      writeFile(
        root,
        'docs/security.md',
        '# Security\n\nyellow-review runs its own separate 14-reviewer persona pipeline.\n'
      );
      stamp(root);

      expect(run(root).status).toBe(0);
    });

    it('excludes nested node_modules from the ledger walk', () => {
      writeFixture(root);
      stamp(root);
      writeFile(
        root,
        'plugins/yellow-council/node_modules/pkg/README.md',
        '# pkg\n\nCouncil uses Codex, Gemini and OpenCode.\n'
      );

      expect(run(root).status).toBe(0);
    });

    it('reports an unreadable file instead of dropping it from the ledger', () => {
      writeFixture(root);
      writeFile(
        root,
        'docs/CONCEPTS.md',
        '# Concepts\n\nCouncil: Codex, Gemini, OpenCode.\n'
      );
      stamp(root);
      if (typeof process.getuid === 'function' && process.getuid() === 0) {
        return; // root bypasses mode bits; the unreadable path is untestable here
      }
      chmodSync(join(root, 'docs/CONCEPTS.md'), 0o000);

      const { status, stderr } = run(root);
      chmodSync(join(root, 'docs/CONCEPTS.md'), 0o644);

      expect(status).toBe(1);
      expect(stderr).toMatch(/docs\/CONCEPTS\.md: unreadable/);
    });

    it('leaves no temp file behind when writing stamps', () => {
      writeFixture(root);
      stamp(root);

      expect(existsSync(join(root, 'scripts/council-roster.json.tmp'))).toBe(
        false
      );
      // The sidecar is still valid JSON after the rename.
      expect(() =>
        JSON.parse(
          readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
        )
      ).not.toThrow();
    });

    it('invalidates stamps when reviewers are reordered', () => {
      // Rule D calls loop order load-bearing, so a reorder is a roster change.
      writeFixture(root);
      stamp(root);

      const reordered = [
        BASE_REVIEWERS[0],
        BASE_REVIEWERS[2],
        BASE_REVIEWERS[1],
        BASE_REVIEWERS[3],
      ];
      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      roster.reviewers = reordered.map((r) => ({
        name: r.name,
        display: r.display,
        kind: r.kind,
        agent: agentId(r),
        agent_path: agentPath(r),
        ships_redaction_awk: Boolean(r.awk),
      }));
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );
      // Keep council.md in step so Rule D passes and only Rule S can fire.
      const loop = reordered.map((r) => r.name).join(' ');
      const spawns = reordered
        .map(
          (r, i) =>
            `${i + 1}. \`Agent(subagent_type="${agentId(r)}", prompt=<pack>)\``
        )
        .join('\n');
      writeFile(
        root,
        COUNCIL_MD,
        `# council\n\nSpawn block:\n\n${spawns}\n\n\`\`\`bash\nfor reviewer in ${loop}; do\n  :\ndone\n\`\`\`\n`
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/was last swept at roster epoch/);
    });

    it('invalidates stamps when a reviewer is renamed for display only', () => {
      // restatesRoster() matches prose against `display`, not `name`. A
      // display-only rename (e.g. OpenCode -> OpenCoder) must flip the
      // epoch too, or --write-stamps re-stamps at the stale epoch and
      // prose still naming the old display passes unswept.
      writeFixture(root);
      stamp(root);

      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      const opencode = roster.reviewers.find(
        (r: { name: string }) => r.name === 'opencode'
      );
      opencode.display = 'OpenCoder';
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );
      // council.md's loop and spawn block key off `name`/`agent`, not
      // `display`, so Rule D still passes and only Rule S can fire.

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/was last swept at roster epoch/);
    });

    it('fails when a declared agent_path does not exist', () => {
      writeFixture(root);
      rmSync(join(root, agentPath(BASE_REVIEWERS[0])));

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/declares agent_path .* which does not exist/);
    });

    it('rejects a redaction_known_untested entry with no real reason', () => {
      writeFixture(root);
      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      roster.redaction_known_untested = [{ file: 'docs/security.md' }];
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/needs a "reason" of at least 20 characters/);
    });

    it('detects a redaction carrier outside the ledger walk scope', () => {
      // Rule R must not inherit the ledger's exclusions — a copy under
      // plugins/yellow-review/ or tests/ was previously invisible.
      writeFixture(root);
      writeFile(
        root,
        'plugins/yellow-review/agents/review/some-reviewer.md',
        `# Some reviewer\n\n${CANONICAL_AWK}\n`
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /plugins\/yellow-review\/agents\/review\/some-reviewer\.md carries the canonical/
      );
    });
  });

  describe('roster shape', () => {
    it('fails on a malformed roster with a plain-English message, not a stack trace', () => {
      writeFixture(root);
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        '{ not json',
        'utf8'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/not valid JSON/);
      expect(stderr).not.toMatch(/at Object\.<anonymous>/);
    });

    it('rejects a null member in exceptions with a plain-English message, not a stack trace', () => {
      writeFixture(root);
      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      roster.exceptions = [null];
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/"exceptions\[0\]" must be an object/);
      expect(stderr).not.toMatch(/at Object\.<anonymous>/);
    });

    it('rejects an exception entry missing "file" with a plain-English message, not a stack trace', () => {
      writeFixture(root);
      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      // No `file` — checkExceptions() would otherwise crash on
      // path.join(ROOT, undefined) instead of failing cleanly here.
      roster.exceptions = [{ contains: 'four reviewers' }];
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(
        /"exceptions\[0\]" must have non-empty string field\(s\): file/
      );
      expect(stderr).not.toMatch(/at Object\.<anonymous>/);
    });

    it('rejects two reviewers sharing an `agent` value', () => {
      // If council.md's spawn block is edited to add a matching duplicate
      // spawn, Rule D2's sequence-equality check derives expectedAgents
      // straight from this roster and would pass too — both sequences are
      // identical, even though the council invokes the same agent twice
      // instead of the intended new reviewer. The uniqueness check must
      // catch this in the roster itself, independent of council.md.
      writeFixture(root);
      const roster = JSON.parse(
        readFileSync(join(root, 'scripts/council-roster.json'), 'utf8')
      );
      roster.reviewers[1].agent = roster.reviewers[0].agent;
      writeFileSync(
        join(root, 'scripts/council-roster.json'),
        `${JSON.stringify(roster, null, 2)}\n`,
        'utf8'
      );

      const { status, stderr } = run(root);

      expect(status).toBe(1);
      expect(stderr).toMatch(/duplicate agent ".*claude-reviewer"/);
      expect(stderr).not.toMatch(/at Object\.<anonymous>/);
    });
  });
});
