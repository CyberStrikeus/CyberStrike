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
  new URL("../../../fixtures/hopperStringSearchProbe.py", import.meta.url),
);
const resultSchema = z.array(
  z.object({
    pattern: z.string(),
    case_sensitive: z.boolean(),
    actual: z.array(z.object({ address: z.string() }).passthrough()),
    expected: z.array(z.object({ address: z.string() }).passthrough()),
  }),
);

async function runProbe() {
  const { stdout } = await execute("python3", [probe, bridge], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1_024 * 1_024,
  });
  return resultSchema.parse(JSON.parse(stdout));
}

describe("Hopper string search", () => {
  it("returns the independently expected records for every query, including repeats", async () => {
    const results = await runProbe();
    expect(results).toHaveLength(14);
    for (const result of results) {
      expect(result.actual).toEqual(result.expected);
    }
  });

  it("matches case-insensitively and case-sensitively across segments in ascending address order", async () => {
    const results = await runProbe();
    const byQuery = (pattern: string, caseSensitive: boolean) =>
      results
        .find(
          (item) =>
            item.pattern === pattern && item.case_sensitive === caseSensitive,
        )
        ?.actual.map((item) => item.address);
    expect(byQuery("needle", false)).toEqual([
      "0x1010",
      "0x1030",
      "0x1050",
      "0x2000",
      "0x3020",
      "0x3040",
    ]);
    expect(byQuery("needle", true)).toEqual(["0x1010", "0x2000", "0x3040"]);
    expect(byQuery("zzz-absent", false)).toEqual([]);
  });

  it("preserves the decoding-unavailable record for an unreadable string", async () => {
    const results = await runProbe();
    const search = results.find(
      (item) => item.pattern === "Broken" && item.case_sensitive,
    );
    expect(search?.actual).toEqual([
      {
        address: "0x1030",
        value: "Broken Needle",
        provider_value: "Broken Needle",
        decoding: {
          available: false,
          reason: "Hopper reported an invalid string object extent at 0x1030",
        },
      },
    ]);
  });
});
