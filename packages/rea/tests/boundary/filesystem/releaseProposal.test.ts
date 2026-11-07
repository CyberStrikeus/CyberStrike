import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  applyReleasePleasePatch,
  releaseProposalSearchDepth,
} from "../../../scripts/lib/release-proposal.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
let upstream: typeof import("release-please");
let githubRuntime: typeof import("release-please/build/src/github.js");
const baseline = "a".repeat(40);
const latest = "b".repeat(40);
const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
};

beforeAll(async () => {
  upstream = await import("release-please");
  githubRuntime = require("release-please/build/src/github.js");
});

afterEach(() => vi.restoreAllMocks());

function respond(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function associatedPullRequest(number = 42, mergeCommit = latest) {
  return {
    number,
    title: "Original title",
    baseRefName: "main",
    headRefName: "feature",
    body: `BEGIN_COMMIT_OVERRIDE\nfix: attributed override (#${number})\nEND_COMMIT_OVERRIDE`,
    mergeCommit: { oid: mergeCommit },
    labels: { nodes: [{ name: "reviewed" }] },
    files: {
      nodes: [{ path: "src/feature.ts" }],
      pageInfo: { hasNextPage: false },
    },
  };
}

type CommitRecord = {
  sha: string;
  message: string;
  files: string[];
  pullRequests?: ReturnType<typeof associatedPullRequest>[];
};
type HistoryVariables = {
  num: number;
  cursor?: string | undefined;
  includeFiles?: boolean | undefined;
};
type HistoryFailure = {
  cursor?: string;
  errors: { message: string; type?: string }[];
  status?: number;
};
const internalError = {
  message:
    "Something went wrong while executing your query on 2026-10-24T08:20:11Z. Please include `fixture:request` when reporting this issue.",
};

function historyPage(
  commits: CommitRecord[],
  page: HistoryVariables,
  pullRequest: boolean,
) {
  const offset = Number(page.cursor ?? "0");
  const selected = commits.slice(offset, offset + page.num);
  return {
    data: {
      repository: {
        ref: {
          target: {
            history: {
              nodes: selected.map((commit) => ({
                sha: commit.sha,
                message: commit.message,
                associatedPullRequests: {
                  nodes: (
                    commit.pullRequests ??
                    (pullRequest && commit.sha === latest
                      ? [associatedPullRequest()]
                      : [])
                  ).map(({ files, ...metadata }) => ({
                    ...metadata,
                    ...(page.includeFiles === false ? {} : { files }),
                  })),
                },
              })),
              pageInfo: {
                hasNextPage: offset + selected.length < commits.length,
                endCursor: String(offset + selected.length),
              },
            },
          },
        },
      },
    },
  };
}

function releaseRecord(version: string, sha = baseline) {
  const tagName = `rea-agents-${version}`;
  return {
    name: version,
    tag: { name: tagName },
    tagCommit: { oid: sha },
    description: "",
    isDraft: false,
    url: `https://github.com/fixture/rea/releases/tag/${tagName}`,
  };
}

function releasePage(releases: ReturnType<typeof releaseRecord>[]) {
  return {
    data: {
      repository: {
        releases: {
          nodes: releases,
          pageInfo: { hasNextPage: false },
        },
      },
    },
  };
}

const defaultConfiguration = {
  "release-type": "node",
  versioning: "always-bump-minor",
  "include-v-in-tag": false,
  packages: {
    ".": {
      "package-name": "rea-agents",
      "extra-files": [{ type: "generic", path: "version.txt" }],
    },
  },
};

function releaseFileEntries(
  configuration: Record<string, unknown>,
  releasedVersions: Record<string, string>,
) {
  const files: Record<string, unknown> = {
    "release-please-config.json": configuration,
    ".release-please-manifest.json": releasedVersions,
    "package.json": {
      name: "rea-agents",
      version: releasedVersions["."] ?? "0.0.0",
    },
    "pkg/package.json": {
      name: "rea-agents",
      version: releasedVersions.pkg ?? "0.0.0",
    },
  };
  return Object.entries(files).map(([path, value], index) => ({
    path,
    sha: (index + 1).toString(16).padStart(40, "0"),
    text: JSON.stringify(value),
  }));
}

async function releaseFixture({
  config = {},
  commits = [
    { sha: latest, message: "fix: direct change", files: ["docs/changed.md"] },
    { sha: baseline, message: "chore: release 6.7.0", files: ["package.json"] },
  ],
  depth = 500,
  pullRequest = false,
  historyFailures = [],
  releaseFailures = [],
  releasedVersions = { ".": "6.7.0", pkg: "6.7.0" },
  releases = [releaseRecord("6.7.0")],
  tags = [],
}: {
  config?: Record<string, unknown>;
  commits?: CommitRecord[];
  depth?: number;
  pullRequest?: boolean;
  historyFailures?: HistoryFailure[];
  releaseFailures?: HistoryFailure["errors"][];
  releasedVersions?: Record<string, string>;
  releases?: ReturnType<typeof releaseRecord>[];
  tags?: { name: string; commit: { sha: string } }[];
} = {}) {
  const requests: { method: string; pathname: string }[] = [];
  const pages: HistoryVariables[] = [];
  const historyQueries: string[] = [];
  const failures = [...historyFailures];
  const releaseErrors = [...releaseFailures];
  const configuration = { ...defaultConfiguration, ...config };
  const entries = releaseFileEntries(configuration, releasedVersions);
  const github = await upstream.GitHub.create({
    owner: "fixture",
    repo: "rea",
    defaultBranch: "main",
    logger: silent,
    fetch: async (
      input: string,
      options: { method?: string; body?: string },
    ) => {
      const url = new URL(input);
      requests.push({
        method: options.method ?? "GET",
        pathname: url.pathname,
      });
      if (url.pathname === "/repos/fixture/rea/tags") return respond(tags);
      if (url.pathname === "/repos/fixture/rea/releases/generate-notes") {
        return respond({ body: "Generated release notes" });
      }
      if (url.pathname === "/graphql") {
        const query = z
          .object({
            query: z.string(),
            variables: z.object({
              num: z.number(),
              cursor: z.string().optional(),
              includeFiles: z.boolean().optional(),
            }),
          })
          .parse(JSON.parse(options.body ?? ""));
        if (query.query.includes("query releases(")) {
          const errors = releaseErrors.shift();
          if (errors) return respond({ errors });
          return respond(releasePage(releases));
        }
        if (!query.query.includes("query pullRequestsSince(")) {
          throw new Error(`Unexpected GraphQL operation: ${query.query}`);
        }
        pages.push(query.variables);
        historyQueries.push(query.query);
        const failure = failures[0];
        if (failure && failure.cursor === query.variables.cursor) {
          failures.shift();
          return respond(
            {
              ...historyPage(commits, query.variables, pullRequest),
              errors: failure.errors,
            },
            failure.status,
          );
        }
        return respond(historyPage(commits, query.variables, pullRequest));
      }
      if (url.pathname === "/repos/fixture/rea/git/trees/main") {
        return respond({
          truncated: false,
          sha: baseline,
          tree: entries.map(({ path, sha, text }) => ({
            path,
            sha,
            type: "blob",
            mode: "100644",
            size: text.length,
          })),
        });
      }
      const blobPrefix = "/repos/fixture/rea/git/blobs/";
      if (url.pathname.startsWith(blobPrefix)) {
        const entry = entries.find(
          (item) => item.sha === url.pathname.slice(blobPrefix.length),
        );
        if (!entry) throw new Error("Unexpected blob read");
        return respond({
          content: Buffer.from(entry.text).toString("base64"),
          encoding: "base64",
          sha: entry.sha,
          size: entry.text.length,
        });
      }
      const commitPath = "/repos/fixture/rea/commits/";
      if (url.pathname.startsWith(commitPath)) {
        const commit = commits.find(
          (item) => item.sha === url.pathname.slice(commitPath.length),
        );
        if (!commit) throw new Error("Unexpected commit lookup");
        return respond({
          files: commit.files.map((filename) => ({ filename })),
        });
      }
      throw new Error(
        `Unexpected HTTP request: ${options.method} ${url.pathname}`,
      );
    },
  });
  const manifest = await upstream.Manifest.fromManifest(
    github,
    "main",
    undefined,
    undefined,
    {
      commitSearchDepth: depth,
      logger: silent,
    },
  );
  return { manifest, github, requests, pages, historyQueries };
}

it("builds the root Node proposal without commit-file lookups and retains extra-file updates", async () => {
  const fixture = await releaseFixture();
  const candidates = await fixture.manifest.buildPullRequests();
  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.body.toString()).toContain("direct change");
  const version = candidates[0]?.updates.find(
    (update) => update.path === "version.txt",
  );
  expect(
    version?.updater.updateContent("6.7.0 // x-release-please-version"),
  ).toContain("6.8.0");
  expect(
    fixture.requests.filter((request) =>
      request.pathname.includes("/commits/"),
    ),
  ).toEqual([]);
  expect(fixture.pages.map((page) => page.num)).toEqual([10]);
  expect(fixture.pages[0]?.includeFiles).toBe(false);
  expect(fixture.historyQueries[0]).toContain("$includeFiles: Boolean!");
  expect(fixture.historyQueries[0]).toContain(
    "files(first: $maxFilesChanged) @include(if: $includeFiles)",
  );
  const commits = [];
  for await (const commit of fixture.github.mergeCommitIterator("main", {
    backfillFiles: false,
  }))
    commits.push(commit);
  expect(commits[0]?.files).toBeUndefined();
});

