# KingInYellows Plugin Marketplace

## Executive Summary

**KingInYellows Plugin Marketplace** is a curated, production-grade Claude Code plugin distribution platform. It serves as a centralized hub for discovering, installing, and maintaining high-quality plugins that extend Claude Code with specialized workflows, MCP server integrations, and custom commands. The marketplace prioritizes developer experience, security, and governance while supporting both individual creators and enterprise teams.

---

## Product Requirements Document (PRD)

### 1. Product Vision

Create the premier Claude Code plugin marketplace that emphasizes quality, security, and developer productivity. KingInYellows will differentiate itself through:

- **Curated Quality**: Every plugin undergoes security review and quality gates
- **Developer Focus**: Plugins solve real problems in modern development workflows
- **Enterprise Ready**: Built-in governance, audit trails, and version management
- **Community-Driven**: Open contribution model with clear standards and support

### 2. Core Objectives

#### 2.1 Discovery & Installation (Users)
Users should be able to:
- Browse categorized plugins with clear descriptions, ratings, and version history
- Install plugins with a single command: `/plugin install plugin-name@kingin-yellows`
- Add the marketplace with: `/plugin marketplace add KingInYellow/claude-plugins`
- View plugin dependencies, permissions, and supported Claude Code versions
- Access detailed documentation and examples for each plugin
- Track installed versions and receive auto-update notifications

#### 2.2 Plugin Distribution (Creators)
Plugin creators should be able to:
- Submit plugins following standard submission guidelines
- Publish across semantic versioning (major.minor.patch)
- View download counts, ratings, and usage analytics
- Maintain plugin repositories with automated validation
- Receive feedback from the community and improve plugins iteratively

#### 2.3 Governance & Security (Admin/Organization)
Administrators should be able to:
- Review and approve/reject plugin submissions
- Monitor plugin security vulnerabilities
- Audit plugin installations across teams
- Set organization policies (e.g., approved plugin allowlists)
- Maintain clear audit trails for compliance

### 3. Key Features

#### 3.1 Marketplace Infrastructure

**marketplace.json Schema**
{
  "name": "kingin-yellows",
  "metadata": {
    "description": "Premium Claude Code plugins for modern development workflows",
    "version": "1.0.0",
    "publisher": "KingInYellow",
    "homepage": "https://github.com/KingInYellow/claude-plugins",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "devops-suite",
      "source": "devops-suite",
      "version": "1.2.0",
      "description": "Complete DevOps automation with Terraform, Docker, and CI/CD",
      "author": { "name": "DevOps Team", "email": "devops@kingin.ai" },
      "category": "devops",
      "tags": ["automation", "terraform", "docker", "cicd"],
      "homepage": "https://github.com/KingInYellow/devops-suite-plugin",
      "commands": ["deploy", "validate", "plan", "destroy"],
      "agents": ["infrastructure-architect", "deployment-manager"],
      "mcpServers": { "terraform": {}, "docker": {} },
      "minimumClaude": "1.0.0"
    }
  ]
}

#### 3.2 Plugin Categories

- **DevOps & Infrastructure**: Terraform, Docker, Kubernetes, CI/CD orchestration
- **Testing & Quality**: Unit testing, E2E testing, code coverage, performance profiling
- **AI & ML**: LLM integration, model training, data processing, MLOps
- **Web & Frontend**: React/Vue patterns, styling, component generation, accessibility
- **Backend & Data**: API design, database migrations, caching, message queues
- **Developer Tools**: Linting, formatting, documentation generation, refactoring
- **Productivity**: Project management, documentation, code analysis, workflow automation
- **Security**: SAST, dependency scanning, secret management, compliance

#### 3.3 Plugin Structure

Each plugin MUST follow this directory structure:

plugin-name/
├── .claude-plugin/
│   ├── plugin.json              # Plugin manifest
│   ├── commands/                # Slash commands
│   │   ├── deploy.ts
│   │   └── validate.ts
│   ├── agents/                  # Specialized agents
│   │   ├── infra-architect.ts
│   │   └── config-generator.ts
│   ├── hooks/
│   │   ├── onInit.ts            # Startup initialization
│   │   ├── onActivate.ts        # Plugin activation
│   │   └── onCommand.ts         # Pre/post command execution
│   ├── mcp-servers/             # MCP server configurations
│   │   ├── terraform-config.json
│   │   └── docker-config.json
│   └── lsp-servers/             # LSP configuration
│       └── yaml-lsp.json
├── src/                         # Implementation
│   ├── commands/
│   ├── agents/
│   ├── services/
│   ├── utils/
│   └── types/
├── tests/                       # Test suite
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docs/                        # User documentation
│   ├── README.md
│   ├── installation.md
│   ├── usage.md
│   ├── examples.md
│   └── troubleshooting.md
├── examples/                    # Practical examples
│   ├── basic-deploy.md
│   ├── terraform-workflow.md
│   └── complex-pipeline.yaml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── plugin-manifest.schema.json  # Manifest schema validation

