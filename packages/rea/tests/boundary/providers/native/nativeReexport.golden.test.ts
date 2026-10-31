import { expect, it } from "vitest";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  dylibCommand,
  LC,
  machoImage,
} from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  NativeFixtureRunner,
  nativeFixture,
  nativeMachoTargetForFile,
} from "../../../fixtures/nativeCommands.js";

it("retains native re-export dependencies alongside ordinary and identity commands", async () => {
  const directory = await createTestTempDirectory("rea-reexport-");
  try {
    const path = join(directory, "libOuter.dylib");
    await writeFile(
      path,
      machoImage({
        fileType: 6,
        commands: [
          dylibCommand(LC.ID_DYLIB, "@rpath/libOuter.dylib"),
          dylibCommand(LC.REEXPORT_DYLIB, "@rpath/libLeaf.dylib"),
          dylibCommand(LC.LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"),
        ],
      }),
    );
    const runner = new NativeFixtureRunner({
      lipo: await nativeFixture("lipo-thin.txt"),
    });
    const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
      await nativeMachoTargetForFile(path),
    );
    const result = await client.execute("inspect_macho", {});
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({
      dependencies: {
        exhaustive: true,
        total: 2,
        items: [
          expect.objectContaining({
            kind: "LC_REEXPORT_DYLIB",
            path: "@rpath/libLeaf.dylib",
          }),
          expect.objectContaining({
            kind: "LC_LOAD_DYLIB",
            path: "/usr/lib/libSystem.B.dylib",
          }),
        ],
      },
      load_commands: {
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "LC_ID_DYLIB" }),
        ]),
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
