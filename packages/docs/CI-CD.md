# Cyberstrike CI/CD Guide

This document explains the Cyberstrike project's CI/CD pipeline, Git branching strategy, and release processes.

---

## Overview

Cyberstrike uses a **simplified Git Flow** branching strategy with tag-based releases:

- **`main`** — Production-ready code. Protected branch. Only receives merges from `dev` via PR.
- **`dev`** — Integration branch (default). All feature branches merge here first.
- **`feat/*`, `fix/*`** — Short-lived branches cut from `dev` for individual changes.
- **`hotfix/*`** — Emergency fixes cut from `main`, merged to both `main` and `dev`.
- Tag-based releases: `v1.0.7`, `v1.0.8-beta.1`

```
main ──────────●──────────────────●──────── (stable releases only)
               ↑                  ↑
dev ───●───●───●───●───●───●──●───●──────── (integration, default branch)
       ↑   ↑       ↑       ↑
       │   │       │       └── feat/wstg-skills
       │   │       └── feat/mcp-update
       │   └── fix/browser-tool
       └── fix/ci-workflow
```

### Why This Strategy?

Previously we used trunk-based development (everything merged directly to `main`). This caused problems:

1. **No safety net** — A bad commit on `main` immediately affected the stable branch
2. **No integration testing** — Features went straight to production without testing alongside other changes
3. **No collaboration workflow** — Multiple developers couldn't work independently and merge safely
4. **No beta path** — No way to accumulate features, test them together, then release

The simplified Git Flow gives us:
- **`dev`** as a staging area where features are integrated and tested together
- **`main`** stays stable — only tested, approved code gets promoted
- **Feature branches** let multiple developers work in parallel without conflicts
- **Beta releases** from `dev` let us test before going to production
- **Hotfix path** for critical bugs that can't wait for the next release cycle

### Branch Protection

| Branch | Direct Push | Force Push | Merge Method | Who Merges |
|--------|------------|------------|--------------|------------|
| `main` | Blocked | Blocked | PR only (from `dev` or `hotfix/*`) | Maintainers |
| `dev` | Allowed (small fixes) | Blocked | PR preferred, direct push OK | All developers |

### Workflows

| Workflow | File | Trigger | Description |
|----------|------|---------|-------------|
| PR Check: TypeScript Validation | `typecheck.yml` | On PR | TypeScript type checking |
| PR Check: Run Tests | `test.yml` | On PR | Linux + Windows tests |
| PR Check: Code Coverage | `coverage.yml` | Push to main/dev, PR | Test coverage reports |
| Security: CodeQL Analysis | `security-scan.yml` | Push to main/dev, PR, Weekly | Static code security analysis |
| PR: Auto Label | `auto-label.yml` | On PR | Automatic PR labeling |
| Release: Auto Changelog | `auto-changelog.yml` | On Release | Automatic release notes |
| PR Check: Bundle Size | `bundle-size.yml` | On PR | CLI bundle size tracking |
| PR Check: Lighthouse CI | `lighthouse.yml` | On PR (docs/web) | Web performance testing |
| Release: CLI to npm + Desktop to GitHub | `release-cli.yml` | `v*` tag | npm and GitHub release |
| Deploy: SST to Cloudflare | `deploy.yml` | `production` push | Backend deployment |
| Community: Update Contributors | `contributors.yml` | Push to main/dev | Auto-generate CONTRIBUTORS.md |
| Community: Discord Notify | `notify-discord.yml` | On Release | Discord release announcements |
| Community: Discord Blog Notify | `notify-discord-blog.yml` | Cron (30m) | Discord blog post announcements |

### Automated Dependencies

| Tool | File | Target Branch | Schedule | Description |
|------|------|---------------|----------|-------------|
| Dependabot | `dependabot.yml` | `dev` | Weekly (Monday) | Automatic dependency updates |

> **Note:** Dependabot PRs target `dev`, not `main`. This ensures dependency updates are tested in the integration branch before reaching production.

---

## 1. Git Branching Strategy (Detailed)

### 1.1 Branch Types

#### `main` — Production Branch
- Always contains stable, released code
- Protected: no direct pushes, no force pushes
- Only updated via:
  - PR from `dev` (regular releases)
  - PR from `hotfix/*` (emergency fixes)
- Release tags (`v*`) are created from `main`

#### `dev` — Integration Branch (Default)
- Where all feature work merges first
- The default branch on GitHub (PRs target here by default)
- Should always be in a "buildable" state
- Beta releases are tagged from `dev`
- Dependabot PRs target `dev`

