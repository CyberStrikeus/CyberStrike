import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const execute = promisify(execFile);
const bridge = fileURLToPath(
  new URL("../../../../bridge/hopper_bridge.py", import.meta.url),
);
const probe = fileURLToPath(
  new URL("../../../fixtures/hopperInstructionProbe.py", import.meta.url),
);
const resultSchema = z.object({
  addresses: z.array(z.number()),
  blocks: z.array(z.object({ start: z.string(), end: z.string() })),
  length: z.number(),
  assembly: z.array(z.string()),
  fast: z.array(z.string()),
  dossier: z.array(z.string()),
  references: z.array(z.object({ source_address: z.string() })),
});

type ProbeResult = z.infer<typeof resultSchema>;

async function runProbe(scenario: string): Promise<ProbeResult> {
  const { stdout } = await execute("python3", [probe, bridge, scenario], {
    encoding: "utf8",
    timeout: 3_000,
    maxBuffer: 1_024 * 1_024,
  });
  return resultSchema.parse(JSON.parse(stdout));
}

describe("Hopper instruction block boundaries", () => {
  it.each(["inclusive", "exclusive", "duplicate"])(
    "preserves branches and returns with %s endpoints without duplicates or adjacent instructions",
    async (scenario) => {
      const result = await runProbe(scenario);
      expect(result.addresses).toEqual([0x1000, 0x1004, 0x1008]);
      if (scenario !== "duplicate") {
        expect(result.blocks).toEqual([
          { start: "0x1000", end: "0x1008" },
          { start: "0x1008", end: "0x100c" },
        ]);
        expect(result.length).toBe(12);
      }
      const lines = ["0x1000: mov", "0x1004: b.ne", "0x1008: ret"];
      expect(result.assembly).toEqual(lines);
      expect(result.fast).toEqual(lines);
      expect(result.dossier).toEqual(lines);
      expect(result.references.map((edge) => edge.source_address)).toEqual([
        "0x1004",
      ]);
    },
  );

  it.each([
    ["gap", [0x1000]],
    ["zero_length", [0x1000]],
    ["negative_length", [0x1000]],
    ["cross_boundary", []],
    ["foreign_owner", [0x1000, 0x1004]],
    ["reversed", []],
  ])("stops safely at %s", async (scenario, addresses) => {
    const result = await runProbe(scenario);
    expect(result.addresses).toEqual(addresses);
    expect(result.assembly).toHaveLength(addresses.length);
    expect(result.fast).toEqual(result.assembly);
    expect(result.dossier).toEqual(result.assembly);
  });

  it("uses instruction lengths without assuming ARM64 fixed-width encoding", async () => {
    const result = await runProbe("variable_length");
    expect(result.addresses).toEqual([0x1000, 0x1003, 0x1005]);
    expect(result.blocks).toEqual([
      { start: "0x1000", end: "0x1005" },
      { start: "0x1005", end: "0x1006" },
    ]);
    expect(result.length).toBe(6);
    expect(result.assembly).toEqual([
      "0x1000: mov",
      "0x1003: b.ne",
      "0x1005: ret",
    ]);
    expect(result.fast).toEqual(result.assembly);
    expect(result.dossier).toEqual(result.assembly);
  });

  it("reports missing ownership support instead of guessing endpoint semantics", async () => {
    const { stdout } = await execute(
      "python3",
      [probe, bridge, "no_ownership"],
      {
        encoding: "utf8",
        timeout: 3_000,
        maxBuffer: 1_024 * 1_024,
      },
    );
    const { error } = z.object({ error: z.string() }).parse(JSON.parse(stdout));
    expect(error).toContain("Hopper");
    expect(error).toContain("basic-block");
    expect(error).toContain("ownership");
  });
});
