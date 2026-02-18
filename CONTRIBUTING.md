# Contributing to Yellow Plugins

Thank you for your interest in contributing to the Yellow Plugins marketplace!
This document provides guidelines and processes for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Documentation Requirements](#documentation-requirements)
- [Architectural Decision Records](#architectural-decision-records)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)

## Code of Conduct

This project adheres to professional standards of collaboration.
Please be respectful, constructive, and focused on technical merit in all interactions.

## Getting Started

### Prerequisites

- Node.js 18-24 LTS
- pnpm 8.0.0 or higher
- Git

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/KingInYellows/yellow-plugins.git
cd yellow-plugins

# Install dependencies
pnpm install

# Verify setup
pnpm validate
pnpm test
```

## Development Workflow

### Branch Strategy

- `main` - Production-ready code
- `codemachine/dev` - Development branch
- Feature branches: `feature/<description>`
- Bug fixes: `fix/<description>`

### Making Changes

1. Create a feature branch from `main` or `codemachine/dev`
2. Make your changes following coding standards
3. Add tests for new functionality
4. Update documentation
5. Run validation: `pnpm validate && pnpm test`
6. Submit a pull request

## Documentation Requirements

All code changes must be accompanied by appropriate documentation updates.

### API Documentation

- All public interfaces, classes, and functions must have TSDoc comments
- Use `@param`, `@returns`, `@throws` tags appropriately
- Include usage examples for complex APIs
- Generate and review API docs: `pnpm docs:build`

### Markdown Documentation

- Update relevant markdown files in `docs/` directory
- Follow markdown style guide (enforced by markdownlint)
- Run documentation linting: `pnpm docs:lint`
- Doctoc will automatically generate/update table of contents

### Documentation Scripts

```bash
# Generate API documentation from TSDoc comments
pnpm docs:build

# Update table of contents in markdown files
pnpm docs:lint:toc

# Lint all markdown files for consistency
pnpm docs:lint:md

# Run both TOC generation and markdown linting
pnpm docs:lint
```

### When to Update Documentation

- **Always**: When adding/modifying public APIs
- **Always**: When changing user-facing behavior
- **Always**: When adding new features
- **Usually**: When fixing bugs that affect documented behavior
- **Sometimes**: When refactoring (if it affects architecture)

## Architectural Decision Records

For significant architectural or design decisions, create an Architectural Decision Record (ADR) using our template.

### When to Create an ADR

Create an ADR when you:

- Change system architecture or component boundaries
- Select a new technology, library, or framework
- Modify data models or schemas
- Change API contracts or interfaces
- Make decisions affecting performance, security, or scalability
- Establish new coding patterns or conventions
- Change build, deployment, or CI/CD processes

### ADR Process

1. **Copy the Template**

   ```bash
   cp docs/plans/ADR-template.md docs/plans/ADR-XXX-your-decision-title.md
   ```

2. **Fill Out the ADR**
   - Use the next available ADR number (XXX)
   - Complete all sections of the template
   - Be thorough in documenting alternatives considered
   - Include rationale for your decision

3. **Review and Discussion**
   - Submit ADR as part of your pull request
   - Discuss with maintainers and stakeholders
   - Iterate based on feedback

4. **Approval and Implementation**
   - ADR must be approved before implementation begins
   - Update ADR status as work progresses
   - Link related code changes to the ADR

### ADR Template Location

The ADR template is located at: **[docs/plans/ADR-template.md](docs/plans/ADR-template.md)**

### ADR Lifecycle

- **Proposed**: Initial draft, under discussion
- **Accepted**: Approved, ready for implementation
- **Implemented**: Decision has been implemented in code
- **Superseded**: Replaced by a newer ADR (link to replacement)
- **Deprecated**: No longer applicable (explain why)

## Testing Requirements

### Test Coverage

- Unit tests: All business logic and utilities
- Integration tests: API contracts and component interactions
- Schema validation tests: All JSON schemas

### Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm test:unit

# Run integration tests only
pnpm test:integration

# Run schema validation tests
pnpm validate:schemas
```

### Test Standards

- Write tests before or alongside implementation (TDD encouraged)
- Test both happy paths and error cases
- Use descriptive test names that explain intent
- Mock external dependencies appropriately
- Aim for high test coverage (target: >80%)

## Pull Request Process

### Before Submitting

- [ ] All tests pass: `pnpm test`
- [ ] Code lints successfully: `pnpm lint`
- [ ] Types check: `pnpm typecheck`
- [ ] Documentation updated
- [ ] ADR created if needed
- [ ] Commit messages are clear and descriptive

### PR Checklist

- [ ] PR title clearly describes the change
- [ ] Description explains what, why, and how
- [ ] References related issues or requirements (e.g., FR-004, NFR-PERF-001)
- [ ] Tests added for new functionality
- [ ] Documentation updated (API docs + markdown)
- [ ] No breaking changes (or clearly documented if unavoidable)
- [ ] Schema changes include migration path if needed

### PR Review Process

1. Automated checks must pass (CI/CD)
2. At least one maintainer review required
3. All review comments addressed
4. Documentation reviewed for completeness
5. ADRs reviewed if applicable
6. Final approval and merge

## Coding Standards

### TypeScript

- Follow strict TypeScript configuration (defined in `tsconfig.base.json`)
- Use explicit types (avoid `any`)
- Prefer interfaces over type aliases for objects
- Use meaningful variable and function names

### Code Organization

- Follow layer architecture (domain → infrastructure → cli)
- Domain layer: Pure business logic, no external dependencies
- Infrastructure layer: External dependencies, file system, validators
- CLI layer: User interface, command handling

### Naming Conventions

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/methods: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Interfaces: `PascalCase` (no `I` prefix)

### Import Organization

```typescript
// 1. External dependencies
import { readFile } from 'fs/promises';

// 2. Internal workspace packages
import { Plugin } from '@domain/entities';

// 3. Relative imports
import { validateSchema } from './validators';
```

### Comments

- Use TSDoc for public APIs
- Inline comments for complex logic only
- Prefer self-documenting code over excessive comments
- Update comments when code changes

## Traceability

All changes should reference relevant requirement IDs where applicable:

- **Functional Requirements**: FR-001 through FR-013
- **Non-Functional Requirements**: NFR-PERF-001, NFR-REL-002, etc.
- **Risks**: RISK-01 through RISK-05

Include these references in:

- Commit messages
- Pull request descriptions
- ADRs
- Documentation updates

## Questions?

- Check the [Full Specification](docs/SPECIFICATION.md)
- Review the [Implementation Guide](docs/IMPLEMENTATION-GUIDE.md)
- Read existing [ADRs](docs/plans/)
- Open a discussion or issue on GitHub

---

Thank you for contributing to Yellow Plugins!
