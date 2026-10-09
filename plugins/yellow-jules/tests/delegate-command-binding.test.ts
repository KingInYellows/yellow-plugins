import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const md = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../commands/jules/delegate.md'
  ),
  'utf8'
);
const step6 = md.slice(md.indexOf('### Step 6'), md.indexOf('### Step 7'));
const step5 = md.slice(md.indexOf('### Step 5'), md.indexOf('### Step 6'));

describe('/jules:delegate binds the launch to the confirmed preview', () => {
  const binding =
    '${REPO}|${BRANCH}|${TASK_REF}|${GRANT_ID}|${REQUEST_ID}|${CORRECTION}|${PROMPT_SHA}|${TITLE_SHA}';

  it('the preview prints a binding over the scope and the staged bytes', () => {
    expect(step5).toContain(binding);
    expect(step5).toContain('printf \'binding=%s\\n\' "$BINDING"');
  });

  it('the launch recomputes it and refuses before calling the CLI', () => {
    expect(step6).toContain(binding);
    expect(step6).toContain(
      "CONFIRMED_BINDING='YELLOW_TODO_binding_from_preview'"
    );
    const compare = step6.indexOf('[ "$CONFIRMED_BINDING" != "$BINDING" ]');
    const launch = step6.indexOf('node "$CLI" "${args[@]}"');
    expect(compare).toBeGreaterThan(-1);
    expect(compare).toBeLessThan(launch);
  });

  it('dispatches the hashed bytes, not a second read of the files', () => {
    expect(step6).toContain('"--prompt=$PROMPT"');
    expect(step6).not.toContain('"--prompt=$(cat');
    expect(step6).toContain('"--title=$TITLE"');
  });
});
