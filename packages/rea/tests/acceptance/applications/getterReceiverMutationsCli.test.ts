import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps getter receiver mutations uncertain in exported Evidence through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-getter-receivers-");
    await writeFile(
      join(root, "app.mjs"),
      `
export function self() {
  const box = { x: 1, get self() { return this; } };
  box.self.x = 2;
  return box.x;
}
export function property() {
  const shared = { x: 1 };
  const box = { s: shared, get v() { return this.s; } };
  box.v.x = 2;
  return shared.x;
}
export function privateField() {
  const shared = { x: 1 };
  class B { #s = shared; get v() { return this.#s; } }
  new B().v.x = 2;
  return shared.x;
}
export function superclass() {
  const shared = { x: 1 };
  class A { get v() { return shared; } }
  class B extends A { get v() { return super.v; } }
  new B().v.x = 2;
  return shared.x;
}
export function arrayReceiver() {
  const arr = [{ x: 1, get self() { return this; } }];
  arr[0].self.x = 2;
  return arr[0].x;
}
export function nestedArrayReceiver() {
  const outer = { arr: [{ x: 1, get self() { return this; } }] };
  outer.arr[0].self.x = 2;
  return outer.arr[0].x;
}
export function assignedReceiver() {
  let box;
  box = { x: 1, get self() { return this; } };
  box.self.x = 2;
  return box.x;
}
export function savedArrayReceiver() {
  const arr = [{ x: 1, get self() { return this; } }];
  const saved = arr[0].self;
  saved.x = 2;
  return arr[0].x;
}
export function arrayReadOnly() {
  const arr = [{ x: 1, get self() { return this; } }];
  const saved = arr[0].self;
  return arr[0].x;
}
export function replacementKeepsOldObject() {
  const old = { x: 1 };
  let box = old;
  box = { x: 1, old: box, get self() { return this; } };
  box.self.x = 2;
  return old.x;
}
export function replacementMutatesCapturedObject() {
  const old = { x: 1 };
  let box = old;
  box = { old: box, get self() { return this; } };
  box.self.old.x = 2;
  return old.x;
}
export function untouched() {
  const box = { x: 1, y: 1, get self() { return this; } };
  box.self.y = 2;
  return box.x;
}
`,
    );
    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: ["analyze-javascript-application", root, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      document = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("analyze_javascript_application", {
        input_path: root,
        format: "directory",
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      document = response.structuredContent;
    }
    const { graph } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(document).normalized_result;
    for (const [name, status] of [
      ["self", "unknown"],
      ["property", "unknown"],
      ["privateField", "unknown"],
      ["superclass", "unknown"],
      ["arrayReceiver", "unknown"],
      ["nestedArrayReceiver", "unknown"],
      ["assignedReceiver", "unknown"],
      ["savedArrayReceiver", "unknown"],
      ["arrayReadOnly", "literal"],
      ["replacementKeepsOldObject", "literal"],
      ["replacementMutatesCapturedObject", "unknown"],
      ["untouched", "literal"],
    ] as const) {
      const projection = graph.nodes
        .flatMap(({ observations }) => observations)
        .find(
          ({ properties }) =>
            properties.semantic_role === "export-return-shapes" &&
            properties.exported_name === name,
        );
      expect(projection, name).toBeDefined();
      expect(projection?.properties.static_return_shapes).toMatchObject([
        {
          value_status: status,
          fields: [
            {
              path: "",
              state: status,
              ...(status === "literal" ? { value: 1 } : {}),
            },
          ],
        },
      ]);
    }
  },
);
