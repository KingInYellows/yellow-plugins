import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Ajv = require('ajv');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const codex = require('../../scripts/lib/generate/emit-codex.js');
const { buildCodexSkillTree } = codex;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runExposureLint } = require('../../scripts/validate-codex.js');

const root = resolve(__dirname, '../..');
const fixtures: string[] = [];
afterAll(() => {
  for (const fixture of fixtures)
    rmSync(fixture, { recursive: true, force: true });
});

describe('DeepWiki current and advertised historical input contracts', () => {
  const corpus = JSON.parse(
    readFileSync(
      join(root, 'tests/fixtures/codex-waves-analysis-integration/cases.json'),
      'utf8'
    )
  );
  const success = corpus.research.cases.find(
    (entry: { id: string }) => entry.id === 'research-success'
  );

  for (const advertisement of corpus.research.toolAdvertisements) {
    it(`single public repository fixture conforms to ${advertisement.name}`, () => {
      const validate = new Ajv({ strict: true }).compile(
        advertisement.inputSchema
      );
      const input = {
        repoName: success.repository,
        question: success.question,
      };
      expect(validate(input)).toBe(true);
      expect(typeof input.repoName).toBe('string');
      expect(input.repoName).toBe('modelcontextprotocol/python-sdk');
      expect(validate({ repoName: input.repoName })).toBe(false);
      if (advertisement.name === 'ask_question') {
        expect(advertisement.historicalOnlyWhenAdvertised).toBe(true);
      } else {
        expect(success.expectedOperation).toBe(advertisement.name);
      }
    });
  }
});

