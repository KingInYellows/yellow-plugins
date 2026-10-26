#!/usr/bin/env node
'use strict';

// Checks a host-installed copy of yellow-thermonuclear-review: frontmatter
// normalised to name + description, the body byte-identical to the source
// skill, and the attribution and safety text present in what the host loaded.
// Usage: node check-installed-skill.js <installed SKILL.md>
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.resolve(
  __dirname,
  '../../../plugins/yellow-review/skills/yellow-thermonuclear-review/SKILL.md'
);
const MARKERS = [
  ['pinned upstream commit', '6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf'],
  ['upstream SKILL.md blob SHA', 'ac76a2bc88bb2d895e83ab1788aa584a82346cfc'],
  ['upstream agent blob SHA', 'dc83d959306c41bb9a4b504608d9607be34e4297'],
  ['MIT notice', 'MIT License'],
  ['MIT copyright line', 'Copyright (c) 2026 Cursor'],
  ['report-only rail', 'Report only. Never mutate the repository.'],
  [
    'fail-closed size rule',
    'absent, empty, or unparseable, emit no size-threshold findings',
  ],
];

function split(text) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error('No frontmatter');
  return { frontmatter: match[1], body: match[2] };
}

const file = process.argv[2];
if (!file) {
  process.stderr.write(
    'usage: check-installed-skill.js <installed SKILL.md>\n'
  );
  process.exit(2);
}
const installed = split(fs.readFileSync(file, 'utf8'));
const flat = installed.body.replace(/\s+/g, ' ');
const keys = installed.frontmatter
  .split('\n')
  .filter((line) => /^[A-Za-z_-]+:/.test(line))
  .map((line) => line.split(':')[0]);
const results = [
  [
    'frontmatter is name + description only',
    JSON.stringify(keys) === JSON.stringify(['name', 'description']),
  ],
  [
    'body identical to source skill',
    installed.body === split(fs.readFileSync(SOURCE, 'utf8')).body,
  ],
  ...MARKERS.map(([label, needle]) => [label, flat.includes(needle)]),
];
for (const [label, ok] of results) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}\n`);
}
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
