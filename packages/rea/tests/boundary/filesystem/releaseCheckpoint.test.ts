import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { z } from "zod";
import { parse } from "yaml";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
  type TestWorkspace,
} from "../../support/workspace/workspaceFixture.js";
import {
  executeWorkflowFixture as execFileAsync,
  workflowGit as git,
} from "../../support/workflowGit.js";

const verifier = fileURLToPath(
  new URL("../../../scripts/verify-release-checkpoint.mjs", import.meta.url),
);

const pluginManifestPaths = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
] as const;

const pluginManifest = (version: string, launch = version) => ({
  version,
  mcpServers: {
    rea: {
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/scripts/plugin-mcp-launcher.mjs", launch],
    },
  },
});

const codexServerConfig = (version: string, launch = version) => ({
  mcpServers: {
    rea: {
      command: "node",
      args: ["./scripts/plugin-mcp-launcher.mjs", launch],
      cwd: ".",
      startup_timeout_sec: 30,
    },
  },
});

async function metadata(
  directory: string,
  version: string,
  notes: string,
  versioning?: string,
) {
  await mkdir(join(directory, "docs"), { recursive: true });
  await mkdir(join(directory, "src"), { recursive: true });
  for (const path of pluginManifestPaths)
    await mkdir(join(directory, dirname(path)), { recursive: true });
  const files = {
    ".claude-plugin/plugin.json": pluginManifest(version),
    ".codex-plugin/plugin.json": {
      version,
      mcpServers: "./.codex-plugin/mcp.json",
    },
    ".codex-plugin/mcp.json": codexServerConfig(version),
    "package.json": { name: "rea-agents", version },
    "package-lock.json": { version, packages: { "": { version } } },
    ".release-please-manifest.json": { ".": version },
    "server.json": {
      version,
      packages: [{ identifier: "rea-agents", version }],
    },
    "release-please-config.json": {
      ...(versioning === undefined ? {} : { versioning }),
      "changelog-sections": [
        { type: "feat", hidden: false },
        { type: "fix", hidden: false },
        { type: "chore", hidden: true },
      ],
    },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(join(directory, name), JSON.stringify(value));
  }
  await writeFile(
    join(directory, "src/generatedPackageMetadata.ts"),
    `export const METADATA = {\n  version: "${version}",\n};\n`,
  );
  await writeFile(
    join(directory, "CHANGELOG.md"),
    `# Changelog\n\n## [${version}]\n\n${notes}\n`,
  );
}

interface ReleaseSeed {
  readonly directory: string;
  readonly releasedSha: string;
}

const seedWorkspaces: TestWorkspace[] = [];
const seedPromises = new Map<string, Promise<ReleaseSeed>>();

const releaseSeed = (versioning?: string): Promise<ReleaseSeed> => {
  const key = versioning ?? "default";
  const existing = seedPromises.get(key);
  if (existing !== undefined) return existing;

  const pending = (async (): Promise<ReleaseSeed> => {
    const workspace = await createTestWorkspace("rea-release-checkpoint-seed-");
    seedWorkspaces.push(workspace);
    const directory = workspace.path(key);
    await mkdir(directory, { recursive: true });
    await git(directory, ["init", "--initial-branch=main"]);
    await metadata(directory, "4.0.0", "Initial release", versioning);
    await git(directory, ["add", "."]);
    await git(
      directory,
      ["commit", "-m", "chore: seed"],
      "2026-01-01T00:00:00Z",
    );
    await git(directory, ["switch", "-c", "release/5.0.0"]);
    await metadata(directory, "5.0.0", "Previous release", versioning);
    await git(directory, ["add", "."]);
    await git(
      directory,
      ["commit", "-m", "chore: release 5.0.0"],
      "2026-01-03T00:00:00Z",
    );
    const releasedSha = await git(directory, ["rev-parse", "HEAD"]);
    await git(directory, ["tag", "rea-agents-5.0.0"]);
    await git(directory, ["switch", "main"]);
    return { directory, releasedSha };
  })();
  seedPromises.set(key, pending);
  return pending;
};

