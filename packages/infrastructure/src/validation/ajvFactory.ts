/**
 * AJV factory for JSON Schema (Draft-07) validation: centralized AJV
 * configuration with per-schema compilation and caching.
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

import { semverRangeKeyword } from './keywords/semverRange.js';

type AjvInstance = import('ajv').default;
type AjvConstructor = new (options?: AjvOptions) => AjvInstance;
type AddFormatsFn = (ajv: AjvInstance) => AjvInstance;

// Ajv / ajv-formats ship as CJS-with-default under ESM — normalize to the
// callable in both interop shapes.
const AjvCtor: AjvConstructor =
  (Ajv as unknown as { default?: AjvConstructor }).default ??
  (Ajv as unknown as AjvConstructor);

const applyFormats: AddFormatsFn =
  (addFormats as unknown as { default?: AddFormatsFn }).default ??
  (addFormats as unknown as AddFormatsFn);

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params: Record<string, unknown>;
  schemaPath: string;
}

interface CachedValidator {
  validator: ValidateFunction;
  schemaId: string;
  compiledAt: Date;
}

/**
 * Creates and caches AJV schema validators. Strict mode (no coercion),
 * `allErrors` (collect every error, not just the first), format validation,
 * and the custom `semverRange` keyword.
 */
export class AjvValidatorFactory {
  private ajv: AjvInstance;
  private validatorCache: Map<string, CachedValidator>;

  constructor() {
    this.ajv = new AjvCtor({
      strict: true,
      allErrors: true, // collect all errors, not just the first
      verbose: true, // include schema + data in error objects
      discriminator: true,
      allowUnionTypes: true,
      $data: true,
    });

    applyFormats(this.ajv);

    // semverRange validates dependencies[].version entries against npm
    // semver range grammar (delegates to semver.validRange).
    this.ajv.addKeyword(semverRangeKeyword);

    this.validatorCache = new Map();
  }

  /**
   * Load and compile a JSON schema from a file (path absolute or relative
   * to CWD). Throws if the file cannot be read or the schema is invalid.
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
   * Compile and cache a JSON schema object under `schemaName`. Throws if
   * compilation fails.
   */
  loadSchema(schemaName: string, schema: object): void {
    try {
      const validator = this.ajv.compile(schema);
      // Prefer the schema's own $id; fall back to the caller's name.
      const schemaId = (schema as { $id?: string }).$id || schemaName;

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
   * Validate `data` against a previously loaded schema. Throws if the named
   * schema was never loaded.
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

    const errors = this.transformErrors(cached.validator.errors || []);

    return { valid: false, errors };
  }

  private transformErrors(ajvErrors: ErrorObject[]): ValidationError[] {
    return ajvErrors.map((error) => ({
      path: error.instancePath || '/',
      message: error.message || 'Validation failed',
      keyword: error.keyword,
      params: error.params as Record<string, unknown>,
      schemaPath: error.schemaPath,
    }));
  }

  hasSchema(schemaName: string): boolean {
    return this.validatorCache.has(schemaName);
  }
}
