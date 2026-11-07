import { gt, major, valid } from "semver";
import { z } from "zod";

const shaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const versionSchema = z.object({ version: z.string() });
const manifestSchema = z.object({ ".": z.string() });
const PLUGIN_MANIFEST_PATHS = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
];
const inlinePluginManifestSchema = versionSchema.extend({
  mcpServers: z.object({
    rea: z.object({
      command: z.literal("node"),
      args: z.tuple([
        z.literal("${CLAUDE_PLUGIN_ROOT}/scripts/plugin-mcp-launcher.mjs"),
        z.string(),
      ]),
    }),
  }),
});
const codexPluginManifestSchema = versionSchema.extend({
  mcpServers: z.literal("./.codex-plugin/mcp.json"),
});
const codexServerConfigSchema = z.object({
  mcpServers: z.object({
    rea: z.object({
      command: z.literal("node"),
      args: z.tuple([
        z.literal("./scripts/plugin-mcp-launcher.mjs"),
        z.string(),
      ]),
      cwd: z.literal("."),
      startup_timeout_sec: z.number().int().positive(),
    }),
  }),
});
const sectionsSchema = z.object({
  versioning: z.string().optional(),
  "changelog-sections": z.array(
    z.object({ type: z.string(), hidden: z.boolean().optional() }),
  ),
});
const GITHUB_MERGE_SUBJECT = /^Merge pull request #(\d+) from \S+/u;

function conventionalTitle(subject, body) {
  if (!GITHUB_MERGE_SUBJECT.test(subject)) return subject;
  // GitHub's default merge message puts the PR title after its subject.
  // Inspect that first nonempty line, not arbitrary examples in commit prose.
  return (
    body
      .split(/\r?\n/u)
      .slice(1)
      .find((line) => line.trim() !== "")
      ?.trim() ?? subject
  );
}

function releaseVersion(value, location) {
  if (valid(value) !== value || value.includes("+")) {
    throw new Error(
      `${location} must contain an exact SemVer without build metadata: ${value}`,
    );
  }
  return value;
}

async function readJson(git, sha, path, schema) {
  const text = await git(["show", `${sha}:${path}`]);
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${path}@${sha} contains invalid JSON: ${error.message}`);
    }
    throw error;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${path}@${sha} is malformed: ${parsed.error.message}`);
  }
  return parsed.data;
}

function readCommits(text) {
  if (text.length === 0) return [];
  const fields = text.split("\0");
  if (fields.pop() !== "" || fields.length % 3 !== 0) {
    throw new Error("Git returned malformed checkpoint history records.");
  }
  const commits = [];
  for (let index = 0; index < fields.length; index += 3) {
    const sha = shaSchema.parse(fields[index]);
    const subject = z.string().parse(fields[index + 1]);
    const body = z.string().parse(fields[index + 2]);
    const title = conventionalTitle(subject, body);
    const type = /^([a-z]+)(?:\([^)]*\))?!?: /u.exec(title)?.[1];
    commits.push({
      sha,
      subject,
      ...(title !== subject ? { conventionalTitle: title } : {}),
      type,
      breaking:
        /^[a-z]+(?:\([^)]*\))?!: /u.test(title) ||
        /^BREAKING(?: CHANGE|-CHANGE):\s*\S/mu.test(body),
      breakingNotes: Array.from(
        body
          .replace(/\r\n/gu, "\n")
          .matchAll(
            /^BREAKING(?: CHANGE|-CHANGE):[ \t]*(\S[^\n]*(?:\n(?!\n|[A-Za-z-]+: )[^\n]+)*)/gmu,
          ),
        (match) => match[1].replace(/\s+/gu, " ").trim(),
      ),
    });
  }
  return commits;
}

