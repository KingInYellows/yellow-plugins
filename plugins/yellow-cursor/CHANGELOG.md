# yellow-cursor

## 0.2.2

### Patch Changes

- [`e239b34`](https://github.com/KingInYellows/yellow-plugins/commit/e239b3462d7c65e866d87dc27197b0167dc0e0d7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Rename the
  skill frontmatter key `user-invokable` to `user-invocable` in every SKILL.md.
  Claude Code (verified against 2.1.259) parses only `user-invocable`; the `k`
  spelling this repo standardised on was silently ignored, so every internal
  skill declared `user-invokable: false` still appeared in the `/` menu. The
  validator gains RULE 20 (error tier) rejecting the old key so it cannot creep
  back through stale templates.

## 0.2.1

### Patch Changes

- [#729](https://github.com/KingInYellows/yellow-plugins/pull/729)
  [`828e5c7`](https://github.com/KingInYellows/yellow-plugins/commit/828e5c741289c685e268d35082af6f7a7afd4faf)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix three
  defects in the Cursor delegation surface that survived onto `main`.

  `delegate`'s `--max-active` cap could be exceeded: the active-agent sweep
  stopped after a fixed page bound and returned the partial count as if it were
  the total, so an account with more pages of cloud agents silently undercounted
  and a billable launch was authorized past the configured cap. The sweep now
  fails closed with `CURSOR_CONCURRENCY_LIMIT` when the listing is still
  paginating at the bound. Archived agents remain **in** the concurrency count
  whenever their status is still `running`: `/cursor:archive --force` archives
  an agent without cancelling its run, so force-archiving hides an agent from
  the default listing but never frees a `--max-active` slot. Only the agent's
  status gates the count, so archived-and-finished agents cost nothing.

  `/cursor:archive` did not actually hide anything: the adapter always requested
  archived agents, so they stayed in `/cursor:list` despite the archive and
  unarchive command contracts promising the opposite. Archived visibility is now
  caller-driven — excluded from the default listing only, and included both for
  canonical-id reconciliation (which must still find an agent archived between
  `send()` and the sweep) and for the concurrency sweep described above — and
  opt-in via `/cursor:list --archived`.

  `/linear:delegate`'s launch step consumed shell variables assigned in earlier
  Bash calls, which do not persist, and derived `CURSOR_REPO_URL` after the
  block that used it. The derivation now precedes the launch and every required
  value is asserted non-empty first, so a missing plugin root or empty
  delegation packet fails loudly instead of launching a billable agent with no
  instructions.

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
