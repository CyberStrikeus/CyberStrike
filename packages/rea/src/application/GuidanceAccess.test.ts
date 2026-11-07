import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { MANAGED_SKILL_FILES } from "./SetupSkill.js";
import { searchGuidanceOutputSchema } from "../contracts/guidanceContracts.js";
import { RetainedRegularFileCleanupFailure } from "./RegularFileRead.js";
import {
  readGuidanceSectionWithReader,
  searchGuidanceWithReader,
} from "./GuidanceAccess.js";

const moduleGuide = `# JavaScript applications\n\n## Read a module without repeating analysis\n\nFor an exact JavaScript module (javascript-module), select its source path and module identity:\n\n\`\`\`json\n{"node_id":"module:main.js","kind":"javascript-module"}\n\`\`\`\n`;
const guideFixture = async (path: string): Promise<string> =>
  path === "references/javascript-applications.md"
    ? moduleGuide
    : `# ${path}\n\nGeneral module guidance for pagination.\n`;

const valueOf = async (
  request: ReturnType<typeof searchGuidanceWithReader>,
) => {
  const result = await request;
  if (!result.ok) throw result.error;
  return searchGuidanceOutputSchema.parse(result.value);
};

it("ranks a focused JavaScript module section and retrieves it with its locator", async () => {
  const resources = new ArtifactResourceScope();
  const result = await valueOf(
    searchGuidanceWithReader(
      { query: "exact JavaScript module" },
      guideFixture,
      resources,
    ),
  );
  expect(result.status).toBe("matches");
  if (result.status !== "matches") throw new Error("Expected guide matches");
  expect(result.matches[0]).toMatchObject({
    guide: "references/javascript-applications.md",
    heading: "Read a module without repeating analysis",
    matched_terms: ["exact", "javascript", "module"],
    context: expect.stringContaining("javascript-module"),
  });
  const selected = result.matches[0];
  if (selected === undefined) throw new Error("Expected selected guidance");
  const retrieved = await readGuidanceSectionWithReader(
    { locator: selected.locator },
    guideFixture,
    resources,
  );
  if (!retrieved.ok) throw retrieved.error;
  expect(retrieved.value).toMatchObject({
    status: "section",
    source: "installed_rea_guidance",
    guide: selected.guide,
    heading: selected.heading,
    locator: selected.locator,
    content: expect.stringContaining('"node_id":"module:main.js"'),
  });
});

