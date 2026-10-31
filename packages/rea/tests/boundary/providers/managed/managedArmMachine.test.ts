import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { buildManagedPeFixture } from "../../../../src/dotnet/ManagedPe.fixture.js";
import { ManagedStaticProvider } from "../../../../src/dotnet/ManagedStaticProvider.js";

it.each([0x01c0, 0x01c2, 0x01c4])(
  "opens and inspects managed PE ARM machine 0x%s through the public path",
  async (machine) => {
    const bytes = buildManagedPeFixture({ cliFlags: 0 });
    bytes.writeUInt16LE(machine, bytes.readUInt32LE(0x3c) + 4);
    const directory = await createTestTempDirectory("rea-managed-arm-");
    const path = join(directory, "fixture.exe");
    await writeFile(path, bytes);
    const parsed = await parseBinaryTarget(path);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value).toMatchObject({
      kind: "executable",
      format: "pe",
      architecture: "arm",
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
        expect(observed.value.subject).toMatchObject({
          path,
          sha256: parsed.value.sha256,
        });
        expect(observed.value.result).toMatchObject({
          module: { name: "Fixture.dll" },
        });
      }
    } finally {
      await client.close();
    }
  },
);