it("keeps real associated PR metadata, body overrides and attribution", async () => {
  const fixture = await releaseFixture({ pullRequest: true });
  const candidates = await fixture.manifest.buildPullRequests();
  const body = candidates[0]?.body.toString();
  expect(body).toContain("attributed override");
  expect(body).toContain("https://github.com/fixture/rea/issues/42");
  expect(body).not.toContain("direct change");
  const commits = [];
  for await (const commit of fixture.github.mergeCommitIterator("main", {
    backfillFiles: false,
  }))
    commits.push(commit);
  expect(commits[0]?.pullRequest).toMatchObject({
    number: 42,
    labels: ["reviewed"],
    mergeCommitOid: latest,
    body: expect.stringContaining("BEGIN_COMMIT_OVERRIDE"),
    files: ["src/feature.ts"],
  });
  expect(commits[0]?.files).toEqual(["src/feature.ts"]);
  expect(fixture.pages.at(-1)?.includeFiles).toBe(true);
});

it.each([false, true])(
  "preserves associated PR selection with omitted files for rebased=%s",
  async (rebased) => {
    const second = "c".repeat(40);
    const fixture = await releaseFixture({
      commits: [
        {
          sha: latest,
          message: "fix: first change",
          files: ["src/first.ts"],
          pullRequests: [
            associatedPullRequest(7, baseline),
            associatedPullRequest(),
          ],
        },
        {
          sha: second,
          message: "fix: second change",
          files: ["src/second.ts"],
          pullRequests: rebased ? [associatedPullRequest()] : [],
        },
        { sha: baseline, message: "chore: release 6.7.0", files: [] },
      ],
    });
    const full = [];
    for await (const commit of fixture.github.mergeCommitIterator("main"))
      full.push(commit);
    expect(fixture.pages.length).toBeGreaterThan(0);
    expect(fixture.pages.every((page) => page.includeFiles === true)).toBe(
      true,
    );
    const fullPageCount = fixture.pages.length;
    // The runtime patch adds this option after source checks read upstream types.
    const options = {
      includeFiles: false,
      backfillFiles: true,
    } satisfies NonNullable<
      Parameters<typeof fixture.github.mergeCommitIterator>[1]
    > & { includeFiles: boolean };
    const omitted = [];
    for await (const commit of fixture.github.mergeCommitIterator(
      "main",
      options,
    ))
      omitted.push(commit);
    expect(fixture.pages.length).toBeGreaterThan(fullPageCount);
    expect(
      fixture.pages
        .slice(fullPageCount)
        .every((page) => page.includeFiles === false),
    ).toBe(true);
    expect(full[0]?.pullRequest?.number).toBe(rebased ? 7 : 42);
    expect(omitted).toEqual(
      full.map(({ files: _files, pullRequest, ...commit }) => ({
        ...commit,
        ...(pullRequest
          ? {
              pullRequest: Object.fromEntries(
                Object.entries(pullRequest).filter(([key]) => key !== "files"),
              ),
            }
          : {}),
      })),
    );
    expect(omitted.every((commit) => commit.files === undefined)).toBe(true);
    expect(
      fixture.requests.filter((request) =>
        request.pathname.includes("/commits/"),
      ),
    ).toEqual([]);
  },
);

