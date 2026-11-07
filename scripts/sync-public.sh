#!/usr/bin/env bash
# sync-public.sh — Export main to the public mirror, excluding pro/enterprise packages.
#
# Usage: ./scripts/sync-public.sh [--dry-run]
#
# This script creates a clean branch from main with pro/enterprise directories
# removed, then pushes to the public remote. The public mirror never sees:
#   - Brain (SaaS orchestration, playbooks, wallet)
#   - Pro domain packages (aws, azure, gcp, oracle, cloud, mobile, internal-network, identity, containers)
#   - Enterprise packages (enterprise, enterprise-vortex, attack-surface-mapping, sast, red-team)
#   - This script itself
#
# NEVER push main directly to public — always use this script.
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# Directories to exclude from public mirror
EXCLUDE_DIRS=(
  # SaaS brain (playbooks, wallet, orchestration — the moat)
  "packages/brain"
  # Pro domain packages (tools are free, but the package includes brain-side specs)
  "packages/aws"
  "packages/azure"
  "packages/gcp"
  "packages/oracle"
  "packages/cloud"
  "packages/mobile"
  "packages/internal-network"
  "packages/identity"
  "packages/containers"
  # Enterprise packages
  "packages/enterprise"
  "packages/enterprise-vortex"
  "packages/attack-surface-mapping"
  "packages/sast"
  "packages/red-team"
  # Android/iOS (mobile domain)
  "packages/android"
  "packages/ios"
  # This script
  "scripts/sync-public.sh"
)

BRANCH="public-export"
REMOTE="public"

echo "=== CyberStrike Public Mirror Sync ==="
echo ""

# Verify we're on main
CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "main" ]]; then
  echo "ERROR: must be on main branch (currently on $CURRENT)"
  exit 1
fi

# Verify no uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: uncommitted changes detected, commit or stash first"
  exit 1
fi

# Sensitive data check (exact strings only — no regex wildcards)
echo "Scanning for sensitive data..."
if grep -rqF "MUFG" packages/ --include="*.ts" --include="*.md" 2>/dev/null; then
  echo "ERROR: sensitive data detected — abort!"
  grep -rnF "MUFG" packages/ --include="*.ts" --include="*.md" 2>/dev/null
  exit 1
fi

# Create export branch from main
echo "Creating export branch from main..."
git branch -D "$BRANCH" 2>/dev/null || true
git checkout -b "$BRANCH"

# Remove excluded directories
echo "Removing pro/enterprise packages..."
for dir in "${EXCLUDE_DIRS[@]}"; do
  if [[ -d "$dir" || -f "$dir" ]]; then
    git rm -rf "$dir" --quiet 2>/dev/null || true
    echo "  removed: $dir"
  fi
done

# Remove brain dependency from cyberstrike package.json
if grep -q '@cyberstrike-io/brain' packages/cyberstrike/package.json; then
  # Remove the brain dep line and the brain relay/executor code
  sed -i '' '/"@cyberstrike-io\/brain"/d' packages/cyberstrike/package.json
  git rm -rf packages/cyberstrike/src/brain --quiet 2>/dev/null || true
  git rm -rf packages/cyberstrike/src/cli/cmd/brain.ts --quiet 2>/dev/null || true

  # Remove brain command import and registration from index.ts
  sed -i '' '/BrainCommand/d' packages/cyberstrike/src/index.ts

  git add packages/cyberstrike/package.json packages/cyberstrike/src/index.ts
  echo "  removed: brain dependency + client code from cyberstrike"
fi

# Commit the scrubbed state
git commit -m "chore: scrub pro/enterprise packages for public mirror" --quiet

echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY RUN — would push to $REMOTE"
  echo "Diff from main:"
  echo "  $(git diff --stat main..HEAD | tail -1)"
  git checkout main --quiet
  git branch -D "$BRANCH" --quiet
else
  echo "Pushing to $REMOTE..."
  git push "$REMOTE" "$BRANCH":main --force
  echo "Done. Public mirror updated."
  git checkout main --quiet
  git branch -D "$BRANCH" --quiet
fi

echo ""
echo "=== Sync complete ==="
