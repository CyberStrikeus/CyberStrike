import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import {
  bomSourceCases,
  createBomArtifact,
  expectBomSourceRange,
} from "../../fixtures/javascriptArtifactBom.js";
import { cliTest } from "../../support/cli/cliFixture.js";

for (const format of ["directory", "asar"] as const) {
  for (const command of ["analyze-javascript-application", "analyze"]) {
    cliTest(
      `${command} preserves original BOM coordinates for ${format}`,
      async ({ cli }) => {
        const files = Object.fromEntries(
          bomSourceCases.map((fixture) => [
            fixture.path,
            Buffer.from(`\uFEFF${fixture.source}`),
          ]),
        );
        const input = await createBomArtifact(format, {
          ...files,
          "dep.js": "export const dependency = true;",
        });
        const output = await cli.run({ arguments: [command, input, "--json"] });
        expect(output.exitCode).toBe(0);
        const result = javascriptApplicationAnalysisResultSchema.parse(
          parseEvidence(output.json).normalized_result,
        );
        expect(result.statistics).toMatchObject({
          parse_failures: 0,
          invalid_utf8_files: 0,
        });
        for (const fixture of bomSourceCases)
          expectBomSourceRange(
            result.graph,
            fixture,
            Buffer.from(`\uFEFF${fixture.source}`),
          );
      },
    );
  }
}