it.each([
  {
    name: "inherited exclusion",
    config: { "exclude-paths": ["docs"] },
    excluded: true,
  },
  {
    name: "package exclusion",
    config: {
      packages: {
        ".": { "package-name": "rea-agents", "exclude-paths": ["docs"] },
      },
    },
    excluded: true,
  },
  {
    name: "explicit plugin",
    config: { plugins: ["sentence-case"] },
    excluded: false,
  },
  {
    name: "nondefault changelog",
    config: { "changelog-type": "github" },
    excluded: false,
  },
  {
    name: "other versioning strategy",
    config: { versioning: "always-bump-patch" },
    excluded: false,
  },
  {
    name: "subpackage",
    config: { packages: { pkg: { "package-name": "rea-agents" } } },
    excluded: true,
  },
])("retains file-backed semantics for $name", async ({ config, excluded }) => {
  const fixture = await releaseFixture({ config });
  const candidates = await fixture.manifest.buildPullRequests();
  expect(
    fixture.requests.filter((request) =>
      request.pathname.includes("/commits/"),
    ),
  ).toHaveLength(2);
  expect(fixture.pages.every((page) => page.includeFiles === true)).toBe(true);
  expect(candidates).toHaveLength(excluded ? 0 : 1);
});

it("collects beyond 500 commits and rejects an unobserved known release boundary", async () => {
  const commits = Array.from({ length: 501 }, (_, index) => ({
    sha: index.toString(16).padStart(40, "0"),
    message: `fix: unreleased change ${index}`,
    files: ["src/change.ts"],
  }));
  commits.push({
    sha: baseline,
    message: "chore: release 6.7.0",
    files: ["package.json"],
  });
  const complete = await releaseFixture({ commits, depth: commits.length });
  const candidates = await complete.manifest.buildPullRequests();
  expect(candidates[0]?.body.toString()).toContain("unreleased change 500");
  expect(complete.pages).toHaveLength(51);
  expect(
    complete.requests.filter((request) =>
      request.pathname.includes("/commits/"),
    ),
  ).toEqual([]);
  const truncated = await releaseFixture({ commits });
  await expect(truncated.manifest.createPullRequests()).rejects.toThrow(
    "Incomplete release history",
  );
  expect(
    truncated.requests.every(
      (request) => request.method === "GET" || request.pathname === "/graphql",
    ),
  ).toBe(true);
});

