import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains getter-local alias mutations in exported Evidence through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-getter-local-aliases-");
    const cases = [
      ["initialized", "const self = this; return self.s;", true],
      ["assigned", "let self; self = this; return self.s;", true],
      ["destructured", "const { s: value } = this; return value;", true],
      ["readOnly", "const self = this; return self.s;", false],
      [
        "cyclic",
        "let self = this.start; while (flag) self = self.child; return self;",
        true,
        "start: { child: { child: shared } }",
      ],
    ] as const;
    const privateCases = [
      ["privateProjection", "shared", true, "unknown"],
      ["privateUnrelated", "{ peer: shared }", true, "literal"],
      ["privateReadOnly", "shared", false, "literal"],
    ] as const;
    await writeFile(
      join(root, "app.mjs"),
      cases
        .map(
          ([
            name,
            getter,
            write,
            members = "s: shared",
          ]) => `export function ${name}() {
            const shared = { x: 1 };
            const box = { ${members}, get v() { ${getter} } };
            ${write ? "box.v.x = 2;" : "const saved = box.v;"}
            return shared.x;
          }`,
        )
        .join("\n") +
        privateCases
          .map(
            ([name, value, write]) => `export function ${name}() {
          const shared = { x: 1 };
          class Box {
            #s = ${value};
            peer = this;
            get v() { const { peer: self } = this; return self.#s; }
          }
          const box = new Box();
          ${write ? "box.v.x = 2;" : "const saved = box.v;"}
          return shared.x;
        }`,
          )
          .join("\n"),
    );
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const [name, status] of [
      ...cases.map(([name, , write]) => [name, write ? "unknown" : "literal"]),
      ...privateCases.map(([name, , , status]) => [name, status]),
    ]) {
      const observation = graph.nodes
        .flatMap(({ observations }) => observations)
        .find(
          ({ properties }) =>
            properties.semantic_role === "export-return-shapes" &&
            properties.exported_name === name,
        );
      expect(observation, name).toBeDefined();
      expect(observation?.properties.static_return_shapes).toMatchObject([
        {
          value_status: status,
          fields: [
            { path: "", state: status, value: status === "unknown" ? null : 1 },
          ],
        },
      ]);
    }
  },
);
