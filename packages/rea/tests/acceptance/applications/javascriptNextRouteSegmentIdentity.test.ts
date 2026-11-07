import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest(
  "preserves literal percent bytes in Next route source segments",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-next-route-segment-");
    const page = (name: string) =>
      `export default function Page${name}(){return null;}`;
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({ dependencies: { next: "16.4.2" } }),
      "app/%61/page.js": page("EncodedA"),
      "app/a/page.js": page("PlainA"),
      "app/100%/page.js": page("Percent"),
      "app/team%2Fadmin/page.js": page("EncodedSlash"),
      "app/%5Fpublic/page.js": page("EscapedUnderscore"),
      "app/blog/%5fdraft/page.js": page("LowercaseEscape"),
      "app/hello world/page.js": page("Space"),
    });
    const response = await cli.run({
      arguments: ["analyze-javascript-application", root, "--format", "json"],
    });
    expect(response.exitCode, response.stdout + response.stderr).toBe(0);
    const analysis = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );
    expect(
      analysis.route_inventory?.routes
        .map(({ path, source_count }) => ({ path, source_count }))
        .sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        ),
    ).toEqual([
      { path: "/%61", source_count: 1 },
      { path: "/100%", source_count: 1 },
      { path: "/_public", source_count: 1 },
      { path: "/a", source_count: 1 },
      { path: "/blog/%5fdraft", source_count: 1 },
      { path: "/hello world", source_count: 1 },
      { path: "/team%2Fadmin", source_count: 1 },
    ]);
    expect(analysis.route_inventory?.coverage).toMatchObject({
      source_parsing: "complete",
      candidate_enumeration: "complete",
      application_routes: "unknown",
    });
  },
);
