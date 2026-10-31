import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

const hopper = fileURLToPath(
  new URL("../../fixtures/hopperLaunchAdmission.mjs", import.meta.url),
);
const ghidra = fileURLToPath(
  new URL("../../fixtures/fakeGhidra.mjs", import.meta.url),
);

for (const blocked of [false, true]) {
  processTest(
    `Hopper admission completes handoff publication before denial exit (blocked=${blocked})`,
    async ({ processes }) => {
      const root = await createTestTempDirectory(
        "rea-hopper-fixture-publication-",
      );
      const mode = join(root, "mode");
      const receipt = join(root, "receipt");
      const handoff = `${receipt}.document-created`;
      await writeFile(mode, "denied-after-handoff");
      if (blocked) await mkdir(handoff);
      const result = await processes.run(
        process.execPath,
        [hopper, mode, receipt, "-Y", "controlled-bootstrap"],
        { timeoutMs: 5_000 },
      );
      expect(result.signal, result.stderr).toBeNull();
      expect(result.exitCode, result.stderr).toBe(blocked ? 1 : 2);
      expect(result.stderr).toContain("Not authorized to send Apple events");
      expect(await readFile(receipt, "utf8")).toBe("controlled-bootstrap");
      if (blocked) {
        expect(result.stderr).toContain(handoff);
        expect((await stat(handoff)).isDirectory()).toBe(true);
      } else {
        expect(await readFile(handoff, "utf8")).toBe("unconfirmed");
      }
    },
  );
}

processTest(
  "Ghidra endpoint publication reports exclusive-file refusal without declaring readiness",
  async ({ processes }) => {
    const root = await createTestTempDirectory(
      "rea-ghidra-fixture-publication-",
    );
    const endpointPath = join(root, "endpoint.json");
    const pending = `${endpointPath}.pending`;
    await writeFile(pending, "previous selected evidence");
    const result = await processes.run(process.execPath, [ghidra], {
      timeoutMs: 5_000,
      env: {
        ...process.env,
        REA_GHIDRA_FIXTURE_CONFIG: JSON.stringify({
          endpointPath,
          transport: "authenticated-loopback-tcp",
          token: "fixture-token",
          runId: "fixture-run",
          providerVersion: "fixture-version",
          profileDigest: "a".repeat(64),
          targetSha256: "b".repeat(64),
        }),
      },
    });
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain("EEXIST");
    expect(result.stderr).toContain(pending);
    expect(await readFile(pending, "utf8")).toBe("previous selected evidence");
    await expect(stat(endpointPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
