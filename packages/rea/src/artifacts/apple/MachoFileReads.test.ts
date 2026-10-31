import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { CPU, fatImage, machoImage } from "./MachoImage.fixture.js";
import { MachOSliceArtifactReader } from "../MachOSliceArtifactReader.js";
import { openRegularFile } from "../../filesystem/RegularFile.js";
import { ok } from "../../domain/result.js";

it("keeps structural Mach-O slice inventory across short descriptor reads", async () => {
  const root = await createTestTempDirectory("rea-macho-short-reads-");
  const fat = join(root, "fat");
  const arm = machoImage({ cpu: CPU.arm64 });
  await writeFile(fat, fatImage([{ cpu: CPU.arm64, bytes: arm }]));
  const source = await openRegularFile(fat, { symlinks: "reject" });
  const read = source.handle.read.bind(source.handle);
  let shortReads = 0;
  const spy = vi.spyOn(source.handle, "read").mockImplementation((async (
    ...args: unknown[]
  ) => {
    if (typeof args[2] === "number" && args[2] > 4) {
      args[2] = 4;
      shortReads += 1;
    }
    return Reflect.apply(read, source.handle, args);
  }) as typeof source.handle.read);
  try {
    const reader = new MachOSliceArtifactReader(
      fat,
      {},
      {
        run: async () =>
          ok({
            tool: "lipo",
            executable: "/usr/bin/lipo",
            executableSha256: "1".repeat(64),
            toolVersion: null,
            versionReason: "fixture",
            arguments: ["-detailed_info", fat],
            // Omitting ranges requires successful structural parsing rather
            // than the fallback that accepts independently reported ranges.
            stdout:
              "architecture arm64\n cputype 16777228\n cpusubtype 0\n align 2^12 (4096)\n",
            stderr: "",
            stdoutBytes: 1,
            stderrBytes: 0,
            exitCode: 0,
            signal: null,
          }),
      },
      source,
    );
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(entries).toMatchObject([
        { path: "slices/arm64", declaredSize: arm.length, byteOffset: 4096 },
      ]);
      expect(shortReads).toBeGreaterThan(4);
      expect(entries[0]?.limitations).toEqual([
        "Slice range was derived from structural Mach-O facts because lipo omitted it.",
      ]);
    } finally {
      await reader.close();
    }
  } finally {
    spy.mockRestore();
    await source.handle.close();
  }
});
