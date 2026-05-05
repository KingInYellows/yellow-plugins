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
 * structural gate but are not actually valid range expressions.
 *
 * @module infrastructure/validation/keywords/semverRange
 */

import semver from 'semver';

import type { CodeKeywordDefinition, KeywordDefinition } from 'ajv';

/**
 * Keyword definition object suitable for `ajv.addKeyword(...)`.
 *
 * The keyword fires only when its schema value is `true` and the data
 * being validated is a string. Non-string data falls through (caller
 * already declared `type: "string"` if a string is required).
 */
export const semverRangeKeyword: KeywordDefinition = {
  keyword: 'semverRange',
  type: 'string',
  schemaType: 'boolean',
  errors: false,
  validate: (schemaValue: unknown, data: unknown): boolean => {
    if (schemaValue !== true) return true;
    if (typeof data !== 'string') return true;
    // semver.validRange returns the canonicalized range on valid input,
    // null on invalid input. Treat null as "not a valid range".
    return semver.validRange(data, { loose: false }) !== null;
  },
};

// Re-export the type alias used by the AJV API surface so consumers can
// strongly type `ajv.addKeyword(semverRangeKeyword)` calls without
// importing AJV directly.
export type SemverRangeKeyword = CodeKeywordDefinition | KeywordDefinition;
