import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

// CodeMirror 5 modes keep a parser context stack on a state parameter. Popping
// it stores a value read from the same slot, so each call can select one more
// `prev` below the slot's original value. An unclosed member-path cycle there
// exhausted the owned worker heap on `mode/stylus/stylus.js`.
const contextStack = `
function Context(type, prev) {
  this.type = type;
  this.prev = prev;
  this.line = { firstWord: "", indent: 0 };
}
function pushContext(state, type) {
  state.context = new Context(type, state.context);
  return type;
}
function popContext(state, currentIndent) {
  var contextIndent = state.context.indent - 2;
  state.context = state.context.prev;
  if (currentIndent) state.context.indent = contextIndent;
  return state.context.type;
}
function tokenBase(stream, state) {
  state.context.line.firstWord = stream.current();
  state.context.line.indent = stream.indentation();
}
module.exports = { pushContext, popContext, tokenBase };
`;

cliTest(
  "analyzes a parser context stack that pops through its own slot",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-self-store-");
    await writeFile(join(root, "mode.js"), contextStack);
    const output = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--max-heap-mb",
        "256",
        "--json",
      ],
    });
    expect(output.exitCode).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(result.statistics).toMatchObject({
      parsed_javascript_files: 1,
      skipped_javascript_files: 0,
      parse_failures: 0,
    });
  },
);
