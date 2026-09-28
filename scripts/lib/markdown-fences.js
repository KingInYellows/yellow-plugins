'use strict';

/**
 * Fenced code block scanners shared by validate-agent-authoring.js and the
 * shell-compat checks (validate-shell-compat.js, check-shell-parse.js).
 *
 * Two readings of the same markdown, deliberately separate:
 *   - CommonMark (`scanFences`, with `stripFencedContent` and
 *     `extractFencedBlocks` as views over it): what a renderer shows. The
 *     authoring validator strips these fences so illustrative examples never
 *     trip its prose rules.
 *   - Raw reader (`extractRawFencedBlocks`): what Claude sees when it reads
 *     the file as text and runs a ```bash block. The shell-compat checks
 *     lint what runs, so they use this one.
 */

// Implemented as a line scan rather than a single multiline regex: the lazy
// [\s\S]*? close-fence search was measurably quadratic on files with many
// near-miss fence-marker lines, and this helper now runs on every markdown
// file, not just SKILL.md.
//
// THE MODEL (4th rewrite of this helper — read this before changing it):
// each line is modeled as (blockquote depth, list content column, content),
// where "content" is the line with ONLY its verified `>` block-quote prefix
// removed — never its indentation, which is load-bearing data, not noise:
//
//   - blockquote depth is the count of `>` markers a line's prefix carries
//     (unchanged from earlier rounds).
//   - list content column is the indentation continuation lines of the
//     current innermost list item must reach to still belong to it — e.g.
//     for a line starting `- `, that's column 2. A stack of active columns
//     is maintained as lines are scanned: a marker line pushes a new
//     column, and any line (blank lines excepted — see below) whose
//     indentation falls short of the top of the stack pops it, and
//     everything shallower, back to whichever list item it still belongs
//     to (or none).
//
// A fence OPENS only when, relative to the active list content column
// (0 outside any list), the marker sits at 0-3 extra spaces of indent — the
// same CommonMark tolerance as before, just measured from the container's
// content column instead of from column 0. 4+ spaces past that column is an
// INDENTED CODE BLOCK, not a fence opener, and is left as ordinary content
// (scanned normally, not hidden) — this is finding 1 from the 4th review
// round: the previous version stripped a line's indentation unconditionally
// before checking, so a 4-space-indented fence-looking line at top level was
// misread as a valid (0-indent) opener, which could truncate everything
// after it as "unclosed fence" content and hide a live dispatch past it.
//
// A candidate BACKTICK marker only opens a fence if its info string (the
// rest of the line after the marker run) contains no backtick — per
// CommonMark, a backtick-fence info string cannot itself contain a
// backtick (there is no such restriction for tilde fences). This is finding
// 3 from the 5th review round: a line like ```` ```lang`suffix ```` was
// being treated as a valid opener even though CommonMark does not read it
// as a fence at all, so an absent closer let the EOF "unclosed fence"
// truncation (below) discard a live dispatch that followed it. A rejected
// candidate is left as ordinary content, scanned normally — the same
// "scan more, not less" bias as the indented-code-block case above.
//
// A fence CLOSES on any of:
//   - a matching marker (same char, length >= opener) at the same
//     blockquote depth as the opener, indented at or within the same 0-3
//     space tolerance past the opener's list content column (the same
//     tolerance OPEN uses — a closer isn't required to line up EXACTLY with
//     the opener's column, only to still be within it);
//   - blockquote depth dropping below the opener's — per CommonMark a block
//     quote ends at the first line lacking its `>` marker (a truly blank
//     line has none, so it ends the quote; lazy continuation only applies
//     to paragraph text) and the quote ending also ends any fence scoped
//     inside it, closer or no closer;
//   - the list content column active at fence-open time no longer being
//     reachable — i.e. a later NON-BLANK line's indentation falls short of
//     it, meaning the list item (or block within it) that contained the
//     fence has ended. This is finding 2 from the 4th round: the earlier
//     version tracked blockquote depth only, so an unclosed fence nested in
//     a list item stayed "open" through EOF even after the surrounding
//     prose plainly outdented back to top level, truncating a live dispatch
//     that followed.
//   - EOF, per CommonMark's "unterminated fence runs to end of document".
//
// Blank lines never end a list item on their own (loose lists tolerate a
// blank line between an item's blocks), so they don't trigger the
// list-column pop/close check — only a subsequent non-blank, under-indented
// line does. Blank lines DO still end a block quote (no `>` marker to
// carry), matching CommonMark and unchanged from earlier rounds. Content
// inside a fence is never re-parsed as a list marker or examined for a new
// column — it's literal.
//
// When a container ends mid-fence, the line that ended it is treated as
// plain content, deliberately NOT re-examined as a potential new fence
// opener even if it happens to be fence-shaped itself (same conservative
// choice earlier rounds made for the blockquote case, now extended to
// lists): a legitimately reopened fence landing exactly on a container
// boundary is scanned as prose instead of being re-hidden. Between the two
// failure modes — treating closed prose as still-hidden fence content (which
// can swallow a real, live broken dispatch) vs. treating truly-fenced text
// as prose (a rare false positive a human review catches instantly) — this
// helper always picks the side that scans more, not less: a false positive
// is cheap, a swallowed finding is not.
//
// Honest limits: this is a normalization heuristic, not a full CommonMark
// block parser. List content columns are computed from a single regex pass
// per marker line (`-`, `*`, `+`, or `N.`/`N)` followed by whitespace) and
// do not implement CommonMark's full list-item-start algorithm (tab
// expansion, lazy continuation inside paragraphs, etc.) — it is accurate for
// the straightforward single- and nested-bullet Markdown this repo's docs
// actually use, not adversarial or exotic list constructs.
//
// KNOWN LIMIT, measured rather than assumed: a block quote opening directly
// on a list-marker line (`- > ```text`) is not recognized as a container, so
// a fenced example inside it is scanned as live prose and reported. That is
// the FALSE-POSITIVE direction — a human sees the error immediately and the
// example is inert — which is the side this helper deliberately errs toward.
// The reverse was checked too: quoted lists followed by indented-code
// look-alikes, four-space-indented list markers, and nested-list fences all
// still report a live dispatch correctly, so no broken dispatch is hidden by
// this gap. Fixing it means splitting a block-quote prefix out of list
// content and threading a second depth through the fence state, which has
// more regression surface than the false positive costs.
const fenceOpenerRe = /^[ \t]{0,3}(`{3,}|~{3,})/;
// `{0,3}`, not `*`: a block-quote marker may carry at most three leading
// spaces. At four the line is an indented code block and the `>` is literal
// content, so `    > ```text` must NOT be read as a depth-1 quote wrapping a
// fence opener — doing so hid every following quoted line as fence content
// through EOF and let a broken dispatch evade RULE 18. Matches the same
// three-space bound `fenceOpenerRe` above already applies.
const blockquotePrefixRe = /^(?:[ \t]{0,3}>[ \t]?)*/;
// A list-item marker at the very start of `rest` (already blockquote-
// stripped): `-`/`*`/`+`, or `N.`/`N)`, followed by whitespace or EOL.
const listMarkerRe = /^([ \t]*)([-*+]|\d+[.)])([ \t]+|$)/;

