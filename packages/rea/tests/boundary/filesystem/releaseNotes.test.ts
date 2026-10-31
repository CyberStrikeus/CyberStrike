import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";
import {
  executeWorkflowFixture as exec,
  workflowGit as git,
} from "../../support/workflowGit.js";

const cli = fileURLToPath(
  new URL("../../../scripts/release-notes.mjs", import.meta.url),
);
const actor = (login: string, __typename = "User") => ({ login, __typename });
const author = (login: string | null, type = "User") => ({
  name: login ?? "Unknown",
  email: "public@example.invalid",
  user: login === null ? null : actor(login, type),
});
const page = (nodes: unknown[], cursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
});

interface ReleaseNotesSeed {
  readonly directory: string;
  readonly base: string;
  readonly target: string;
}

let seed: ReleaseNotesSeed | undefined;
let seedWorkspaceRoot: string | undefined;

const pluginManifests = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
] as const;
const pluginServerConfig = ".codex-plugin/mcp.json";

const pluginMarketplaces = [
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
] as const;
const pluginMarketplace = (version: string, packageName = "rea-agents") => ({
  plugins: [
    { name: "rea", source: { source: "npm", package: packageName, version } },
  ],
});

const pluginServer = (version: string, command = "node") => ({
  mcpServers: {
    rea: {
      command,
      args: ["./scripts/plugin-mcp-launcher.mjs", version],
      startup_timeout_sec: 30,
    },
  },
});

const pluginManifest = (
  version: string,
  { skills = ["./skill"], command = "node" } = {},
) => ({
  version,
  skills,
  mcpServers: {
    rea: {
      command,
      args: ["${CLAUDE_PLUGIN_ROOT}/scripts/plugin-mcp-launcher.mjs", version],
    },
  },
});

const pluginManifestFor = (
  path: (typeof pluginManifests)[number],
  version: string,
  options: { skills?: string[]; command?: string } = {},
) =>
  path === ".codex-plugin/plugin.json"
    ? {
        version,
        skills: options.skills ?? ["./skill"],
        mcpServers: "./.codex-plugin/mcp.json",
      }
    : pluginManifest(version, options);