#### 3.4 Plugin Manifest (plugin.json)

{
  "name": "devops-suite",
  "displayName": "DevOps Suite",
  "version": "1.2.0",
  "description": "Complete DevOps automation workflows for infrastructure and CI/CD",
  "author": {
    "name": "DevOps Team",
    "email": "devops@kingin.ai",
    "url": "https://github.com/KingInYellow"
  },
  "license": "MIT",
  "minimumClaudeVersion": "1.0.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/KingInYellow/devops-suite-plugin"
  },
  "keywords": ["devops", "terraform", "docker", "cicd", "automation"],
  "permissions": {
    "filesystem": ["read", "write"],
    "network": ["http", "https"],
    "environment": ["read"]
  },
  "commands": [
    {
      "name": "deploy",
      "description": "Deploy infrastructure with Terraform",
      "implementation": "./src/commands/deploy.ts",
      "arguments": [
        {
          "name": "environment",
          "description": "Target environment (dev, staging, prod)",
          "required": true,
          "options": ["dev", "staging", "prod"]
        },
        {
          "name": "dryRun",
          "description": "Plan without applying changes",
          "required": false,
          "type": "boolean"
        }
      ]
    }
  ],
  "agents": [
    {
      "name": "infrastructure-architect",
      "description": "Expert at designing scalable infrastructure",
      "implementation": "./src/agents/infra-architect.ts",
      "capabilities": ["terraform", "kubernetes", "aws", "gcp"]
    }
  ],
  "hooks": {
    "onInit": "./src/hooks/onInit.ts",
    "onActivate": "./src/hooks/onActivate.ts",
    "onCommand": "./src/hooks/onCommand.ts"
  },
  "mcpServers": [
    {
      "name": "terraform",
      "description": "Terraform operations via MCP",
      "command": "terraform-mcp-server",
      "args": ["--port", "3000"],
      "env": {
        "TF_LOG": "INFO"
      }
    }
  ],
  "lspServers": [
    {
      "language": "hcl",
      "command": "hcl-language-server"
    }
  ]
}

#### 3.5 Rating & Review System

- **5-star rating system** with minimum 10 install base to display rating
- **Version-specific feedback**: Users can rate specific plugin versions
- **Trust signals**: Display downloads, last update date, security audit status
- **Community comments**: Discuss features, issues, best practices

#### 3.6 Security & Compliance

**Submission Requirements:**
- Security review checklist (no hardcoded secrets, safe API usage)
- Automated SAST scanning on submission
- Dependency vulnerability scanning (via npm audit equivalent)
- Clear permission declarations (filesystem, network, environment)
- Author verification via GitHub account

**Ongoing Monitoring:**
- Monthly CVE scanning against transitive dependencies
- Automatic deprecation notices for end-of-life versions
- Security incident disclosure process
- Plugin suspension for malicious behavior

### 4. Success Metrics

#### 4.1 Platform Metrics
- **Total Plugins**: 50+ plugins in first 6 months, 200+ in year 1
- **Active Marketplaces**: Measure adoption of marketplace by external organizations
- **Plugin Quality Score**: Average rating ≥ 4.5 stars
- **Community Contributions**: 40% of new plugins from community creators

#### 4.2 Developer Metrics
- **Installation Growth**: 100+ installations/week by month 6, 1000+/week by month 12
- **Plugin Retention**: 70% of plugins maintained/updated within 6 months
- **Documentation Quality**: All plugins have ≥ 95% documentation coverage
- **Issue Resolution**: Average 48-hour response time for support issues

#### 4.3 Governance Metrics
- **Security Reviews**: 100% of plugins undergo security review before approval
- **CVE Response**: Average 7-day patch time for security vulnerabilities
- **Audit Trail**: Complete audit logs for all plugin installations/updates
- **Compliance**: Support for SAST, SBOM, and compliance frameworks

### 5. Phased Rollout

**Phase 1 (Months 1-2): Foundation**
- Core marketplace infrastructure
- Plugin submission & approval workflow
- Basic rating/review system
- Documentation portal