#### `feat/*` — Feature Branches
- Cut from `dev`, merged back to `dev` via PR
- Naming: `feat/short-description` (e.g., `feat/wstg-agent-skills`)
- Deleted after merge
- Short-lived: ideally merged within days, not weeks

#### `fix/*` — Bug Fix Branches
- Cut from `dev`, merged back to `dev` via PR
- Naming: `fix/short-description` (e.g., `fix/browser-crash`)
- For non-critical bugs found during development

#### `hotfix/*` — Emergency Fix Branches
- Cut from `main`, merged to **both** `main` AND `dev`
- Naming: `hotfix/short-description` (e.g., `hotfix/auth-bypass`)
- Only for critical bugs in production that can't wait

### 1.2 Daily Development Workflow

```bash
# 1. Make sure you're on dev and up to date
git checkout dev
git pull origin dev

# 2. Create a feature branch
git checkout -b feat/my-new-feature

# 3. Develop (make commits)
git add .
git commit -m "feat(browser): add screenshot capture"

# 4. Push and create PR (targets dev by default)
git push origin feat/my-new-feature
gh pr create --title "feat(browser): add screenshot capture" --body "Description..."

# 5. After review and CI passes, merge to dev
gh pr merge --squash

# 6. Clean up
git checkout dev
git pull origin dev
git branch -d feat/my-new-feature
```

### 1.3 Release Workflow

```bash
# 1. Ensure dev is stable (all tests pass, features working)
git checkout dev
git pull origin dev

# 2. Optional: tag a beta from dev for testing
git tag v1.1.0-beta.1
git push origin v1.1.0-beta.1

# 3. When beta is validated, create PR from dev → main
gh pr create --base main --title "release: v1.1.0" --body "Release notes..."

# 4. Merge to main
gh pr merge --merge

# 5. Tag the stable release from main
git checkout main
git pull origin main
git tag v1.1.0
git push origin v1.1.0
```

### 1.4 Hotfix Workflow

```bash
# 1. Cut hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-auth-bug

# 2. Fix the bug
git add .
git commit -m "fix(critical): patch authentication bypass"

# 3. PR to main
git push origin hotfix/critical-auth-bug
gh pr create --base main --title "hotfix: patch auth bypass"

# 4. After merge to main, also merge to dev
git checkout dev
git pull origin dev
git merge main
git push origin dev
```

### 1.5 For External Contributors

External contributors should:

1. **Fork** the repository on GitHub
2. **Clone** their fork locally
3. Create a **feature branch** from `dev`
4. Push to their fork
5. Open a **PR targeting `dev`** on the main repo

```bash
# Fork on GitHub first, then:
git clone https://github.com/YOUR_USERNAME/cyberstrike.io.git
cd cyberstrike.io
git remote add upstream https://github.com/CyberStrikeus/cyberstrike.io.git

# Stay in sync
git fetch upstream
git checkout dev
git merge upstream/dev

# Create feature branch
git checkout -b feat/my-contribution
# ... work ...
git push origin feat/my-contribution
# Open PR on GitHub targeting CyberStrikeus/cyberstrike.io:dev
```

### Commit Message Format (Conventional Commits)

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code formatting (no functional change)
- `refactor`: Code refactoring
- `test`: Adding/fixing tests
- `chore`: Build, CI, dependency updates

**Examples:**
```bash
git commit -m "feat(browser): add interactive Playwright installation"
git commit -m "fix(auth): resolve token refresh issue"
git commit -m "docs: update CI/CD documentation"
git commit -m "chore: bump version to 1.0.7"
```

---

## 2. Pull Request Process

All PRs target `dev` by default (since `dev` is the default branch). PRs to `main` are only for releases and hotfixes.

### Steps

```bash
# 1. Create feature branch from dev
git checkout dev && git pull origin dev
git checkout -b feat/new-feature

# 2. Develop
# ... write code ...

# 3. Commit and push
git add .
git commit -m "feat: new feature description"
git push origin feat/new-feature

# 4. Open PR on GitHub (targets dev automatically)
gh pr create --title "feat: new feature" --body "Description..."
```

### Automated Checks

These workflows run when a PR is opened:

| Workflow | Check | Duration |
|----------|-------|----------|
| PR Check: TypeScript Validation | Type errors | ~1 min |
| PR Check: Run Tests (Linux + Windows) | E2E tests | ~5 min |

A checkmark or X indicator appears on the PR. Don't merge until all checks pass.

### PR Merge

```bash
# Squash merge (recommended for feature branches)
gh pr merge --squash

# Or use GitHub UI "Squash and merge"
```