afterAll(async () => {
  await Promise.allSettled(seedPromises.values());
  const cleanup = await Promise.allSettled(
    seedWorkspaces.map(({ root }) => removeTestWorkspace(root)),
  );
  const failures = cleanup.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Could not remove release checkpoint seeds",
    );
});

async function fixture(
  subject = "fix(contracts)!: require absolute paths (#948)",
  footer = "",
  options: { mergePullRequest?: boolean; versioning?: string } = {},
) {
  const seed = await releaseSeed(options.versioning);
  const directory = await createTestTempDirectory("rea-release-ancestry-");
  await cp(seed.directory, directory, { recursive: true, dereference: true });
  if (options.mergePullRequest) {
    await git(directory, ["switch", "-c", "change/contracts"]);
  }
  await writeFile(
    join(directory, "behavior.txt"),
    "Unreleased mainline behavior\n",
  );
  await git(directory, ["add", "."]);
  await git(
    directory,
    ["commit", "-m", subject, "-m", footer],
    "2026-01-02T00:00:00Z",
  );
  if (options.mergePullRequest) {
    await git(directory, ["switch", "main"]);
    await git(
      directory,
      [
        "merge",
        "--no-ff",
        "change/contracts",
        "-m",
        "Merge pull request #948 from fixture/absolute-paths",
        "-m",
        subject,
      ],
      "2026-01-02T00:00:00Z",
    );
  }
  const changedSha = await git(directory, ["rev-parse", "HEAD"]);
  await git(directory, [
    "merge",
    "--no-ff",
    "release/5.0.0",
    "-m",
    "chore: sync published baseline",
  ]);
  const sourceSha = await git(directory, ["rev-parse", "HEAD"]);
  return {
    directory,
    sourceSha,
    changedSha,
    releasedSha: seed.releasedSha,
    versioning: options.versioning,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function candidate(
  f: Fixture,
  version: string,
  notes = "### ⚠ BREAKING CHANGES\n\n* MCP callers must use absolute paths; CLI paths remain compatible. See #948.",
) {
  await metadata(f.directory, version, notes, f.versioning);
  await git(f.directory, ["add", "."]);
  await git(
    f.directory,
    ["commit", "-m", `chore: release ${version}`],
    "2026-01-05T00:00:00Z",
  );
  return git(f.directory, ["rev-parse", "HEAD"]);
}

function verify(
  f: Pick<Fixture, "directory" | "sourceSha">,
  version = "6.0.0",
  phase = "prepare",
  stage = "candidate",
) {
  return execFileAsync(
    process.execPath,
    [
      verifier,
      "--phase",
      phase,
      "--stage",
      stage,
      "--release-branch",
      version === "main" ? "main" : `release/${version}`,
      "--source-sha",
      f.sourceSha,
    ],
    { cwd: f.directory },
  );
}

const reportSchema = z.object({
  expectedVersion: z.string(),
  baselineVersion: z.string(),
  applicationSha: z.string(),
  commits: z.array(
    z.object({
      sha: z.string(),
      subject: z.string(),
      conventionalTitle: z.string().optional(),
      breaking: z.boolean(),
    }),
  ),
  missingNotes: z.array(
    z.object({
      sha: z.string(),
      subject: z.string(),
      conventionalTitle: z.string().optional(),
      type: z.string().optional(),
      breaking: z.boolean(),
    }),
  ),
});

it("retains an unreleased breaking commit hidden by the side-branch chronological cutoff", async () => {
  const f = await fixture();
  const walk = (
    await git(f.directory, ["log", "--format=%H", f.sourceSha])
  ).split("\n");
  expect(walk.slice(0, walk.indexOf(f.releasedSha))).not.toContain(
    f.changedSha,
  );
  await candidate(f, "6.0.0");
  const result = await verify(f);
  const report = reportSchema.parse(JSON.parse(result.stdout));
  expect(report).toMatchObject({
    expectedVersion: "6.0.0",
    baselineVersion: "5.0.0",
    missingNotes: [],
  });
  expect(report.commits).toContainEqual({
    sha: f.changedSha,
    subject: "fix(contracts)!: require absolute paths (#948)",
    breaking: true,
  });
});

it("rejects a wrong bot version before publication", async () => {
  const f = await fixture();
  await candidate(f, "5.1.0");
  await expect(verify(f)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      "declares 5.1.0; release branch requires 6.0.0",
    ),
  });
});