**Phase 2 (Months 3-4): Community**
- Community marketplace discovery
- Advanced filtering & search
- Team governance policies
- Analytics dashboard

**Phase 3 (Months 5-6): Scale**
- Marketplace federation (multiple orgs)
- Auto-update policies
- Advanced security scanning
- Enterprise licensing models

---

## Technical Design Document

### 1. Architecture Overview

#### 1.1 System Components

┌─────────────────────────────────────────────────────────┐
│              Claude Code Plugin System                   │
└─────────────────────────────────────────────────────────┘
                            ▲
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
         ┌────────┐   ┌─────────┐   ┌──────────┐
         │ Command │   │  Agent  │   │ MCP/LSP  │
         │ System  │   │ System  │   │ Servers  │
         └────────┘   └─────────┘   └──────────┘
              │             │             │
              └─────────────┼─────────────┘
                            │
                    ┌───────▼────────┐
                    │  Marketplace   │
                    │  Distribution  │
                    │    (GitHub)    │
                    └────────────────┘

#### 1.2 Repository Structure

KingInYellow/claude-plugins/
├── .github/
│   ├── workflows/
│   │   ├── validate-plugin.yml      # Plugin validation on PR
│   │   ├── security-scan.yml        # SAST + dependency scan
│   │   ├── deploy-marketplace.yml   # Deploy marketplace.json
│   │   └── plugin-release.yml       # Release versioned plugins
│   └── ISSUE_TEMPLATE/
│       ├── plugin-submission.md
│       └── bug-report.md
├── plugins/                         # Individual plugin directories
│   ├── devops-suite/
│   ├── testing-framework/
│   ├── ai-ml-suite/
│   └── ...
├── marketplace/
│   ├── marketplace.json            # Main marketplace manifest
│   ├── schema/
│   │   ├── marketplace-schema.json
│   │   └── plugin-schema.json
│   └── scripts/
│       ├── generate-marketplace.ts  # Build marketplace.json
│       ├── validate-marketplace.ts
│       └── health-check.ts
├── docs/
│   ├── README.md                   # Getting started
│   ├── CONTRIBUTING.md             # Contribution guidelines
│   ├── plugin-development-guide.md # How to build plugins
│   ├── submission-guidelines.md    # Plugin submission checklist
│   ├── security-policy.md          # Security requirements
│   ├── examples/
│   │   ├── minimal-plugin.md
│   │   ├── with-mcp-server.md
│   │   └── with-agents.md
│   └── api/
│       ├── commands.md
│       ├── agents.md
│       ├── hooks.md
│       └── mcp-integration.md
├── tools/
│   ├── plugin-scaffold.ts          # CLI: Generate new plugin
│   ├── plugin-validator.ts         # CLI: Validate plugin.json
│   ├── marketplace-builder.ts      # CLI: Build marketplace.json
│   └── plugin-tester.ts            # CLI: Local test framework
├── tests/
│   ├── marketplace/
│   │   ├── marketplace-schema.test.ts
│   │   └── validation.test.ts
│   └── fixtures/
│       └── sample-plugins/
├── .claude/
│   └── settings.json               # Team plugin config
├── package.json
├── turbo.json                      # Monorepo config (if using)
├── tsconfig.json
├── vitest.config.ts
└── README.md

### 2. Plugin Lifecycle

#### 2.1 Development Phase

// Step 1: Create new plugin scaffolding
npx @kingin-yellows/plugin-scaffold create my-plugin

// Step 2: Develop locally with hot reload
npm run dev

// Step 3: Run validation
npm run validate

// Step 4: Test with local marketplace
npm run test:local

#### 2.2 Submission Phase

Developer pushes to feature branch
    ↓
GitHub Actions validates plugin.json schema
    ↓
SAST scan + npm audit on dependencies
    ↓
Security review checklist (automated + manual)
    ↓
PR review by KingInYellow maintainers
    ↓
Approval & merge to main
    ↓
Automated release tag created (v1.0.0)
    ↓
marketplace.json regenerated
    ↓
Plugin available in marketplace

#### 2.3 Distribution Phase

User: /plugin marketplace add KingInYellow/claude-plugins
  ↓
Claude Code fetches marketplace.json from GitHub
  ↓
User browses available plugins
  ↓
User: /plugin install devops-suite@kingin-yellows
  ↓
Claude Code downloads plugin from source (GitHub release)
  ↓
