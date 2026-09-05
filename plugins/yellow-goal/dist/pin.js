"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PINNED_ENGINE_ASSET_SHA256 = exports.PINNED_ENGINE_ASSET_URL = exports.PINNED_ENGINE_ASSET_NAME = exports.PINNED_ENGINE_COMMIT = exports.PINNED_ENGINE_TAG = exports.PINNED_ENGINE_VERSION = void 0;
/**
 * Consumer pin for the yellow-goal engine. The blocking checks are the
 * runtime probes (`version --json` and `capabilities --json` must report
 * this exact engine version and the v1 protocol identity), not the advisory
 * registry pin linter. Bump only when a new engine tag has been cut and
 * verified: annotated tag, public GitHub Release asset, SHA-256, and the
 * blocking public-artifact compatibility job.
 *
 * `scripts/verify-goal-release.sh` and `tests/release-pin.test.ts` keep the
 * shell-side download/hash gate in agreement with these constants.
 */
exports.PINNED_ENGINE_VERSION = '0.2.0';
exports.PINNED_ENGINE_TAG = 'v0.2.0';
exports.PINNED_ENGINE_COMMIT = '09bcd16cd25ec249e3248d3ce7dcb4536a0d348e';
exports.PINNED_ENGINE_ASSET_NAME = 'goal-gen-0.2.0.tgz';
exports.PINNED_ENGINE_ASSET_URL = 'https://github.com/KingInYellows/yellow-goal/releases/download/v0.2.0/goal-gen-0.2.0.tgz';
exports.PINNED_ENGINE_ASSET_SHA256 = '7ad266b22603007552b582b83349464cc67f4976eca63bf4db56ffacc4e1663a';