describe('installed flat-reference snapshot enforces paths before source reads', () => {
  const reference = readFileSync(
    join(
      root,
      'plugins/yellow-debt/skills/debt-complexity-scan/references/scan-contract.md'
    ),
    'utf8'
  );
  const program = reference.match(/```python\n([\s\S]*?)\n```/)?.[1];

  function inspect(sourcePath: string, setup?: (workspace: string) => void) {
    expect(program).toBeDefined();
    const workspace = mkdtempSync(join(tmpdir(), 'yellow-bounded-source-'));
    fixtures.push(workspace);
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'src/file.js'), 'export const amount = 1;\n');
    setup?.(workspace);
    const before = readFileSync(join(workspace, 'src/file.js'), 'utf8');
    const process = spawnSync('python3', ['-c', program!], {
      input: JSON.stringify({ root: workspace, path: sourcePath }),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(process.error).toBeUndefined();
    expect(process.stderr).toBe('');
    expect(readFileSync(join(workspace, 'src/file.js'), 'utf8')).toBe(before);
    return { exit: process.status, output: JSON.parse(process.stdout) };
  }

  it('reads actual validated source with line numbers', () => {
    const result = inspect('src/file.js');
    expect(result.exit).toBe(0);
    expect(result.output).toEqual({
      status: 'success',
      exclusions: [],
      files: [
        {
          path: 'src/file.js',
          lines: [{ line: 1, text: 'export const amount = 1;' }],
        },
      ],
    });
  });

  it.each([
    '../file.js',
    '/tmp/file.js',
    '-file.js',
    'src/../file.js',
    'src/./file.js',
    'src/.env',
    'src/token.js',
    'src/file.js\n',
    'src/file.js;touch marker',
    'src\\file.js',
    'src//file.js',
  ])('refuses %j without reading any source', (sourcePath) => {
    const result = inspect(sourcePath);
    expect(result.exit).toBe(1);
    expect(result.output.status).toBe('error');
    expect(result.output.files).toEqual([]);
  });

  it('refuses leaf and ancestor symlinks', () => {
    for (const sourcePath of ['alias.js', 'linked/file.js']) {
      const result = inspect(sourcePath, (workspace) => {
        symlinkSync(
          join(workspace, 'src/file.js'),
          join(workspace, 'alias.js')
        );
        symlinkSync(join(workspace, 'src'), join(workspace, 'linked'));
      });
      expect(result.exit).toBe(1);
      expect(result.output.files).toEqual([]);
    }
  });

  it('bounds source lines and redacts synthetic credential assignments', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        "const token = 'synthetic-placeholder';\n" +
          'const amount = 1;\n'.repeat(2000)
      );
    });
    expect(result.exit).toBe(0);
    expect(result.output.status).toBe('partial');
    expect(result.output.files[0].lines).toHaveLength(2000);
    expect(result.output.files[0].lines[0].text).toBe(
      '--- redacted possible credential at line 1 ---'
    );
    expect(JSON.stringify(result.output)).not.toContain(
      'synthetic-placeholder'
    );
  });

  it('redacts quoted-key credentials and authorization headers', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'const a = { "api_key": "synthetic-one" };\n' +
          "const b = { 'password': 'synthetic-two' };\n" +
          'const c = { Authorization: "Bearer synthetic-three" };\n' +
          'h.set("Authorization", "synthetic-four");\n' +
          'const amount = 1;\n'
      );
    });
    expect(result.exit).toBe(0);
    const text = JSON.stringify(result.output);
    for (const secret of ['one', 'two', 'three', 'four']) {
      expect(text).not.toContain('synthetic-' + secret);
    }
    expect(result.output.files[0].lines[4].text).toBe('const amount = 1;');
  });

  it('redacts compound credential names and credential-bearing URLs', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'AWS_SECRET_ACCESS_KEY = "synthetic-one"\n' +
          'GITHUB_TOKEN=synthetic-two\n' +
          'db_password: synthetic-three\n' +
          'const d = { "api_key_v2": "synthetic-four" };\n' +
          'const u = "postgres://user:synthetic-five@host/db";\n' +
          'fetch("https://user:synthetic-six@host/path");\n' +
          'const keyboardLayout = "us";\n' +
          'parseToken(input);\n' +
          'const url = "https://example.com/path";\n'
      );
    });
    expect(result.exit).toBe(0);
    const text = JSON.stringify(result.output);
    for (const secret of ['one', 'two', 'three', 'four', 'five', 'six']) {
      expect(text).not.toContain('synthetic-' + secret);
    }
    const lines = result.output.files[0].lines;
    for (let index = 0; index < 6; index += 1) {
      expect(lines[index].text).toBe(
        '--- redacted possible credential at line ' + (index + 1) + ' ---'
      );
    }
    expect(lines[6].text).toBe('const keyboardLayout = "us";');
    expect(lines[7].text).toBe('parseToken(input);');
    expect(lines[8].text).toBe('const url = "https://example.com/path";');
  });

  it('redacts credential values wrapped onto continuation lines', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'const apiKey =\n' +
          '  "sk-live-abc123"\n' +
          'const amount = 1;\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('sk-live-abc123');
    const lines = result.output.files[0].lines;
    expect(lines[0].text).toBe(
      '--- redacted possible credential at line 1 ---'
    );
    expect(lines[1].text).toBe(
      '--- redacted possible credential at line 2 ---'
    );
    expect(lines[2].text).toBe('const amount = 1;');
  });

  const redactedAt = (line: number) =>
    '--- redacted possible credential at line ' + line + ' ---';

  it('redacts a backtick template literal through its closing delimiter', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'const privateKey = `\n' +
          'fake-payload-alpha\n' +
          'fake-payload-beta\n' +
          '`;\n' +
          'const amount = 1;\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('fake-payload');
    const lines = result.output.files[0].lines;
    for (let index = 0; index < 4; index += 1) {
      expect(lines[index].text).toBe(redactedAt(index + 1));
    }
    expect(lines[4].text).toBe('const amount = 1;');
  });

  it('redacts a triple-quoted literal through its closing delimiter', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'password = """\n' + 'fake-payload-gamma\n' + '"""\n' + 'amount = 1\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('fake-payload');
    const lines = result.output.files[0].lines;
    for (let index = 0; index < 3; index += 1) {
      expect(lines[index].text).toBe(redactedAt(index + 1));
    }
    expect(lines[3].text).toBe('amount = 1');
  });

  it('keeps a backtick span open past an escaped backtick', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'const privateKey = `\n' +
          'fake-payload-iota \\` still-hidden\n' +
          'fake-payload-kappa\n' +
          '`;\n' +
          'const amount = 1;\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('fake-payload');
    const lines = result.output.files[0].lines;
    for (let index = 0; index < 4; index += 1) {
      expect(lines[index].text).toBe(redactedAt(index + 1));
    }
    expect(lines[4].text).toBe('const amount = 1;');
  });

  it('keeps a triple-quoted span open past an escaped triple quote', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'password = """\n' +
          'fake-payload-lambda \\""" still-hidden\n' +
          'fake-payload-mu\n' +
          '"""\n' +
          'amount = 1\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('fake-payload');
    const lines = result.output.files[0].lines;
    for (let index = 0; index < 4; index += 1) {
      expect(lines[index].text).toBe(redactedAt(index + 1));
    }
    expect(lines[4].text).toBe('amount = 1');
  });

  it('closes a span when an escaped backslash precedes the real backtick', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'const privateKey = `\n' +
          'fake-payload-nu \\\\`;\n' +
          'const amount = 1;\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('fake-payload');
    const lines = result.output.files[0].lines;
    expect(lines[0].text).toBe(redactedAt(1));
    expect(lines[1].text).toBe(redactedAt(2));
    expect(lines[2].text).toBe('const amount = 1;');
  });

  it('redacts a YAML block scalar until the indentation returns', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'api_key: |\n' +
          '  fake-payload-delta\n' +
          '  fake-payload-epsilon\n' +
          'other: 1\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('fake-payload');
    const lines = result.output.files[0].lines;
    for (let index = 0; index < 3; index += 1) {
      expect(lines[index].text).toBe(redactedAt(index + 1));
    }
    expect(lines[3].text).toBe('other: 1');
  });

  it('redacts a bare PEM private key block without any assignment marker', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        '-----BEGIN RSA PRIVATE KEY-----\n' +
          'fake-payload-zeta\n' +
          '-----END RSA PRIVATE KEY-----\n' +
          'const amount = 1;\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('fake-payload');
    const lines = result.output.files[0].lines;
    for (let index = 0; index < 3; index += 1) {
      expect(lines[index].text).toBe(redactedAt(index + 1));
    }
    expect(lines[3].text).toBe('const amount = 1;');
  });

  it('redacts through end of file when a literal span is still open', () => {
    const result = inspect('src/file.js', (workspace) => {
      writeFileSync(
        join(workspace, 'src/file.js'),
        'const amount = 1;\n' +
          'const secret = `\n' +
          'fake-payload-eta\n' +
          'fake-payload-theta\n'
      );
    });
    expect(result.exit).toBe(0);
    expect(JSON.stringify(result.output)).not.toContain('fake-payload');
    const lines = result.output.files[0].lines;
    expect(lines[0].text).toBe('const amount = 1;');
    for (let index = 1; index < 4; index += 1) {
      expect(lines[index].text).toBe(redactedAt(index + 1));
    }
  });

  it('bounds directory scans to twenty supported source files', () => {
    const result = inspect('src', (workspace) => {
      for (let index = 0; index < 21; index += 1) {
        writeFileSync(
          join(workspace, 'src', `sample-${index}.js`),
          'export const amount = 1;\n'
        );
      }
    });
    expect(result.exit).toBe(0);
    expect(result.output.status).toBe('partial');
    expect(result.output.files).toHaveLength(20);
  });
});