function splitBlockquotePrefix(line) {
  const match = blockquotePrefixRe.exec(line);
  const prefix = match ? match[0] : '';
  let depth = 0;
  for (const ch of prefix) {
    if (ch === '>') depth++;
  }
  return { depth, rest: line.slice(prefix.length) };
}

function leadingIndentOf(str) {
  let i = 0;
  while (i < str.length && (str[i] === ' ' || str[i] === '\t')) i++;
  return i;
}

// The content column a list item starting at `rest` establishes for its own
// continuation lines, or -1 if `rest` doesn't open a list item here. Per
// CommonMark, that column is the marker's indent plus the marker text plus
// the whitespace after it — capped to 1 space if that whitespace is absent
// or is 5+ characters (in both cases the rest of the line, if any, would
// itself read as an indented code block inside the item, not the item's
// normal content start).
function listItemContentColumn(rest) {
  const match = listMarkerRe.exec(rest);
  if (!match) return -1;
  const gap = match[3].length;
  const effectiveGap = gap === 0 || gap >= 5 ? 1 : gap;
  return match[1].length + match[2].length + effectiveGap;
}

// A fence opener starting at `column` of `rest`, or null. Returns the marker
// character and run length the matching closer must reproduce, plus the
// trimmed info string. A backtick
// opener whose info string itself contains a backtick is not a fence per
// CommonMark, so it is rejected here rather than at each call site.
function fenceOpenerAt(rest, column) {
  const openerMatch = fenceOpenerRe.exec(rest.slice(column));
  if (!openerMatch) return null;
  const marker = openerMatch[1];
  const infoString = rest.slice(column + openerMatch[0].length);
  if (marker[0] === '`' && infoString.includes('`')) return null;
  return {
    char: marker[0],
    len: marker.length,
    info: infoString.replace(/\r$/, '').trim(),
  };
}

