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

const cmd = (name: string): string =>
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      `../commands/jules/${name}.md`
    ),
    'utf8'
  );

describe('/jules:reply binds the send to the confirmed preview', () => {
  const reply = cmd('reply');
  const s5 = reply.slice(
    reply.indexOf('### Step 5'),
    reply.indexOf('### Step 6')
  );
  const s6 = reply.slice(
    reply.indexOf('### Step 6'),
    reply.indexOf('### Step 7')
  );
  const binding =
    '${SESSION}|${GRANT_ID}|${REQUEST_ID}|${CORRECTION}|${MESSAGE_SHA}';

  it('prints the binding at the preview and verifies it before the CLI call', () => {
    expect(s5).toContain(binding);
    expect(s5).toContain('printf \'binding=%s\\n\' "$BINDING"');
    expect(s6).toContain(binding);
    const compare = s6.indexOf('[ "$CONFIRMED_BINDING" != "$BINDING" ]');
    expect(compare).toBeGreaterThan(-1);
    expect(compare).toBeLessThan(s6.indexOf('node "$CLI" "${args[@]}"'));
  });

  it('dispatches the hashed bytes', () => {
    expect(s6).toContain('"--message=$MESSAGE"');
    expect(s6).not.toContain('"--message=$(cat');
  });
});

describe('/jules:approve binds the approval to the reviewed plan', () => {
  const approve = cmd('approve');
  const s3 = approve.slice(
    approve.indexOf('### Step 3'),
    approve.indexOf('### Step 4')
  );
  const s5 = approve.slice(
    approve.indexOf('### Step 5'),
    approve.indexOf('### Step 6')
  );
  const s6 = approve.slice(
    approve.indexOf('### Step 6'),
    approve.indexOf('### Step 7')
  );
  const binding =
    '${SESSION}|${PLAN_ID}|${GRANT_ID}|${REQUEST_ID}|${PLAN_DIGEST}';

  it('Step 3 prints a digest of the plan shown to the user', () => {
    expect(s3).toContain("printf 'plan_digest=%s\\n'");
  });

  it('Step 5 prints the binding; Step 6 re-reads the plan and verifies before approving', () => {
    expect(s5).toContain(binding);
    expect(s6).toContain(binding);
    expect(s6).toContain('FRESH=$(node "$CLI" status --session "$SESSION")');
    const compare = s6.indexOf('[ "$CONFIRMED_BINDING" != "$BINDING" ]');
    expect(compare).toBeGreaterThan(-1);
    expect(compare).toBeLessThan(s6.indexOf('node "$CLI" "${args[@]}"'));
  });

  it('uses the same plan digest expression in Step 3 and Step 6', () => {
    const expr =
      "jq -c '[.pendingPlan.planId, ((.pendingPlan.steps // []) | map([.title, .description]))]'";
    expect(s3).toContain(expr);
    expect(s6).toContain(expr);
  });
});
