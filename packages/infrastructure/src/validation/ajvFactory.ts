/**
 * AJV Factory for JSON Schema Validation
 *
 * Provides centralized AJV configuration with schema compilation and caching.
 * Supports JSON Schema Draft-07 with strict validation and format checking.
 *
 * @module infrastructure/validation/ajvFactory
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';

import Ajv, {
  type ErrorObject,
  type Options as AjvOptions,
  type ValidateFunction,
} from 'ajv';
import addFormats from 'ajv-formats';

type AjvInstance = import('ajv').default;
type AjvConstructor = new (options?: AjvOptions) => AjvInstance;
type AddFormatsFn = (ajv: AjvInstance) => AjvInstance;

const AjvCtor: AjvConstructor =
  (Ajv as unknown as { default?: AjvConstructor }).default ??
  (Ajv as unknown as AjvConstructor);

const applyFormats: AddFormatsFn =
  (addFormats as unknown as { default?: AddFormatsFn }).default ??
  (addFormats as unknown as AddFormatsFn);

/**
 * Validation result containing success status and typed errors
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Structured validation error with enhanced context
 */
export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params: Record<string, unknown>;
  schemaPath: string;
}

/**
 * Schema compilation cache entry
 */
interface CachedValidator {
  validator: ValidateFunction;
  schemaId: string;
  compiledAt: Date;
}

/**
 * AJV Factory for creating and caching schema validators
 *
 * Features:
 * - Strict mode validation (no coercion)
 * - Format validation (uri, email, date-time, hostname)
 * - Schema caching for performance
 * - Detailed error reporting
 *
 * @example
 * ```typescript
 * const factory = new AjvValidatorFactory();
 * await factory.loadSchemaFromFile('marketplace', './schemas/marketplace.schema.json');
 * const result = factory.validate('marketplace', data);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export class AjvValidatorFactory {
  private ajv: AjvInstance; // AJV instance
  private validatorCache: Map<string, CachedValidator>;

  constructor() {
    // Initialize AJV with strict configuration
    this.ajv = new AjvCtor({
      strict: true, // Strict schema validation
      allErrors: true, // Collect all errors (not just first)
      verbose: true, // Include schema and data in errors
      discriminator: true, // Support discriminator keyword
      allowUnionTypes: true, // Allow union types in schemas
      $data: true, // Support $data references
    });

    // Add format validators (uri, email, date-time, etc.)
    applyFormats(this.ajv);

    this.validatorCache = new Map();
  }

  /**
   * Load and compile a JSON schema from file
   *
   * @param schemaName - Unique identifier for this schema
   * @param filePath - Path to JSON schema file (absolute or relative to CWD)
   * @throws Error if schema file cannot be read or is invalid
   *
   * @example
   * ```typescript
   * await factory.loadSchemaFromFile('marketplace', './schemas/marketplace.schema.json');
   * ```
   */
  async loadSchemaFromFile(
    schemaName: string,
    filePath: string
  ): Promise<void> {
    try {
      const absolutePath = resolve(process.cwd(), filePath);
      const schemaContent = await readFile(absolutePath, 'utf-8');
      const schema = JSON.parse(schemaContent);

      this.loadSchema(schemaName, schema);
    } catch (error) {
      throw new Error(
        `Failed to load schema "${schemaName}" from ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Load and compile a JSON schema from object
   *
   * @param schemaName - Unique identifier for this schema
   * @param schema - JSON schema object
   * @throws Error if schema compilation fails
   *
   * @example
   * ```typescript
   * factory.loadSchema('plugin', pluginSchemaObject);
   * ```
   */
  loadSchema(schemaName: string, schema: object): void {
    try {
      // Compile the schema
      const validator = this.ajv.compile(schema);

      // Extract schema $id if present, otherwise use schemaName
      const schemaId = (schema as { $id?: string }).$id || schemaName;

      // Cache the compiled validator
      this.validatorCache.set(schemaName, {
        validator,
        schemaId,
        compiledAt: new Date(),
      });
    } catch (error) {
      throw new Error(
        `Failed to compile schema "${schemaName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Validate data against a loaded schema
   *
   * @param schemaName - Name of the schema to validate against
   * @param data - Data to validate
   * @returns ValidationResult with success status and detailed errors
   * @throws Error if schema not found
   *
   * @example
   * ```typescript
   * const result = factory.validate('marketplace', marketplaceData);
   * if (!result.valid) {
   *   result.errors.forEach(err => {
   *     console.error(`${err.path}: ${err.message}`);
   *   });
   * }
   * ```
   */
  validate(schemaName: string, data: unknown): ValidationResult {
    const cached = this.validatorCache.get(schemaName);

    if (!cached) {
      throw new Error(
        `Schema "${schemaName}" not found. Load it first with loadSchema() or loadSchemaFromFile().`
      );
    }

    const valid = cached.validator(data);

    if (valid) {
      return { valid: true, errors: [] };
    }

    // Transform AJV errors to our structured format
    const errors = this.transformErrors(cached.validator.errors || []);

    return { valid: false, errors };
  }

  /**
   * Transform AJV errors into structured ValidationError format
   *
   * @private
   * @param ajvErrors - Raw AJV error objects
   * @returns Structured validation errors with enhanced context
   */
  private transformErrors(ajvErrors: ErrorObject[]): ValidationError[] {
    return ajvErrors.map((error) => ({
      path: error.instancePath || '/',
      message: error.message || 'Validation failed',
      keyword: error.keyword,
      params: error.params as Record<string, unknown>,
      schemaPath: error.schemaPath,
    }));
  }

  /**
   * Check if a schema is loaded
   *
   * @param schemaName - Name of the schema to check
   * @returns True if schema is loaded and compiled
   */
  hasSchema(schemaName: string): boolean {
    return this.validatorCache.has(schemaName);
  }

  /**
   * Get list of all loaded schema names
   *
   * @returns Array of schema names
   */
  getLoadedSchemas(): string[] {
    return Array.from(this.validatorCache.keys());
  }

  /**
   * Clear all cached validators
   *
   * Useful for testing or reloading schemas
   */
  clearCache(): void {
    this.validatorCache.clear();
  }

  /**
   * Get cache statistics
   *
   * @returns Object with cache size and schema details
   */
  getCacheStats(): {
    size: number;
    schemas: Array<{ name: string; id: string; compiledAt: Date }>;
  } {
    return {
      size: this.validatorCache.size,
      schemas: Array.from(this.validatorCache.entries()).map(
        ([name, cached]) => ({
          name,
          id: cached.schemaId,
          compiledAt: cached.compiledAt,
        })
      ),
    };
  }
}

/**
 * Singleton instance of AjvValidatorFactory
 *
 * Provides a shared validator factory across the application for performance.
 * Use this for most validation needs.
 *
 * @example
 * ```typescript
 * import { sharedValidatorFactory } from './ajvFactory.js';
 *
 * // In application initialization
 * await sharedValidatorFactory.loadSchemaFromFile('marketplace', './schemas/marketplace.schema.json');
 *
 * // Later in the code
 * const result = sharedValidatorFactory.validate('marketplace', data);
 * ```
 */
export const sharedValidatorFactory = new AjvValidatorFactory();
