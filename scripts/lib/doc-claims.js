'use strict';

/**
 * Claim grounding for docs/solutions/ bodies. Node port of Compound
 * Engineering's skills/ce-compound/scripts/validate-doc-claims.py
 * (EveryInc/compound-engineering-plugin @ b405537), called by
 * scripts/validate-solutions.js on each new or modified live doc.
 *
 * Four checks on the body (frontmatter excluded):
 *   1. Backticked repo paths (tokens containing `/`) exist in the working
 *      tree. `../` tokens resolve from the doc's directory. A path missing
 *      now but tracked at HEAD or the base ref is "deleted" or "stale
 *      checkout"; one missing everywhere is an error when it is
 *      path-shaped. Placeholders (`<>{}*$`, `path/to`, `...`), git refs,
 *      URLs, home/absolute paths and slash identifiers are skipped.
 *   2. Hex words (7-40 chars with a digit and an a-f letter) resolve to
 *      commits. When the words right before one present it as a commit
 *      (COMMIT_WORDS, a CITATION_VERBS + CITATION_PREPS pair, or this
 *      repo's `owner/repo@<sha>` pin) an unresolved one is an error;
 *      otherwise it is a note, since content hashes and session ids are
 *      hex too. A pin naming another repo (or any pin when `origin` is
 *      unknown) is never checked here.
 *   3. Relative markdown links resolve from the doc's location.
 *   4. Leftover drafting scaffold: bare `{{...}}` tokens (error) and
 *      "Learning N" numbering (warning). Code spans and fences are masked
 *      first so documented template syntax is not flagged.
 *
 * Escape hatch: a finding whose source line contains `(historical)` is
 * reported as a warning instead of an error, for citations the documented
 * fix itself removed.
 *
 * The module never touches the network; classification uses local refs. In
 * a shallow clone an unresolved commit is only a warning, since history is
 * missing rather than the commit.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLACEHOLDER_CHARS = /[<>{}*$]/;
const PLACEHOLDER_SUBSTRINGS = ['path/to', '...', '…'];
const SHA_RE = /\b[0-9a-f]{7,40}\b/g;
const COMMIT_WORDS = new Set(
  (
    'commit commits committed committing revision revisions rev revs ' +
    'revert reverts reverted cherry-pick cherry-picked rebase rebased ' +
    'bisect bisected'
  ).split(' ')
);
const CITATION_VERBS = new Set(
  (
    'fixed fix fixes landed lands land introduced introduces introduce ' +
    'shipped ships ship merged merges merge resolved resolves resolve ' +
    'reverted reverts broke breaks broken caused causes regressed ' +
    'added adds removed removes released releases'
  ).split(' ')
);
const CITATION_PREPS = new Set(['in', 'by', 'at', 'with']);
const REPO_PIN_RE = /(?<![\w./@-])([\w.-]+)\/([\w.-]+)@$/;
const BACKTICK_RE = /`([^`\n]+)`/g;
// An optional link title (`"..."`, `'...'` or `(...)`) may follow the target.
const MD_LINK_RE =
  /\[[^\]]*\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const HISTORICAL_MARK = '(historical)';

function git(args, cwd) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30000,
    });
    return { ok: true, out: out.trim() };
  } catch {
    return { ok: false, out: '' };
  }
}

// Return { body, bodyStart } with YAML frontmatter removed. bodyStart is the
// 1-indexed file line the body starts on.
function splitBody(text) {
  const lines = text.split('\n');
  if (lines.length && lines[0].trimEnd() === '---') {
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trimEnd() === '---') {
        return { body: lines.slice(i + 1).join('\n'), bodyStart: i + 2 };
      }
    }
  }
  return { body: text, bodyStart: 1 };
}

function normalizePath(token) {
  let t = token.trim().replace(/[.,;]+$/, '');
  t = t.replace(/:\d+([-–]\d+)?$/, '');
  if (t.startsWith('./')) t = t.slice(2);
  return t;
}

function isPathCandidate(token) {
  if (/\s/.test(token)) return false;
  if (!token.includes('/')) return false;
  if (token.includes('://')) return false;
  if (/^(http|#|\/|~|@)/.test(token)) return false; // URLs, abs, npm scopes
  if (token.includes('//')) return false; // sed expressions, protocol-less URLs
  if (/^(origin|upstream|refs)\//.test(token)) return false;
  if (PLACEHOLDER_CHARS.test(token)) return false;
  if (PLACEHOLDER_SUBSTRINGS.some((s) => token.includes(s))) return false;
  return true;
}

// Tell a path citation from a slash-delimited identifier (branch name,
// provider/model id) among tokens found nowhere in git.
function isPathShaped(token, repoRoot) {
  const segments = token.split('/');
  const last = segments[segments.length - 1];
  if (/^v?\d+(\.\d+)+$/.test(last)) return false; // name/1.2.3 version pin
  if (/\.[A-Za-z0-9]{1,8}$/.test(last)) return true;
  if (token.endsWith('/') && segments.length > 2) return true;
  try {
    return fs.statSync(path.join(repoRoot, segments[0])).isDirectory();
  } catch {
    return false;
  }
}

// A missing path under a dot-directory (`.git/...`, `.claude/agents/`) is a
// runtime or machine-local location, not a repo citation.
function isRuntimePath(rel) {
  return rel.split('/')[0].startsWith('.');
}

// Blank fenced blocks and inline code spans, keeping line count and length.
// Blank fenced blocks, and inline code spans unless `inline` is false.
function maskCode(lines, { inline = true } = {}) {
  const masked = [];
  let fence = null;
  for (const line of lines) {
    const m = line.match(FENCE_RE);
    if (fence === null && m) {
      fence = m[1];
      masked.push(' '.repeat(line.length));
      continue;
    }
    if (fence !== null) {
      if (
        m &&
        m[1][0] === fence[0] &&
        m[1].length >= fence.length &&
        !m[2].trim()
      ) {
        fence = null;
      }
      masked.push(' '.repeat(line.length));
      continue;
    }
    masked.push(
      inline ? line.replace(BACKTICK_RE, (x) => ' '.repeat(x.length)) : line
    );
  }
  return masked;
}

// Classify the text right before a hex word on the same line.
// Returns 'commit', 'external-pin', or null.
function commitCue(prefix, thisRepo) {
  // A hex word inside a URL: checkable only when the URL names this repo.
  const lastToken = prefix.split(/\s+/).pop() || '';
  if (lastToken.includes('://')) {
    const url = lastToken.match(
      /github\.com\/([\w.-]+)\/([\w.-]+)\/commits?\/$/i
    );
    if (!url) return 'external-pin';
    const named = `${url[1]}/${url[2]}`.toLowerCase();
    return thisRepo && named === thisRepo ? 'commit' : 'external-pin';
  }
  const pin = prefix.match(REPO_PIN_RE);
  if (pin) {
    const named = `${pin[1]}/${pin[2]}`.toLowerCase();
    // Only a pin naming this repo (per `origin`) is checkable here.
    return thisRepo && named === thisRepo ? 'commit' : 'external-pin';
  }
  const unflagged = prefix
    .split(/\s+/)
    .filter((w) => !w.startsWith('-'))
    .join(' ');
  const words = (unflagged.match(/[A-Za-z][A-Za-z0-9-]*/g) || [])
    .slice(-3)
    .map((w) => w.toLowerCase());
  if (words.some((w) => COMMIT_WORDS.has(w))) return 'commit';
  if (
    words.length >= 2 &&
    CITATION_PREPS.has(words[words.length - 1]) &&
    CITATION_VERBS.has(words[words.length - 2])
  ) {
    return 'commit';
  }
  return null;
}