Plugin installed to cache directory
  ↓
Plugin.json parsed and commands/agents registered
  ↓
MCP/LSP servers launched if configured
  ↓
User can run /deploy, etc.

#### 2.4 Update Phase

Developer pushes to feature branch
  ↓
Version bump in plugin.json (1.0.0 → 1.0.1)
  ↓
CHANGELOG.md updated
  ↓
PR merged, tag created
  ↓
marketplace.json auto-regenerated
  ↓
Users notified via auto-update (if enabled)
  ↓
Plugin updates available

### 3. Core Data Models

#### 3.1 Marketplace Manifest (marketplace.json)

interface MarketplaceManifest {
  // Required
  name: string;                    // "kingin-yellows"
  
  // Metadata
  metadata: {
    description: string;
    version: string;               // Marketplace version
    publisher: string;             // "KingInYellow"
    homepage: string;
    license?: string;
    repositoryUrl: string;
    pluginRoot?: string;           // Base path for relative sources
    
    // Contact info
    contact?: {
      email?: string;
      website?: string;
      github?: string;
    };
  };
  
  // Plugins list
  plugins: PluginEntry[];
  
  // Optional: Categories for discovery
  categories?: Category[];
  
  // Optional: Featured/highlighted plugins
  featured?: string[];             // Plugin names to highlight
}

interface PluginEntry {
  // Required
  name: string;                    // kebab-case, unique
  source: PluginSource;            // GitHub, local, URL
  
  // Metadata (merged with plugin.json)
  displayName?: string;
  version?: string;
  description?: string;
  author?: Author;
  homepage?: string;
  repository?: Repository;
  
  // Classification
  category?: string;
  tags?: string[];
  
  // Component paths (relative to source)
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | { [key: string]: string };
  mcpServers?: string | MCPServerConfig[];
  lspServers?: string | LSPServerConfig[];
  
  // Requirements
  minimumClaude?: string;          // Semantic version (e.g., "1.0.0")
  permissions?: PluginPermissions;
  
  // Control
  strict?: boolean;                // If false, don't require plugin.json
  enabled?: boolean;               // Enable/disable in marketplace
}

type PluginSource = 
  | { type: "github"; repo: string; ref?: string; path?: string }
  | { type: "url"; url: string }
  | { type: "local"; path: string };

interface PluginPermissions {
  filesystem?: ("read" | "write")[];
  network?: ("http" | "https")[];
  environment?: ("read" | "write")[];
  system?: ("execute")[];
}

interface Category {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

#### 3.2 Plugin Manifest (plugin.json)

interface PluginManifest {
  // Required
  name: string;
  version: string;
  description: string;
  
  // Metadata
  displayName?: string;
  author: Author;
  license: string;
  
  // Compatibility
  minimumClaudeVersion?: string;
  engines?: { "claude-code": string };
  
  // Repository & docs
  repository?: Repository;
  homepage?: string;
  bugs?: { url: string; email?: string };
  keywords: string[];
  
  // Permissions (must be declared)
  permissions?: PluginPermissions;
  
  // Components
  commands?: CommandDefinition[];
  agents?: AgentDefinition[];
  hooks?: HookDefinition;
  mcpServers?: MCPServerConfig[];
  lspServers?: LSPServerConfig[];
  
  // Optional metadata for discovery
  category?: string;
  tags?: string[];
  featured?: boolean;
  
  // Lifecycle
  activate?: string;               // Async init file
  deactivate?: string;             // Cleanup file
}

interface CommandDefinition {
  name: string;
  displayName?: string;
  description: string;
  implementation: string;          // Path to implementation
  icon?: string;
  
  // Arguments/parameters
  arguments?: CommandArgument[];
  
  // When to show this command
  when?: string;                   // Activation condition
}

interface CommandArgument {
  name: string;
  description?: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "enum" | "path";
  options?: string[];
  default?: string | number | boolean;
}

interface AgentDefinition {
  name: string;
  description: string;
  implementation: string;
  
  // What this agent specializes in
  capabilities?: string[];
  knowledgeAreas?: string[];
  
  // Configuration
  model?: string;                  // Which Claude model to prefer
  temperature?: number;
  systemPrompt?: string;
}

interface HookDefinition {
  onInit?: string;                 // Initialize plugin
  onActivate?: string;             // When plugin activated
  onDeactivate?: string;           // When plugin deactivated
  onCommand?: string;              // Pre/post command hook
  onError?: string;                // Error handling
}

interface MCPServerConfig {
  name: string;
  description?: string;
  command: string;                 // Executable to run
  args?: string[];
  env?: Record<string, string>;
  