beforeAll(async () => {
  const workspace = await createTestWorkspace("rea-release-notes-seed-");
  seedWorkspaceRoot = workspace.root;
  const directory = workspace.path("repository");
  await mkdir(directory, { recursive: true });
  await git(directory, ["init", "--initial-branch=main"]);
  await writeFile(join(directory, "product.txt"), "base");
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ version: "6.3.0" }),
  );
  await writeFile(
    join(directory, ".release-please-manifest.json"),
    JSON.stringify({ ".": "6.3.0" }),
  );
  for (const path of pluginManifests) {
    await mkdir(join(directory, dirname(path)), { recursive: true });
    await writeFile(
      join(directory, path),
      JSON.stringify(pluginManifestFor(path, "6.3.0")),
    );
  }
  await writeFile(
    join(directory, pluginServerConfig),
    JSON.stringify(pluginServer("6.3.0")),
  );
  for (const path of pluginMarketplaces) {
    await mkdir(join(directory, dirname(path)), { recursive: true });
    await writeFile(
      join(directory, path),
      JSON.stringify(pluginMarketplace("6.3.0")),
    );
  }
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "chore: baseline"]);
  const base = await git(directory, ["rev-parse", "HEAD"]);
  await git(directory, ["tag", "rea-agents-6.3.0"]);
  await git(directory, ["switch", "-c", "feature"]);
  await writeFile(join(directory, "feature.txt"), "capability");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "feat: useful capability (#101)"]);
  const feature = await git(directory, ["rev-parse", "HEAD"]);
  await git(directory, ["switch", "main"]);
  await writeFile(join(directory, "direct.txt"), "direct fix");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "fix: direct improvement"]);
  const direct = await git(directory, ["rev-parse", "HEAD"]);
  await git(directory, [
    "merge",
    "--no-ff",
    "feature",
    "-m",
    "Merge pull request #101",
  ]);
  const target = await git(directory, ["rev-parse", "HEAD"]);
  const bin = join(directory, "bin");
  await mkdir(bin);
  const issue = (number: number, login: string) => ({
    number,
    url: `https://github.com/fixture/rea/issues/${number}`,
    author: actor(login),
    repository: { nameWithOwner: "fixture/rea" },
  });
  const metadata = {
    commits: {
      [feature]: {
        oid: feature,
        authors: page([author("alice")], "authors-2"),
        associatedPullRequests: page(
          [{ number: 999, mergeCommit: null }],
          "prs-2",
        ),
      },
      [direct]: {
        oid: direct,
        authors: page([
          author("dana"),
          author("automation[bot]"),
          author("platformbot", "Bot"),
          author("claude"),
          author("cursoragent"),
          author("codex"),
          author("Copilot"),
          author("morluto"),
        ]),
        associatedPullRequests: page([]),
      },
      [target]: {
        oid: target,
        authors: page([author("merger")]),
        associatedPullRequests: page([
          { number: 101, mergeCommit: { oid: target } },
        ]),
      },
    },
    prs: {
      101: {
        number: 101,
        title: "feat: useful capability",
        url: "https://github.com/fixture/rea/pull/101",
        author: actor("alice"),
        mergeCommit: { oid: target },
        closingIssuesReferences: page([issue(51, "reporter")], "issues-2"),
      },
    },
    continuations: {
      "authors-2": { authors: page([author("bob"), author(null)]) },
      "prs-2": {
        associatedPullRequests: page([
          { number: 101, mergeCommit: { oid: target } },
        ]),
      },
      "issues-2": {
        closingIssuesReferences: page([issue(52, "second-reporter")]),
      },
    },
  };
  await writeFile(join(directory, "github.json"), JSON.stringify(metadata));
  await writeFile(
    join(bin, "gh"),
    `#!${process.execPath}
import { readFileSync } from 'node:fs';
if (!process.argv.includes('graphql')) {
  const pr = JSON.parse(readFileSync(new URL('../.git/release-pr.json', import.meta.url), 'utf8'));
  process.stdout.write(JSON.stringify(process.argv.includes('--slurp') ? [[pr]] : pr));
  process.exit(0);
}
let input = ''; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const fixture = JSON.parse(readFileSync(new URL('../github.json', import.meta.url), 'utf8'));
if (fixture.errors) { process.stdout.write(JSON.stringify({ errors: fixture.errors })); process.exit(0); }
const result = {};
if (request.variables.cursor) result.item = fixture.continuations[request.variables.cursor];
else {
  for (const match of request.query.matchAll(/(c\\d+): object\\(oid:"([a-f0-9]+)"\\)/g)) result[match[1]] = fixture.commits[match[2]];
  for (const match of request.query.matchAll(/(p\\d+): pullRequest\\(number:(\\d+)\\)/g)) result[match[1]] = fixture.prs[match[2]];
}
if (!Object.keys(result).length || Object.values(result).some(value => !value)) throw new Error('Unmodeled GitHub query');
process.stdout.write(JSON.stringify({data:{repository:result}}));
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  seed = { directory, base, target };
});

afterAll(async () => {
  if (seedWorkspaceRoot !== undefined)
    await removeTestWorkspace(seedWorkspaceRoot);
});

async function fixture() {
  const initial = seed;
  if (initial === undefined)
    throw new Error("Release notes seed was not initialized");
  const directory = await createTestTempDirectory("rea-release-notes-");
  await cp(initial.directory, directory, {
    recursive: true,
    dereference: true,
  });
  const { base, target } = initial;
  const bin = join(directory, "bin");
  const manifest = join(directory, "inventory.json");
  const invoke = (args: string[]) =>
    exec(process.execPath, [cli, ...args], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
  await invoke([
    "inventory",
    "--repository",
    "fixture/rea",
    "--base",
    base,
    "--target",
    target,
    "--version",
    "6.4.0",
    "--manifest",
    manifest,
  ]);
  const { stdout: record } = await invoke(["record", "--manifest", manifest]);
  const bullet =
    "- Added the capability (#101; fixes #51, #52). Thanks @alice, @bob, @reporter, @second-reporter.";
  const notes = `## [6.4.0]\n\n### Highlights\n\n${bullet}\n\n### Changes\n\n### Fixes\n\n${record}`;
  await writeFile(join(directory, "CHANGELOG.md"), notes);
  return { directory, base, target, manifest, invoke, notes, record, bullet };
}

