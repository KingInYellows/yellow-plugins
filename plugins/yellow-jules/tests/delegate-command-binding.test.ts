import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
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

  describe('Step 3 refuses a plan whose preview would be capped', () => {
    const s6Block = /```bash\n([\s\S]*?)```/.exec(s6)?.[1] ?? '';
    const block = /```bash\n([\s\S]*?)```/.exec(s3)?.[1] ?? '';
    const runStatus = (status: unknown, script = block) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-approve-'));
      fs.mkdirSync(path.join(root, 'dist'));
      fs.writeFileSync(
        path.join(root, 'dist/cli.js'),
        `console.log(${JSON.stringify(JSON.stringify(status))});`
      );
      const res = spawnSync(
        'bash',
        [
          '-c',
          script
            .replace('YELLOW_TODO_session', 'sessions/1')
            .replace('YELLOW_TODO_plan_id', 'p1'),
        ],
        { env: { ...process.env, CLAUDE_PLUGIN_ROOT: root }, encoding: 'utf8' }
      );
      fs.rmSync(root, { recursive: true, force: true });
      return res;
    };
    const run = (title: string, description: string) =>
      runStatus({
        ok: true,
        pendingPlan: {
          planId: 'p1',
          steps: [{ index: 0, title, description }],
        },
      });

    it.each([
      ['status failed', { ok: false }],
      ['no pending plan', { ok: true, pendingPlan: null }],
      [
        'a different plan',
        { ok: true, pendingPlan: { planId: 'p2', steps: [] } },
      ],
    ])('Step 3 emits no digest when %s', (_n, status) => {
      const res = runStatus(status);
      expect(res.status).toBe(1);
      expect(res.stdout).not.toContain('plan_digest=');
      expect(res.stderr).toContain('could not be read as pending');
    });

    it.each([
      ['status failed', { ok: false }],
      ['no pending plan', { ok: true, pendingPlan: null }],
    ])(
      'Step 6 refuses before approving when the re-read shows %s',
      (_n, status) => {
        const script = s6Block
          .replace('YELLOW_TODO_grant_id', 'g1')
          .replace('YELLOW_TODO_request_id', 'r1')
          .replace('YELLOW_TODO_deadline_or_empty', '')
          .replace('YELLOW_TODO_binding_from_preview', 'a'.repeat(64));
        const res = runStatus(status, script);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('could not be re-read as pending');
      }
    );

    it('binds a plan that fits the preview', () => {
      const res = run('Add tests', 'x'.repeat(300));
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/plan_digest=[0-9a-f]{64}/);
    });

    it.each([
      ['title', 'T'.repeat(301), 'short'],
      ['description', 'short', 'D'.repeat(301)],
    ])(
      'exits without a digest when the %s is over 300 characters',
      (field, title, description) => {
        const res = run(title, description);
        expect(res.status).toBe(1);
        expect(res.stdout).not.toContain('plan_digest=');
        expect(res.stderr).toContain(`step 1 ${field}`);
        expect(res.stderr).toContain('Jules UI');
      }
    );
  });

  it('uses the same plan digest expression in Step 3 and Step 6', () => {
    const expr =
      "jq -c '[.pendingPlan.planId, ((.pendingPlan.steps // []) | map([.title, .description]))]'";
    expect(s3).toContain(expr);
    expect(s6).toContain(expr);
  });
});