  // Optional: for validation
  version?: string;
  protocol?: string;
}

interface LSPServerConfig {
  language: string;
  command: string;
  args?: string[];
  initializationOptions?: Record<string, any>;
}

### 4. CI/CD Pipeline

#### 4.1 Plugin Validation Workflow (.github/workflows/validate-plugin.yml)

name: Validate Plugin

on:
  pull_request:
    paths:
      - 'plugins/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Detect plugin changes
        id: detect
        run: |
          CHANGED=$(git diff --name-only origin/main HEAD | grep '^plugins/' | cut -d'/' -f2 | sort -u)
          echo "changed_plugins=$CHANGED" >> $GITHUB_OUTPUT
      
      - name: Validate plugin.json schema
        run: |
          npm run validate:schema plugins/${{ matrix.plugin }}
      
      - name: Lint plugin
        run: |
          npm run lint:plugin plugins/${{ matrix.plugin }}
      
      - name: Test plugin
        run: |
          npm run test plugins/${{ matrix.plugin }}
      
      - name: Security: SAST scan
        run: |
          npm run scan:sast plugins/${{ matrix.plugin }}
      
      - name: Security: Dependency scan
        run: |
          npm audit --audit-level=moderate
        working-directory: plugins/${{ matrix.plugin }}

#### 4.2 Security Scanning Workflow

name: Security Scan

on:
  pull_request:
    paths:
      - 'plugins/**'
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      
      - name: SAST with Semgrep
        uses: returntocorp/semgrep-action@v1
        with:
          config: >-
            p/owasp-top-ten
            p/security-audit
      
