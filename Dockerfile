# Yellow Plugins CI Container
# Purpose: Reproducible build environment for GitHub Actions workflows
# Node 20 LTS Slim (digest-pinned for immutability)
# Last updated: 2026-01-12

FROM node:20-slim@sha256:a22f79e64de59efd3533828aecc9817bfdc1cd37dde598aa27d6065e7b1f0abc

LABEL maintainer="KingInYellows"
LABEL description="CI environment for yellow-plugins validation and testing"
LABEL version="1.0.0"

# Install essential tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git=1:2.39.* \
    ca-certificates=20230311 \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm (locked version matching packageManager field)
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Install global validation tools
RUN npm install -g --no-fund --no-audit \
    ajv-cli@5.0.0 \
    typescript@5.3.3

# Set working directory
WORKDIR /workspace

# Copy package metadata for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/
COPY packages/cli/package.json packages/cli/
COPY packages/infrastructure/package.json packages/infrastructure/

# Pre-install dependencies (layer cache optimization)
# This layer is invalidated only when lockfile changes
RUN pnpm install --frozen-lockfile --prefer-offline

# Copy rest of workspace
COPY . .

# Verify installation
RUN node --version && \
    pnpm --version && \
    ajv --version && \
    git --version

# Default command: run validation suite
CMD ["pnpm", "validate:schemas"]