it("inventories side branches and paginated credits, then checks and renders synchronized notes", async () => {
  const f = await fixture();
  const inventory = z
    .object({
      commits: z.array(
        z.object({
          sha: z.string(),
          authors: z.array(
            z.object({ user: z.object({ login: z.string() }).nullable() }),
          ),
        }),
      ),
      pullRequests: z.array(z.object({ number: z.number() })),
    })
    .parse(JSON.parse(await readFile(f.manifest, "utf8")));
  expect(inventory.commits).toHaveLength(3);
  expect(
    inventory.commits.flatMap(({ authors }) =>
      authors.map(({ user }) => user?.login),
    ),
  ).toEqual(
    expect.arrayContaining(["claude", "cursoragent", "codex", "Copilot"]),
  );
  expect(inventory.pullRequests.map((pr) => pr.number)).toEqual([101]);
  expect(f.record).toContain(
    "Thanks @alice, @bob, @reporter, @second-reporter.",
  );
  expect(f.record).toContain("Thanks @dana.");
  expect(f.record).not.toMatch(
    /@(?:merger|automation|platformbot|claude|cursoragent|codex|Copilot|morluto)/u,
  );
  const body = join(f.directory, "body.md");
  await writeFile(
    body,
    `## 🤖 I have created a release beep boop\n\n${f.notes}\n---\nThis PR was generated with [Release Please](https://github.com/googleapis/release-please).\n`,
  );
  const report = await f.invoke([
    "check",
    "--manifest",
    f.manifest,
    "--pr-body",
    body,
  ]);
  expect(JSON.parse(report.stdout)).toMatchObject({
    commits: 3,
    pullRequests: 1,
    unresolvedAuthors: [{ name: "Unknown", user: null }],
  });
  const output = join(f.directory, "rendered.md");
  await f.invoke(["render", "--manifest", f.manifest, "--output", output]);
  expect(await readFile(output, "utf8")).toBe(f.notes.trim() + "\n");
  await expect(
    f.invoke(["render", "--manifest", f.manifest, "--output", output]),
  ).rejects.toMatchObject({ stderr: expect.stringContaining("EEXIST") });
  const { stdout: summary } = await f.invoke([
    "record",
    "--manifest",
    f.manifest,
    "--summary",
  ]);
  expect(summary).toContain("3 commits and 1 merged PR]");
  expect(summary).toContain(
    "/blob/rea-agents-6.4.0/docs/releases/6.4.0.contributions.json",
  );
  expect(summary).not.toContain("Thanks");
  const conciseNotes = f.notes
    .replace(f.record, summary)
    .replace(
      "### Changes\n",
      "### Changes\n\n- Capability details (#101).\n- Related migration (#51).\n",
    );
  await writeFile(join(f.directory, "CHANGELOG.md"), conciseNotes);
  await f.invoke(["check", "--manifest", f.manifest]);
  await writeFile(
    join(f.directory, "CHANGELOG.md"),
    conciseNotes.replace(
      "6.4.0.contributions.json",
      "6.3.0.contributions.json",
    ),
  );
  await expect(
    f.invoke(["check", "--manifest", f.manifest]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("Contribution record differs"),
  });
  await expect(
    f.invoke([
      "inventory",
      "--repository",
      "fixture/rea",
      "--base",
      f.base,
      "--target",
      f.target,
      "--version",
      "6.4.0",
      "--manifest",
      f.manifest,
    ]),
  ).rejects.toMatchObject({ stderr: expect.stringContaining("EEXIST") });
});

it("rejects lost grouped credits, fabricated references, bots, and stale PR bodies", async () => {
  const f = await fixture();
  const directLink =
    /\[[a-f0-9]{7}\]\(https:\/\/github\.com\/fixture\/rea\/commit\/[a-f0-9]+\)/u.exec(
      f.record,
    )?.[0];
  if (!directLink)
    throw new Error("Fixture is missing its direct contribution");
  for (const [replacement, error] of [
    [f.bullet.replace(", @bob", ""), "Missing Thanks @bob"],
    [
      f.bullet.replace(", @bob", "") + "\n- Thanks @bob for other work.",
      "Missing Thanks @bob",
    ],
    [f.bullet + " (#999)", "Unknown release reference #999"],
    [f.bullet + "a".repeat(65_536), "inline PR body limit"],
    [f.bullet + "汉".repeat(43_000), "GitHub's body budget"],
    [
      f.bullet + `\n- Fixed direct behavior (${directLink}).`,
      "Missing Thanks @dana",
    ],
    [
      f.bullet + " Thanks @automation[bot].",
      "Unverified human credit @automation[bot]",
    ],
    [f.bullet + " Thanks @Copilot.", "Unverified human credit @copilot"],
  ]) {
    await writeFile(
      join(f.directory, "CHANGELOG.md"),
      f.notes.replace(f.bullet, replacement!),
    );
    await expect(
      f.invoke(["check", "--manifest", f.manifest]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining(error!) });
  }
  await writeFile(
    join(f.directory, "CHANGELOG.md"),
    f.notes.replace(
      f.bullet,
      f.bullet + "\n- See [#101](https://github.com/other/repo/pull/101).",
    ),
  );
  await f.invoke(["check", "--manifest", f.manifest]);
  await writeFile(join(f.directory, "CHANGELOG.md"), f.notes);
  const body = join(f.directory, "body.md");
  await writeFile(
    body,
    f.notes.replace("Added the capability", "Stale capability"),
  );
  await expect(
    f.invoke(["check", "--manifest", f.manifest, "--pr-body", body]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("PR body differs"),
  });
  await writeFile(
    join(f.directory, "CHANGELOG.md"),
    f.notes.replace("### Complete contribution record", "### Missing record"),
  );
  await expect(
    f.invoke(["check", "--manifest", f.manifest]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("Contribution record differs"),
  });
});

