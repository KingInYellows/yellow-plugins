/**
 * Consumer pin for the yellow-goal engine. The blocking checks are the
 * runtime probes (`version --json` and `capabilities --json --protocol v2`
 * must report this exact engine version and the v2 protocol identity), not
 * the advisory registry pin linter. Bump only when a new engine tag has been
 * cut and verified: annotated tag, public GitHub Release asset, SHA-256, and
 * the blocking public-artifact compatibility job.
 *
 * `scripts/verify-goal-release.sh` and `tests/release-pin.test.ts` keep the
 * shell-side download/hash gate in agreement with these constants. This pin
 * is the already-published v0.3.0 asset (annotated tag peeled at
 * 2f336d548523f795fef95f43fb03d751c2d65b80). It is not a newer main commit.
 */
export const PINNED_ENGINE_VERSION = '0.3.0';
export const PINNED_ENGINE_TAG = 'v0.3.0';
export const PINNED_ENGINE_COMMIT =
  '2f336d548523f795fef95f43fb03d751c2d65b80';
export const PINNED_ENGINE_ASSET_NAME = 'goal-gen-0.3.0.tgz';
export const PINNED_ENGINE_ASSET_URL =
  'https://github.com/KingInYellows/yellow-goal/releases/download/v0.3.0/goal-gen-0.3.0.tgz';
export const PINNED_ENGINE_ASSET_SHA256 =
  '16e9d4b84f8b771ca1c368c886da70ef0d29c5e2af5ba68a51094c20f0a5db23';
