import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import {
  typeScriptDialectCases,
  createTypeScriptDialectArtifact,
  expectTypeScriptDialectReference,
} from "../../fixtures/javascriptArtifactTypeScriptDialect.js";
import { cliTest } from "../../support/cli/cliFixture.js";

// These complementary rows cover both CLI adapters and carrier formats; both
// adapters enter the same JavaScript application workflow.
for (const { command, format } of [
  { command: "analyze-javascript-application", format: "asar" },
  { command: "analyze", format: "directory" },
] as const) {
  cliTest(
    `${command} retains TypeScript dialect reference facts for ${format}`,
    async ({ cli }) => {
      const input = await createTypeScriptDialectArtifact(
        format,
        typeScriptDialectCases,
      );
      const output = await cli.run({ arguments: [command, input, "--json"] });
      expect(output.exitCode).toBe(0);
      const result = javascriptApplicationAnalysisResultSchema.parse(
        parseEvidence(output.json).normalized_result,
      );
      expect(result.statistics).toMatchObject({
        parse_failures: 0,
        invalid_utf8_files: 0,
      });
      for (const fixture of typeScriptDialectCases)
        expectTypeScriptDialectReference(result.graph, fixture);
    },
  );
}
