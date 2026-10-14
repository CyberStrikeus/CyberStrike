// @ts-check
// Fetches latest stable version from GitHub releases for the navbar badge.
// Runs before `astro build` — no auth needed (public repo).

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO = "CyberStrikeus/CyberStrike";

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

async function main() {
  console.log(`Fetching releases from github.com/${REPO}...`);

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases?per_page=10`,
    { headers: { Accept: "application/vnd.github+json" } }
  );

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const releases = await res.json();
  const stable = releases
    .filter((r) => !r.prerelease)
    .sort(compareSemverDesc)[0];

  if (stable) {
    const dir = fileURLToPath(new URL("..", import.meta.url));
    const path = join(dir, "src/docs/data/latest-version.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: stable.tag_name }), "utf8");
    console.log(`✓ latest-version.json → ${stable.tag_name}`);
  }
}

main().catch((err) => {
  console.error("fetch-changelog failed:", err.message);
  process.exit(1);
});
