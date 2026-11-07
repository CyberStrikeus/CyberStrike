import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";

import { ARTIFACT_COMPARISON_EXAMPLE } from "../../../src/contracts/artifactComparisonExample.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";
import { advertisedSchemaErrors } from "../../fixtures/mcpAdvertisedSchemaValidity.js";

const evidence = ARTIFACT_COMPARISON_EXAMPLE.left;
const retained = {
  kind: "retained-evidence",
  evidence_id: evidence.evidence_id,
} as const;
const file = {
  kind: "evidence-file",
  path: join(tmpdir(), "evidence.json"),
} as const;

it("advertises one spelling per compare_artifacts source and rejects the same sides the parser rejects", async () => {
  const contract = toolContract("compare_artifacts");
  const server = new McpServer({ name: "artifact-sources", version: "0" });
  const client = new Client({ name: "artifact-sources", version: "0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async () => ({ content: [] }),
  );
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    expect(advertisedSchemaErrors(tools)).toEqual([]);
    const tool = tools.find(({ name }) => name === contract.name);
    if (tool === undefined) throw new Error("compare_artifacts not advertised");
    expect(tool.inputSchema.examples).toEqual([
      {
        left: {
          kind: "retained-evidence",
          evidence_id: ARTIFACT_COMPARISON_EXAMPLE.left.evidence_id,
        },
        right: {
          kind: "retained-evidence",
          evidence_id: ARTIFACT_COMPARISON_EXAMPLE.right.evidence_id,
        },
      },
    ]);
    const validate = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(tool.inputSchema);
    const sides: readonly (readonly [string, unknown, boolean])[] = [
      ["complete Evidence", evidence, true],
      ["retained reference", retained, true],
      ["Evidence file", file, true],
      [
        "selected bundle record",
        { ...file, evidence_id: evidence.evidence_id },
        true,
      ],
      ["second inline spelling", { kind: "inline", evidence }, false],
      ["retained reference without ID", { kind: "retained-evidence" }, false],
      ["two references at once", { ...retained, path: file.path }, false],
      [
        "Evidence carrying a source kind",
        { ...evidence, kind: "retained-evidence" },
        false,
      ],
      ["relative Evidence file", { ...file, path: "evidence.json" }, false],
      ["empty side", {}, false],
    ];
    for (const [label, side, accepted] of sides)
      for (const input of [
        { left: side, right: retained },
        { left: retained, right: side },
      ]) {
        expect(contract.inputSchema.safeParse(input).success, label).toBe(
          accepted,
        );
        expect(validate(input), label).toBe(accepted);
      }
    expect(contract.inputSchema.safeParse({ left: retained }).success).toBe(
      false,
    );
    expect(validate({ left: retained })).toBe(false);
    // compare_functions is the precedent for the inline and retained forms;
    // only the Evidence-file reference extends it.
    const functions = toolContract("compare_functions");
    const shared = sides.filter(
      ([, side]) =>
        typeof side !== "object" ||
        side === null ||
        !("kind" in side) ||
        side.kind !== "evidence-file",
    );
    expect(shared).toHaveLength(sides.length - 3);
    for (const [label, side] of shared)
      expect(
        functions.inputSchema.safeParse({ left: side, right: retained })
          .success,
        label,
      ).toBe(
        contract.inputSchema.safeParse({ left: side, right: retained }).success,
      );
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
});
