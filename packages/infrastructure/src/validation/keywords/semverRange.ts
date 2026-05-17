/**
 * AJV custom keyword `semverRange`: validates that a string is a valid npm
 * semver range (delegates to `semver.validRange()`).
 *
 * Used in `schemas/plugin.schema.json` for `dependencies[].version`. The
 * schema applies a lightweight `pattern` first; this keyword rejects strings
 * that pass the structural gate but are not valid ranges. The schema MUST
 * also set `minLength: 1` — `semver.validRange("")` returns `"*"` (truthy),
 * so the empty string would otherwise pass here.
 *
 * @module infrastructure/validation/keywords/semverRange
 */

import type { FuncKeywordDefinition, SchemaValidateFunction } from 'ajv';
import semver from 'semver';

// AJV's SchemaValidateFunction is a callable that ALSO carries an `errors`
// property the function populates on failure — built and attached in two
// steps. `type: 'string'` (on the keyword below) guarantees `data` is a
// string when this runs, so no in-function type guard is needed.
const validateFn: SchemaValidateFunction = (
  schemaValue: unknown,
  data: unknown
): boolean => {
  if (schemaValue !== true) {
    validateFn.errors = null;
    return true;
  }
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

// `errors: true` enables structured error output with the offending value,
// replacing AJV's generic "must pass keyword validation" message.
export const semverRangeKeyword: FuncKeywordDefinition = {
  keyword: 'semverRange',
  type: 'string',
  schemaType: 'boolean',
  errors: true,
  validate: validateFn,
};
