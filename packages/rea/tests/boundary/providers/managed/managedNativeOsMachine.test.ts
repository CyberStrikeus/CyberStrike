import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { buildManagedPeFixture } from "../../../../src/dotnet/ManagedPe.fixture.js";
import { ManagedStaticProvider } from "../../../../src/dotnet/ManagedStaticProvider.js";

// ReadyToRun images compiled for a non-Windows OS store the machine XORed with
// IMAGE_FILE_MACHINE_NATIVE_OS_OVERRIDE (dotnet/runtime src/coreclr/inc/pedecoder.h).
it.each([
  ["Linux x86", 0x014c ^ 0x7b79, 0, "x86"],
  ["Linux ARM", 0x01c4 ^ 0x7b79, 0, "arm"],
  ["Apple ARM", 0x01c4 ^ 0x4644, 0, "arm"],
  ["FreeBSD x86", 0x014c ^ 0xadc4, 0, "x86"],
] as const)(
  "opens and inspects the %s ReadyToRun machine through the public path",
  async (_label, machine, cliFlags, architecture) => {
    const bytes = buildManagedPeFixture({ cliFlags, readyToRun: true });
    bytes.writeUInt16LE(machine, bytes.readUInt32LE(0x3c) + 4);
    const directory = await createTestTempDirectory("rea-managed-os-machine-");
    const path = join(directory, "fixture.dll");
    await writeFile(path, bytes);
    const parsed = await parseBinaryTarget(path);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value).toMatchObject({
      kind: "executable",
      format: "pe",
      architecture,
      managed: true,
    });
    const client = new ManagedStaticProvider().createClient(parsed.value);
    try {
      for (const operation of [
        "inspect_managed_artifact",
        "inspect_managed_members",
        "inspect_managed_native_boundaries",
      ] as const) {
        const observed = await client.execute(operation, {});
        if (!observed.ok) throw observed.error;
        expect(observed.value.result).toMatchObject({
          module: { name: "Fixture.dll" },
        });
      }
      const artifact = await client.execute("inspect_managed_artifact", {});
      if (!artifact.ok) throw artifact.error;
      expect(artifact.value.result).toMatchObject({
        pe: { machine, architecture },
        classification: { managed_architecture: architecture },
      });
    } finally {
      await client.close();
    }
  },
);