it("rejects a missing manifest release before replaying a historical version override", async () => {
  const fixture = await releaseFixture({
    releasedVersions: { ".": "6.8.0" },
    releases: [releaseRecord("6.7.0", "d".repeat(40))],
    commits: [
      { sha: latest, message: "fix: current change", files: ["src/change.ts"] },
      {
        sha: baseline,
        message: "chore: release 6.8.0",
        files: ["package.json"],
      },
      {
        sha: "c".repeat(40),
        message: "fix: historical version override\n\nRelease-As: 0.4.0",
        files: ["src/historical.ts"],
      },
    ],
  });
  await expect(fixture.manifest.createPullRequests()).rejects.toThrow(
    "Missing expected release",
  );
  expect(fixture.pages).toEqual([]);
  expect(
    fixture.requests.every(
      (request) => request.method === "GET" || request.pathname === "/graphql",
    ),
  ).toBe(true);
});

it("uses a tag-only manifest release and excludes older version overrides", async () => {
  const fixture = await releaseFixture({
    releasedVersions: { ".": "6.8.0" },
    releases: [],
    tags: [{ name: "rea-agents-6.8.0", commit: { sha: baseline } }],
    commits: [
      { sha: latest, message: "fix: current change", files: ["src/change.ts"] },
      {
        sha: baseline,
        message: "chore: release 6.8.0",
        files: ["package.json"],
      },
      {
        sha: "c".repeat(40),
        message: "fix: historical version override\n\nRelease-As: 0.4.0",
        files: ["src/historical.ts"],
      },
    ],
  });
  const candidates = await fixture.manifest.buildPullRequests();
  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.body.toString()).toContain("current change");
  expect(candidates[0]?.body.toString()).not.toContain(
    "historical version override",
  );
  const version = candidates[0]?.updates.find(
    (update) => update.path === "version.txt",
  );
  expect(
    version?.updater.updateContent("6.8.0 // x-release-please-version"),
  ).toContain("6.9.0");
  expect(
    fixture.requests.some(
      (request) => request.pathname === "/repos/fixture/rea/tags",
    ),
  ).toBe(true);
});