it("binds publication to complete recorded history and the reviewed base", async () => {
  const f = await fixture();
  for (const path of pluginManifests)
    await writeFile(
      join(f.directory, path),
      JSON.stringify(pluginManifestFor(path, "6.4.0")),
    );
  await writeFile(
    join(f.directory, pluginServerConfig),
    JSON.stringify(pluginServer("6.4.0")),
  );
  for (const path of pluginMarketplaces)
    await writeFile(
      join(f.directory, path),
      JSON.stringify(pluginMarketplace("6.4.0")),
    );
  await git(f.directory, [
    "add",
    "CHANGELOG.md",
    ...pluginManifests,
    pluginServerConfig,
    ...pluginMarketplaces,
  ]);
  await git(f.directory, ["commit", "-m", "chore: release notes"]);
  const source = await git(f.directory, ["rev-parse", "HEAD"]);
  // Release PRs bump the plugin manifest version and pinned launch only.
  await f.invoke(["check", "--manifest", f.manifest, "--source", source]);
  await writeFile(join(f.directory, "product.txt"), "later product change");
  await git(f.directory, ["add", "product.txt"]);
  await git(f.directory, ["commit", "-m", "fix: later product change"]);
  await expect(
    f.invoke(["check", "--manifest", f.manifest, "--source", "HEAD"]),
  ).rejects.toMatchObject({ stderr: expect.stringContaining("base moved") });
  const value = z
    .object({ commits: z.array(z.unknown()) })
    .passthrough()
    .parse(JSON.parse(await readFile(f.manifest, "utf8")));
  value.commits.pop();
  await writeFile(f.manifest, JSON.stringify(value));
  await expect(
    f.invoke(["check", "--manifest", f.manifest]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("complete local Git history"),
  });
});

it.each(pluginManifests)(
  "treats a release that changes the skill path in %s as a product change",
  async (path) => {
    const f = await fixture();
    await writeFile(
      join(f.directory, path),
      JSON.stringify(
        pluginManifestFor(path, "6.4.0", { skills: ["./another-skill"] }),
      ),
    );
    await git(f.directory, ["add", "CHANGELOG.md", path]);
    await git(f.directory, ["commit", "-m", "chore: release notes"]);
    await expect(
      f.invoke(["check", "--manifest", f.manifest, "--source", "HEAD"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `Product changed after notes target; regenerate inventory: ${path}`,
      ),
    });
  },
);

it("accepts Release Please lockfile refreshes without allowing product changes", async () => {
  const f = await fixture();
  await writeFile(
    join(f.directory, "package-lock.json"),
    '{"lockfileVersion":3}',
  );
  await writeFile(
    join(f.directory, "package-lock.json"),
    '{"lockfileVersion":3}',
  );
  await git(f.directory, [
    "add",
    "CHANGELOG.md",
    "package-lock.json",
    "package-lock.json",
  ]);
  await git(f.directory, ["commit", "-m", "chore: release lockfiles"]);
  await f.invoke(["check", "--manifest", f.manifest, "--source", "HEAD"]);
});

it.each([
  {
    path: ".claude-plugin/plugin.json",
    content: pluginManifest("6.4.0", { command: "other-launcher" }),
  },
  {
    path: pluginServerConfig,
    content: pluginServer("6.4.0", "other-launcher"),
  },
])(
  "keeps launcher behavior in $path outside version-only metadata",
  async ({ path, content }) => {
    const f = await fixture();
    await writeFile(join(f.directory, path), JSON.stringify(content));
    await git(f.directory, ["add", "CHANGELOG.md", path]);
    await git(f.directory, ["commit", "-m", "chore: release notes"]);
    await expect(
      f.invoke(["check", "--manifest", f.manifest, "--source", "HEAD"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `Product changed after notes target; regenerate inventory: ${path}`,
      ),
    });
  },
);

