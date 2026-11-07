import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { readGuidanceSectionInputSchema } from "../contracts/guidanceContracts.js";
import { MANAGED_SKILL_FILES } from "./SetupSkill.js";
import {
  readGuidanceSectionWithReader,
  searchGuidanceWithReader,
} from "./GuidanceAccess.js";

const reader = (text: string) => async (path: string) =>
  path === MANAGED_SKILL_FILES[0] ? text : "# Other\n";

it("does not substitute a common domain word for an unknown query subject", async () => {
  const resources = new ArtifactResourceScope();
  expect(
    await searchGuidanceWithReader(
      { query: "how do I inspect module frobnicate qzxv" },
      reader("# Modules\nInspect a module with retained facts.\n"),
      resources,
    ),
  ).toMatchObject({ ok: true, value: { status: "no_matches" } });
  await resources.close();
});

it.each([
  ["## C#", "C#"],
  ["## C# ###", "C#"],
  ["## C\\#", "C\\#"],
  ["   ## C#", "C#"],
  ["## C# \t ### \t", "C#"],
  ["## ###", ""],
])("preserves the source title in %s", async (line, heading) => {
  const resources = new ArtifactResourceScope();
  const source = reader(`${line}\nneedle instructions\n`);
  const result = await searchGuidanceWithReader(
    { query: "needle" },
    source,
    resources,
  );
  if (!result.ok || result.value.status !== "matches")
    throw new Error("Expected matching documentation");
  expect(result.value.matches[0]?.heading).toBe(heading);
  const value = await readGuidanceSectionWithReader(
    { locator: result.value.matches[0]?.locator },
    source,
    resources,
  );
  expect(value).toMatchObject({
    ok: true,
    value: { status: "section", heading },
  });
  await resources.close();
});

it("issues readable locators independently of heading length", async () => {
  const resources = new ArtifactResourceScope();
  const heading = `needle ${"x".repeat(3000)}`;
  const source = reader(`## ${heading}\nInstructions\n`);
  const result = await searchGuidanceWithReader(
    { query: "needle" },
    source,
    resources,
  );
  if (!result.ok || result.value.status !== "matches")
    throw new Error("Expected match");
  const locator = result.value.matches[0]?.locator;
  expect(readGuidanceSectionInputSchema.safeParse({ locator }).success).toBe(
    true,
  );
  expect(
    await readGuidanceSectionWithReader({ locator }, source, resources),
  ).toMatchObject({
    ok: true,
    value: { status: "section", heading },
  });
  await resources.close();
});

it.each([2048, 2049])(
  "bounds the combined index across guides with %i sections each",
  async (count) => {
    const resources = new ArtifactResourceScope();
    const result = await searchGuidanceWithReader(
      { query: "needle", limit: 1 },
      async (path) =>
        path === MANAGED_SKILL_FILES[0] || path === MANAGED_SKILL_FILES[1]
          ? "# needle\n".repeat(count)
          : "",
      resources,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { status: count === 2048 ? "matches" : "bundle_unavailable" },
    });
    await resources.close();
  },
);

it("preserves retry cleanup errors and their live owner in both operations", async () => {
  const resources = new ArtifactResourceScope();
  const source = reader("# needle\nInstructions\n");
  const initial = await searchGuidanceWithReader(
    { query: "needle" },
    source,
    resources,
  );
  if (!initial.ok || initial.value.status !== "matches")
    throw new Error("Expected match");
  const locator = initial.value.matches[0]?.locator;
  let blocked = true;
  resources.retain({
    kind: "lease",
    resource: "guidance descriptor",
    lease: {
      release: async () => {
        if (blocked) throw new Error("still owned");
      },
    },
  });
  const retryingReader = (path: string) => resources.run(() => source(path));
  const errors = [];
  for (const result of [
    await searchGuidanceWithReader(
      { query: "needle" },
      retryingReader,
      resources,
    ),
    await readGuidanceSectionWithReader({ locator }, retryingReader, resources),
  ]) {
    if (result.ok) throw new Error("Cleanup failures must remain errors");
    expect(result.error).toMatchObject({ cleanupIncomplete: true });
    expect(result.error.cleanupResources).toContain("guidance descriptor");
    errors.push(result.error);
  }
  blocked = false;
  await resources.close();
  expect(resources.hasPending).toBe(false);
  for (const error of errors) expect(error.cleanupIncomplete).toBe(false);
});
