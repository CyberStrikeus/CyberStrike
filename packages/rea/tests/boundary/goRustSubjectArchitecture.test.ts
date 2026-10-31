import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { GoBinaryService } from "../../src/application/go/GoBinaryService.js";
import { RustBinaryService } from "../../src/application/rust/RustBinaryService.js";
import { elf } from "../../src/domain/binaryTarget.fixture.js";
import { GoBinaryProvider } from "../../src/go/GoBinaryProvider.js";
import { RustBinaryProvider } from "../../src/rust/RustBinaryProvider.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

it.each([
  [1, 1, 20, "ppc", "powerpc"],
  [1, 2, 20, "ppc", "powerpc"],
  [1, 1, 3, "386", "x86"],
  [2, 1, 62, "amd64", "x86_64"],
  [2, 2, 21, "ppc64", null],
] as const)(
  "preserves ELF class%d byte-order%d machine%d in Go and Rust subjects",
  async (bits, endian, machine, local, canonical) => {
    const root = await createTestTempDirectory("rea-metadata-subject-");
    const path = join(root, "header.elf");
    const bytes = elf(bits, endian, machine);
    await writeFile(path, bytes);
    for (const service of [
      new GoBinaryService(new GoBinaryProvider()),
      new RustBinaryService(new RustBinaryProvider()),
    ]) {
      const result = await service.inspect({ path });
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value.subject).toMatchObject({
        architecture: canonical,
        digest: { sha256: createHash("sha256").update(bytes).digest("hex") },
      });
      expect(result.value.normalized_result).toMatchObject({
        architecture: local,
        bits: bits === 1 ? 32 : 64,
        byte_order: endian === 1 ? "little" : "big",
      });
    }
  },
);