// Walk `lines` once and return every fence the model above recognizes, in
// document order. Each record carries the opener's line index, the index of
// the line that ENDED it (`endIndex`: the closer, the first line past a
// container that ended mid-fence, or `lines.length` at EOF) and why it ended:
//   - 'closer'    a matching closing marker (endIndex is that line)
//   - 'container' the enclosing block quote / list item ended first
//   - 'eof'       unterminated, runs to the end of the document
// plus what a body extractor needs: marker, info string, and the column the
// opener sat at (container content column + the opener's own 0-3 indent).
function scanFences(lines) {
  const fences = [];
  let current = null;
  const listStack = []; // ascending content columns of active list items

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const { depth, rest } = splitBlockquotePrefix(line);
    const isBlank = rest.trim() === '';
    const indent = leadingIndentOf(rest);

    if (current) {
      const containerEnded =
        depth < current.depth || (!isBlank && indent < current.listColumn);
      if (containerEnded) {
        // The container (block quote or list item) the fence opened inside
        // ended before a matching closer showed up — see the block comment
        // above for why this line is kept as plain content rather than
        // re-examined as a potential new opener. It does not touch the list
        // stack either, matching the helper's behavior before extraction.
        current.endIndex = i;
        current.endReason = 'container';
        fences.push(current);
        current = null;
        continue;
      }
      const contentForClose =
        indent >= current.listColumn ? rest.slice(current.listColumn) : rest;
      const closerRe = new RegExp(
        `^[ \\t]{0,3}\\${current.char}{${current.len},}[ \\t]*\\r?$`
      );
      if (depth === current.depth && closerRe.test(contentForClose)) {
        current.endIndex = i;
        current.endReason = 'closer';
        fences.push(current);
        current = null;
      }
      continue;
    }

    // Not in a fence. Pop any list contexts this line has outdented past
    // (blank lines never end a list item on their own — see block comment).
    if (!isBlank) {
      while (listStack.length && indent < listStack[listStack.length - 1]) {
        listStack.pop();
      }
    }
    const containerColumn = listStack.length
      ? listStack[listStack.length - 1]
      : 0;

    // The content column this line's own list marker establishes, if it
    // opens one. Needed BEFORE the fence test: a fence may open on the very
    // same line as the marker, at that column rather than the container's.
    const openedColumn = isBlank ? -1 : listItemContentColumn(rest);

    let opener = null;
    let openerColumn = containerColumn;
    if (indent - containerColumn <= 3) {
      opener = fenceOpenerAt(rest, containerColumn);
    }
    // else: 4+ spaces past the container's content column — an indented
    // code block, not a fence opener. Left as ordinary content (finding 1:
    // scanning is the safe side).
    if (!opener && openedColumn !== -1) {
      // A fence opening ON the marker line (`- ```text`): CommonMark starts
      // the item's content at the marker's content column, so the fence
      // begins there. Testing only the container column leaves the opener
      // unrecognized and scans the whole item body as live prose — a false
      // positive on legitimate illustrative examples.
      opener = fenceOpenerAt(rest, openedColumn);
      if (opener) openerColumn = openedColumn;
    }
    if (opener) {
      current = {
        openIndex: i,
        endIndex: -1,
        endReason: '',
        char: opener.char,
        len: opener.len,
        info: opener.info,
        depth,
        listColumn: openerColumn,
        bodyColumn: openerColumn + leadingIndentOf(rest.slice(openerColumn)),
      };
    }

    if (openedColumn !== -1) listStack.push(openedColumn);
  }
  if (current) {
    current.endIndex = lines.length;
    current.endReason = 'eof';
    fences.push(current);
  }
  return fences;
}

// `stripFrontmatter` MUST be false when the caller has already sliced the
// frontmatter off, or passes a mid-document section. The leading-`---` regex
// below cannot tell a frontmatter block from a body that simply OPENS with a
// `---` thematic break and contains another one later: it would delete
// everything between them. That is a silent masking bug — a live
// `skill: "<ns>:<cmd>"` sitting between two horizontal rules would never reach
// RULE 18. Only a caller holding the ORIGINAL file content may strip here.
//
// A closed fence is replaced by a single blank line. A fence whose container
// ended first is dropped up to (not including) the line that ended the
// container, which stays as prose. An unterminated fence drops everything
// from its opener to EOF (CommonMark: it runs to the end of the document).
function stripFencedContent(content, { stripFrontmatter = true } = {}) {
  const lines = (
    stripFrontmatter
      ? content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      : content
  ).split('\n');
  const kept = [];
  let next = 0;
  for (const fence of scanFences(lines)) {
    for (let i = next; i < fence.openIndex; i++) kept.push(lines[i]);
    if (fence.endReason === 'eof') return kept.join('\n');
    if (fence.endReason === 'container') {
      next = fence.endIndex;
    } else {
      kept.push(''); // preserve the blank the old regex replacement left
      next = fence.endIndex + 1;
    }
  }
  for (let i = next; i < lines.length; i++) kept.push(lines[i]);
  return kept.join('\n');
}