it.each(["omitted", "0.0.0"])(
  "preserves initial bootstrap with an %s manifest version",
  async (version) => {
    const releasedVersions: Record<string, string> =
      version === "omitted" ? {} : { ".": version };
    const fixture = await releaseFixture({
      releasedVersions,
      releases: [],
      commits: [
        {
          sha: latest,
          message: "feat: initial change",
          files: ["src/change.ts"],
        },
      ],
    });
    const candidates = await fixture.manifest.buildPullRequests();
    expect(candidates).toHaveLength(1);
    const versionUpdate = candidates[0]?.updates.find(
      (update) => update.path === "version.txt",
    );
    expect(
      versionUpdate?.updater.updateContent("0.0.0 // x-release-please-version"),
    ).toContain("1.0.0");
  },
);

it.each([
  {
    name: "timestamped GraphQL internal error",
    error: internalError,
    status: 200,
  },
  {
    name: "GraphQL internal error without timestamp",
    error: {
      message:
        "Something went wrong while executing your query. Please include `fixture:request` when reporting this issue.",
    },
    status: 200,
  },
  { name: "HTTP 502 error", error: internalError, status: 502 },
])(
  "retries the same history cursor after $name and discards partial data",
  async ({ error, status }) => {
    const sleep = vi
      .spyOn(githubRuntime, "sleepInMs")
      .mockResolvedValue(undefined);
    const commits = Array.from({ length: 11 }, (_, index) => ({
      sha: index.toString(16).padStart(40, "0"),
      message: `fix: unreleased change ${index}`,
      files: ["src/change.ts"],
    }));
    commits.push({ sha: baseline, message: "chore: release 6.7.0", files: [] });
    const fixture = await releaseFixture({
      commits,
      historyFailures: [{ cursor: "10", errors: [error], status }],
    });
    const candidates = await fixture.manifest.buildPullRequests();
    const body = candidates[0]?.body.toString();
    expect(body?.match(/unreleased change 10/gu)).toHaveLength(1);
    expect(fixture.pages.map((page) => page.cursor)).toEqual([
      undefined,
      "10",
      "10",
    ]);
    expect(fixture.pages[1]).toEqual(fixture.pages[2]);
    expect(fixture.historyQueries[1]).toBe(fixture.historyQueries[2]);
    expect(sleep.mock.calls).toEqual([[1000]]);
  },
);