function referencesCommit(text, commit) {
  if (text.includes(commit.sha.slice(0, 7))) return true;
  const pullRequest =
    GITHUB_MERGE_SUBJECT.exec(commit.subject)?.[1] ??
    /\(#(\d+)\)$/u.exec(commit.subject)?.[1];
  return (
    pullRequest !== undefined &&
    new RegExp(`#${pullRequest}(?!\\d)`, "u").test(text)
  );
}

function releaseNotes(text, expectedVersion) {
  const headings = Array.from(text.matchAll(/^## \[([^\]]+)\].*$/gmu));
  const first = headings[0];
  if (first?.[1] !== expectedVersion || first.index === undefined) {
    throw new Error(`CHANGELOG.md must start with release ${expectedVersion}.`);
  }
  return text.slice(first.index, headings[1]?.index ?? text.length);
}

function breakingSection(notes) {
  const heading = /^### [^\n]*BREAKING CHANGES[^\n]*\n/imu.exec(notes);
  if (heading === null) return "";
  const body = notes.slice(heading.index + heading[0].length);
  const end = body.search(/^### /mu);
  return end < 0 ? body : body.slice(0, end);
}

async function requireAncestor(git, ancestor, descendant, description) {
  try {
    await git(["merge-base", "--is-ancestor", ancestor, descendant]);
  } catch (error) {
    const failure = z.object({ code: z.literal(1) }).safeParse(error);
    if (!failure.success) throw error;
    throw new Error(
      `${description}: ${ancestor} is not an ancestor of ${descendant}. Sync the released tag into main before cutting a checkpoint, and prepare candidates from that frozen source.`,
    );
  }
}

async function resolveBaseline(git, tag) {
  try {
    return shaSchema.parse(
      (await git(["rev-parse", "--verify", `${tag}^{commit}`])).trim(),
    );
  } catch (error) {
    const failure = z.object({ code: z.literal(128) }).safeParse(error);
    if (!failure.success) throw error;
    throw new Error(
      `Published baseline ${tag} is unavailable. Fetch release tags and finish the previous release sync before preparing this checkpoint. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function validateCandidate(git, sha, version, commits) {
  const versions = [
    [
      "package.json",
      (await readJson(git, sha, "package.json", versionSchema)).version,
    ],
    [
      ".release-please-manifest.json",
      (
        await readJson(
          git,
          sha,
          ".release-please-manifest.json",
          manifestSchema,
        )
      )["."],
    ],
  ];
  const lock = await readJson(
    git,
    sha,
    "package-lock.json",
    versionSchema.extend({
      packages: z.object({ "": versionSchema }),
    }),
  );
  versions.push(
    ["package-lock.json", lock.version],
    ["package-lock.json packages.root", lock.packages[""].version],
  );
  const server = await readJson(
    git,
    sha,
    "server.json",
    versionSchema.extend({
      packages: z.array(
        z.object({ identifier: z.string(), version: z.string() }),
      ),
    }),
  );
  const npmPackage = server.packages.find(
    (entry) => entry.identifier === "rea-agents",
  );
  if (npmPackage === undefined)
    throw new Error("server.json is missing the rea-agents package.");
  versions.push(
    ["server.json", server.version],
    ["server.json rea-agents package", npmPackage.version],
  );
  // A stale manifest keeps the previous plugin cache key or launches the
  // previous server, so both are version authority like server.json.
  const launches = [];
  for (const path of PLUGIN_MANIFEST_PATHS) {
    const manifest =
      path === ".codex-plugin/plugin.json"
        ? await readJson(git, sha, path, codexPluginManifestSchema)
        : await readJson(git, sha, path, inlinePluginManifestSchema);
    versions.push([path, manifest.version]);
    const server =
      path === ".codex-plugin/plugin.json"
        ? await readJson(
            git,
            sha,
            ".codex-plugin/mcp.json",
            codexServerConfigSchema,
          )
        : manifest;
    launches.push([path, server.mcpServers.rea.args[1]]);
  }
  // Catalogs are generated and checked from this candidate by the release job;
  // they are not version authority stored in the immutable source tree.
  const generated = await git([
    "show",
    `${sha}:src/generatedPackageMetadata.ts`,
  ]);
  const generatedVersions = Array.from(
    generated.matchAll(/^\s+version: "([^"]+)"/gmu),
  );
  if (generatedVersions.length !== 1)
    throw new Error(
      "Generated package metadata must declare one literal version.",
    );
  versions.push(["src/generatedPackageMetadata.ts", generatedVersions[0]?.[1]]);
  for (const [location, actual] of versions) {
    if (actual !== version) {
      throw new Error(
        `${location}@${sha} declares ${actual}; release branch requires ${version}.`,
      );
    }
  }
  // The launcher checks the scalar pin against the runtime in its own package.
  for (const [location, launched] of launches) {
    if (launched !== version) {
      throw new Error(
        `${location}@${sha} launches version ${launched ?? "no version"}; release branch requires ${version}.`,
      );
    }
  }
  const notes = releaseNotes(
    await git(["show", `${sha}:CHANGELOG.md`]),
    version,
  );
  const breakingNotes = breakingSection(notes);
  const normalizedBreakingNotes = breakingNotes.replace(/\s+/gu, " ");
  const missingBreaking = commits.filter(
    (commit) =>
      commit.breaking &&
      !referencesCommit(breakingNotes, commit) &&
      (commit.breakingNotes.length === 0 ||
        commit.breakingNotes.some(
          (note) => !normalizedBreakingNotes.includes(note),
        )),
  );
  if (missingBreaking.length > 0) {
    throw new Error(
      `Release ${version} migration notes omit unreleased breaking changes: ${missingBreaking.map((commit) => `${commit.sha} ${commit.subject}`).join("; ")}`,
    );
  }
  return commits.filter((commit) => !referencesCommit(notes, commit));
}

/** Validate a recorded checkpoint and optional candidate using exact Git ancestry. */
export async function inspectReleaseCheckpoint(git, options) {
  const { phase, stage, releaseBranch, sourceSha, candidateSha } = z
    .object({
      phase: z.enum(["prepare", "publish"]),
      stage: z.enum(["source", "candidate"]),
      releaseBranch: z.union([
        z.literal("main"),
        z.string().startsWith("release/"),
      ]),
      sourceSha: shaSchema,
      candidateSha: shaSchema.optional(),
    })
    .parse(options);
  if (releaseBranch === "main" && (phase !== "publish" || stage !== "source")) {
    throw new Error(
      "Main publication validates its reviewed merged source SHA.",
    );
  }
  const expectedVersion = releaseVersion(
    releaseBranch === "main"
      ? (await readJson(git, sourceSha, "package.json", versionSchema)).version
      : releaseBranch.slice("release/".length),
    releaseBranch === "main" ? "reviewed main release" : "release/VERSION",
  );
  if (phase === "publish" && stage === "candidate") {
    throw new Error(
      "Publish validates its merged source SHA; candidate stage applies only to prepare.",
    );
  }
  const applicationSha =
    phase === "publish"
      ? shaSchema.parse((await git(["rev-parse", `${sourceSha}^1`])).trim())
      : sourceSha;
  const manifest = await readJson(
    git,
    applicationSha,
    ".release-please-manifest.json",
    manifestSchema,
  );
  const baselineVersion = releaseVersion(
    manifest["."],
    "published baseline manifest",
  );
  const sourcePackage = await readJson(
    git,
    applicationSha,
    "package.json",
    versionSchema,
  );
  if (sourcePackage.version !== baselineVersion) {
    throw new Error(
      `Source package ${sourcePackage.version} and release baseline ${baselineVersion} disagree.`,
    );
  }
  if (!gt(expectedVersion, baselineVersion)) {
    throw new Error(
      `Expected release ${expectedVersion} must advance published baseline ${baselineVersion}.`,
    );
  }
  const baselineTag = `refs/tags/rea-agents-${baselineVersion}`;
  const baselineSha = await resolveBaseline(git, baselineTag);
  await requireAncestor(
    git,
    baselineSha,
    applicationSha,
    "Published baseline is outside the checkpoint ancestry",
  );
  const configuration = await readJson(
    git,
    applicationSha,
    "release-please-config.json",
    sectionsSchema,
  );
  const visibleTypes = new Set(
    configuration["changelog-sections"]
      .filter((section) => !section.hidden)
      .map((section) => section.type),
  );
  const commits = readCommits(
    await git([
      "log",
      "--first-parent",
      "-z",
      "--format=%H%x00%s%x00%B",
      `${baselineSha}..${applicationSha}`,
    ]),
  ).filter((commit) => commit.breaking || visibleTypes.has(commit.type));
  const breaking = commits.filter((commit) => commit.breaking);
  if (
    configuration.versioning !== "always-bump-minor" &&
    breaking.length > 0 &&
    major(baselineVersion) > 0 &&
    major(expectedVersion) <= major(baselineVersion)
  ) {
    throw new Error(
      `Expected release ${expectedVersion} contains unreleased breaking markers since ${baselineVersion}: ${breaking.map((commit) => `${commit.sha} ${commit.subject}`).join("; ")}. Review compatibility or select a major version.`,
    );
  }
  let snapshot = phase === "publish" ? sourceSha : candidateSha;
  if (stage === "candidate" && snapshot === undefined) {
    snapshot = shaSchema.parse((await git(["rev-parse", "HEAD"])).trim());
  }
  if (phase === "publish" || stage === "candidate") {
    await requireAncestor(
      git,
      applicationSha,
      snapshot,
      "Candidate is outside the selected checkpoint ancestry",
    );
  }
  const missingNotes =
    phase === "publish" || stage === "candidate"
      ? await validateCandidate(git, snapshot, expectedVersion, commits)
      : [];
  return {
    expectedVersion,
    baselineVersion,
    baselineSha,
    sourceSha,
    applicationSha,
    commits,
    missingNotes,
  };
}
