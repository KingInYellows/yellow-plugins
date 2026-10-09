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

describe('/jules:supervise binds the approval to the reviewed plan', () => {
  const supervise = cmd('supervise');
  const blocks = [...supervise.matchAll(/```bash\n([\s\S]*?)```/g)].map(
    (m) => m[1] ?? ''
  );
  const review = blocks.find((b) => b.includes("printf 'plan_digest=%s")) ?? '';
  const approve =
    blocks.find((b) => b.includes('"$CLI" approve --session')) ?? '';

  const plan = (title: string, description = 'd', planId = 'p1') => ({
    ok: true,
    pendingPlan: { planId, steps: [{ index: 0, title, description }] },
  });

  // Runs a block against a stub CLI: `status` prints `status`, `approve` is
  // recorded in calls.log.
  const run = (
    script: string,
    status: unknown,
    subst: Record<string, string>
  ) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-supervise-'));
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(
      path.join(root, 'dist/cli.js'),
      `const fs=require('fs');const c=process.argv[2];` +
        `if(c==='approve'){fs.appendFileSync(${JSON.stringify(path.join(root, 'calls.log'))},'approve\\n');console.log('{"ok":true}');}` +
        `else console.log(${JSON.stringify(JSON.stringify(status))});`
    );
    let body = script;
    for (const [k, v] of Object.entries(subst)) body = body.replace(k, v);
    const res = spawnSync('bash', ['-c', body], {
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
      encoding: 'utf8',
    });
    const called = fs.existsSync(path.join(root, 'calls.log'));
    fs.rmSync(root, { recursive: true, force: true });
    return { ...res, called };
  };
  const reviewRun = (status: unknown) =>
    run(review, status, {
      YELLOW_TODO_session: 'sessions/1',
      YELLOW_TODO_observed_plan_id: 'p1',
    });
  const approveRun = (status: unknown, digest: string) =>
    run(approve, status, {
      YELLOW_TODO_session: 'sessions/1',
      YELLOW_TODO_observed_plan_id: 'p1',
      YELLOW_TODO_grant_id: 'g1',
      YELLOW_TODO_plan_digest: digest,
    });
  const digestOf = (status: unknown): string =>
    /plan_digest=([0-9a-f]{64})/.exec(reviewRun(status).stdout)?.[1] ?? '';

  it('finds both blocks', () => {
    expect(review).not.toBe('');
    expect(approve).not.toBe('');
  });

  it('approves the plan it reviewed', () => {
    const digest = digestOf(plan('Add tests'));
    expect(digest).toHaveLength(64);
    const res = approveRun(plan('Add tests'), digest);
    expect(res.called).toBe(true);
  });

  it('refuses when the plan text changed under the same plan id', () => {
    const digest = digestOf(plan('Add tests'));
    const res = approveRun(plan('Delete everything'), digest);
    expect(res.status).toBe(1);
    expect(res.called).toBe(false);
    expect(res.stderr).toContain('plan changed');
  });

  it.each([
    ['status failed', { ok: false }],
    ['no pending plan', { ok: true, pendingPlan: null }],
    ['a different plan id', plan('Add tests', 'd', 'p2')],
  ])('refuses to review or approve when %s', (_n, status) => {
    expect(reviewRun(status).stdout).not.toContain('plan_digest=');
    const res = approveRun(status, 'a'.repeat(64));
    expect(res.status).toBe(1);
    expect(res.called).toBe(false);
  });

  it('refuses a review whose fields would be capped', () => {
    const res = reviewRun(plan('T'.repeat(301)));
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain('plan_digest=');
  });
});

