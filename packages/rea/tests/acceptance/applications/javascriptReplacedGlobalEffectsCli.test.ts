import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const EFFECT_RELATIONS = [
  "schedules-timer",
  "constructs-request",
  "parses",
  "coerces",
];

const SOURCE = `function work() {}
setTimeout(work, 100);
fetch('https://example.invalid');
new WebSocket('wss://example.invalid');
JSON.parse('null');
String(work);
`;

const REPLACEMENTS = `setTimeout = () => null;
fetch = () => null;
WebSocket = class {};
JSON.parse = () => null;
String = () => '';
`;

cliTest.for(["CLI", "stdio MCP"] as const)(
  "does not resolve built-in effects after visible global replacements through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-replaced-globals-");
    await writeFixtureFiles(root, {
      "replaced/main.mjs": REPLACEMENTS + SOURCE,
      "control/main.mjs": SOURCE,
    });
    const effects = async (directory: string) => {
      const graph = (
        await analyzeJavaScriptDirectory(surface, cli, `${root}/${directory}`)
      ).semantic_graph;
      if (graph === null) throw new Error("Expected a semantic graph");
      return {
        relations: graph.relations
          .filter(({ relation }) => EFFECT_RELATIONS.includes(relation))
          .map(({ relation, resolution }) => `${relation}:${resolution}`)
          .sort(),
        boundaryUnknowns: graph.unknowns
          .filter(({ family }) => family === "boundary")
          .map(({ detail }) => detail),
      };
    };

    // The replaced JSON.parse remains only the generic `.parse` candidate.
    await expect(effects("replaced")).resolves.toEqual({
      relations: ["parses:candidate"],
      boundaryUnknowns: ["Static parse boundary kind is a candidate."],
    });
    await expect(effects("control")).resolves.toEqual({
      relations: [
        "coerces:resolved",
        "constructs-request:resolved",
        "constructs-request:resolved",
        "parses:resolved",
        "schedules-timer:resolved",
      ],
      boundaryUnknowns: [],
    });
  },
);
