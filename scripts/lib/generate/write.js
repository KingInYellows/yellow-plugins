'use strict';

/**
 * Shared write helpers for the manifest generation pipeline.
 *
 * `assertWithinRoot` and `atomicWrite` are lifted verbatim from
 * scripts/sync-manifests.js (sync-manifests.js now imports `assertWithinRoot`
 * from here; scripts/catalog-version.js imports `atomicWrite`) so the
 * traversal guard and the tmp-file + rename write path are defined once. The
 * `[sync-manifests]` prefix in the traversal error is preserved as-is — it
 * is part of sync-manifests.js's observable error wording.
 *
 * `serializeJson` is the single serialization contract for every generated
 * manifest: 2-space indent + trailing newline — exactly the bytes the
 * committed artifacts carry (R8).
 *
 * `NAME_RE` is the plugin-name allowlist for consumers that derive
 * filesystem paths from plugin names — it is the path-traversal guard.
 * New code should import it rather than redeclare the literal (a few
 * pre-existing scripts still carry their own copies).
 */

const { writeFileSync, renameSync, unlinkSync } = require('fs');
const { resolve, sep } = require('path');

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

function assertWithinRoot(filePath, rootDir) {
  const canonical = resolve(filePath);
  const rootCanonical = resolve(rootDir);
  if (canonical !== rootCanonical && !canonical.startsWith(rootCanonical + sep)) {
    throw new Error(`[sync-manifests] Path traversal detected: ${filePath}`);
  }
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  // `wx` (O_CREAT|O_EXCL): never write THROUGH a pre-existing `.tmp`
  // entry — a planted `plugin.json.tmp -> /elsewhere` symlink would
  // otherwise receive the bytes (and O_EXCL refuses a dangling link too).
  // A leftover from an interrupted run is unlinked (the entry itself,
  // never a target) and the create retried once.
  try {
    writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw new Error(`[atomicWrite] create ${tmp} failed: ${e.message}`);
    try {
      unlinkSync(tmp); // EISDIR/EPERM when the leftover is a directory: reported, never recursed into
      writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
    } catch (retryErr) {
      throw new Error(`[atomicWrite] ${tmp} already exists and could not be replaced: ${retryErr.message}`);
    }
  }
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

module.exports = { assertWithinRoot, atomicWrite, serializeJson, NAME_RE };
