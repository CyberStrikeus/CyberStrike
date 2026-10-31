import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("pages forward caller facts across segments without retaining stale results", async () => {
  const bridge = fileURLToPath(
    new URL("../../../../bridge/hopper_bridge.py", import.meta.url),
  );
  const fixture = fileURLToPath(
    new URL("../../../fixtures/hopperCallerProbe.py", import.meta.url),
  );
  const { stdout } = await promisify(execFile)("python3", [fixture, bridge], {
    encoding: "utf8",
    timeout: 3000,
  });
  const result = JSON.parse(stdout) as Record<string, unknown>;
  expect(result.first).toMatchObject({
    start: 0,
    next: 64,
    total: 130,
    items: 64,
  });
  expect(result.second).toMatchObject({
    start: 64,
    next: 128,
    total: 130,
    items: 64,
    caller: {
      caller: { address: "0x3410" },
      callees: ["0x2000"],
      references: [
        {
          source_address: "0x3414",
          target_address: "0x2000",
          call: { classification: "direct" },
        },
      ],
    },
  });
  expect(result.third).toMatchObject({
    start: 128,
    next: 130,
    total: 130,
    items: 2,
  });
  expect(result.changed).toMatchObject({ callees: [], references: [] });
  expect(result.oversized).toMatchObject({
    start: 0,
    next: 0,
    total: 130,
    items: [],
    oversized: true,
  });
  expect(result.target_limited).toBe(true);
  expect(result.target_count).toBeGreaterThan(0);
  expect(result.target_count).toBeLessThan(0x10000);
  expect(result.invalid).toBe(true);
});
