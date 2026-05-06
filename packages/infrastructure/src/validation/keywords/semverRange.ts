/**
 * AJV custom keyword: `semverRange`
 *
 * Validates that a string value is a syntactically valid npm semver range
 * (e.g., `^1.0.0`, `~2.0.0`, `>=3 <4`, `1.x`, `*`, `1.2.3 - 2.0.0`,
 * `>=1.0.0 || ^2.0.0`). Delegates to `semver.validRange()` from the
 * canonical npm `semver` package.
 *
 * Used in `schemas/plugin.schema.json` for `dependencies[].version`. The
 * schema applies a lightweight `pattern` first to reject obvious non-semver
 * input; this keyword runs second and rejects strings that pass the
 * structural gate but are not actually valid range expressions. The schema
 * MUST also set `minLength: 1` on the field — `semver.validRange("")`
 * returns `"*"` (truthy, the universal range), so the empty string would
 * otherwise pass this keyword.
 *
 * @module infrastructure/validation/keywords/semverRange
 */

import type { FuncKeywordDefinition, SchemaValidateFunction } from 'ajv';
import semver from 'semver';

/**
 * Keyword definition object suitable for `ajv.addKeyword(...)`.
 *
 * AJV's `type: 'string'` filter ensures the validate function is only
 * invoked for string-typed data, so no in-function non-string guard is
 * needed. `errors: true` enables structured error output with the
 * offending value, replacing AJV's default generic "must pass keyword
 * validation" message.
 */
// AJV's SchemaValidateFunction is a callable that ALSO carries an `errors`
// property the function itself populates with structured error objects on
// failure. TypeScript expresses that as a callable + property, so we
// construct the validate function and attach `errors` in two steps.
const validateFn: SchemaValidateFunction = (
  schemaValue: unknown,
  data: unknown
): boolean => {
  if (schemaValue !== true) {
    validateFn.errors = null;
    return true;
  }
  // AJV's `type: 'string'` filter guarantees data is a string when this
  // function is invoked; no defensive guard needed.
  if (semver.validRange(data as string, { loose: false }) !== null) {
    validateFn.errors = null;
    return true;
  }
  validateFn.errors = [
    {
      keyword: 'semverRange',
      message: `must be a valid npm semver range (got "${String(data)}")`,
      params: { value: data },
    },
  ];
  return false;
};

export const semverRangeKeyword: FuncKeywordDefinition = {
  keyword: 'semverRange',
  type: 'string',
  schemaType: 'boolean',
  errors: true,
  validate: validateFn,
};
