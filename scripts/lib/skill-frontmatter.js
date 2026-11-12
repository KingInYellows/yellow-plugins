'use strict';

/**
 * Whether a SKILL.md can be typed and dispatched by name. Claude Code treats
 * a skill as user-invocable unless its frontmatter sets `user-invocable` to
 * false. Only the frontmatter block is read: a skill body may quote the key
 * in an example.
 */
function isUserInvocableSkill(text) {
  const frontmatter =
    (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  const line = frontmatter.match(/^user-invocable:[ \t]*(.*)$/m);
  if (!line) return true;
  const value = line[1]
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .toLowerCase();
  return value !== 'false';
}

module.exports = { isUserInvocableSkill };