// The language tag of a fence info string: its first word, lowercased, with
// a pandoc-style `{.lang}` wrapper tolerated. '' when there is none.
function languageOf(info) {
  const match = /^\{?\.?([A-Za-z0-9_+-]+)/.exec(info);
  return match ? match[1].toLowerCase() : '';
}

// Remove up to `columns` leading spaces/tabs — the container indent plus the
// opener's own indent, which CommonMark strips from each content line. Lines
// indented less than that simply lose all their leading whitespace.
function dedent(text, columns) {
  let i = 0;
  while (
    i < columns &&
    i < text.length &&
    (text[i] === ' ' || text[i] === '\t')
  )
    i++;
  return text.slice(i);
}

// Remove exactly `depth` block-quote markers — the ones the fence itself is
// nested in. A body line such as `  > "$out"` inside an unquoted fence is a
// shell redirect, not a quote marker, and must survive intact.
function stripQuoteMarkers(line, depth) {
  let rest = line;
  for (let n = 0; n < depth; n++) {
    const match = /^[ \t]{0,3}>[ \t]?/.exec(rest);
    if (!match) break;
    rest = rest.slice(match[0].length);
  }
  return rest;
}

// Every fenced code block in `content`, in document order, with the body
// dedented and stripped of block-quote markers so it can be handed straight
// to a shell or a linter. Line numbers are 1-based and refer to `content` as
// given (frontmatter is NOT stripped here, so numbers match the file).
//   startLine      the opener line
//   bodyStartLine  the first body line (startLine + 1)
//   endLine        the closer line, or the last body line when unclosed
//   closed         true only for a fence ended by a matching closer
//   endReason      'closer' | 'container' | 'eof' (see scanFences)
function extractFencedBlocks(content) {
  const lines = content.split('\n');
  return scanFences(lines).map((fence) => {
    const bodyLines = [];
    for (let i = fence.openIndex + 1; i < fence.endIndex; i++) {
      const rest = stripQuoteMarkers(lines[i], fence.depth);
      bodyLines.push(dedent(rest.replace(/\r$/, ''), fence.bodyColumn));
    }
    const closed = fence.endReason === 'closer';
    return {
      startLine: fence.openIndex + 1,
      bodyStartLine: fence.openIndex + 2,
      endLine: closed ? fence.endIndex + 1 : fence.endIndex,
      closed,
      endReason: fence.endReason,
      info: fence.info,
      lang: languageOf(fence.info),
      indent: fence.bodyColumn,
      body: bodyLines.join('\n'),
    };
  });
}

// Raw-reader fence scan. Claude reads command/skill/agent markdown as text,
// not as rendered CommonMark, so a ```bash opener indented under a list item
// whose body sits at column 0 is — to the reader that executes it — still a
// bash block, even though CommonMark ends the list item (and the fence) at
// the first outdented line. The shell-compat checks lint what runs, so they
// use this reading: a fence opens on any fence-shaped line (any indentation;
// block-quote markers stripped) and closes at the next line that is only a
// marker of the same character and at least the same length. List
// containers are ignored. Records have the same shape as
// extractFencedBlocks'; endReason is 'closer' or 'eof'.
function extractRawFencedBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  let current = null;
  const finish = (endIndex, endReason) => {
    const bodyLines = [];
    for (let i = current.openIndex + 1; i < endIndex; i++) {
      const rest = stripQuoteMarkers(lines[i], current.depth);
      bodyLines.push(dedent(rest.replace(/\r$/, ''), current.indent));
    }
    const closed = endReason === 'closer';
    blocks.push({
      startLine: current.openIndex + 1,
      bodyStartLine: current.openIndex + 2,
      endLine: closed ? endIndex + 1 : endIndex,
      closed,
      endReason,
      info: current.info,
      lang: languageOf(current.info),
      indent: current.indent,
      body: bodyLines.join('\n'),
    });
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    if (current) {
      const rest = stripQuoteMarkers(lines[i], current.depth);
      const closerRe = new RegExp(
        `^[ \\t]*\\${current.char}{${current.len},}[ \\t]*\\r?$`
      );
      if (closerRe.test(rest)) finish(i, 'closer');
      continue;
    }
    const { depth, rest } = splitBlockquotePrefix(lines[i]);
    const indent = leadingIndentOf(rest);
    const opener = fenceOpenerAt(rest.slice(indent), 0);
    if (opener) {
      current = {
        openIndex: i,
        depth,
        indent,
        char: opener.char,
        len: opener.len,
        info: opener.info,
      };
    }
  }
  if (current) finish(lines.length, 'eof');
  return blocks;
}

module.exports = {
  scanFences,
  stripFencedContent,
  extractFencedBlocks,
  extractRawFencedBlocks,
  languageOf,
};