it("does not retry canonical internal errors outside commit-history reads", async () => {
  const sleep = vi
    .spyOn(githubRuntime, "sleepInMs")
    .mockResolvedValue(undefined);
  const fixture = await releaseFixture({ releaseFailures: [[internalError]] });
  await expect(fixture.manifest.createPullRequests()).rejects.toMatchObject({
    name: "GraphqlResponseError",
    errors: [internalError],
  });
  expect(fixture.pages).toEqual([]);
  expect(
    fixture.requests.filter((request) => request.pathname === "/graphql"),
  ).toHaveLength(1);
  expect(sleep).not.toHaveBeenCalled();
});

it.each([
  {
    name: "permission",
    errors: [{ message: "Resource not accessible", type: "FORBIDDEN" }],
  },
  {
    name: "validation",
    errors: [
      { message: "Field does not exist", type: "GRAPHQL_VALIDATION_FAILED" },
    ],
  },
  {
    name: "mixed",
    errors: [
      internalError,
      { message: "Resource not accessible", type: "FORBIDDEN" },
    ],
  },
  {
    name: "unrecognized internal",
    errors: [{ message: "Another server failure", type: "INTERNAL" }],
  },
  { name: "empty errors", errors: [] },
])("does not retry $name GraphQL failures", async ({ errors }) => {
  const sleep = vi
    .spyOn(githubRuntime, "sleepInMs")
    .mockResolvedValue(undefined);
  const fixture = await releaseFixture({ historyFailures: [{ errors }] });
  await expect(fixture.manifest.createPullRequests()).rejects.toMatchObject({
    name: "GraphqlResponseError",
    errors,
  });
  expect(fixture.pages).toHaveLength(1);
  expect(sleep).not.toHaveBeenCalled();
  expect(
    fixture.requests.every(
      (request) => request.method === "GET" || request.pathname === "/graphql",
    ),
  ).toBe(true);
});

it("exhausts bounded history retries without creating a partial proposal", async () => {
  const sleep = vi
    .spyOn(githubRuntime, "sleepInMs")
    .mockResolvedValue(undefined);
  const fixture = await releaseFixture({
    historyFailures: Array.from({ length: 6 }, () => ({
      errors: [internalError],
    })),
  });
  await expect(fixture.manifest.createPullRequests()).rejects.toMatchObject({
    name: "GraphqlResponseError",
    errors: [internalError],
  });
  expect(fixture.pages).toHaveLength(6);
  expect(fixture.pages.every((page) => page.cursor === undefined)).toBe(true);
  expect(sleep.mock.calls).toEqual([[1000], [2000], [4000], [8000], [16000]]);
  expect(
    fixture.requests.every(
      (request) => request.method === "GET" || request.pathname === "/graphql",
    ),
  ).toBe(true);
});

it("preserves a reached explicit last-release override", async () => {
  const fixture = await releaseFixture({
    config: { "last-release-sha": latest },
  });
  await expect(fixture.manifest.buildPullRequests()).resolves.toEqual([]);
});

it("preserves complete mixed bootstrap history with all known release boundaries", async () => {
  const fixture = await releaseFixture({
    releasedVersions: { ".": "6.7.0", pkg: "0.0.0" },
    config: {
      packages: {
        ".": { "package-name": "rea-agents" },
        pkg: { "package-name": "unreleased" },
      },
    },
  });
  await expect(fixture.manifest.buildPullRequests()).resolves.toHaveLength(1);
});

