import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const REPO_ROOT = resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');

type WorkflowDocument = Record<string, unknown>;

type WorkflowPolicy = {
  category:
    | 'supersedable-pr-validation'
    | 'manual-or-scheduled-analytical'
    | 'manual-or-event-driven-exemption'
    | 'operational-exemption';
  reason?: string;
  workflowKey?: string;
};

/**
 * This registry is deliberately explicit: a new active workflow must be
 * classified before it can bypass the cancellation contract.
 */
const WORKFLOW_POLICIES: Record<string, WorkflowPolicy> = {
  'claude-code-review.yml': {
    category: 'supersedable-pr-validation',
    workflowKey: 'claude-code-review',
  },
  'claude.yml': {
    category: 'manual-or-event-driven-exemption',
    reason:
      'Comment, review, and issue-driven Claude requests are independent user invocations; this workflow has no pull_request trigger.',
  },
  'lint-plugins.yml': {
    category: 'supersedable-pr-validation',
    workflowKey: 'lint-plugins',
  },
  'upstream-pins-advisory.yml': {
    category: 'manual-or-scheduled-analytical',
    reason:
      'Scheduled and manually requested advisory reports must remain independent and never be auto-cancelled.',
  },
  'validate-schemas-fork.yml': {
    category: 'supersedable-pr-validation',
    workflowKey: 'validate-schemas-fork',
  },
  'validate-schemas.yml': {
    category: 'supersedable-pr-validation',
    workflowKey: 'validate-schemas',
  },
  'version-packages.yml': {
    category: 'operational-exemption',
    reason:
      'Release, publication, tag, and manual recovery operations must not be interrupted or auto-cancelled.',
  },
};

function readOnTrigger(workflow: WorkflowDocument): Record<string, unknown> {
  // YAML 1.1 parsers may turn the unquoted `on` key into the string key
  // `true`. Support both representations so this contract cannot silently
  // misclassify a workflow because of parser-version differences.
  const trigger = workflow.on ?? workflow.true;
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
    throw new Error('Workflow is missing a mapping-valued `on` trigger key');
  }
  return trigger as Record<string, unknown>;
}

function readWorkflows(): Map<
  string,
  { document: WorkflowDocument; triggers: Record<string, unknown> }
> {
  const files = readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort();

  return new Map(
    files.map((file) => {
      const document = YAML.parse(
        readFileSync(join(WORKFLOWS_DIR, file), 'utf8'),
        { version: '1.2' }
      ) as WorkflowDocument;
      return [file, { document, triggers: readOnTrigger(document) }];
    })
  );
}

function hasPullRequestTrigger(triggers: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(triggers, 'pull_request');
}

function isSelfHosted(document: WorkflowDocument): boolean {
  return JSON.stringify(document.jobs ?? '').includes('self-hosted');
}

describe('GitHub Actions workflow concurrency contracts', () => {
  const workflows = readWorkflows();

  it('classifies every active workflow and documents all exemptions', () => {
    expect([...workflows.keys()]).toEqual(
      Object.keys(WORKFLOW_POLICIES).sort()
    );

    const workflowKeys = Object.values(WORKFLOW_POLICIES)
      .filter((policy) => policy.category === 'supersedable-pr-validation')
      .map((policy) => policy.workflowKey);
    expect(new Set(workflowKeys).size).toBe(workflowKeys.length);

    for (const [file, policy] of Object.entries(WORKFLOW_POLICIES)) {
      if (policy.category !== 'supersedable-pr-validation') {
        expect(policy.reason, `${file} exemption reason`).toBeTruthy();
      }
    }
  });

  it('preserves the on key with YAML 1.1 and 1.2 parsers', () => {
    for (const file of workflows.keys()) {
      const source = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
      const yaml11 = YAML.parse(source, { version: '1.1' }) as WorkflowDocument;
      const yaml12 = YAML.parse(source, { version: '1.2' }) as WorkflowDocument;

      expect(
        Object.keys(readOnTrigger(yaml11)).length,
        `${file} YAML 1.1`
      ).toBeGreaterThan(0);
      expect(
        Object.keys(readOnTrigger(yaml12)).length,
        `${file} YAML 1.2`
      ).toBeGreaterThan(0);
    }
  });

  it('requires PR-number-scoped cancellation for supersedable validation', () => {
    for (const [file, policy] of Object.entries(WORKFLOW_POLICIES)) {
      if (policy.category !== 'supersedable-pr-validation') continue;

      const workflow = workflows.get(file);
      if (!workflow) throw new Error(`Missing workflow ${file}`);

      const { document, triggers } = workflow;
      const concurrency = document.concurrency;
      expect(concurrency, `${file} top-level concurrency`).toBeDefined();
      expect(typeof concurrency, `${file} concurrency type`).toBe('object');

      const group = (concurrency as Record<string, unknown>).group;
      const cancelInProgress = (concurrency as Record<string, unknown>)[
        'cancel-in-progress'
      ];
      expect(typeof group, `${file} group type`).toBe('string');
      expect(group as string, `${file} workflow-specific prefix`).toMatch(
        new RegExp(`^${policy.workflowKey}-`)
      );
      expect(group as string, `${file} stable PR identity`).toContain(
        'github.event.pull_request.number'
      );
      expect(
        hasPullRequestTrigger(triggers),
        `${file} pull_request trigger`
      ).toBe(true);

      if (Object.keys(triggers).length > 1) {
        expect(group as string, `${file} event isolation`).toContain(
          'github.event_name'
        );
        expect(group as string, `${file} per-run fallback`).toContain(
          'github.run_id'
        );
        expect(group as string, `${file} no ref fallback`).not.toContain(
          'github.ref'
        );
        expect(cancelInProgress, `${file} PR-only cancellation`).toBe(
          "${{ github.event_name == 'pull_request' }}"
        );
      } else {
        expect(group as string, `${file} no per-run identity`).not.toMatch(
          /github\.(run_id|run_attempt|sha)|github\.event\.pull_request\.head\.sha/
        );
        expect(cancelInProgress, `${file} PR cancellation`).toBe(true);
      }

      if (isSelfHosted(document)) {
        expect(
          policy.workflowKey,
          `${file} self-hosted PR policy`
        ).toBeTruthy();
      }
    }
  });

  it('does not enable cancellation for documented exemptions', () => {
    for (const [file, policy] of Object.entries(WORKFLOW_POLICIES)) {
      if (policy.category === 'supersedable-pr-validation') continue;

      const workflow = workflows.get(file);
      if (!workflow) throw new Error(`Missing workflow ${file}`);

      const concurrency = workflow.document.concurrency;
      if (concurrency && typeof concurrency === 'object') {
        expect(
          (concurrency as Record<string, unknown>)['cancel-in-progress'],
          `${file} exemption cancellation`
        ).not.toBe(true);
      }
    }
  });
});