      - name: Check for secrets
        uses: zricethezav/gitleaks-action@master
        env:
          GITLEAKS_ENABLE_COMMENTS: true

#### 4.3 Release & Deploy Workflow

name: Release Plugin

on:
  push:
    branches:
      - main
    paths:
      - 'plugins/**'

jobs:
  detect-versions:
    runs-on: ubuntu-latest
    outputs:
      plugins: ${{ steps.detect.outputs.plugins }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Detect version changes
        id: detect
        run: |
          # Compare plugin versions with previous releases
          npm run detect:version-changes > versions.json
          echo "plugins=$(cat versions.json)" >> $GITHUB_OUTPUT
  
  release:
    needs: detect-versions
    runs-on: ubuntu-latest
    strategy:
      matrix:
        plugin: ${{ fromJson(needs.detect-versions.outputs.plugins) }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Create release tag
        run: |
          VERSION=$(jq -r '.version' plugins/${{ matrix.plugin }}/plugin.json)
          git tag "${{ matrix.plugin }}-v$VERSION"
          git push origin "${{ matrix.plugin }}-v$VERSION"
      
      - name: Generate marketplace.json
        run: npm run build:marketplace
      
      - name: Deploy marketplace.json
        run: |
          git config user.name "KingInYellow Bot"
          git config user.email "bot@kingin.ai"
          git add marketplace/marketplace.json
          git commit -m "chore: update marketplace for ${{ matrix.plugin }}"
          git push

### 5. Plugin Development Toolkit

#### 5.1 Scaffold Command

npx @kingin-yellows/plugin-scaffold create my-awesome-plugin

# Generated structure:
my-awesome-plugin/
├── .claude-plugin/
│   ├── plugin.json
│   ├── commands/
│   │   └── mycommand.ts
│   ├── agents/
│   ├── hooks/
│   ├── mcp-servers/
│   └── lsp-servers/
├── src/
│   ├── types/
│   ├── services/
│   └── utils/
├── tests/
│   └── unit/
├── docs/
│   ├── README.md
│   ├── usage.md
│   └── examples.md
├── examples/
├── package.json
├── tsconfig.json
└── vitest.config.ts

#### 5.2 Validation Tools

// Validate plugin.json schema
npm run validate plugins/my-plugin

// Run full quality checks
npm run quality:check plugins/my-plugin

// Lint and fix
npm run lint plugins/my-plugin --fix

// Test with coverage
npm run test:coverage plugins/my-plugin

#### 5.3 Local Testing

// Test marketplace locally
/plugin marketplace add ./marketplace

// Install local plugin
/plugin install my-awesome-plugin@kingin-yellows

// Debug mode
/plugin install my-awesome-plugin@kingin-yellows --debug

// View plugin info
/plugin info my-awesome-plugin

### 6. Security Model

#### 6.1 Permission System

Plugins MUST declare permissions in plugin.json:

"permissions": {
  "filesystem": ["read", "write"],
  "network": ["http", "https"],
  "environment": ["read"],
  "system": []
}

Claude Code will:
- Display declared permissions to users during installation
- Enforce declared permissions at runtime
- Allow users to revoke permissions per plugin
- Audit all permission usage

#### 6.2 Submission Checklist

## Plugin Submission Checklist

### Code Quality
- [ ] All TypeScript with strict mode enabled
- [ ] 80%+ test coverage
- [ ] No console.log in production code
- [ ] Proper error handling with try/catch
- [ ] No hardcoded secrets or credentials

### Security
- [ ] Declared all required permissions
- [ ] No eval() or dynamic code execution
- [ ] Sanitized user input before use
- [ ] No direct file system access (use provided APIs)
- [ ] npm audit passes with no high/critical vulnerabilities

### Documentation
- [ ] README.md with quick start
- [ ] Examples for each command/agent
- [ ] TypeScript types exported and documented
- [ ] Usage guide with screenshots/GIFs
- [ ] Troubleshooting section

### Configuration
- [ ] Valid plugin.json schema
- [ ] Meaningful command descriptions
- [ ] Proper error messages
- [ ] Configuration file support (if applicable)

### Testing
- [ ] Unit tests for all public APIs
- [ ] Integration tests for MCP servers
- [ ] E2E test of main workflow
- [ ] CI/CD pipeline configured

### 7. Deployment Strategy

#### 7.1 Marketplace Publishing

1. **GitHub as Single Source of Truth**
   - marketplace.json committed to repo
   - All plugins source from GitHub releases
   - Version history preserved via tags

2. **CDN Distribution** (Future)
   - marketplace.json cached on CDN
   - Plugin packages cached for faster downloads
   - Regional mirrors for latency optimization

3. **Mirroring** (Enterprise)
   - Organizations can mirror marketplace internally
   - Air-gapped deployments supported
   - Custom marketplace overlays allowed

#### 7.2 Update Strategy

Scheduled marketplace refresh
    ↓
Check for plugin updates (daily)
    ↓
If updates found:
  - Run security scan
  - Update marketplace.json
  - Notify subscribed users
    ↓
Users receive update notification
    ↓
Auto-update enabled → immediate install
    ↓
Auto-update disabled → users install manually

---

## Appendix: Plugin Examples

### Example 1: Minimal Plugin (Single Command)

{
  "name": "hello-world",
  "version": "1.0.0",
  "description": "Simple greeting plugin",
  "author": { "name": "Your Name" },
  "license": "MIT",
  "commands": [
    {
      "name": "hello",
      "description": "Say hello",
      "implementation": "./src/commands/hello.ts"
    }
  ]
}

### Example 2: Plugin with MCP Server

{
  "name": "database-tools",
  "version": "1.0.0",
  "description": "Database operations via MCP",
  "mcpServers": [
    {
      "name": "postgresql",
      "command": "node",
      "args": ["./dist/mcp-server.js"],
      "env": { "DATABASE_URL": "postgresql://..." }
    }
  ]
}

### Example 3: Plugin with Agent

{
  "name": "architecture-expert",
  "version": "1.0.0",
  "agents": [
    {
      "name": "system-architect",
      "description": "Expert in designing scalable systems",
      "implementation": "./src/agents/architect.ts",
      "capabilities": ["microservices", "kubernetes", "distributed-systems"]
    }
  ]
}

---

## Getting Started

### For Users
1. Add marketplace: `/plugin marketplace add KingInYellow/claude-plugins`
2. Browse plugins: `/plugin` → Discover tab
3. Install: `/plugin install devops-suite@kingin-yellows`

### For Plugin Creators
1. Fork KingInYellow/claude-plugins
2. Run scaffold: `npx @kingin-yellows/plugin-scaffold create my-plugin`
3. Develop locally with `npm run dev`
4. Submit PR following submission guidelines
5. Security review + approval
6. Merge & automatic release

### For Organizations
1. Fork marketplace or create overlay
2. Configure in `.claude/settings.json`:
   {
     "extraKnownMarketplaces": {
       "company-plugins": {
         "source": "github",
         "repo": "your-org/claude-plugins"
       }
     },
     "enabledPlugins": {
       "devops-suite@kingin-yellows": true
     }
   }
3. Team members see plugins on trust

---

*Last Updated: January 10, 2026*
