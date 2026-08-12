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

/**
 * Scans the script source for every `const NS_<NAME> = NS + '-NNN';`
 * declaration (not just the ones {@link EXPECTED_PAIRINGS} already knows
 * about) and returns the assembled `ERROR-NAMESPACE-NNN` code for each. This
 * is what lets the "no orphan" assertion below catch a script-side NS_*
 * constant that was added without a paired catalog entry — the it.each
 * table above only re-checks constants someone already remembered to list.
 */
function extractAllAssembledCodes(source: string): string[] {
  const constRe = /const (NS_[A-Z0-9_]+) = NS \+ '(-\d+)';/g;
  const codes: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = constRe.exec(source)) !== null) {
    codes.push(`ERROR-NAMESPACE${match[2]}`);
  }
  return codes;
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

  it("the script assembles exactly the catalog's NAMESPACE_* codes, no more and no fewer", () => {
    const catalogNamespaceCodes = Object.entries(ERROR_CODES)
      .filter(([name]) => name.startsWith('NAMESPACE_'))
      .map(([, code]) => code);

    const scriptAssembledCodes = extractAllAssembledCodes(source);

    expect(
      scriptAssembledCodes.sort(),
      `script NS_* constants assemble to ${JSON.stringify(scriptAssembledCodes.sort())}, ` +
        `catalog NAMESPACE_* codes are ${JSON.stringify(catalogNamespaceCodes.sort())} — ` +
        'the two sets must be identical'
    ).toEqual(catalogNamespaceCodes.sort());
  });

  it('EXPECTED_PAIRINGS covers every catalog NAMESPACE_* code', () => {
    // extractAllAssembledCodes above proves the script and catalog agree as
    // sets, but it.each only re-verifies constants someone already listed in
    // EXPECTED_PAIRINGS. Without this assertion, that table could shrink to
    // a single stale entry — losing per-pairing failure messages for the
    // rest — and nothing would fail, because the set-equality check above
    // never reads EXPECTED_PAIRINGS at all.
    const catalogNamespaceCodes = Object.entries(ERROR_CODES)
      .filter(([name]) => name.startsWith('NAMESPACE_'))
      .map(([, code]) => code);
    const tabledCodes = EXPECTED_PAIRINGS.map((pair) => pair.catalogCode);

    expect(
      tabledCodes.sort(),
      `EXPECTED_PAIRINGS is missing catalog code(s): ${JSON.stringify(
        catalogNamespaceCodes.filter((code) => !tabledCodes.includes(code))
      )} — add the corresponding { scriptConst, catalogCode } entry`
    ).toEqual(catalogNamespaceCodes.sort());
  });
});