---

## 3. Release Process

### 3.1 Stable Release (e.g., v1.0.7)

Used for production-ready versions. Code must be on `main`.

```bash
# 1. Create PR from dev → main
gh pr create --base main --title "release: v1.0.7" --body "## Changes\n- ..."

# 2. Merge to main (after review)
gh pr merge --merge

# 3. Update version (package.json) on main
git checkout main && git pull origin main
# Edit packages/cyberstrike/package.json
git add . && git commit -m "chore: bump version to 1.0.7"
git push origin main

# 4. Create tag (triggers release workflow)
git tag v1.0.7
git push origin v1.0.7
```

**Result:**
- `@cyberstrike-io/cli@1.0.7` published to npm (`latest` tag)
- GitHub Release created
- Desktop binaries (Windows, macOS, Linux) attached

**User installation:**
```bash
npm install -g @cyberstrike-io/cli
# or
npm install -g @cyberstrike-io/cli@1.0.7
```

### 3.2 Beta Release (e.g., v1.0.8-beta.1)

Used for early test versions. Tagged from `dev`.

```bash
# Tag from dev branch
git checkout dev && git pull origin dev
git tag v1.0.8-beta.1
git push origin v1.0.8-beta.1
```

**Result:**
- `@cyberstrike-io/cli@1.0.8-beta.1` published to npm (`beta` tag)
- GitHub Pre-release created

**User installation:**
```bash
npm install -g @cyberstrike-io/cli@beta
```

### 3.3 Other Pre-release Types

| Type | Tag Format | npm Tag | Tagged From | Usage |
|------|------------|---------|-------------|-------|
| Alpha | `v1.0.8-alpha.1` | `alpha` | `dev` or feature branch | Early development, unstable |
| Beta | `v1.0.8-beta.1` | `beta` | `dev` | Feature-complete, testing phase |
| RC | `v1.0.8-rc.1` | `rc` | `dev` | Release candidate, final testing |
| Stable | `v1.0.8` | `latest` | `main` | Production-ready |

```bash
# Alpha release (from dev)
git tag v1.0.8-alpha.1 && git push origin v1.0.8-alpha.1

# Beta release (from dev)
git tag v1.0.8-beta.1 && git push origin v1.0.8-beta.1

# Release candidate (from dev)
git tag v1.0.8-rc.1 && git push origin v1.0.8-rc.1

# Stable release (from main only)
git checkout main
git tag v1.0.8 && git push origin v1.0.8
```

---

## 4. Production Deployment

Used to deploy backend/API changes to production.

```bash
# Push from main to production
git push origin main:production
```

**Workflow:** `Deploy: SST to Cloudflare (Production)`

**What gets deployed:**
- SST (Serverless Stack) to Cloudflare Workers
- API endpoints
- Database migrations (if any)

---

## 5. Manual Workflow Triggering

You can manually run any workflow:

### GitHub UI
1. Go to GitHub repo → Actions tab
2. Select workflow from left menu
3. Click "Run workflow" button
4. Select branch and click "Run workflow"

### GitHub CLI
```bash
# Manually trigger release workflow
gh workflow run "Release: CLI to npm + Desktop to GitHub"

# Manually trigger test workflow
gh workflow run "PR Check: Run Tests (Linux + Windows)"
```

---

## 6. Error Handling

### Wrong Tag Created

```bash
# Delete local tag
git tag -d v1.0.7

# Delete remote tag
git push origin :v1.0.7

# or
git push origin --delete v1.0.7
```

### Workflow Failed

1. Go to GitHub Actions → Click on the failed workflow run
2. Review error logs
3. Fix the issue and retry

```bash
# Re-release with same tag (delete first, then recreate)
git push origin :v1.0.7
git tag -d v1.0.7
git tag v1.0.7
git push origin v1.0.7
```

### npm Publish Failed

- Ensure `NPM_TOKEN` secret is valid
- Verify package name is available on npm
- Use automation token for accounts with 2FA

---

## 7. Version Management

### Semantic Versioning (SemVer)

Format: `MAJOR.MINOR.PATCH`

| Change | When | Example |
|--------|------|---------|
| MAJOR | Breaking change | `1.0.0` → `2.0.0` |
| MINOR | New feature (backward compatible) | `1.0.0` → `1.1.0` |
| PATCH | Bug fix | `1.0.0` → `1.0.1` |

### Version Update

```bash
# Manual update
# Edit packages/cyberstrike/package.json

# Commit
git add packages/cyberstrike/package.json
git commit -m "chore: bump version to 1.0.8"
git push origin main

# Tag and release
git tag v1.0.8
git push origin v1.0.8
```

