import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("Hopper preserves named-entry selection and explicit address containment", async () => {
  const fixture = fileURLToPath(
    new URL(
      "../../../fixtures/hopperProcedureSelectionProbe.py",
      import.meta.url,
    ),
  );
  const bridge = fileURLToPath(
    new URL("../../../../bridge/hopper_bridge.py", import.meta.url),
  );
  const { stdout } = await promisify(execFile)(
    "python3",
    ["-I", "-S", fixture, bridge],
    { timeout: 3_000 },
  );
  const observed = JSON.parse(stdout);
  for (const selector of ["entry", "alias_entry", "0x401004", "401004"])
    expect(observed.results[selector]).toEqual({ entry: "0x401000" });
  expect(observed.results.inner).toMatchObject({
    diagnostic_type: "invalid_request",
    message: expect.stringContaining(
      "inner at 0x401004 is inside procedure entry at 0x401000",
    ),
  });
  expect(observed.results["file-offset:0x4"]).toMatchObject({
    diagnostic_type: "invalid_request",
    message: expect.stringContaining("source-file coordinates"),
  });
  expect(observed.name_lookups).toEqual([
    "entry",
    "alias_entry",
    "inner",
    "401004",
  ]);
});
