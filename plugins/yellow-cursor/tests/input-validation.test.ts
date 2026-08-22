import { describe, expect, it } from 'vitest';

import { AppErrorException } from '../src/errors.js';
import {
  validateAgentId,
  validateArtifactRemotePath,
  validateIdempotencyKey,
  validateMaxActive,
  validateModelId,
  validatePrompt,
  validateRef,
  validateRepoUrl,
  validateRunId,
  validateLocalOutPath,
  resolveLocalOutPath,
} from '../src/validate.js';

function expectInvalid(fn: () => unknown): void {
  expect(fn).toThrow(AppErrorException);
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppErrorException);
    expect((err as AppErrorException).appError.code).toBe(
      'CURSOR_INVALID_INPUT'
    );
  }
}

describe('validateRepoUrl', () => {
  it('accepts allowlisted https hosts', () => {
    expect(validateRepoUrl('https://github.com/org/repo')).toBe(
      'https://github.com/org/repo'
    );
    expect(validateRepoUrl('https://gitlab.com/org/repo')).toBe(
      'https://gitlab.com/org/repo'
    );
    expect(
      validateRepoUrl('https://dev.azure.com/org/project/_git/repo')
    ).toContain('dev.azure.com');
    expect(validateRepoUrl('https://bitbucket.org/org/repo')).toContain(
      'bitbucket.org'
    );
  });

  it('rejects non-allowlisted hosts', () => {
    expectInvalid(() => validateRepoUrl('https://evil.example.com/org/repo'));
  });

  it('rejects http (non-https)', () => {
    expectInvalid(() => validateRepoUrl('http://github.com/org/repo'));
  });

  it('rejects userinfo in the URL', () => {
    expectInvalid(() =>
      validateRepoUrl('https://user:pass@github.com/org/repo')
    );
  });

  it('rejects an explicit non-default port', () => {
    expectInvalid(() => validateRepoUrl('https://github.com:8443/org/repo'));
  });

  it('accepts the default https port written explicitly (the URL parser strips it, so url.port is empty)', () => {
    expect(validateRepoUrl('https://github.com:443/org/repo')).toBe(
      'https://github.com/org/repo'
    );
  });

  it('rejects a fragment', () => {
    expectInvalid(() => validateRepoUrl('https://github.com/org/repo#readme'));
  });

  it('rejects unparseable input', () => {
    expectInvalid(() => validateRepoUrl('not a url'));
    expectInvalid(() => validateRepoUrl(''));
  });
});

describe('validateRef', () => {
  it('accepts ordinary branch and tag names', () => {
    expect(validateRef('main')).toBe('main');
    expect(validateRef('feature/add-thing')).toBe('feature/add-thing');
    expect(validateRef('v1.2.3')).toBe('v1.2.3');
  });

  it('rejects a leading dash (flag-injection guard)', () => {
    expectInvalid(() => validateRef('--upload-pack=evil'));
  });

  it('rejects whitespace', () => {
    expectInvalid(() => validateRef('main branch'));
  });

  it('rejects shell metacharacters', () => {
    expectInvalid(() => validateRef('main;rm -rf /'));
    expectInvalid(() => validateRef('$(whoami)'));
    expectInvalid(() => validateRef('`whoami`'));
    expectInvalid(() => validateRef('main|cat'));
    expectInvalid(() => validateRef('main&&echo'));
  });

  it('rejects ".." traversal-shaped refs', () => {
    expectInvalid(() => validateRef('a..b'));
  });

  it('rejects leading/trailing slash and .lock suffix', () => {
    expectInvalid(() => validateRef('/main'));
    expectInvalid(() => validateRef('main/'));
    expectInvalid(() => validateRef('main.lock'));
  });

  it('rejects empty and overlong refs', () => {
    expectInvalid(() => validateRef(''));
    expectInvalid(() => validateRef('a'.repeat(256)));
  });
});

describe('validateAgentId', () => {
  it('accepts the documented bc-<hex/dashes> shape', () => {
    expect(validateAgentId('bc-41d32f40-3b15-454d-a580-ad62a664204a')).toBe(
      'bc-41d32f40-3b15-454d-a580-ad62a664204a'
    );
  });

  it('rejects a slash', () => {
    expectInvalid(() => validateAgentId('bc-abc/def'));
  });

  it('rejects ".." traversal payloads', () => {
    expectInvalid(() => validateAgentId('../../etc/passwd'));
  });

  it('rejects percent-encoding payloads', () => {
    expectInvalid(() => validateAgentId('bc-%2e%2e%2fetc'));
  });

  it('rejects NUL-byte payloads', () => {
    expectInvalid(() => validateAgentId('bc-abc\x00def'));
  });

  it('rejects extreme length', () => {
    expectInvalid(() => validateAgentId(`bc-${'a'.repeat(200)}`));
  });

  it('rejects a missing bc- prefix', () => {
    expectInvalid(() => validateAgentId('not-an-agent-id'));
  });
});

