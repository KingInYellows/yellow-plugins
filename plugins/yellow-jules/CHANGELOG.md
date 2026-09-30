# yellow-jules

## 0.2.0

### Minor Changes

- [`dab83f3`](https://github.com/KingInYellows/yellow-plugins/commit/dab83f3d724ea89bde1e86117ffbcbe324487a58)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Initial release
  of yellow-jules (experimental): Google Jules as the third member of the
  `remote-agent` capability group, built on an exact-pinned
  `@google/jules-sdk@0.2.0` typed runtime with a one-line JSON CLI. This release
  is read-only — `/jules:setup`, `/jules:list`, `/jules:status`, and
  `/jules:collect` observe sessions and stage patches, generated files, and pull
  request references under the plugin data directory without touching any
  checkout. The SDK installs only with consent, via `npm ci --ignore-scripts`
  from a shipped lockfile, and is re-verified on every load; requests are pinned
  to the vendor origin with redirects refused; the local journal fails loud on
  corruption and stale locks; every output path is redacted.