it("returns an honest no-match result and rejects empty queries and invalid bounds", async () => {
  const resources = new ArtifactResourceScope();
  expect(
    await valueOf(
      searchGuidanceWithReader(
        { query: "unlikely qzxv term" },
        guideFixture,
        resources,
      ),
    ),
  ).toMatchObject({
    status: "no_matches",
    total_matches: 0,
    message: expect.stringContaining("does not indicate"),
  });
  expect(
    await valueOf(
      searchGuidanceWithReader(
        { query: "how do I frobnicate qzxv" },
        guideFixture,
        resources,
      ),
    ),
  ).toMatchObject({
    status: "no_matches",
    total_matches: 0,
  });
  expect(
    await searchGuidanceWithReader({ query: "  " }, guideFixture, resources),
  ).toMatchObject({ ok: false });
  expect(
    await searchGuidanceWithReader(
      { query: "x".repeat(2049) },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
  expect(
    await searchGuidanceWithReader(
      { query: "module", limit: 21 },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
});

it("does not treat Markdown headings inside fenced code as section boundaries", async () => {
  const result = await valueOf(
    searchGuidanceWithReader(
      { query: "phantom-heading-token" },
      async (path) =>
        `${await guideFixture(path)}\n\n\`\`\`markdown\n# phantom-heading-token\n\`\`\`\n`,
      new ArtifactResourceScope(),
    ),
  );
  expect(result.status).toBe("matches");
  if (result.status !== "matches") throw new Error("Expected guide matches");
  expect(result.matches.map(({ heading }) => heading)).not.toContain(
    "phantom-heading-token",
  );
});

it("refuses an oversized guide bundle instead of indexing partial content", async () => {
  const result = await searchGuidanceWithReader(
    { query: "module" },
    async (path) =>
      path === "SKILL.md" ? "x".repeat(4_194_305) : guideFixture(path),
    new ArtifactResourceScope(),
  );
  expect(result).toMatchObject({
    ok: true,
    value: { status: "bundle_unavailable" },
  });
});

it("paginates deterministically without losing, duplicating, or reordering matches", async () => {
  const readGuide = guideFixture;
  const first = await valueOf(
    searchGuidanceWithReader(
      { query: "module", limit: 2 },
      readGuide,
      new ArtifactResourceScope(),
    ),
  );
  const repeat = await valueOf(
    searchGuidanceWithReader(
      { query: "module", limit: 2 },
      readGuide,
      new ArtifactResourceScope(),
    ),
  );
  expect(first).toEqual(repeat);
  if (first.status !== "matches") throw new Error("Expected guide matches");
  expect(first.has_more).toBe(true);
  const all = first.matches.map(({ locator }) => locator);
  let cursor = first.next_cursor;
  while (cursor !== undefined) {
    const page = await valueOf(
      searchGuidanceWithReader(
        { query: "module", limit: 2, cursor },
        readGuide,
        new ArtifactResourceScope(),
      ),
    );
    if (page.status !== "matches") throw new Error("Expected guide matches");
    all.push(...page.matches.map(({ locator }) => locator));
    cursor = page.next_cursor;
  }
  const complete = await valueOf(
    searchGuidanceWithReader(
      { query: "module", limit: 20 },
      readGuide,
      new ArtifactResourceScope(),
    ),
  );
  if (complete.status !== "matches") throw new Error("Expected guide matches");
  expect(new Set(all).size).toBe(all.length);
  expect(all).toEqual(complete.matches.map(({ locator }) => locator));
});

it("rejects malformed locators and reports changed or missing installed guides", async () => {
  const resources = new ArtifactResourceScope();
  const search = await valueOf(
    searchGuidanceWithReader(
      { query: "exact JavaScript module" },
      guideFixture,
      resources,
    ),
  );
  if (search.status !== "matches") throw new Error("Expected guide matches");
  expect(
    await readGuidanceSectionWithReader(
      { locator: "../../outside.md" },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
  const changedReader = async (path: string) =>
    `${await guideFixture(path)}\nChanged after search.\n`;
  const stale = await readGuidanceSectionWithReader(
    { locator: search.matches[0]?.locator },
    changedReader,
    resources,
  );
  expect(stale).toMatchObject({ ok: true, value: { status: "stale_locator" } });
  const firstPage = await valueOf(
    searchGuidanceWithReader(
      { query: "module", limit: 1 },
      guideFixture,
      resources,
    ),
  );
  if (firstPage.status !== "matches" || firstPage.next_cursor === undefined)
    throw new Error("Expected a continuation token");
  expect(
    await searchGuidanceWithReader(
      { query: "module", limit: 1, cursor: firstPage.next_cursor },
      changedReader,
      resources,
    ),
  ).toMatchObject({ ok: true, value: { status: "stale_continuation" } });
  expect(
    await searchGuidanceWithReader(
      { query: "different query", cursor: firstPage.next_cursor },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
  expect(
    await searchGuidanceWithReader(
      { query: "module", cursor: "garbage" },
      guideFixture,
      resources,
    ),
  ).toMatchObject({ ok: false });
  const missingReader = async (): Promise<string> => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  expect(
    await searchGuidanceWithReader(
      { query: "module" },
      missingReader,
      resources,
    ),
  ).toMatchObject({ ok: true, value: { status: "bundle_unavailable" } });
  expect(
    await readGuidanceSectionWithReader(
      { locator: search.matches[0]?.locator },
      missingReader,
      resources,
    ),
  ).toMatchObject({ ok: true, value: { status: "bundle_unavailable" } });
});

it("returns cleanup failures separately and retains their owner until retry succeeds", async () => {
  const resources = new ArtifactResourceScope();
  let failRelease = true;
  const failure = new RegularFileCleanupFailure({
    path: "guidance file handle",
    owner: {
      close: async () => {
        if (failRelease) throw new Error("descriptor close failed");
      },
    } as never,
    outcome: { kind: "failed", cause: new Error("guide read failed") },
    cleanupCause: new Error("descriptor close failed"),
  });
  const retainedFailure = new RetainedRegularFileCleanupFailure(failure);
  resources.retain(retainedFailure.cleanupOwner);
  const result = await searchGuidanceWithReader(
    { query: "module" },
    async () => {
      throw retainedFailure;
    },
    resources,
  );
  if (result.ok) throw new Error("Expected a retained cleanup failure");
  expect(result.error).toMatchObject({ cleanupIncomplete: true });
  expect(result.error.cleanupResources).toEqual(["guidance file handle"]);
  expect(resources.hasPending).toBe(true);
  failRelease = false;
  await resources.close();
  expect(resources.hasPending).toBe(false);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);

  const freshResources = new ArtifactResourceScope();
  freshResources.retain({
    kind: "lease",
    resource: "unrelated pending resource",
    lease: { release: async () => undefined },
  });
  expect(
    await searchGuidanceWithReader(
      { query: "module" },
      async () => {
        throw new Error("guide is unreadable");
      },
      freshResources,
    ),
  ).toMatchObject({
    ok: true,
    value: { status: "bundle_unavailable" },
  });
  await freshResources.close();
});

it("uses only the fixed managed guide inventory for injected reads", async () => {
  const requested: string[] = [];
  await searchGuidanceWithReader(
    { query: "module" },
    async (path) => {
      requested.push(path);
      return guideFixture(path);
    },
    new ArtifactResourceScope(),
  );
  expect(requested).toEqual([...MANAGED_SKILL_FILES]);
});
