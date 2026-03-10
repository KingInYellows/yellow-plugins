import { describe, expect, it } from 'vitest';

import { ValidationStatus } from '../../../domain/src/index.js';

import { SchemaValidator } from './validator.js';

describe('SchemaValidator.validateCompatibility', () => {
  const validator = new SchemaValidator();
  const baseEnvironment = {
    claudeCodeVersion: '2.5.0',
    nodeVersion: '22.22.0',
    platform: 'linux',
    arch: 'x64',
    installedPlugins: [],
  };

  it('enforces an exact semver node minimum', () => {
    const result = validator.validateCompatibility(
      { nodeMin: '22.22.0' },
      { ...baseEnvironment, nodeVersion: '22.21.0' }
    );

    expect(result.status).toBe(ValidationStatus.ERROR);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('/compatibility/nodeMin');
    expect(result.errors[0]?.context?.expected).toBe('>= 22.22.0');
  });

  it('enforces a semver node maximum', () => {
    const result = validator.validateCompatibility(
      { nodeMax: '24.0.0' },
      { ...baseEnvironment, nodeVersion: '24.0.1' }
    );

    expect(result.status).toBe(ValidationStatus.ERROR);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('/compatibility/nodeMax');
    expect(result.errors[0]?.context?.expected).toBe('<= 24.0.0');
  });

  it('accepts supported node versions inside the bounds', () => {
    const result = validator.validateCompatibility(
      { nodeMin: '22.22.0', nodeMax: '24.99.99' },
      { ...baseEnvironment, nodeVersion: '24.14.0' }
    );

    expect(result.status).toBe(ValidationStatus.SUCCESS);
    expect(result.errors).toHaveLength(0);
  });
});