it("rejects a requested minor that omits the breaking ancestry", async () => {
  const f = await fixture();
  await expect(verify(f, "5.1.0", "prepare", "source")).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("contains unreleased breaking markers"),
  });
});

it.each([
  { subject: "fix(contracts)!: require absolute paths (#948)", footer: "" },
  {
    subject: "fix(contracts): change path inputs (#948)",
    footer: "BREAKING CHANGE: relative MCP paths are rejected",
  },
])(
  "accepts a breaking minor under always-bump-minor: $subject",
  async ({ subject, footer }) => {
    const f = await fixture(subject, footer, {
      versioning: "always-bump-minor",
    });
    await expect(
      verify(f, "5.1.0", "prepare", "source"),
    ).resolves.toMatchObject({
      stderr: "",
    });
    const candidateSha = await candidate(f, "5.1.0");
    const report = reportSchema.parse(
      JSON.parse((await verify(f, "5.1.0")).stdout),
    );
    expect(report.expectedVersion).toBe("5.1.0");
    expect(report.missingNotes).toEqual([]);
    expect(report.commits).toContainEqual({
      sha: f.changedSha,
      subject,
      breaking: true,
    });
    await expect(
      verify({ ...f, sourceSha: candidateSha }, "5.1.0", "publish", "source"),
    ).resolves.toMatchObject({ stderr: "" });
  },
);

it("still requires migration notes for breaking minor releases", async () => {
  const f = await fixture(undefined, "", { versioning: "always-bump-minor" });
  await candidate(f, "5.1.0", "### Bug Fixes\n\nSee #948.");
  await expect(verify(f, "5.1.0")).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      "migration notes omit unreleased breaking changes",
    ),
  });
});

it.each([
  {
    notes:
      "### ⚠ BREAKING CHANGES\n\n* **contracts:** Use absolute MCP paths. Relative paths are rejected.",
    accepted: true,
  },
  {
    notes:
      "### ⚠ BREAKING CHANGES\n\n* **contracts:** Use absolute MCP paths.\n  Relative paths are rejected.",
    accepted: true,
  },
  {
    notes: "### ⚠ BREAKING CHANGES\n\n* Use absolute MCP paths.",
    accepted: false,
  },
  {
    notes:
      "### Bug Fixes\n\n* Use absolute MCP paths. Relative paths are rejected.",
    accepted: false,
  },
  {
    notes:
      "### ⚠ BREAKING CHANGES\n\n* Use absolute MCP paths. Relative paths are rejected.",
    footer:
      "BREAKING CHANGE: Use absolute MCP paths. Relative paths are rejected.\n\nBREAKING CHANGE: Rename the old CLI option.",
    accepted: false,
  },
  {
    notes:
      "### ⚠ BREAKING CHANGES\n\n* Use absolute MCP paths. Relative paths are rejected.\n* Rename the old CLI option.",
    footer:
      "BREAKING CHANGE: Use absolute MCP paths.\r\nRelative paths are rejected.\r\n\r\nBREAKING CHANGE: Rename the old CLI option.",
    accepted: true,
  },
])(
  "validates generated migration text on a main release merge ($accepted): $notes",
  async ({ notes, accepted, footer }) => {
    const f = await fixture(
      "fix(contracts)!: change path inputs",
      footer ??
        "BREAKING CHANGE: Use absolute MCP paths.\nRelative paths are rejected.",
      { versioning: "always-bump-minor" },
    );
    const sourceSha = await candidate(f, "5.1.0", notes);
    const result = verify({ ...f, sourceSha }, "main", "publish", "source");
    if (!accepted) {
      await expect(result).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "migration notes omit unreleased breaking changes",
        ),
      });
      return;
    }
    const original = JSON.parse((await result).stdout);
    const report = reportSchema.parse(original);
    expect(report).toMatchObject({
      expectedVersion: "5.1.0",
      baselineVersion: "5.0.0",
      applicationSha: f.sourceSha,
    });
    await writeFile(join(f.directory, "later-work.txt"), "Later main change\n");
    await git(f.directory, ["add", "."]);
    await git(f.directory, ["commit", "-m", "fix: unrelated later work"]);
    // A moved checkout does not change the selected reviewed merge.
    expect(
      JSON.parse(
        (await verify({ ...f, sourceSha }, "main", "publish", "source")).stdout,
      ),
    ).toEqual(original);
    await expect(
      verify(
        { ...f, sourceSha: await git(f.directory, ["rev-parse", "HEAD"]) },
        "main",
        "publish",
        "source",
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("must advance published baseline"),
    });
  },
);

