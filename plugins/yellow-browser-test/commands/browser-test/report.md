---
name: browser-test:report
description: >
  Generate a test report from the most recent results. Use when user says
  "generate report", "show test results", "create test report", or wants
  to view or share the results of a previous test run.
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - Task
---

# Generate Test Report

Create a formatted markdown report from the most recent browser test results.

## Workflow

### Step 1: Find Results

Check for `test-reports/results.json`.

If not found: "No test results found. Run `/browser-test:test` or `/browser-test:explore` first."

### Step 2: Generate Report

Spawn the `test-reporter` agent:

```
Task(test-reporter): "Generate report from test-reports/results.json. Write markdown report and offer GitHub issue creation for failures."
```

### Step 3: Display Summary

Show the report file path and a brief summary of results.

## Error Handling

| Error | Action |
|-------|--------|
| No results.json found | "No test results. Run `/browser-test:test` or `/browser-test:explore` first" |
| results.json is malformed | "Results file is corrupted. Re-run tests with `/browser-test:test`" |
| gh CLI not available | "Install gh CLI for issue creation: https://cli.github.com/" |
