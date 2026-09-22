// @ts-check
// Fetches GitHub releases and generates changelog.mdx at build time.
// Runs before `astro build` — no auth needed (public repo).

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO = "CyberStrikeus/CyberStrike";
const OUTPUT = "src/docs/data/docs/en/resources/changelog.mdx";

// --- Badge mappings ---

const COMMIT_BADGES = [
  { pattern: /^feat(\(.*?\))?:/i, badge: { text: "Added", variant: "tip" } },
  { pattern: /^fix(\(.*?\))?:/i, badge: { text: "Fixed", variant: "note" } },
  {
    pattern: /^security/i,
    badge: { text: "Security", variant: "danger" },
  },
  {
    pattern: /^perf(\(.*?\))?:/i,
    badge: { text: "Improved", variant: "info" },
  },
  {
    pattern: /^refactor(\(.*?\))?:/i,
    badge: { text: "Improved", variant: "info" },
  },
];

const HEADING_BADGES = [
  { pattern: /feat|feature|add|new/i, badge: { text: "Added", variant: "tip" } },
  { pattern: /fix|bug/i, badge: { text: "Fixed", variant: "note" } },
  { pattern: /security/i, badge: { text: "Security", variant: "danger" } },
  {
    pattern: /perf|improv|optim/i,
    badge: { text: "Improved", variant: "info" },
  },
  {
    pattern: /break/i,
    badge: { text: "Breaking", variant: "caution" },
  },
  {
    pattern: /deprecat/i,
    badge: { text: "Deprecated", variant: "caution" },
  },
];

// Prefixes to skip entirely (non-user-facing)
const SKIP_PREFIXES = /^(docs|chore|ci|build|test|style)(\(.*?\))?:/i;

// Stop parsing the body when we hit contributor attribution sections
const STOP_PATTERNS = [
  /^\*\*thank you/i,
  /^##+ community/i,
  /^##+ contributors/i,
];

// --- Helpers ---

function stripAuthor(text) {
  return text.replace(/\s*\(@[^)]+\)\s*$/, "").trim();
}

function stripCommitLink(text) {
  return text.replace(/\s*\[`[a-f0-9]+`\]\([^)]+\)\s*$/, "").trim();
}

function stripConventionalPrefix(text) {
  return text
    .replace(/^(feat|fix|security|perf|docs|refactor|chore|ci|build|test)(\(.*?\))?:\s*/i, "")
    .trim();
}

// Escape characters that MDX would parse as JSX/expression delimiters.
// Bare `<` followed by a digit/whitespace (e.g. "<1s") is interpreted as a
// JSX tag and crashes the build with "Unexpected character before name".
// `{` / `}` would be parsed as JS expression delimiters.
function escapeMdx(text) {
  return text
    .replace(/</g, "&lt;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;");
}

function cleanText(text) {
  return escapeMdx(stripCommitLink(stripAuthor(stripConventionalPrefix(text))));
}

function getBadgeForCommit(line) {
  for (const { pattern, badge } of COMMIT_BADGES) {
    if (pattern.test(line.trim())) return badge;
  }
  return null;
}

function getBadgeForHeading(heading) {
  for (const { pattern, badge } of HEADING_BADGES) {
    if (pattern.test(heading)) return badge;
  }
  // Default: treat unknown sections as "Added"
  return { text: "Added", variant: "tip" };
}

// --- Parser ---

/**
 * Parses a release body into an array of { badge, text } items.
 * Handles two formats:
 *   1. `- feat: text (@author)` (conventional commit prefix)
 *   2. `### Section heading\n- items`
 */
