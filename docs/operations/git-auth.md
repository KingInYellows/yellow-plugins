# Git Authentication for Publishing

**Document Version**: 1.0.0 **Last Updated**: 2026-01-12 **Part of**: Task
I4.T1 - Publish Service and CLI Command

---

## Overview

The Yellow Plugins marketplace publish command relies on your existing git
credentials for authentication when pushing changes to remote repositories. The
system does not store any credentials; all authentication is handled by git
itself using your configured SSH keys or Personal Access Tokens (PATs).

This document explains the git authentication prerequisites, setup procedures,
and troubleshooting steps for publishing plugins.

---

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Authentication Methods](#authentication-methods)
- [SSH Keys Setup](#ssh-keys-setup)
  - [Check Existing SSH Keys](#check-existing-ssh-keys)
  - [Generate New SSH Key](#generate-new-ssh-key)
  - [Add SSH Key to GitHub](#add-ssh-key-to-github)
  - [Test SSH Connection](#test-ssh-connection)
- [Personal Access Tokens (PAT)](#personal-access-tokens-pat)
  - [Create a PAT](#create-a-pat)
  - [Configure PAT for Git](#configure-pat-for-git)
  - [Test PAT Authentication](#test-pat-authentication)
- [Troubleshooting Authentication Errors](#troubleshooting-authentication-errors)
  - [SSH Authentication Failed](#ssh-authentication-failed)
  - [HTTPS Authentication Failed](#https-authentication-failed)
  - [Permission Denied](#permission-denied)
- [Rollback Procedures for Failed Pushes](#rollback-procedures-for-failed-pushes)
  - [Scenario 1: Push Failed After Commit](#scenario-1-push-failed-after-commit)
  - [Scenario 2: Partial Push (Some Refs Failed)](#scenario-2-partial-push-some-refs-failed)
  - [Scenario 3: Network Timeout](#scenario-3-network-timeout)
- [Security Best Practices](#security-best-practices)
- [CI/CD Integration](#cicd-integration)
- [Traceability](#traceability)
- [See Also](#see-also)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

---

## Authentication Methods

The Yellow Plugins publish command supports two git authentication methods:

1. **SSH Keys** (Recommended) - More secure, no password/token needed after
   setup
2. **Personal Access Tokens (PAT)** - Required for HTTPS remotes, useful for
   CI/CD

**Important**: The system does NOT store credentials. You must configure
authentication at the git level before using the publish command.

---

## SSH Keys Setup

### Check Existing SSH Keys

First, check if you already have SSH keys configured:

```bash
ls -la ~/.ssh
```

Look for files named:

- `id_rsa` and `id_rsa.pub` (RSA keys)
- `id_ed25519` and `id_ed25519.pub` (Ed25519 keys, recommended)

If you see these files, you likely already have SSH keys configured.

### Generate New SSH Key

If you don't have SSH keys or want to create a new one:

```bash
# Generate Ed25519 key (recommended)
ssh-keygen -t ed25519 -C "your_email@example.com"

# Or generate RSA key (4096-bit)
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
```

When prompted:

1. Accept the default file location (press Enter)
2. Enter a secure passphrase (optional but recommended)

### Add SSH Key to GitHub

1. Copy your public key to clipboard:

```bash
# For Ed25519
cat ~/.ssh/id_ed25519.pub

# For RSA
cat ~/.ssh/id_rsa.pub
```

2. Go to GitHub Settings: https://github.com/settings/keys
3. Click "New SSH key"
4. Paste your public key
5. Give it a descriptive title (e.g., "Dev Machine - 2026")
6. Click "Add SSH key"

### Test SSH Connection

Verify your SSH key is working:

```bash
ssh -T git@github.com
```

Expected output:

```
Hi username! You've successfully authenticated, but GitHub does not provide shell access.
```

If successful, you can now use the publish command with SSH remotes.

---

## Personal Access Tokens (PAT)

### Create a PAT

1. Go to GitHub Settings: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Yellow Plugins Publish")
4. Select expiration (90 days recommended, or custom)
5. Select scopes:
   - **Required**: `repo` (Full control of private repositories)
   - This grants push access to your repositories
6. Click "Generate token"
7. **Important**: Copy the token immediately - you won't be able to see it again

### Configure PAT for Git

**Option 1: Store PAT in Git Credential Helper** (Recommended)

```bash
# Enable credential helper
git config --global credential.helper store

# Push once to cache credentials (will prompt for username/token)
git push origin main

# When prompted:
# Username: your-github-username
# Password: <paste your PAT here>
```

Your credentials are now stored in `~/.git-credentials`.

**Option 2: Include PAT in Remote URL** (Not recommended for security)

```bash
git remote set-url origin https://YOUR_TOKEN@github.com/username/repo.git
```

**Option 3: Use Environment Variable**

```bash
# Set PAT as environment variable
export GIT_TOKEN="ghp_yourPersonalAccessToken"

# Use in git commands
git push https://${GIT_TOKEN}@github.com/username/repo.git
```

### Test PAT Authentication

```bash
# Try pushing to your repository
git push origin main
```

If successful, you should see:

```
Enumerating objects: 5, done.
Counting objects: 100% (5/5), done.
...
To https://github.com/username/repo.git
   a1b2c3d..e4f5g6h  main -> main
```

---

## Troubleshooting Authentication Errors

### SSH Authentication Failed

**Error**:

```
Permission denied (publickey).
fatal: Could not read from remote repository.
```

**Resolution**:

1. Verify SSH key is added to ssh-agent:

```bash
ssh-add -l
```

2. If empty, add your key:

```bash
ssh-add ~/.ssh/id_ed25519
```

3. Test connection again:

```bash
ssh -T git@github.com
```

4. If still failing, check your SSH config:

```bash
cat ~/.ssh/config
```

Add if missing:

```
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
```

### HTTPS Authentication Failed

**Error**:

```
Authentication failed for 'https://github.com/username/repo.git'
```

**Resolution**:

1. Verify your PAT is valid (not expired)
2. Verify PAT has `repo` scope
3. Clear cached credentials:

```bash
git config --global --unset credential.helper
git config --global credential.helper store
```

4. Try pushing again (will prompt for credentials)

### Permission Denied

**Error**:

```
ERROR: Permission to username/repo.git denied to user.
fatal: Could not read from remote repository.
```

**Resolution**:

1. Verify you have push access to the repository:
   - Go to repository Settings → Collaborators
   - Ensure your account has Write or Admin access

2. Verify remote URL is correct:

```bash
git remote -v
```

3. If using SSH, verify you're using the correct GitHub account:

```bash
ssh -T git@github.com
```

---

## Rollback Procedures for Failed Pushes

### Scenario 1: Push Failed After Commit

If the publish command committed changes locally but failed to push:

**Check local commit status**:

```bash
git log -1
git status
```

**Option A: Retry Push Manually**

```bash
git push origin main
```

**Option B: Undo Commit (Keep Changes)**

```bash
git reset --soft HEAD~1
```

This keeps your changes staged. You can now:

- Fix authentication issues
- Re-run the publish command

**Option C: Undo Commit and Changes**

```bash
git reset --hard HEAD~1
```

**Warning**: This discards all changes. Only use if you want to start over.

### Scenario 2: Partial Push (Some Refs Failed)

If tags were created but not pushed:

**Check tag status**:

```bash
git tag -l
git ls-remote --tags origin
```

**Push tags manually**:

```bash
git push origin --tags
```

### Scenario 3: Network Timeout

If push failed due to network issues:

**Check repository status**:

```bash
git status
git log origin/main..HEAD
```

**Retry after network recovery**:

```bash
git push origin main
```

The commit is safe locally. You can retry the push at any time.

---

## Security Best Practices

1. **Never commit credentials**: Do not add PATs or private keys to git
   repositories
2. **Use SSH keys with passphrases**: Adds an extra layer of security
3. **Rotate PATs regularly**: Set expiration dates and regenerate tokens
4. **Use fine-grained PATs**: GitHub offers fine-grained tokens with
   repository-specific access
5. **Store credentials securely**:
   - Use system keychains (macOS Keychain, Windows Credential Manager)
   - Avoid plaintext storage in `.git-credentials`
6. **Audit access**: Regularly review SSH keys and PATs in GitHub settings

---

## CI/CD Integration

For automated publishing in CI/CD pipelines:

### GitHub Actions

```yaml
name: Publish Plugin

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Configure Git
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"

      - name: Publish Plugin
        env:
          GIT_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git remote set-url origin https://x-access-token:${GIT_TOKEN}@github.com/${{ github.repository }}.git
          npm run plugin:publish -- --push --tag ${{ github.ref_name }}
```

**Security Notes**:

- Use GitHub's built-in `GITHUB_TOKEN` for authentication
- Token is automatically provided and scoped to the repository
- No need to create or store personal PATs

### GitLab CI

```yaml
publish:
  stage: deploy
  only:
    - tags
  script:
    - git config user.name "GitLab CI"
    - git config user.email "ci@gitlab.com"
    - git remote set-url origin
      https://oauth2:${CI_JOB_TOKEN}@gitlab.com/${CI_PROJECT_PATH}.git
    - npm run plugin:publish -- --push --tag $CI_COMMIT_TAG
```

---

## Traceability

- **FR-008 – Update Notifications**: Documents
  publish prerequisites (PAT/SSH) and remote push recovery steps so release
  automation can rely on git-native workflows.
- **Assumption 2 – Git Authentication**:
  Reinforces that existing developer credentials (SSH keys or PATs) power all
  publish operations—no additional secrets are stored by the CLI.

---

## See Also

- [Publish Command Documentation](../cli/publish.md) - Complete publish workflow
- [Feature Flags Documentation](./feature-flags.md) - Enabling publish
  functionality
- [GitHub SSH Key Documentation](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) -
  Official GitHub guide
- [GitHub PAT Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) -
  Official GitHub guide