---

## 8. Best Practices

### Do's

- Always branch from `dev` for new work (`feat/*`, `fix/*`)
- Always create PRs — even for small changes (builds good habits)
- Ensure tests pass before merging any PR
- Tag beta releases from `dev` before promoting to `main`
- Follow semantic versioning rules
- Write meaningful commit messages using conventional commits
- Sync `dev` with `main` after hotfixes (`git merge main` on dev)
- Delete feature branches after merging

### Don'ts

- Don't push directly to `main` — always use PRs
- Don't force push to `main` or `dev`
- Don't tag stable releases from `dev` — only from `main`
- Don't release without testing (beta first, then stable)
- Don't reuse the same version number
- Don't leave npm tokens in code
- Don't let feature branches live longer than 1-2 weeks

---

## 9. Example Scenarios

### Scenario 1: Bug Fix Release

```bash
# 1. Create fix branch from dev
git checkout dev && git pull origin dev
git checkout -b fix/login-timeout

# 2. Fix the bug
git add .
git commit -m "fix(auth): resolve login timeout issue"
git push origin fix/login-timeout

# 3. PR to dev, merge after CI passes
gh pr create --title "fix(auth): resolve login timeout" --body "Fixes #42"
gh pr merge --squash

# 4. When ready to release: PR from dev → main
git checkout dev && git pull origin dev
gh pr create --base main --title "release: v1.0.7"
gh pr merge --merge

# 5. Tag and release from main
git checkout main && git pull origin main
# Update package.json version
git add . && git commit -m "chore: bump version to 1.0.7"
git push origin main
git tag v1.0.7
git push origin v1.0.7
```

### Scenario 2: New Feature + Beta Testing

```bash
# 1. Develop feature on a branch
git checkout dev && git pull origin dev
git checkout -b feat/screenshot-capture
git add .
git commit -m "feat(browser): add screenshot capture"
git push origin feat/screenshot-capture

# 2. PR to dev, merge after CI passes
gh pr create --title "feat(browser): add screenshot capture"
gh pr merge --squash

# 3. Beta release from dev
git checkout dev && git pull origin dev
git tag v1.1.0-beta.1
git push origin v1.1.0-beta.1

# 4. Get feedback, fix issues on another branch
git checkout -b fix/screenshot-quality
git add .
git commit -m "fix(browser): improve screenshot quality"
git push origin fix/screenshot-quality
gh pr create --title "fix(browser): improve screenshot quality"
gh pr merge --squash

# 5. Second beta from dev
git checkout dev && git pull origin dev
git tag v1.1.0-beta.2
git push origin v1.1.0-beta.2

# 6. When beta is validated, promote to main
gh pr create --base main --title "release: v1.1.0"
gh pr merge --merge

# 7. Stable release from main
git checkout main && git pull origin main
# Update package.json version
git add . && git commit -m "chore: bump version to 1.1.0"
git push origin main
git tag v1.1.0
git push origin v1.1.0
```

### Scenario 3: Hotfix (Critical Production Bug)

```bash
# 1. Cut hotfix branch from main (not dev!)
git checkout main && git pull origin main
git checkout -b hotfix/auth-bypass

# 2. Fix the critical bug
git add .
git commit -m "fix(critical): patch authentication bypass vulnerability"
git push origin hotfix/auth-bypass

# 3. PR to main (fast-track, skip dev)
gh pr create --base main --title "hotfix: patch auth bypass"
gh pr merge --merge

# 4. Immediate release from main
git checkout main && git pull origin main
# Update package.json version
git add . && git commit -m "chore: bump version to 1.0.8"
git push origin main
git tag v1.0.8
git push origin v1.0.8

# 5. IMPORTANT: Sync the fix back to dev
git checkout dev && git pull origin dev
git merge main
git push origin dev
```

---

## 10. Useful Commands

```bash
# List all tags
git tag -l

# Last 5 tags
git tag -l | tail -5

# Tag details
git show v1.0.7

# Workflow status
gh run list --limit 5

# Workflow logs
gh run view <run-id> --log

# npm versions
npm view @cyberstrike-io/cli versions

# npm latest version
npm view @cyberstrike-io/cli version

# npm beta version
npm view @cyberstrike-io/cli dist-tags.beta
```

---

## 11. Security Scanning (CodeQL)

### Why Security Scanning?

For a security testing tool like Cyberstrike, code security is paramount. CodeQL provides:

