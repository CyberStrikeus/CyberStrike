import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

// Hand-written tokenizers dispatch through long short-circuit chains; the
// CodeMirror 5 pug mode's `nextToken` has 38 operands. Work that doubled per
// operand could not finish such a chain within any per-source deadline.
const operands = 38;

cliTest(
  "analyzes a long short-circuit dispatch chain within the source deadline",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-logical-chain-");
    const chain = Array.from(
      { length: operands },
      (unused, index) => `f${String(index)}(s)`,
    ).join(" || ");
    await writeFile(
      join(root, "index.js"),
      `function next(s) {\n  var tok = ${chain};\n  return tok;\n}\nmodule.exports = next;\n`,
    );
    await writeFile(
      join(root, "package.json"),
      '{"name":"chain","version":"1.0.0","main":"index.js"}\n',
    );
    const output = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--analysis-timeout-ms",
        "15000",
        "--json",
      ],
    });
    expect(output.exitCode).toBe(0);
    const result = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json).normalized_result;
    expect(result.statistics).toMatchObject({
      parsed_javascript_files: 1,
      parse_failures: 0,
    });
    expect(
      result.semantic_graph.nodes.filter(({ kind }) => kind === "call-site"),
    ).toHaveLength(operands);
  },
);