describe('bounded analysis and integration skills ship without checkout dependencies', () => {
  for (const [plugin, skill, reference] of [
    ['yellow-debt', 'debt-complexity-scan', 'scan-contract.md'],
    ['yellow-research', 'research-public-repo', 'deepwiki-contract.md'],
  ]) {
    it(`${plugin} packages only its selected skill and flat contract`, () => {
      const source = JSON.parse(
        readFileSync(join(root, 'catalog/plugins', plugin + '.json'), 'utf8')
      );
      source.targets.codex = {
        ...source.targets.codex,
        enabled: true,
        skillAllowlist: [skill],
        componentPaths: { skills: './codex/skills' },
      };
      const result = buildCodexSkillTree(root, plugin, source);
      expect(result.status).toBe('ok');
      const relativePaths = result.targets.map((target: { path: string }) =>
        target.path.slice(join(root, 'plugins', plugin).length + 1)
      );
      expect(relativePaths.sort()).toEqual(
        [
          `codex/skills/${skill}/SKILL.md`,
          `codex/skills/${skill}/references/${reference}`,
        ].sort()
      );

      const isolated = mkdtempSync(join(tmpdir(), 'yellow-bounded-skills-'));
      fixtures.push(isolated);
      for (const target of result.targets) {
        const path = join(isolated, target.path.slice(root.length + 1));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, target.bytes);
      }
      const installed = join(
        isolated,
        'plugins',
        plugin,
        'codex/skills',
        skill
      );
      expect(
        readFileSync(join(installed, 'references', reference), 'utf8')
      ).toBe(
        readFileSync(
          join(
            root,
            'plugins',
            plugin,
            'skills',
            skill,
            'references',
            reference
          ),
          'utf8'
        )
      );
      expect(
        runExposureLint({
          rootDir: isolated,
          catalog: { pluginOrder: [plugin] },
          sources: { [plugin]: source },
        })
      ).toEqual([]);
    });
  }
});