- **Static Analysis**: Detects vulnerabilities before runtime
- **OWASP Coverage**: Identifies SQL injection, XSS, command injection, etc.
- **Automated Auditing**: Every PR and push is automatically scanned
- **GitHub Integration**: Results appear in Security tab and PR comments

### How It Works

CodeQL analyzes the codebase using semantic queries:

1. **Build Phase**: Creates a database of the code structure
2. **Analysis Phase**: Runs security queries against the database
3. **Report Phase**: Generates findings with severity levels

### When It Runs

| Trigger | Description |
|---------|-------------|
| Push to main/dev | Every commit is scanned |
| Pull Request | PRs are blocked if critical issues found |
| Weekly (Monday 00:00 UTC) | Scheduled scan for new vulnerability patterns |
| Manual | Can be triggered from Actions tab |

### Viewing Results

1. Go to GitHub repo → Security tab → Code scanning alerts
2. Or view in PR → Checks → CodeQL

### Severity Levels

| Level | Action |
|-------|--------|
| Critical | Block merge, fix immediately |
| High | Block merge, fix before release |
| Medium | Warning, fix in next sprint |
| Low | Informational, fix when convenient |

### Customization

The workflow uses extended security queries:
- `security-extended`: Additional security rules
- `security-and-quality`: Code quality + security combined

---

## 12. Dependency Management (Dependabot)

### Why Dependabot?

Outdated dependencies are a major security risk. Dependabot provides:

- **Automatic Updates**: Creates PRs for outdated packages
- **Security Alerts**: Notifies when dependencies have known vulnerabilities
- **Version Grouping**: Groups minor/patch updates to reduce PR noise
- **GitHub Actions**: Also keeps workflow actions up to date

### Configuration

Located at `.github/dependabot.yml`:

```yaml
version: 2
updates:
  # npm dependencies
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      minor-and-patch:
        patterns: ["*"]
        update-types: ["minor", "patch"]

  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### How It Works

1. **Weekly Scan**: Every Monday, Dependabot checks for updates
2. **PR Creation**: Creates PRs for outdated dependencies
3. **Grouping**: Minor and patch updates are grouped together
4. **CI Check**: Your existing test/typecheck workflows run on these PRs
5. **Review & Merge**: Review the PR, then merge if tests pass

### Handling Dependabot PRs

```bash
# View open Dependabot PRs
gh pr list --author "dependabot[bot]"

# Merge a Dependabot PR
gh pr merge <PR_NUMBER> --squash
```

### Security Alerts

When a dependency has a known vulnerability:
1. GitHub creates a security alert
2. Dependabot creates a security update PR
3. These PRs are marked with "security" label
4. **Priority**: Merge security PRs immediately

### Ignoring Updates

Major version updates are ignored by default to prevent breaking changes:

```yaml
ignore:
  - dependency-name: "*"
    update-types: ["version-update:semver-major"]
```

To update a major version manually:
```bash
# Update a specific package
bun update <package-name>

# Or edit package.json and run
bun install
```

---

## 13. Automatic PR Labeling

### Why Auto Label?

Manual labeling is tedious and inconsistent. Auto Label provides:

- **Consistency**: Every PR gets labeled the same way
- **Filtering**: Easily filter PRs by type, scope, or package
- **Changelog**: Labels drive automatic release notes generation
- **Visibility**: Instantly see what a PR affects without reading the diff

### How It Works

The workflow runs on every PR and applies labels based on two criteria:

**1. PR Title (Conventional Commits)**

| Title Prefix | Label |
|--------------|-------|
| `feat:` | `feature` |
| `fix:` | `bug` |
| `docs:` | `documentation` |
| `refactor:` | `refactor` |
| `perf:` | `performance` |
| `test:` | `testing` |
| `chore:` | `chore` |
| `ci:` | `ci` |

**2. Scope in Title**

| Scope | Label |
|-------|-------|
| `(cli)` | `cli` |
| `(tui)` | `tui` |
| `(sdk)` | `sdk` |
| `(web)` | `web` |
| `(mcp)` | `mcp` |
| `(security)` | `security` |
| `(deps)` | `dependencies` |

**3. Files Changed**

| Path | Label |
|------|-------|
| `packages/cyberstrike/` | `cli` |
| `packages/web/` | `web` |
| `packages/sdk/` | `sdk` |
| `packages/desktop/` | `desktop` |
| `docs/` or `*.md` | `documentation` |
| `.github/` | `ci` |
| `*test*` or `*spec*` | `testing` |

**4. Special Cases**

| Condition | Label |
|-----------|-------|
| Dependabot PR | `dependencies` + `automated` |
| Title contains `breaking` or `!:` | `breaking-change` |
| Title contains `urgent` | `priority-high` |

### Example

A PR titled `feat(cli): add new scan command` that modifies files in `packages/cyberstrike/` will get:
- `feature` (from `feat:` prefix)
- `cli` (from `(cli)` scope and file path)

### Viewing Labels

```bash
# List all labels
gh label list