describe('validateRunId', () => {
  it('accepts a safe id shape', () => {
    expect(validateRunId('run-00000001')).toBe('run-00000001');
  });

  it('rejects traversal and metacharacters', () => {
    expectInvalid(() => validateRunId('../etc/passwd'));
    expectInvalid(() => validateRunId('run/00000001'));
    expectInvalid(() => validateRunId('run;rm -rf /'));
  });
});

describe('validateIdempotencyKey', () => {
  it('accepts a safe key', () => {
    expect(validateIdempotencyKey('abc-123.456:789')).toBe('abc-123.456:789');
  });

  it('rejects unsafe characters and empty input', () => {
    expectInvalid(() => validateIdempotencyKey(''));
    expectInvalid(() => validateIdempotencyKey('abc def'));
    expectInvalid(() => validateIdempotencyKey('abc/def'));
  });

  it('rejects extreme length', () => {
    expectInvalid(() => validateIdempotencyKey('a'.repeat(201)));
  });
});

describe('validatePrompt', () => {
  it('accepts a normal prompt', () => {
    expect(validatePrompt('do the thing')).toBe('do the thing');
  });

  it('rejects an empty prompt', () => {
    expectInvalid(() => validatePrompt(''));
  });

  it('rejects NUL bytes', () => {
    expectInvalid(() => validatePrompt('abc\x00def'));
  });

  it('rejects a prompt over the 100KB cap', () => {
    expectInvalid(() => validatePrompt('a'.repeat(100 * 1024 + 1)));
  });

  it('accepts a prompt right at the cap', () => {
    expect(() => validatePrompt('a'.repeat(100 * 1024))).not.toThrow();
  });
});

describe('validateModelId', () => {
  it('passes through undefined (model is optional)', () => {
    expect(validateModelId(undefined)).toBeUndefined();
  });

  it('rejects an empty string and control characters', () => {
    expectInvalid(() => validateModelId(''));
    expectInvalid(() => validateModelId('gpt\x00'));
  });
});

describe('validateMaxActive', () => {
  it('accepts values in range', () => {
    expect(validateMaxActive(1)).toBe(1);
    expect(validateMaxActive(3)).toBe(3);
    expect(validateMaxActive(50)).toBe(50);
  });

  it('rejects zero, negative, non-integer, and out-of-range values', () => {
    expectInvalid(() => validateMaxActive(0));
    expectInvalid(() => validateMaxActive(-1));
    expectInvalid(() => validateMaxActive(1.5));
    expectInvalid(() => validateMaxActive(51));
  });
});

describe('validateLocalOutPath', () => {
  it('accepts a simple relative path', () => {
    expect(validateLocalOutPath('logs/output.txt')).toBe('logs/output.txt');
  });

  it('rejects absolute paths, traversal, leading hyphens, and metacharacters', () => {
    expectInvalid(() => validateLocalOutPath('/etc/passwd'));
    expectInvalid(() => validateLocalOutPath('../../.git/hooks/pre-commit'));
    expectInvalid(() => validateLocalOutPath('-rf'));
    expectInvalid(() => validateLocalOutPath('out;rm'));
  });
});

describe('resolveLocalOutPath', () => {
  it('resolves under the approved root and rejects escapes', () => {
    const root = '/tmp/artifact-downloads';
    expect(resolveLocalOutPath(root, 'nested/out.txt')).toBe(
      '/tmp/artifact-downloads/nested/out.txt'
    );
    expectInvalid(() => resolveLocalOutPath(root, '../outside.txt'));
  });
});

describe('validateArtifactRemotePath', () => {
  it('accepts an ordinary relative path', () => {
    expect(validateArtifactRemotePath('logs/output.txt')).toBe(
      'logs/output.txt'
    );
  });

  it('rejects absolute paths and traversal segments', () => {
    expectInvalid(() => validateArtifactRemotePath('/etc/passwd'));
    expectInvalid(() => validateArtifactRemotePath('../../etc/passwd'));
    expectInvalid(() => validateArtifactRemotePath('logs/../../etc/passwd'));
  });

  it('rejects control characters', () => {
    expectInvalid(() => validateArtifactRemotePath('logs/out\x00.txt'));
  });
});