it("requires complete local history when sizing the upstream search", async () => {
  const directory = await createTestTempDirectory("rea-release-depth-");
  await execute("git", ["init", "--quiet", directory]);
  await execute("git", [
    "-C",
    directory,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  const run = async (command: string, args: string[]) =>
    (await execute(command, args, { cwd: directory })).stdout;
  const head = (await run("git", ["rev-parse", "HEAD"])).trim();
  await expect(releaseProposalSearchDepth(run, head)).resolves.toBe(1);
  await writeFile(join(directory, ".git/shallow"), `${head}\n`);
  await expect(releaseProposalSearchDepth(run, head)).rejects.toThrow(
    "complete Git history",
  );
});

const releasePatchFixture = async () => {
  const root = await createTestTempDirectory("rea-release-git-patch-");
  const project = join(root, "project space Ω");
  const dependencyPath = "node_modules/release dependency space Ω";
  const directory = join(project, dependencyPath);
  const upstreamDirectory = dirname(
    require.resolve("release-please/package.json"),
  );
  const source = fileURLToPath(new URL("../../../", import.meta.url));
  const patchPath = join(project, "patches/release-please+17.3.0.patch");
  const patch = await readFile(
    join(source, "patches/release-please+17.3.0.patch"),
    "utf8",
  );
  const members = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gmu)].map((match) => {
    const member = match[1];
    if (member === undefined) throw new Error("Patch header omitted its path");
    return member;
  });
  await mkdir(join(project, "scripts/lib"), { recursive: true });
  await mkdir(dirname(patchPath), { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeFile(join(project, "package.json"), '{"type":"module"}');
  await writeFile(patchPath, patch);
  for (const script of ["release-proposal.mjs", "release-notes.mjs"])
    await copyFile(
      join(source, "scripts/lib", script),
      join(project, "scripts/lib", script),
    );
  for (const dependency of ["semver", "zod"])
    await symlink(
      dirname(require.resolve(`${dependency}/package.json`)),
      join(project, "node_modules", dependency),
      "junction",
    );
  for (const member of ["package.json", ...members]) {
    await mkdir(dirname(join(directory, member)), { recursive: true });
    await copyFile(join(upstreamDirectory, member), join(directory, member));
  }
  const environment = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.protectNTFS",
    GIT_CONFIG_VALUE_0: "true",
  };
  const git = (...args: string[]) =>
    execute("git", args, { cwd: project, env: environment });
  // Installation owns the patched dependency. Reverse only the private copy
  // to obtain the exact upstream input for the fresh-application control.
  await git("apply", "--reverse", "--directory", dependencyPath, patchPath);
  const apply = () =>
    execute(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { applyReleasePleasePatch } from ${JSON.stringify(pathToFileURL(join(project, "scripts/lib/release-proposal.mjs")).href)}; await applyReleasePleasePatch(${JSON.stringify(directory)});`,
      ],
      { cwd: project, env: environment, timeout: 10_000 },
    );
  const contents = () =>
    Promise.all(
      members.map((member) => readFile(join(directory, member), "utf8")),
    );
  return { directory, apply, contents, git, dependencyPath, patchPath };
};

it("applies the private dependency patch with protected Git paths and is idempotent", async () => {
  const fixture = await releasePatchFixture();
  const original = await fixture.contents();
  await fixture.apply();
  const patched = await fixture.contents();
  expect(patched).not.toEqual(original);
  expect(patched.join("\n")).toContain("const rootOnlyNode =");
  await fixture.git(
    "apply",
    "--check",
    "--reverse",
    "--directory",
    fixture.dependencyPath,
    fixture.patchPath,
  );
  await fixture.apply();
  expect(await fixture.contents()).toEqual(patched);
});

it("rejects a different dependency version before patching", async () => {
  const fixture = await createTestTempDirectory("rea-release-patch-");
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({ version: "17.4.0" }),
  );
  await expect(applyReleasePleasePatch(fixture)).rejects.toThrow(
    "requires release-please 17.3.0",
  );
});

it.each(["partial", "mismatched"])(
  "rejects a %s private dependency patch without changing its files",
  async (state) => {
    const fixture = await releasePatchFixture();
    const manifest = join(fixture.directory, "build/src/manifest.js");
    const original = await readFile(manifest, "utf8");
    await fixture.apply();
    const patched = await readFile(manifest, "utf8");
    await writeFile(
      manifest,
      state === "partial"
        ? original
        : patched.replace(
            "const rootOnlyNode =",
            "const mismatchedRootOnlyNode =",
          ),
    );
    const before = await fixture.contents();
    await expect(fixture.apply()).rejects.toThrow(
      "does not match the installed source",
    );
    expect(await fixture.contents()).toEqual(before);
  },
);