# Filter PRs by label
gh pr list --label feature
gh pr list --label bug
```

---

## 14. Automatic Changelog (Release Notes)

### Why Auto Changelog?

Writing release notes manually is time-consuming and error-prone. Auto Changelog provides:

- **Automatic Generation**: Creates release notes from commit history
- **Categorization**: Groups changes by type (features, fixes, security, etc.)
- **Consistency**: Every release follows the same format
- **Traceability**: Each entry links to its commit

### How It Works

When a GitHub Release is created:

1. **Tag Detection**: Identifies the current and previous tags
2. **Commit Analysis**: Reads all commits between the two tags
3. **Categorization**: Sorts commits by conventional commit prefix
4. **Formatting**: Generates markdown with categories, icons, and commit links
5. **Update**: Updates the GitHub Release body with the generated notes

### Categories

| Prefix | Category | Icon |
|--------|----------|------|
| `feat:` | Features | 🚀 |
| `fix:` | Bug Fixes | 🐛 |
| `security` keyword | Security | 🔒 |
| `perf:` | Performance | ⚡ |
| `docs:` | Documentation | 📝 |
| `ci:`, `chore(ci):` | CI/CD | ⚙️ |
| Other | Other | 📦 |

### Example Output

```markdown
### 🚀 Features

- Add interactive Playwright installation prompt ([`abc1234`])
- Add CodeQL security scanning workflow ([`def5678`])

### 🐛 Bug Fixes

- Update @clack/prompts API compatibility ([`ghi9012`])

### 🔒 Security

- Update astro packages to patch vulnerabilities ([`jkl3456`])

---

### Installation
npm install -g @cyberstrike-io/cli
```

### When It Runs

| Trigger | Description |
|---------|-------------|
| Release created | Automatically updates the release notes |
| Manual | Run with a specific tag via Actions tab |

### Manual Trigger

```bash
# Generate changelog for a specific tag
gh workflow run "Release: Auto Changelog" --field tag=v1.0.7
```

### Prerequisites

For the best results, follow [Conventional Commits](https://www.conventionalcommits.org/) in your commit messages:

```bash
feat(cli): add new scan command          # → Features
fix(auth): resolve token refresh issue   # → Bug Fixes
fix(security): patch XSS vulnerability   # → Security
perf(tui): optimize rendering            # → Performance
docs: update getting started guide       # → Documentation
chore(ci): update CodeQL action          # → CI/CD
```

---

## 15. Code Coverage

### Why Code Coverage?

Code coverage measures how much of the codebase is exercised by tests. For a security tool like Cyberstrike, high coverage means:

- **Confidence**: More code tested = fewer hidden bugs
- **Visibility**: See exactly which files and functions lack tests
- **Regression Prevention**: Coverage drops alert you when PRs remove test coverage
- **Quality Gate**: Block PRs that significantly reduce coverage

### How It Works

1. **Test Run**: `bun test --coverage` runs all unit tests with coverage tracking
2. **Report Generation**: Produces an LCOV report with per-file coverage data
3. **Upload**: Sends the report to Codecov for analysis and tracking
4. **PR Comment**: Codecov posts a comment on the PR showing coverage changes

### When It Runs

| Trigger | Description |
|---------|-------------|
| Push to main | Track baseline coverage |
| Pull Request | Compare PR coverage vs main |
| Manual | Run from Actions tab |

### Codecov Setup

Codecov is free for public open source repos. To complete the setup:

1. Go to [codecov.io](https://codecov.io) and sign in with GitHub
2. Add the `CyberStrikeus/cyberstrike.io` repository
3. (Optional) Add `CODECOV_TOKEN` to repo secrets for private uploads

### Reading Coverage Reports

Codecov provides:

| Metric | Description |
|--------|-------------|
| **Line Coverage** | Percentage of code lines executed by tests |
| **Branch Coverage** | Percentage of conditional branches tested |
| **Patch Coverage** | Coverage of only the changed lines in a PR |
| **Project Coverage** | Overall repository coverage trend |

### PR Comment Example

```
Coverage Report
  Merging #15 into main will increase coverage by +2.3%