function repoSlug(repoRoot) {
  const { ok, out } = git(['remote', 'get-url', 'origin'], repoRoot);
  if (!ok) return null;
  const m = out.match(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/**
 * Check one doc's body.
 *
 * @param {object} opts
 * @param {string} opts.text      full file text
 * @param {string} opts.docPath   absolute path of the doc
 * @param {string} opts.repoRoot  absolute repo root paths resolve against
 * @param {string} [opts.baseRef] upstream ref for classification
 * @param {string} [opts.baselineText] the doc at the diff base, when it
 *   existed there; errors on citations already in it become warnings
 * @returns {{errors: string[], warnings: string[], notes: string[]}}
 */
function checkDocClaims({ text, docPath, repoRoot, baseRef, baselineText }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const docDir = path.dirname(docPath);
  const { body, bodyStart } = splitBody(text);
  const bodyLines = body.split('\n');

  // Prefer an occurrence not marked (historical), so one marked mention
  // does not excuse a later live one of the same citation.
  const lineOf = (needle) => {
    const live = bodyLines.findIndex(
      (l) => l.includes(needle) && !l.includes(HISTORICAL_MARK)
    );
    if (live !== -1) return live;
    const i = bodyLines.findIndex((l) => l.includes(needle));
    return i === -1 ? null : i;
  };
  // A baseline match must be the whole citation, not a fragment of a longer
  // one: `README.md` inside `../../../README.md` does not count.
  const inBaseline = (needle) => {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w./-])${esc}($|[^\\w./-])`).test(baselineText);
  };
  // `needle` is the cited text. On a modified doc, an error whose needle
  // already appeared in the base version is pre-existing debt: report it as
  // a warning so amending an old doc does not require fixing all of it.
  const report = (lineIdx, severity, msg, needle) => {
    const loc = lineIdx === null ? '' : ` (line ${bodyStart + lineIdx})`;
    const historical =
      lineIdx !== null && bodyLines[lineIdx].includes(HISTORICAL_MARK);
    const preExisting =
      typeof baselineText === 'string' &&
      typeof needle === 'string' &&
      inBaseline(needle);
    let full = msg.replace('{loc}', loc);
    if (severity === 'error' && preExisting && !historical) {
      full += ' (pre-existing in the base version)';
    }
    if (severity === 'error' && !historical && !preExisting) errors.push(full);
    else if (severity === 'note') notes.push(full);
    else warnings.push(full);
  };

  const inGit = git(['rev-parse', '--show-toplevel'], repoRoot).ok;
  let upstream = null;
  let shallow = false;
  let thisRepo = null;
  if (inGit) {
    for (const cand of [baseRef, 'origin/main', 'origin/master']) {
      if (
        cand &&
        git(['rev-parse', '--verify', '--quiet', cand], repoRoot).ok
      ) {
        upstream = cand;
        break;
      }
    }
    shallow =
      git(['rev-parse', '--is-shallow-repository'], repoRoot).out === 'true';
    thisRepo = repoSlug(repoRoot);
  }
  const tracked = (ref, rel) =>
    inGit &&
    ref !== null &&
    git(['cat-file', '-e', `${ref}:${rel}`], repoRoot).ok;

  // Tracked file list, loaded once, for plugin- or skill-relative citations
  // such as `lib/foo.sh` or `skills/` written from inside a plugin.
  let trackedFiles = null;
  const suffixTracked = (rel) => {
    if (!inGit) return false;
    if (trackedFiles === null) {
      const { ok, out } = git(['ls-files'], repoRoot);
      trackedFiles = ok ? out.split('\n') : [];
    }
    const needle = `/${rel.replace(/\/$/, '')}`;
    return trackedFiles.some(
      (f) => f.endsWith(needle) || f.includes(`${needle}/`)
    );
  };
  const everTracked = (rel) =>
    inGit &&
    git(['log', '--all', '-1', '--format=%h', '--', rel], repoRoot).out !== '';

  // 1. Cited repo paths.
  const seenPaths = new Set();
  // Fenced blocks are examples; inline spans outside them are citations.
  const fenceMasked = maskCode(bodyLines, { inline: false }).join('\n');
  const lineAt = (offset) =>
    fenceMasked.slice(0, offset).split('\n').length - 1;
  for (const m of fenceMasked.matchAll(BACKTICK_RE)) {
    const raw = m[1];
    const token = normalizePath(raw);
    if (!isPathCandidate(token)) continue;
    let check = token;
    if (token.startsWith('../') || token.includes('/../')) {
      const rel = path.relative(repoRoot, path.resolve(docDir, token));
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      check = rel.split(path.sep).join('/');
    }
    if (seenPaths.has(check)) continue;
    seenPaths.add(check);
    if (fs.existsSync(path.join(repoRoot, check))) continue;
    if (isRuntimePath(check)) continue;
    if (suffixTracked(check)) continue; // plugin- or skill-relative citation
    const atHead = tracked('HEAD', check);
    const atUpstream = tracked(upstream, check);
    if (!atHead && !atUpstream && !isPathShaped(check, repoRoot)) continue;
    const inHistory = !atHead && !atUpstream && everTracked(check);
    const idx = lineOf(`\`${raw}\``);
    if (atHead) {
      report(
        idx,
        'warning',
        `path \`${token}\`{loc} is tracked at HEAD but missing from the ` +
          'working tree (deleted or uncommitted removal?)'
      );
    } else if (atUpstream) {
      report(
        idx,
        'warning',
        `path \`${token}\`{loc} is missing here but exists at ${upstream} ` +
          '(stale checkout?)'
      );
    } else if (inHistory) {
      report(
        idx,
        'warning',
        `path \`${token}\`{loc} existed in git history but is gone now ` +
          '(deleted or renamed?)'
      );
    } else {
      report(
        idx,
        'error',
        `path \`${token}\`{loc} does not exist in the repo` +
          (upstream ? ` or at ${upstream}` : '') +
          '. Fix the citation, or mark the line (historical) if the fix ' +
          'removed it',
        raw
      );
    }
  }

  // 2. Cited commit SHAs.
  if (inGit) {
    const seen = new Map();
    // Fenced blocks hold examples and fixtures, not citations; inline code
    // spans stay, since `abc1234` is a common way to cite a commit.
    for (const m of fenceMasked.matchAll(SHA_RE)) {
      const sha = m[0];
      if (!/\d/.test(sha) || !/[a-f]/.test(sha)) continue;
      const lineStart = body.lastIndexOf('\n', m.index - 1) + 1;
      const cue = commitCue(body.slice(lineStart, m.index), thisRepo);
      const lineIdx = body.slice(0, m.index).split('\n').length - 1;
      const prev = seen.get(sha);
      // Prefer a commit cue, then an occurrence not marked (historical).
      const live = !bodyLines[lineIdx].includes(HISTORICAL_MARK);
      const rank = (cue === 'commit' ? 2 : 0) + (live ? 1 : 0);
      if (!prev || rank > prev.rank) {
        seen.set(sha, { lineIdx, cue, rank });
      }
    }
    for (const [sha, { lineIdx, cue }] of seen) {
      if (cue === 'external-pin') continue;
      const resolves = git(['cat-file', '-e', `${sha}^{commit}`], repoRoot).ok;
      if (!resolves) {
        if (cue !== 'commit') {
          report(
            lineIdx,
            'note',
            `hex ${sha}{loc} does not resolve to a commit; fine for a ` +
              'content hash or session id'
          );
        } else {
          report(
            lineIdx,
            shallow ? 'warning' : 'error',
            `commit ${sha}{loc} does not resolve in this repository` +
              (shallow ? ' (shallow clone, history incomplete)' : '') +
              '. Cite the PR number instead, or drop it',
            sha
          );
        }
        continue;
      }
      const inHead = git(
        ['merge-base', '--is-ancestor', sha, 'HEAD'],
        repoRoot
      ).ok;
      const inUp =
        upstream !== null &&
        git(['merge-base', '--is-ancestor', sha, upstream], repoRoot).ok;
      if (inHead && (inUp || upstream === null)) continue;
      if (inHead) {
        report(
          lineIdx,
          'warning',
          `commit ${sha}{loc} is not on ${upstream} yet; a squash merge ` +
            'rewrites it, so prefer the PR number'
        );
      } else if (!inUp) {
        report(
          lineIdx,
          'warning',
          `commit ${sha}{loc} exists but is unreachable from HEAD` +
            (upstream ? ` and ${upstream}` : '') +
            ' (rebased away?); prefer the PR number'
        );
      }
    }
  }

  // 3. Relative and root-relative markdown links.
  const seenLinks = new Set();
  // Code spans and fences are masked so `handlers[type](event)` is not a link.
  for (const m of maskCode(bodyLines).join('\n').matchAll(MD_LINK_RE)) {
    const target = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    let bare = target.split('#')[0];
    try {
      bare = decodeURIComponent(bare);
    } catch {
      // Malformed escape: check the literal spelling.
    }
    if (!bare || seenLinks.has(bare)) continue;
    if (PLACEHOLDER_CHARS.test(bare)) continue;
    if (PLACEHOLDER_SUBSTRINGS.some((x) => bare.includes(x))) continue;
    // A (historical) occurrence does not stand in for later live ones.
    if (!bodyLines[lineAt(m.index)].includes(HISTORICAL_MARK)) {
      seenLinks.add(bare);
    }
    // GitHub resolves a leading-slash link from the repo root.
    const resolved = bare.startsWith('/')
      ? path.join(repoRoot, bare)
      : path.resolve(docDir, bare);
    if (fs.existsSync(resolved)) continue;
    const rel = path.relative(repoRoot, resolved).split(path.sep).join('/');
    const archived = rel.replace(
      /^docs\/solutions\/(?!archived\/)/,
      'docs/solutions/archived/'
    );
    const softMiss =
      (archived !== rel && fs.existsSync(path.join(repoRoot, archived))) ||
      (!rel.startsWith('..') &&
        (tracked('HEAD', rel) || tracked(upstream, rel)));
    report(
      lineAt(m.index),
      softMiss ? 'warning' : 'error',
      `link (${target}){loc} does not resolve from the doc's location` +
        (softMiss ? ' (target archived or deleted)' : ''),
      target
    );
  }

  // 4. Leftover drafting scaffold.
  maskCode(bodyLines).forEach((line, i) => {
    const placeholder = line.match(/\{\{[^}\n]*\}\}/);
    if (placeholder) {
      report(
        i,
        'error',
        `scaffold "${placeholder[0]}"{loc} is a leftover drafting ` +
          'placeholder; replace it with real content',
        placeholder[0]
      );
    }
    const numbering = line.match(/\bLearnings?\s+#?\d/);
    if (numbering) {
      report(
        i,
        'warning',
        `scaffold "${numbering[0]}"{loc} looks like drafting-context ` +
          'numbering; rewrite it as a path or link'
      );
    }
  });

  return { errors, warnings, notes };
}

module.exports = { checkDocClaims, commitCue, maskCode, splitBody };
