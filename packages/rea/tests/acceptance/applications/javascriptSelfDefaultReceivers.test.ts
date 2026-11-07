import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  analyzeJavaScriptDirectory,
  runNodeJsonControl,
} from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const requireEdges = (
  graph: Awaited<ReturnType<typeof analyzeJavaScriptDirectory>>["graph"],
) =>
  graph.edges.flatMap(({ relation, properties }) =>
    relation === "imports" && properties.kind === "require"
      ? [
          {
            specifier: properties.specifier,
            expression: properties.expression,
            resolved_path: properties.resolved_path,
          },
        ]
      : [],
  );

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps self-defaulted receivers out of the module loader graph through %s",
  async (surface, { cli }) => {
    const members = await createTestTempDirectory("rea-self-default-members-");
    await writeFixtureFiles(members, {
      "main.cjs": `function message(session, text) {
  session.messages = session.messages || [];
  session.messages.push(text);
}
const session = {};
message(session, "first");
message(session, "second");
const local = {};
local.items = local.items || [];
local.items.push("item");
function trimmed(value) {
  value = value || " fallback ";
  return value.trim();
}
let load = require;
load = load || require;
console.log(JSON.stringify([session.messages, local.items, trimmed(), load("./dep.cjs")]));`,
      "dep.cjs": 'module.exports = "dep";',
    });
    expect(await runNodeJsonControl(members, "main.cjs")).toEqual([
      ["first", "second"],
      ["item"],
      "fallback",
      "dep",
    ]);
    const memberResult = await analyzeJavaScriptDirectory(
      surface,
      cli,
      members,
    );
    expect(requireEdges(memberResult.graph)).toEqual([
      { specifier: "./dep.cjs", expression: null, resolved_path: "dep.cjs" },
    ]);
    expect(memberResult.graph.coverage.status).toBe("complete");

    // A binding read in its own initializer is not a loader, while a native
    // delegate that survives its self-default remains a possible load.
    const bindings = await createTestTempDirectory(
      "rea-self-default-bindings-",
    );
    await writeFixtureFiles(bindings, {
      "queue.cjs": `var queue = queue || [];
queue.push(["track", "load"]);
console.log(JSON.stringify(queue));`,
      "delegate.cjs": `const box = { load: module.require };
box.load = box.load || null;
console.log(JSON.stringify(box.load.call(module, "./dep.cjs")));`,
      "dep.cjs": 'module.exports = "dep";',
    });
    expect(await runNodeJsonControl(bindings, "queue.cjs")).toEqual([
      ["track", "load"],
    ]);
    expect(await runNodeJsonControl(bindings, "delegate.cjs")).toBe("dep");
    const bindingResult = await analyzeJavaScriptDirectory(
      surface,
      cli,
      bindings,
    );
    expect(requireEdges(bindingResult.graph)).toEqual([
      {
        specifier: null,
        expression: 'box.load.call(module, "./dep.cjs")',
        resolved_path: null,
      },
    ]);
  },
);
