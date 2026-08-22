# yellow-cursor

## 0.2.0

### Minor Changes

- [#726](https://github.com/KingInYellows/yellow-plugins/pull/726)
  [`575f8cd`](https://github.com/KingInYellows/yellow-plugins/commit/575f8cd83ab3afc63174af8254029b7070957876)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Initial release
  of yellow-cursor: Cursor Cloud Agents integration built on an exact-pinned
  `@cursor/sdk@1.0.28` typed TypeScript runtime with a deterministic JSON CLI.
  Ten commands (`/cursor:setup`, `delegate`, `list`, `status`, `follow-up`,
  `cancel`, `artifacts`, `usage`, `archive`, `unarchive`) model Cursor's durable
  Agent and per-prompt Run as distinct entities, confirm before every billable
  launch, protect retries with HTTP-level idempotency keys plus local
  reservations and remote reconciliation, cap per-repository concurrency, deny
  nested delegation, redact credentials on every output path, and store only
  prompt digests in an atomic, symlink-safe local index. Permanent agent
  deletion is intentionally absent from the surface. yellow-cursor is also the
  first Cursor-native generated distribution pilot (`.cursor-plugin/` artifacts
  emitted from the neutral catalog).