@@            Coverage Diff            @@
##             main     #15     +/-    ##
=========================================
+ Coverage    72.5%   74.8%   +2.3%
  Files          85      87      +2
  Lines        4200    4350    +150
=========================================
+ Hits         3045    3257    +212
  Misses       1155    1093     -62
```

### Adding Coverage Badge to README

After the first report, add to `README.md`:

```markdown
[![codecov](https://codecov.io/gh/CyberStrikeus/cyberstrike.io/branch/main/graph/badge.svg)](https://codecov.io/gh/CyberStrikeus/cyberstrike.io)
```

---

## 16. Bundle Size Check

**File:** `.github/workflows/bundle-size.yml`

The bundle size workflow measures the CLI build output and reports it on PRs so the team can track size regressions.

### How It Works

1. Checks out the PR code
2. Builds the CLI with `bun run build`
3. Measures the total size of `packages/cyberstrike/dist`
4. Comments the result on the PR (or updates an existing comment)

### Triggers

| Event | When |
|-------|------|
| Pull Request | Every PR |
| Manual | Run from Actions tab |

### PR Comment Example

```
📦 Bundle Size

| Metric | Value |
|--------|-------|
| Total Size | **4.52 MB** |
| Bytes | 4,739,072 |

*Measured from `packages/cyberstrike/dist`*
```

### Concurrency

Uses `bundle-${{ github.ref }}` group with `cancel-in-progress: true`. If a new push arrives while the check is running, the old run is cancelled.

---

## 17. Lighthouse CI

**File:** `.github/workflows/lighthouse.yml`

The Lighthouse workflow runs Google Lighthouse against the docs site to catch performance, accessibility, and SEO regressions.

### How It Works

1. Checks out the code and sets up Node 22
2. Builds the docs site (`npm run build` in `docs/`)
3. Runs Lighthouse CI against the built static files
4. Comments the PR with scores for each tested page

### Triggers

| Event | When |
|-------|------|
| Pull Request | Only when `packages/web/**` or `docs/**` files change |
| Manual | Run from Actions tab |

### Score Thresholds

| Category | Minimum | Level |
|----------|---------|-------|
| Performance | 80 | warn |
| Accessibility | 90 | error |
| Best Practices | 80 | warn |
| SEO | 80 | warn |

The workflow **fails** if Accessibility drops below 90. Other categories produce warnings.

### Tested Pages

- `/` (homepage)
- `/docs/getting-started/` (docs entry point)

### PR Comment Example

```
🔦 Lighthouse Results

| Page | Performance | Accessibility | Best Practices | SEO |
|------|-------------|---------------|----------------|-----|
| `/` | 🟢 95 | 🟢 100 | 🟢 92 | 🟢 90 |
| `/docs/getting-started/` | 🟢 88 | 🟢 98 | 🟢 90 | 🟢 85 |

📊 Full Report (link)
```

### Score Indicators

| Emoji | Range |
|-------|-------|
| 🟢 | 90-100 |
| 🟡 | 50-89 |
| 🔴 | 0-49 |

### Concurrency

Uses `lighthouse-${{ github.ref }}` group with `cancel-in-progress: true`.

---

## 18. Contributors Bot

**File:** `.github/workflows/contributors.yml`

The contributors workflow automatically generates and maintains a `CONTRIBUTORS.md` file with a visual table of all project contributors.

### How It Works

1. Checks out the repository with full history (`fetch-depth: 0`)
2. Uses the GitHub API to fetch all contributors
3. Filters out bot accounts
4. Generates a markdown table with avatars, profile links, and commit counts
5. Commits the updated file if anything changed

### Triggers

| Event | When |
|-------|------|
| Push to main | After every merge |
| Manual | Run from Actions tab |

### Generated Output

The workflow creates `CONTRIBUTORS.md` at the repo root with a table like:

```html
<table>
  <tr>
    <td align="center">
      <a href="https://github.com/username">
        <img src="avatar_url" width="80" alt="username" />
        <br /><sub><b>username</b></sub>
      </a>
      <br />42 commits
    </td>
    <!-- 7 contributors per row -->
  </tr>
</table>
```

### Configuration

| Setting | Value |
|---------|-------|
| Contributors per row | 7 |
| Max contributors | 100 |
| Bot filtering | Excludes accounts with `[bot]` in login |
| Commit message | `chore: update contributors list [skip ci]` |

The `[skip ci]` tag prevents the commit from triggering other workflows.

### Permissions

Requires `contents: write` permission to push the updated file.

---

## 19. Discord Notifications

**File:** `.github/workflows/notify-discord.yml`

The Discord notification workflow sends release announcements to the project's Discord server with a rich embed containing version info, changelog, and install instructions.

### How It Works

1. Fetches release details (tag, body, URL, pre-release status)
2. Cleans up the changelog markdown for Discord display
3. Sends a rich embed to the Discord webhook with:
   - Version and release type (stable/pre-release)
   - Changelog content from the GitHub release
   - Install command
   - Links to release notes, npm, and GitHub

### Triggers

| Event | When |
|-------|------|
| Release published | After a GitHub release is published |
| Manual | Run from Actions tab with a tag input |

### Prerequisites

Add the Discord webhook URL as a repository secret:

1. Go to **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `DISCORD_WEBHOOK_URL`
4. Value: The Discord webhook URL from your `#announcements` channel

### Embed Format

The notification appears as a Discord embed with:

| Field | Content |
|-------|---------|
| Title | 🚀 Cyberstrike v1.0.8 |
| Description | Changelog from release notes |
| Install | `npm install -g @cyberstrike-io/cli` |
| Type | Stable Release / Pre-release |
| Version | `1.0.8` |
| Links | Release Notes · npm · GitHub |
| Color | Teal (stable) / Orange (pre-release) |

### Manual Dispatch

You can trigger a notification manually from the Actions tab:

| Input | Required | Description |
|-------|----------|-------------|
| `tag` | Yes | Tag to announce (e.g., `v1.0.8`) |
| `message` | No | Custom message if no release exists for the tag |

### Integration with Release Pipeline

The notification workflow runs after the release pipeline completes:

```
Tag push (v*) → release-cli.yml → auto-changelog.yml → Release published → notify-discord.yml
```

The workflow waits for the release to be fully published (with changelog) before sending the Discord notification.

---

## 20. Discord Blog Notifications

**File:** `.github/workflows/notify-discord-blog.yml`

The blog notification workflow polls the Notion database for newly published blog posts and announces them on Discord.

### How It Works

**Automatic (Scheduled):**

1. Runs every 30 minutes via cron
2. Queries the Notion API for posts with `status: Published` and `published_date` within the last 35 minutes
3. For each new post, sends a Discord embed to `#announcements`

**Manual:**

1. Trigger from the Actions tab with title, slug, and optional description
2. Sends a Discord embed immediately

### Triggers

| Event | When |
|-------|------|
| Schedule | Every 30 minutes |
| Manual | Run from Actions tab with blog post details |

### Prerequisites

Add these repository secrets:

| Secret | Description |
|--------|-------------|
| `NOTION_API_KEY` | Notion internal integration token |
| `NOTION_DATABASE_ID` | ID of the blog posts database |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL (already set) |

### Setting Up Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Create a new internal integration
3. Copy the **Internal Integration Secret** → save as `NOTION_API_KEY`
4. Open the blog database in Notion → **Share** → **Invite** the integration
5. Copy the database ID from the URL → save as `NOTION_DATABASE_ID`
   - URL format: `notion.so/{workspace}/{DATABASE_ID}?v=...`

### Notion Database Schema

The workflow expects these properties:

| Property | Type | Description |
|----------|------|-------------|
| `title` | Title | Blog post title |
| `slug` | Rich text | URL slug for the blog post |
| `status` | Status | Must have a `Published` option |
| `published_date` | Date | When the post was published |

### Discord Embed

Blog notifications appear with an indigo-colored embed:

| Field | Content |
|-------|---------|
| Title | 📝 New Blog Post |
| Description | **Blog Post Title** |
| Link | cyberstrike.io/blog/{slug} |
| Color | Indigo (#6366F1) |

### Flow Diagram

```
Notion: Set status → Published → published_date = now
   ↓ (within 30 min)
GitHub Actions: Cron → Notion API query → Found new post
   ↓
Discord: Blog embed → #announcements
   ↓ (parallel)
Coolify: Webhook → Redeploy landing → Blog live on site
```

### Manual Dispatch Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Blog post title |
| `slug` | Yes | URL slug (e.g., `getting-started-with-cyberstrike`) |
| `description` | No | Short description for the embed |

---

## Resources

- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [npm Publishing](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
- [CodeQL Documentation](https://codeql.github.com/docs/)
- [Dependabot Configuration](https://docs.github.com/en/code-security/dependabot)
- [Codecov Documentation](https://docs.codecov.io/)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [Google Lighthouse](https://developer.chrome.com/docs/lighthouse/)
- [Discord Webhooks](https://discord.com/developers/docs/resources/webhook)
- [Notion API](https://developers.notion.com/)
