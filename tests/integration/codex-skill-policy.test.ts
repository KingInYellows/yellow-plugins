/* eslint-disable @typescript-eslint/no-var-requires */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  buildCodexSkillTree,
  buildCodexPluginManifest,
} = require('../../scripts/lib/generate/emit-codex');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  buildCursorSkillTree,
} = require('../../scripts/lib/generate/emit-cursor');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  validateSkillPolicy,
  readSkillPolicy,
  validatePublicMcp,
} = require('../../scripts/lib/generate/skill-policy');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  assessWorkflow,
} = require('../../scripts/smoke-codex-workflow-acceptance');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'yellow-policy-'));
  roots.push(root);
  const skill = join(root, 'plugins', 'test-plugin', 'skills', 'test-skill');
  mkdirSync(join(skill, 'agents'), { recursive: true });
  writeFileSync(
    join(skill, 'SKILL.md'),
    '---\nname: test-skill\ndescription: Test skill\n---\n\nBody.\n'
  );
  writeFileSync(
    join(skill, 'agents', 'openai.yaml'),
    'policy:\n  allow_implicit_invocation: false\n'
  );
  const target = {
    enabled: true,
    skillAllowlist: ['test-skill'],
    componentPaths: { skills: './codex/skills' },
  };
  return {
    root,
    skill,
    source: {
      targets: {
        codex: target,
        cursor: { ...target, componentPaths: { skills: './cursor/skills' } },
      },
    },
  };
}
describe('bounded invocation policy packaging', () => {
  it('copies policy verbatim only into Codex; keeps Cursor bytes unchanged', () => {
    const f = fixture();
    const codex = buildCodexSkillTree(f.root, 'test-plugin', f.source);
    expect(codex.status).toBe('ok');
    expect(
      codex.targets.find((t: { path: string }) =>
        t.path.endsWith('agents/openai.yaml')
      ).bytes
    ).toBe(readFileSync(join(f.skill, 'agents', 'openai.yaml'), 'utf8'));
    const cursor = buildCursorSkillTree(f.root, 'test-plugin', f.source);
    expect(cursor.status).toBe('ok');
    expect(cursor.targets).toHaveLength(1);
  });
  it.each([
    'policy:\n  allow_implicit_invocation: "false"\n',
    'policy:\n  allow_implicit_invocation: false\n  allow_implicit_invocation: true\n',
    'policy:\n  allow_implicit_invocation: false\ndependencies:\n  tools: []\n',
    'interface:\n  icon_small: ../secret\n',
    'policy: &p\n  allow_implicit_invocation: false\nextra: *p\n',
  ])(
    'rejects malformed, duplicate, aliased or undeclared policy fields',
    (raw) => {
      expect(() => validateSkillPolicy(raw)).toThrow();
    }
  );
  it('rejects symlink directory, leaf and extra resources', () => {
    const f = fixture();
    writeFileSync(join(f.skill, 'agents', 'extra.yaml'), 'extra');
    expect(() => readSkillPolicy(f.skill)).toThrow();
    rmSync(join(f.skill, 'agents'), { recursive: true });
    const outside = join(f.root, 'outside');
    mkdirSync(outside);
    writeFileSync(
      join(outside, 'openai.yaml'),
      'policy:\n  allow_implicit_invocation: false\n'
    );
    symlinkSync(outside, join(f.skill, 'agents'));
    expect(() => readSkillPolicy(f.skill)).toThrow();
    rmSync(join(f.skill, 'agents'));
    mkdirSync(join(f.skill, 'agents'));
    symlinkSync(
      join(outside, 'openai.yaml'),
      join(f.skill, 'agents', 'openai.yaml')
    );
    expect(() => readSkillPolicy(f.skill)).toThrow();
  });
  it('does not copy unselected skills or their policies', () => {
    const f = fixture();
    f.source.targets.codex.skillAllowlist = [];
    expect(
      buildCodexSkillTree(f.root, 'test-plugin', f.source).targets
    ).toEqual([]);
  });
  it('carries catalog attribution plus parser-supported identity presentation', () => {
    const source = {
      author: { name: 'Owner', url: 'https://example.test/owner' },
      homepage: 'https://example.test/repo',
      license: 'MIT',
      keywords: ['review'],
      targets: {
        codex: {
          interface: { displayName: 'Review', category: 'Developer Tools' },
        },
      },
    };
    const result = buildCodexPluginManifest(
      source,
      { name: 'test-plugin', version: '1.0.0' },
      null
    );
    expect(result.author).toEqual(source.author);
    expect(result.interface.developerName).toBe('Owner');
    expect(result.interface.websiteURL).toBe(source.homepage);
    expect(result.commands).toEqual([]);
  });
});
describe('public target-selected HTTP MCP', () => {
  it('passes the single public URL map without shared Claude credentials', () => {
    const servers = { deepwiki: { url: 'https://mcp.deepwiki.com/mcp' } };
    const source = {
      mcpServers: { private: { env: { KEY: 'excluded' } } },
      targets: {
        codex: {
          interface: { displayName: 'Research', category: 'Developer Tools' },
          mcpServers: servers,
        },
      },
    };
    expect(
      buildCodexPluginManifest(
        source,
        { name: 'test-plugin', version: '1.0.0' },
        null
      ).mcpServers
    ).toEqual(servers);
  });
  it.each([
    { x: { url: 'http://example.test/mcp' } },
    { x: { url: 'https://user:pass@example.test/mcp' } },
    { x: { url: 'https://example.test/mcp?key=test' } },
    { x: { url: 'https://example.test/${KEY}' } },
    {
      x: {
        url: 'https://example.test/mcp',
        headers: { Authorization: 'excluded' },
      },
    },
    { x: { command: 'echo', env: {} } },
  ])(
    'rejects credential, substitution and unsupported transport shapes',
    (value) => {
      expect(() => validatePublicMcp(value)).toThrow();
    }
  );
});
describe('real-model receipt acceptance', () => {
  it('rejects no activation, missing references, wrong outputs and unsolicited activation', () => {
    const skill = { path: '/installed/codex/skills/test/SKILL.md' };
    expect(() =>
      assessWorkflow(
        { expected: { status: 'ok' } },
        '{"status":"ok"}',
        [],
        skill,
        []
      )
    ).toThrow();
    expect(() =>
      assessWorkflow(
        { requiredReads: ['references/a.md'] },
        '',
        [skill.path],
        skill,
        []
      )
    ).toThrow();
    expect(() =>
      assessWorkflow(
        { expected: { status: 'ok' } },
        '{"status":"blocked"}',
        [skill.path],
        skill,
        []
      )
    ).toThrow();
    expect(() =>
      assessWorkflow({ activation: false }, '4', [skill.path], skill, [])
    ).toThrow();
  });
});
