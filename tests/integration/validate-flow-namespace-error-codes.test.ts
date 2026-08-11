/**
 * Locks the ERROR-NAMESPACE-* codes scripts/validate-flow-namespace.js
 * emits to the ERROR_CODES entries in packages/domain/src/validation/
 * errorCatalog.ts.
 *
 * The script assembles its codes via string concatenation
 * (`const NS = 'ERROR-' + 'NAMESPACE'; const NS_STALE_REFERENCE = NS +
 * '-001';`) specifically so scripts/lint-error-codes.js's literal
 * ERROR-[A-Z]+-\d+ scan does not flag it as re-implementing the catalog
 * (see the script's module header and errorCatalog.ts's NAMESPACE block).
 * That deliberate concatenation is exactly what makes the two sides driftable
 * without either guardrail firing: if a future PR renames or renumbers a
 * NAMESPACE_* entry in the catalog without a paired edit to the script's
 * NS_* constants, lint-error-codes.js's literal scan cannot see the change
 * on either side, and nothing else currently checks that they still agree.
 *
 * This test parses the script's source text for its NS_* constant
 * definitions (rather than requiring the CJS script as a module, since the
 * constants are module-private and it self-executes as a CLI) and asserts
 * the assembled code for each equals the corresponding catalog constant.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ERROR_CODES } from '@yellow-plugins/domain';
import { describe, it, expect } from 'vitest';

const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'validate-flow-namespace.js');

// Maps each script-side constant name to the catalog constant it must match.
// Extend this table (and the paired script/catalog entries) together if a
// NAMESPACE_* code is ever added, renamed, or removed.
const EXPECTED_PAIRINGS: Array<{ scriptConst: string; catalogCode: string }> = [
  { scriptConst: 'NS_STALE_REFERENCE', catalogCode: ERROR_CODES.NAMESPACE_STALE_REFERENCE },
  {
    scriptConst: 'NS_ALLOWLIST_COUNT_DRIFT',
    catalogCode: ERROR_CODES.NAMESPACE_ALLOWLIST_COUNT_DRIFT,
  },
  {
    scriptConst: 'NS_ALLOWLIST_PATH_MISSING',
    catalogCode: ERROR_CODES.NAMESPACE_ALLOWLIST_PATH_MISSING,
  },
];

/**
 * Extracts the assembled `ERROR-NAMESPACE-NNN` string for a given
 * `const <name> = NS + '-NNN';` declaration in the script source, mirroring
 * the same concatenation the script performs at runtime.
 */
function extractAssembledCode(source: string, constName: string): string {
  const prefixMatch = source.match(/const NS = 'ERROR-' \+ 'NAMESPACE';/);
  if (!prefixMatch) {
    throw new Error(
      "validate-flow-namespace.js no longer defines `const NS = 'ERROR-' + 'NAMESPACE';` " +
        '— update this test to match the new assembly.'
    );
  }

  const suffixPattern = new RegExp(`const ${constName} = NS \\+ '(-\\d+)';`);
  const suffixMatch = source.match(suffixPattern);
  if (!suffixMatch) {
    throw new Error(
      `validate-flow-namespace.js no longer defines \`const ${constName} = NS + '-NNN';\` ` +
        '— update this test to match the new assembly.'
    );
  }

  return `ERROR-NAMESPACE${suffixMatch[1]}`;
}

describe('validate-flow-namespace.js error codes stay in sync with errorCatalog.ts', () => {
  const source = readFileSync(SCRIPT_PATH, 'utf8');

  it.each(EXPECTED_PAIRINGS)(
    '$scriptConst assembles the same code as its catalog constant',
    ({ scriptConst, catalogCode }) => {
      const assembled = extractAssembledCode(source, scriptConst);
      expect(assembled).toBe(catalogCode);
    }
  );

  it('the catalog defines no NAMESPACE_* code the script does not also assemble', () => {
    const catalogNamespaceCodes = Object.entries(ERROR_CODES)
      .filter(([name]) => name.startsWith('NAMESPACE_'))
      .map(([, code]) => code);

    const assembledCodes = EXPECTED_PAIRINGS.map((pair) => pair.catalogCode);

    expect(catalogNamespaceCodes.sort()).toEqual(assembledCodes.sort());
  });
});
