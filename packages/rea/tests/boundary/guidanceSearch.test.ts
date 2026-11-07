import { expect, it } from "vitest";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import {
  readGuidanceSection,
  searchGuidance,
} from "../../src/application/GuidanceAccess.js";

it("finds and retrieves the selected section from the generated package bundle", async () => {
  const resources = new ArtifactResourceScope();
  try {
    const result = await searchGuidance(
      { query: "exact JavaScript module" },
      resources,
    );
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      status: "matches",
      source: "installed_rea_guidance",
      package: expect.stringMatching(/^rea-agents@/u),
    });
    if (result.value.status !== "matches")
      throw new Error("Expected guidance matches");
    const match = result.value.matches.find(
      ({ heading }) => heading === "Read a module without repeating analysis",
    );
    expect(match).toBeDefined();
    expect(result.value.matches[0]?.heading).toBe(
      "Read a module without repeating analysis",
    );
    expect(match).toMatchObject({
      guide: "references/javascript-applications.md",
      matched_terms: expect.arrayContaining(["exact", "javascript", "module"]),
      context: expect.stringContaining("javascript-module"),
    });
    if (match === undefined) throw new Error("Expected selected guidance");

    const retrieved = await readGuidanceSection(
      { locator: match.locator },
      resources,
    );
    if (!retrieved.ok) throw retrieved.error;
    expect(retrieved.value).toMatchObject({
      status: "section",
      source: "installed_rea_guidance",
      guide: match.guide,
      heading: match.heading,
      locator: match.locator,
      content: expect.stringContaining("node_id"),
    });
  } finally {
    await resources.close();
  }
});