it("checks the live merged PR and exact Git snapshot before either publication route", async () => {
  const f = await fixture();
  await mkdir(join(f.directory, "docs/releases"), { recursive: true });
  await writeFile(
    join(f.directory, "docs/releases/6.4.0.contributions.json"),
    await readFile(f.manifest),
  );
  await writeFile(
    join(f.directory, "package.json"),
    JSON.stringify({ version: "6.4.0" }),
  );
  await git(f.directory, [
    "add",
    "CHANGELOG.md",
    "package.json",
    "docs/releases/6.4.0.contributions.json",
  ]);
  await git(f.directory, ["commit", "-m", "chore: release 6.4.0"]);
  const source = await git(f.directory, ["rev-parse", "HEAD"]);
  const pr = {
    number: 1399,
    body: f.notes,
    merged_at: "2026-10-11T00:00:00Z",
    merge_commit_sha: source,
    head: {
      ref: "release-please--branches--main--components--rea-agents",
      repo: { full_name: "fixture/rea" },
    },
    labels: [{ name: "rea:release-notes-finalized" }],
  };
  const prFile = join(f.directory, ".git/release-pr.json");
  await writeFile(prFile, JSON.stringify(pr));
  for (const selector of [[], ["--pr", "1399"]]) {
    const result = await f.invoke([
      "publication",
      "--repository",
      "fixture/rea",
      "--source",
      source,
      ...selector,
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "verified",
      version: "6.4.0",
      commits: 3,
    });
  }
  // Worktree edits cannot substitute for the reviewed source.
  await writeFile(join(f.directory, "CHANGELOG.md"), "unreviewed working text");
  await f.invoke([
    "publication",
    "--repository",
    "fixture/rea",
    "--source",
    source,
  ]);
  await writeFile(
    prFile,
    JSON.stringify({
      ...pr,
      body: f.notes.replace("Added the capability", "Different release"),
    }),
  );
  await expect(
    f.invoke([
      "publication",
      "--repository",
      "fixture/rea",
      "--source",
      source,
    ]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("PR body differs"),
  });
  await writeFile(prFile, JSON.stringify(pr));
  await git(f.directory, ["rm", "docs/releases/6.4.0.contributions.json"]);
  await git(f.directory, ["commit", "-m", "chore: remove inventory"]);
  const missing = await git(f.directory, ["rev-parse", "HEAD"]);
  await writeFile(prFile, JSON.stringify({ ...pr, merge_commit_sha: missing }));
  await expect(
    f.invoke([
      "publication",
      "--repository",
      "fixture/rea",
      "--source",
      missing,
    ]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining("missing its contribution inventory"),
  });
  await writeFile(
    prFile,
    JSON.stringify({ ...pr, merge_commit_sha: missing, labels: [] }),
  );
  const legacy = await f.invoke([
    "publication",
    "--repository",
    "fixture/rea",
    "--source",
    missing,
  ]);
  expect(JSON.parse(legacy.stdout)).toMatchObject({ status: "legacy" });
});

it("fails closed on partial GitHub errors and non-advancing pagination without saving an inventory", async () => {
  const f = await fixture();
  const metadataFile = join(f.directory, "github.json");
  const metadata = JSON.parse(await readFile(metadataFile, "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(
    metadataFile,
    JSON.stringify({ ...metadata, errors: [{ message: "quota exceeded" }] }),
  );
  const output = join(f.directory, "failed.json");
  const args = [
    "inventory",
    "--repository",
    "fixture/rea",
    "--base",
    f.base,
    "--target",
    f.target,
    "--version",
    "6.4.0",
    "--manifest",
    output,
  ];
  await expect(f.invoke(args)).rejects.toMatchObject({
    stderr: expect.stringContaining("quota exceeded"),
  });
  await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  const cyclic = {
    ...metadata,
    continuations: {
      "authors-2": { authors: page([author("bob")], "authors-2") },
    },
  };
  await writeFile(metadataFile, JSON.stringify(cyclic));
  await expect(f.invoke(args)).rejects.toMatchObject({
    stderr: expect.stringContaining("non-advancing authors cursor"),
  });
  await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(pluginMarketplaces)(
  "treats a marketplace package change in %s as product behavior",
  async (path) => {
    const f = await fixture();
    await writeFile(
      join(f.directory, path),
      JSON.stringify(pluginMarketplace("6.4.0", "another-package")),
    );
    await git(f.directory, ["add", "CHANGELOG.md", path]);
    await git(f.directory, ["commit", "-m", "chore: release notes"]);
    await expect(
      f.invoke(["check", "--manifest", f.manifest, "--source", "HEAD"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `Product changed after notes target; regenerate inventory: ${path}`,
      ),
    });
  },
);
