/**
 * Consumer pin for the yellow-goal engine. The blocking check is the
 * setup probe (engineVersion must equal this string), not the advisory
 * registry pin linter. Bump only when cutting a new engine tag and
 * after a tarball install-smoke against that tag.
 */
export const PINNED_ENGINE_VERSION = '0.1.0';