it("rejects a minor when a GitHub merge commit carries its bang marker in the PR title", async () => {
  const f = await fixture("fix(contracts)!: require absolute paths", "", {
    mergePullRequest: true,
  });
  await expect(verify(f, "5.1.0", "prepare", "source")).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("contains unreleased breaking markers"),
  });
});

it.each([
  {
    subject: "fix(contracts)!: require absolute paths",
    version: "6.0.0",
    breaking: true,
  },
  { subject: "fix: improve diagnostics", version: "5.0.1", breaking: false },
])(
  "recognizes GitHub merge titles and PR note references for $version",
  async ({ subject, version, breaking }) => {
    const f = await fixture(subject, "", { mergePullRequest: true });
    await candidate(
      f,
      version,
      `${breaking ? "### ⚠ BREAKING CHANGES" : "### Bug Fixes"}\n\nSee #948 for the change and migration.`,
    );
    const report = reportSchema.parse(
      JSON.parse((await verify(f, version)).stdout),
    );
    expect(report.missingNotes).toEqual([]);
    expect(report.commits).toContainEqual({
      sha: f.changedSha,
      subject: "Merge pull request #948 from fixture/absolute-paths",
      conventionalTitle: subject,
      breaking,
    });
  },
);

it("does not treat an ordinary body example as a merge title or breaking declaration", async () => {
  const f = await fixture(
    "fix: improve diagnostics",
    "Example subject:\n\nfix(contracts)!: example only",
  );
  await candidate(f, "5.0.1", `### Bug Fixes\n\n${f.changedSha}`);
  await expect(verify(f, "5.0.1")).resolves.toMatchObject({ stderr: "" });
});

it("cannot satisfy migration references with notes retained from an older release", async () => {
  const f = await fixture();
  await candidate(
    f,
    "6.0.0",
    "### Features\n\nNew tool\n\n## [5.0.0]\n\n### ⚠ BREAKING CHANGES\n\nSee #948.",
  );
  await expect(verify(f)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      "migration notes omit unreleased breaking changes",
    ),
  });
});

it("recognizes a BREAKING CHANGE footer without a bang in the subject", async () => {
  const f = await fixture(
    "fix(contracts): change path inputs (#948)",
    "BREAKING CHANGE: relative MCP paths are rejected",
  );
  await expect(verify(f, "5.1.0", "prepare", "source")).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("contains unreleased breaking markers"),
  });
});

it.each([
  { subject: "fix: correct supported output", version: "5.0.1" },
  { subject: "feat: add an optional inspection", version: "5.1.0" },
])(
  "accepts compatible $version without a major increment",
  async ({ subject, version }) => {
    const f = await fixture(subject);
    await candidate(f, version, `### Changes\n\n${f.changedSha} ${subject}`);
    const report = reportSchema.parse(
      JSON.parse((await verify(f, version)).stdout),
    );
    expect(report.expectedVersion).toBe(version);
    expect(report.commits.every((entry) => !entry.breaking)).toBe(true);
  },
);

