'use strict';

/**
 * Shared write helpers for the manifest generation pipeline.
 *
 * `assertWithinRoot` and `atomicWrite` are lifted verbatim from
 * scripts/sync-manifests.js (which now imports them from here, as does
 * scripts/catalog-version.js) so the traversal guard and the tmp-file +
 * rename write path are defined once. The `[sync-manifests]` prefix in the
 * traversal error is preserved as-is — it is part of sync-manifests.js's
 * observable error wording.
 *
 * `serializeJson` is the single serialization contract for every generated
 * manifest: 2-space indent + trailing newline — exactly the bytes the
 * committed artifacts carry (R8).
 */

const { writeFileSync, renameSync, unlinkSync } = require('fs');
const { resolve, sep } = require('path');

function assertWithinRoot(filePath, rootDir) {
  const canonical = resolve(filePath);
  const rootCanonical = resolve(rootDir);
  if (canonical !== rootCanonical && !canonical.startsWith(rootCanonical + sep)) {
    throw new Error(`[sync-manifests] Path traversal detected: ${filePath}`);
  }
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, filePath); // atomic on Linux when on same filesystem
  } catch (e) {
    try { unlinkSync(tmp); } catch (_) { /* ignore cleanup errors */ }
    throw new Error(`[atomicWrite] rename ${tmp} -> ${filePath} failed: ${e.message}`);
  }
}

function serializeJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

module.exports = { assertWithinRoot, atomicWrite, serializeJson };