function parseReleaseBody(body) {
  if (!body || body.trim() === "" || body.trim() === "No notable changes") {
    return [];
  }

  const lines = body.split("\n");
  const items = [];
  let currentSectionBadge = null;
  let hasSections = false;

  // First pass: detect if the body uses section headings
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line.trim())) {
      hasSections = true;
      break;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at contributor attribution
    if (STOP_PATTERNS.some((p) => p.test(trimmed))) break;

    // Section heading
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      currentSectionBadge = getBadgeForHeading(headingMatch[1]);
      continue;
    }

    // Bullet item
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (!bulletMatch) continue;

    const rawText = bulletMatch[1];

    if (hasSections) {
      // Section-based format: use current section badge
      if (!currentSectionBadge) continue;
      items.push({
        badge: currentSectionBadge,
        text: escapeMdx(stripCommitLink(stripAuthor(rawText))),
      });
    } else {
      // Conventional commit format
      if (SKIP_PREFIXES.test(rawText)) continue;
      const badge = getBadgeForCommit(rawText);
      if (!badge) continue;
      items.push({ badge, text: cleanText(rawText) });
    }
  }

  // Deduplicate by text
  const seen = new Set();
  return items.filter(({ text }) => {
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

// --- Semver sort (descending: newest first) ---

function parseSemver(tag) {
  const clean = tag.replace(/^v/, "");
  const [major = 0, minor = 0, patch = 0] = clean.split(".").map(Number);
  return { major, minor, patch };
}

function compareSemverDesc(a, b) {
  const av = parseSemver(a.tag_name);
  const bv = parseSemver(b.tag_name);
  if (bv.major !== av.major) return bv.major - av.major;
  if (bv.minor !== av.minor) return bv.minor - av.minor;
  return bv.patch - av.patch;
}

// --- MDX generator ---

function badge(b) {
  return `<Badge text="${b.text}" variant="${b.variant}" size="md" />`;
}

function generateMdx(releases) {
  const stableReleases = releases
    .filter((r) => !r.prerelease)
    .sort(compareSemverDesc);

  const blocks = stableReleases
    .map((release) => {
      const items = parseReleaseBody(release.body);
      const body =
        items.length > 0
          ? items.map((i) => `- ${badge(i.badge)} ${i.text}`).join("\n")
          : "_No notable changes._";

      return `## ${release.tag_name}\n\n${body}\n\n---`;
    })
    .join("\n\n");

  return `---
title: Changelog
description: Release notes and version history for Cyberstrike CLI
sidebar:
  order: 1
  label: Changelog
---

All notable changes to Cyberstrike CLI are documented here. For the full release history with downloadable assets, see [GitHub Releases](https://github.com/CyberStrikeus/CyberStrike/releases).

---

${blocks}

## Version Format

Cyberstrike follows [Semantic Versioning](https://semver.org/):

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking changes | Major | 1.0.0 → 2.0.0 |
| New features | Minor | 1.0.0 → 1.1.0 |
| Bug fixes | Patch | 1.0.0 → 1.0.1 |

## Badge Legend

- <Badge text="Added" variant="tip" size="md" /> New feature or capability
- <Badge text="Fixed" variant="note" size="md" /> Bug fix
- <Badge text="Improved" variant="info" size="md" /> Enhancement to existing feature
- <Badge text="Security" variant="danger" size="md" /> Security-related update
- <Badge text="Breaking" variant="caution" size="md" /> Breaking change
- <Badge text="Deprecated" variant="caution" size="md" /> Feature marked for removal

## Pre-release Versions

| Tag | Purpose | Install Command |
|-----|---------|-----------------|
| \`latest\` | Stable release | \`npm install -g @cyberstrike-io/cyberstrike\` |
| \`beta\` | Beta testing | \`npm install -g @cyberstrike-io/cyberstrike@beta\` |
| \`alpha\` | Early access | \`npm install -g @cyberstrike-io/cyberstrike@alpha\` |
`;
}

// --- Main ---

async function main() {
  console.log(`Fetching releases from github.com/${REPO}...`);

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=50`,
    { headers: { Accept: "application/vnd.github+json" } }
  );

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const releases = await res.json();
  console.log(`Found ${releases.length} releases (${releases.filter((r) => !r.prerelease).length} stable)`);

  const mdx = generateMdx(releases);

  const dir = fileURLToPath(new URL("..", import.meta.url));
  const changelogPath = join(dir, OUTPUT);

  // Ensure directory exists
  mkdirSync(dirname(changelogPath), { recursive: true });

  writeFileSync(changelogPath, mdx, "utf8");
  console.log(`✓ changelog.mdx generated → ${OUTPUT}`);

  const latestStable = releases
    .filter((r) => !r.prerelease)
    .sort(compareSemverDesc)[0];

  if (latestStable) {
    const versionPath = join(dir, "src/docs/data/latest-version.json");
    mkdirSync(dirname(versionPath), { recursive: true });

    writeFileSync(
      versionPath,
      JSON.stringify({ version: latestStable.tag_name }),
      "utf8"
    );
    console.log(`✓ latest-version.json → ${latestStable.tag_name}`);
  }
}

main().catch((err) => {
  console.error("fetch-changelog failed:", err.message);
  process.exit(1);
});
