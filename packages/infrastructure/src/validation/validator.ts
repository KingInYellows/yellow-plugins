/**
 * Validator implementation using AJV
 *
 * Implements the IValidator interface from the domain layer using AJV
 * for JSON Schema validation. Maps low-level AJV errors to domain-level
 * validation results with specification error codes.
 *
 * @module infrastructure/validation/validator
 */

import { resolve } from 'path';

import {
  type DomainValidationError,
  type DomainValidationResult,
  ValidationErrorFactory,
  ValidationStatus,
  type IValidator,
  type PluginCompatibility,
  type SystemEnvironment,
} from '@yellow-plugins/domain';
import * as semver from 'semver';

import { AjvValidatorFactory } from './ajvFactory.js';

/**
 * Schema validator implementing domain validation interface
 *
 * Usage:
 * 1. Initialize with schema paths
 * 2. Call validateMarketplace() or validatePluginManifest()
 * 3. Receive domain-level validation results with spec-aligned error codes
 *
 * @example
 * ```typescript
 * const validator = new SchemaValidator();
 * await validator.initialize();
 *
 * const result = validator.validateMarketplace(marketplaceData);
 * if (result.status === ValidationStatus.ERROR) {
 *   result.errors.forEach(err => {
 *     console.error(`[${err.code}] ${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 */
export class SchemaValidator implements IValidator {
  private factory: AjvValidatorFactory;
  private initialized: boolean;

  constructor(factory?: AjvValidatorFactory) {
    this.factory = factory || new AjvValidatorFactory();
    this.initialized = false;
  }