describe('/jules:supervise binds the reply to the pass decision', () => {
  const supervise = cmd('supervise');
  const blocks = [...supervise.matchAll(/```bash\n([\s\S]*?)```/g)].map(
    (m) => m[1] ?? ''
  );
  const preview =
    blocks.find(
      (b) => b.includes("printf 'binding=%s") && b.includes('message.txt')
    ) ?? '';
  const send = blocks.find((b) => b.includes('args=(reply --session')) ?? '';
  const DIGEST = 'b'.repeat(64);

  const prepare = (message: string) => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'yellow-jules-supervise.')
    );
    fs.writeFileSync(path.join(dir, 'message.txt'), message);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jules-sup-reply-'));
    fs.mkdirSync(path.join(root, 'dist'));
    const calls = path.join(root, 'calls.json');
    fs.writeFileSync(
      path.join(root, 'dist/cli.js'),
      `require('fs').writeFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2)));console.log('{"ok":true,"sent":true}');`
    );
    return { dir, root, calls };
  };
  const exec = (
    script: string,
    ctx: { dir: string; root: string },
    over: Record<string, string> = {}
  ) => {
    const values: Record<string, string> = {
      YELLOW_TODO_work_dir: ctx.dir,
      YELLOW_TODO_session: 'sessions/1',
      YELLOW_TODO_grant_id: 'g1',
      YELLOW_TODO_1_or_0: '1',
      YELLOW_TODO_observed_activity_id_or_none: 'act-1',
      YELLOW_TODO_observed_question_digest_or_none: DIGEST,
      ...over,
    };
    let body = script;
    for (const [k, v] of Object.entries(values)) body = body.replace(k, v);
    return spawnSync('bash', ['-c', body], {
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ctx.root },
      encoding: 'utf8',
    });
  };
  const bindingOf = (ctx: { dir: string; root: string }, over = {}) =>
    /binding=([0-9a-f]{64})/.exec(exec(preview, ctx, over).stdout)?.[1] ?? '';

  it('finds both blocks', () => {
    expect(preview).not.toBe('');
    expect(send).not.toBe('');
  });

  it('sends the confirmed message with the question expectation', () => {
    const ctx = prepare('Use Postgres.');
    const binding = bindingOf(ctx);
    expect(binding).toHaveLength(64);
    const res = exec(send, ctx, { YELLOW_TODO_binding_from_preview: binding });
    const argv = JSON.parse(fs.readFileSync(ctx.calls, 'utf8')) as string[];
    expect(res.status).toBe(0);
    expect(argv).toContain('--message=Use Postgres.');
    expect(argv).toContain('--correction');
    expect(argv).toEqual(
      expect.arrayContaining([
        '--expect-activity-id',
        'act-1',
        '--expect-question-digest',
        DIGEST,
      ])
    );
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  it.each([
    ['the message bytes change', {}, 'Use MySQL.'],
    [
      'the observed question differs',
      { YELLOW_TODO_observed_activity_id_or_none: 'act-2' },
      undefined,
    ],
    [
      'the session is substituted',
      { YELLOW_TODO_session: 'sessions/2' },
      undefined,
    ],
    ['the correction flag flips', { YELLOW_TODO_1_or_0: '0' }, undefined],
  ])('refuses before the CLI when %s', (_n, over, newMessage) => {
    const ctx = prepare('Use Postgres.');
    const binding = bindingOf(ctx);
    if (newMessage !== undefined) {
      fs.writeFileSync(path.join(ctx.dir, 'message.txt'), newMessage);
    }
    const res = exec(send, ctx, {
      YELLOW_TODO_binding_from_preview: binding,
      ...over,
    });
    expect(res.status).toBe(1);
    expect(fs.existsSync(ctx.calls)).toBe(false);
    expect(res.stderr).toContain('differs from the printed binding');
    fs.rmSync(ctx.dir, { recursive: true, force: true });
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  it('omits the expectation flags for a non-question decision', () => {
    const ctx = prepare('Please restructure.');
    const none = {
      YELLOW_TODO_observed_activity_id_or_none: 'none',
      YELLOW_TODO_observed_question_digest_or_none: 'none',
    };
    const binding = bindingOf(ctx, none);
    exec(send, ctx, { YELLOW_TODO_binding_from_preview: binding, ...none });
    const argv = JSON.parse(fs.readFileSync(ctx.calls, 'utf8')) as string[];
    expect(argv).not.toContain('--expect-activity-id');
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });
});

describe('/jules:reply refuses a preview that would hide part of the message', () => {
  const reply = cmd('reply');
  const s5 = reply.slice(
    reply.indexOf('### Step 5'),
    reply.indexOf('### Step 6')
  );
  const block = /```bash\n([\s\S]*?)```/.exec(s5)?.[1] ?? '';

  const run = (message: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-reply.'));
    fs.writeFileSync(path.join(dir, 'message.txt'), message);
    const body = block
      .replace('YELLOW_TODO_work_dir', dir)
      .replace('YELLOW_TODO_session', 'sessions/1')
      .replace('YELLOW_TODO_grant_id', 'g1')
      .replace('YELLOW_TODO_request_id', 'r1')
      .replace('YELLOW_TODO_1_or_0', '0');
    const res = spawnSync('bash', ['-c', body], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    return res;
  };

  it('prints the binding and the whole message when it fits', () => {
    const res = run('x'.repeat(500));
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/binding=[0-9a-f]{64}/);
    expect(res.stdout).toContain('x'.repeat(500));
  });

  it('exits without a binding when the message is over 500 characters', () => {
    const res = run('x'.repeat(501));
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain('binding=');
    expect(res.stderr).toContain('501 characters');
  });
});
