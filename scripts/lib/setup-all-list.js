'use strict';

// The /setup:all delegated-command list: the entry points
// plugins/yellow-core/commands/setup/all.md dispatches through the Skill
// tool, one numbered backticked name per line between the two markers.

const DELEGATED_START = '<!-- setup-all-delegated-commands:start -->';
const DELEGATED_END = '<!-- setup-all-delegated-commands:end -->';

function extractMarkedSection(markdown, startMarker, endMarker) {
  const start = markdown.indexOf(startMarker);
  if (start === -1) return null;
  const end = markdown.indexOf(endMarker, start + startMarker.length);
  if (end === -1) return null;
  return markdown.slice(start + startMarker.length, end);
}

function parseDelegatedCommands(section) {
  const commands = [];
  for (const match of section.matchAll(/^\d+\.\s+`([^`]+)`$/gm)) {
    commands.push(match[1]);
  }
  return commands;
}

module.exports = {
  DELEGATED_START,
  DELEGATED_END,
  extractMarkedSection,
  parseDelegatedCommands,
};