  /**
   * Initialize validator by loading schemas
   *
   * Loads marketplace and plugin schemas from the schemas/ directory.
   * Must be called before validation methods.
   *
   * @param schemaDir - Directory containing schema files (defaults to 'schemas')
   * @throws Error if schemas cannot be loaded
   */
  async initialize(schemaDir = 'schemas'): Promise<void> {
    const schemaPath = resolve(process.cwd(), schemaDir);

    try {
      await this.factory.loadSchemaFromFile(
        'marketplace',
        `${schemaPath}/marketplace.schema.json`
      );
      await this.factory.loadSchemaFromFile(
        'plugin',
        `${schemaPath}/plugin.schema.json`
      );

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize validator: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Validate a marketplace index file
   *
   * @param data - Marketplace data to validate
   * @returns Validation result with detailed errors
   * @throws Error if validator not initialized
   */
  validateMarketplace(data: unknown): DomainValidationResult {
    this.ensureInitialized();

    const result = this.factory.validate('marketplace', data);

    return {
      status: result.valid ? ValidationStatus.SUCCESS : ValidationStatus.ERROR,
      errors: result.errors.map((err) =>
        ValidationErrorFactory.schemaError(
          err.path,
          err.message,
          err.keyword,
          err.params
        )
      ),
      warnings: [],
      entityName: 'marketplace',
      validatedAt: new Date(),
    };
  }

  /**
   * Validate a plugin manifest file
   *
   * @param data - Plugin manifest data to validate
   * @param pluginId - Optional plugin ID for enhanced error messages
   * @returns Validation result with detailed errors
   * @throws Error if validator not initialized
   */
  validatePluginManifest(
    data: unknown,
    pluginId?: string
  ): DomainValidationResult {
    this.ensureInitialized();

    const result = this.factory.validate('plugin', data);

    const entityName = pluginId ? `plugin:${pluginId}` : 'plugin';

    return {
      status: result.valid ? ValidationStatus.SUCCESS : ValidationStatus.ERROR,
      errors: result.errors.map((err) =>
        ValidationErrorFactory.schemaError(err.path, err.message, err.keyword, {
          ...err.params,
          pluginId,
        })
      ),
      warnings: [],
      entityName,
      validatedAt: new Date(),
    };
  }

  /**
   * Validate plugin compatibility with current environment
   *
   * Checks:
   * - Claude Code version constraints
   * - Node.js version constraints
   * - Platform (OS) requirements
   * - Architecture (CPU) requirements
   * - Plugin dependencies
   *
   * @param compatibility - Compatibility requirements from plugin manifest
   * @param environment - Current system environment
   * @returns Validation result with compatibility errors
   */
  validateCompatibility(
    compatibility: PluginCompatibility,
    environment: SystemEnvironment
  ): DomainValidationResult {
    const errors: DomainValidationError[] = [];
    const warnings: DomainValidationError[] = [];

    // Validate Claude Code version
    if (compatibility.claudeCodeMin) {
      if (
        semver.lt(environment.claudeCodeVersion, compatibility.claudeCodeMin)
      ) {
        errors.push(
          ValidationErrorFactory.compatibilityError(
            'claudeCodeMin',
            environment.claudeCodeVersion,
            `>= ${compatibility.claudeCodeMin}`
          )
        );
      }
    }

    if (compatibility.claudeCodeMax) {
      if (
        semver.gt(environment.claudeCodeVersion, compatibility.claudeCodeMax)
      ) {
        errors.push(
          ValidationErrorFactory.compatibilityError(
            'claudeCodeMax',
            environment.claudeCodeVersion,
            `<= ${compatibility.claudeCodeMax}`
          )
        );
      }
    }

    // Validate Node.js version
    if (compatibility.nodeMin) {
      const nodeMajor = semver.major(environment.nodeVersion);
      const requiredMajor = parseInt(compatibility.nodeMin, 10);

      if (nodeMajor < requiredMajor) {
        errors.push(
          ValidationErrorFactory.compatibilityError(
            'nodeMin',
            environment.nodeVersion,
            `>= ${compatibility.nodeMin}.x`
          )
        );
      }
    }

    // Validate platform (OS)
    if (compatibility.os && compatibility.os.length > 0) {
      if (!compatibility.os.includes(environment.platform)) {
        errors.push(
          ValidationErrorFactory.compatibilityError(
            'os',
            environment.platform,
            compatibility.os.join(', ')
          )
        );
      }
    }

    // Validate architecture (CPU)
    if (compatibility.arch && compatibility.arch.length > 0) {
      if (!compatibility.arch.includes(environment.arch)) {
        errors.push(
          ValidationErrorFactory.compatibilityError(
            'arch',
            environment.arch,
            compatibility.arch.join(', ')
          )
        );
      }
    }

    // Validate plugin dependencies
    if (
      compatibility.pluginDependencies &&
      compatibility.pluginDependencies.length > 0
    ) {
      const missing = compatibility.pluginDependencies.filter(
        (dep: string) => !environment.installedPlugins.includes(dep)
      );

      if (missing.length > 0) {
        errors.push(
          ValidationErrorFactory.compatibilityError(
            'pluginDependencies',
            environment.installedPlugins.join(', '),
            missing.join(', ')
          )
        );
      }
    }

    return {
      status:
        errors.length > 0 ? ValidationStatus.ERROR : ValidationStatus.SUCCESS,
      errors,
      warnings,
      entityName: 'compatibility',
      validatedAt: new Date(),
    };
  }

  /**
   * Ensure validator is initialized before use
   *
   * @private
   * @throws Error if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Validator not initialized. Call initialize() before using validation methods.'
      );
    }
  }

  /**
   * Check if validator is initialized
   *
   * @returns True if schemas are loaded and validator is ready
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create and initialize a validator instance
 *
 * Convenience function for creating a ready-to-use validator.
 *
 * @param schemaDir - Directory containing schema files (defaults to 'schemas')
 * @returns Initialized validator
 *
 * @example
 * ```typescript
 * const validator = await createValidator();
 * const result = validator.validateMarketplace(data);
 * ```
 */
export async function createValidator(
  schemaDir?: string
): Promise<SchemaValidator> {
  const validator = new SchemaValidator();
  await validator.initialize(schemaDir);
  return validator;
}