it("accepts an exact prerelease version", async () => {
  const f = await fixture();
  await candidate(f, "6.0.0-rc.1");
  await expect(verify(f, "6.0.0-rc.1")).resolves.toMatchObject({ stderr: "" });
});

it.each(["6.01.0", "6.0", "not-a-version", "6.0.0+build"])(
  "rejects invalid release version %s",
  async (version) => {
    const directory = await createTestTempDirectory(
      "rea-release-invalid-version-",
    );
    await expect(
      verify(
        { directory, sourceSha: "1".repeat(40) },
        version,
        "prepare",
        "source",
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("must contain an exact SemVer"),
    });
  },
);

it("validates candidate options before inspecting the working directory", async () => {
  const directory = await createTestTempDirectory(
    "rea-release-invalid-candidate-",
  );
  await git(directory, ["init", "--initial-branch=main"]);
  await expect(
    verify({ directory, sourceSha: "1".repeat(40) }, "not-a-version"),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("must contain an exact SemVer"),
  });
});

it.each([
  "package-lock.json",
  "server.json",
  "src/generatedPackageMetadata.ts",
])("rejects inconsistent version metadata in %s", async (path) => {
  const f = await fixture();
  await candidate(f, "6.0.0");
  await writeFile(
    join(f.directory, path),
    path.endsWith(".ts")
      ? 'export const METADATA = {\n  version: "5.1.0",\n};\n'
      : JSON.stringify(
          path === "package-lock.json"
            ? { version: "6.0.0", packages: { "": { version: "5.1.0" } } }
            : path === "server.json"
              ? {
                  version: "6.0.0",
                  packages: [{ identifier: "rea-agents", version: "5.1.0" }],
                }
              : { package: { version: "5.1.0" } },
        ),
  );
  await git(f.directory, ["add", "."]);
  await git(f.directory, ["commit", "-m", "chore: inconsistent metadata"]);
  await expect(verify(f)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      "declares 5.1.0; release branch requires 6.0.0",
    ),
  });
});

it.each(
  pluginManifestPaths.map((path) => ({
    path,
    stale: "version",
    manifest:
      path === ".codex-plugin/plugin.json"
        ? { version: "5.1.0", mcpServers: "./.codex-plugin/mcp.json" }
        : pluginManifest("5.1.0"),
    failure: "declares 5.1.0; release branch requires 6.0.0",
  })),
)("rejects a plugin $stale in $path", async ({ path, manifest, failure }) => {
  const f = await fixture();
  await candidate(f, "6.0.0");
  await writeFile(join(f.directory, path), JSON.stringify(manifest));
  await git(f.directory, ["add", "."]);
  await git(f.directory, ["commit", "-m", "chore: stale plugin manifest"]);
  await expect(verify(f)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(failure),
  });
});

it.each([
  {
    path: ".claude-plugin/plugin.json",
    manifest: pluginManifest("6.0.0", "5.1.0"),
  },
  {
    path: ".codex-plugin/mcp.json",
    manifest: codexServerConfig("6.0.0", "5.1.0"),
  },
])("reads the release pin from $path", async ({ path, manifest }) => {
  const f = await fixture();
  await candidate(f, "6.0.0");
  await writeFile(join(f.directory, path), JSON.stringify(manifest));
  await git(f.directory, ["add", "."]);
  await git(f.directory, ["commit", "-m", "chore: stale plugin launch"]);
  await expect(verify(f)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      `launches version 5.1.0; release branch requires 6.0.0`,
    ),
  });
});

it("checks a publish merge using its pre-release first parent baseline", async () => {
  const f = await fixture();
  const sourceSha = await candidate(f, "6.0.0");
  const report = reportSchema.parse(
    JSON.parse(
      (await verify({ ...f, sourceSha }, "6.0.0", "publish", "source")).stdout,
    ),
  );
  expect(report.applicationSha).toBe(f.sourceSha);
  expect(report.baselineVersion).toBe("5.0.0");
});

