---
name: chatprd-conventions
description: >
  ChatPRD conventions and patterns reference. Use when commands or agents
  need context about ChatPRD templates, project structure, or error handling.
user-invocable: false
---

# ChatPRD Conventions

## What It Does

Reference patterns for ChatPRD MCP interactions. Loaded by commands and agents for consistent error handling, template selection, and input validation.

## When to Use

Use when yellow-chatprd plugin commands or agents need shared context for ChatPRD MCP tool usage, error mapping, or input validation rules.

## Usage

This skill is not user-invocable. It provides shared context for the yellow-chatprd plugin's commands and agents, and all such commands and agents must follow these conventions.

## Error Mapping

Map MCP errors to user-friendly messages. Always handle these cases:

| Error | User Message | Action |
|-------|-------------|--------|
| Authentication required / token expired | "ChatPRD authentication required. A browser window will open for login." | MCP client handles re-auth automatically |
| No team subscription | "ChatPRD Team plan required for MCP access." | Stop — cannot proceed without subscription |
| Document not found (404) | "Document not found. Use `/chatprd:search` to find it." | Suggest search command |
| Rate limited (429) | "ChatPRD rate limit hit. Retrying..." | Exponential backoff: 1s, 2s, 4s. Max 3 retries. Abort if all retries fail. |
| Network timeout | "ChatPRD server unavailable. Retry in a moment." | Retry once, then report failure |
| MCP tool not found | "ChatPRD MCP tools unavailable. Check plugin installation." | Verify MCP server connection |

## Template Guide

ChatPRD provides AI-powered templates for different document types. When creating documents, suggest the best-fit template:

| Template | Use For |
|----------|---------|
| PRD | Product requirements — features, user stories, acceptance criteria |
| One-Pager | Quick proposals — problem statement, solution, key metrics |
| User Persona | Audience definition — demographics, goals, pain points |
| API Documentation | Endpoint specs — routes, parameters, responses, auth |
| Launch Plan | Go-to-market — timeline, channels, success metrics |
| Technical Spec | Architecture decisions — system design, trade-offs, dependencies |

When `list_templates` is available, fetch the live list and match against the user's description. Fall back to this static mapping if the tool is unavailable.

## Input Validation

All `$ARGUMENTS` values are user input and must be validated before use:

- **Max length:** 500 characters. Reject longer inputs with a clear error.
- **Path traversal:** Reject inputs containing `..`, `/`, or `~`.
- **Whitespace:** Trim leading/trailing whitespace before processing.
- **HTML:** Strip HTML tags from titles and descriptions before passing to MCP tools.
- **General rule:** Never interpolate `$ARGUMENTS` into shell commands. Pass to MCP tools as API parameters only.

## Security Patterns

| Pattern | Application |
|---------|------------|
| **C1: Validate before write** | `get_document` before every `update_document` |
| **H1: TOCTOU mitigation** | Re-fetch document immediately before write — never use stale content |
| **Read-before-write dedup** | `search_documents` before `create_document` to avoid duplicates |
| **M3: Explicit confirmation** | Confirm before creating or updating documents |