it("reports other omitted entries for review without inventing a breaking change", async () => {
  const f = await fixture("fix: improve diagnostics");
  await candidate(f, "5.0.1", "### Bug Fixes\n\nUpdated diagnostics");
  const result = await verify(f, "5.0.1");
  expect(reportSchema.parse(JSON.parse(result.stdout)).missingNotes).toEqual([
    {
      sha: f.changedSha,
      subject: "fix: improve diagnostics",
      type: "fix",
      breaking: false,
    },
  ]);
  expect(result.stderr).toContain("additional unreleased mainline entries");
});

it("reports a missing published tag with recovery advice", async () => {
  const f = await fixture();
  await git(f.directory, ["tag", "-d", "rea-agents-5.0.0"]);
  await expect(verify(f, "6.0.0", "prepare", "source")).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Fetch release tags"),
  });
});

it("rejects a published baseline outside the selected ancestry", async () => {
  const f = await fixture();
  const next = await candidate(f, "6.0.0");
  await git(f.directory, ["tag", "-f", "rea-agents-5.0.0", next]);
  await expect(verify(f, "6.0.0", "prepare", "source")).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      "Published baseline is outside the checkpoint ancestry",
    ),
  });
});

it("reports malformed candidate JSON with the exact metadata path", async () => {
  const f = await fixture();
  await candidate(f, "6.0.0");
  await writeFile(join(f.directory, "server.json"), "{");
  await git(f.directory, ["add", "."]);
  await git(f.directory, ["commit", "-m", "chore: invalid metadata"]);
  await expect(verify(f)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringMatching(/server\.json@.*contains invalid JSON/u),
  });
});

it("rejects a candidate from a different source even when versions and notes match", async () => {
  const f = await fixture();
  await git(f.directory, ["switch", "release/5.0.0"]);
  await candidate(f, "6.0.0");
  await expect(verify(f)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      "Candidate is outside the selected checkpoint ancestry",
    ),
  });
});

it.skipIf(process.platform === "win32").each([
  { job: "release-please", valid: true },
  { job: "release-please", valid: false },
  { job: "merged-release", valid: true },
  { job: "merged-release", valid: false },
])(
  "the actual $job preflight admits the next action only for valid metadata ($valid)",
  async ({ job, valid }) => {
    const f = await fixture();
    const sourceSha = await candidate(f, valid ? "6.0.0" : "5.1.0");
    const workflow = z
      .object({
        jobs: z.object({
          [job]: z.object({
            steps: z.array(
              z.object({
                name: z.string().optional(),
                run: z.string().optional(),
              }),
            ),
          }),
        }),
      })
      .parse(
        parse(
          await readFile(
            new URL("../../../.github/workflows/release.yml", import.meta.url),
            "utf8",
          ),
        ),
      );
    const command = z
      .string()
      .parse(
        workflow.jobs[job]?.steps.find(
          (step) =>
            step.name ===
            (job === "merged-release"
              ? "Validate reviewed merge before release creation"
              : "Validate checkpoint version and ancestry before release creation"),
        )?.run,
      );
    const marker = join(f.directory, "next-release-action");
    const execution = execFileAsync(
      "bash",
      [
        "-e",
        "-o",
        "pipefail",
        "-c",
        `${command}\ntouch "$NEXT_RELEASE_ACTION_MARKER"`,
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          ...process.env,
          GIT_DIR: join(f.directory, ".git"),
          GIT_WORK_TREE: f.directory,
          RELEASE_PHASE: "publish",
          RELEASE_BRANCH: "release/6.0.0",
          SOURCE_SHA: sourceSha,
          GITHUB_SHA: sourceSha,
          NEXT_RELEASE_ACTION_MARKER: marker,
        },
      },
    );
    if (valid) {
      await expect(execution).resolves.toMatchObject({ stderr: "" });
      expect(await readFile(marker, "utf8")).toBe("");
    } else {
      await expect(execution).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          job === "merged-release"
            ? "contains unreleased breaking markers"
            : "release branch requires 6.0.0",
        ),
      });
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);
