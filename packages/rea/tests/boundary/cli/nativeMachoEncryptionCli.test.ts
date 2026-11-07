import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { describe, expect } from "vitest";
import { z } from "zod";

import { inspectMachoSchema } from "../../../src/domain/native/nativeInspection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const evidenceSchema = z.object({ normalized_result: inspectMachoSchema });
const LC_ENCRYPTION_INFO_64 = 0x2c;

/** File offset of the thin 64-bit image's LC_ENCRYPTION_INFO_64 cryptid word. */
const cryptidOffset = (bytes: Buffer): number => {
  let offset = 32;
  for (let index = 0; index < bytes.readUInt32LE(16); index += 1) {
    if (bytes.readUInt32LE(offset) === LC_ENCRYPTION_INFO_64)
      return offset + 16;
    offset += bytes.readUInt32LE(offset + 4);
  }
  throw new Error("fixture has no LC_ENCRYPTION_INFO_64");
};

describe.skipIf(process.platform !== "darwin")(
  "native Mach-O CLI encryption status",
  () => {
    cliTest(
      "reports every slice's encryption command where otool reports it",
      async ({ cli, processes }) => {
        const directory = await createTestTempDirectory(
          "rea-macho-encryption-",
        );
        const source = join(directory, "main.c");
        const arm64 = join(directory, "enc");
        const x86 = join(directory, "plain_x86");
        const fat = join(directory, "fat_enc");
        await writeFile(source, "int main(void) { return 0; }\n");
        const run = async (command: string, arguments_: string[]) => {
          const result = await processes.run(command, arguments_, {
            timeoutMs: 30_000,
          });
          expect(result.exitCode, result.stderr).toBe(0);
          return result.stdout;
        };
        await run("/usr/bin/xcrun", [
          "clang",
          "-arch",
          "arm64",
          source,
          "-o",
          arm64,
          "-Wl,-encryptable",
        ]);
        // Mark the range encrypted, as App Store binaries are, and re-sign.
        const bytes = await readFile(arm64);
        bytes.writeUInt32LE(1, cryptidOffset(bytes));
        await writeFile(arm64, bytes);
        await run("/usr/bin/codesign", ["-f", "-s", "-", arm64]);
        await run("/usr/bin/xcrun", [
          "clang",
          "-arch",
          "x86_64",
          source,
          "-o",
          x86,
        ]);
        await run("/usr/bin/lipo", ["-create", x86, arm64, "-output", fat]);
        const otool = await run("/usr/bin/otool", [
          "-arch",
          "arm64",
          "-l",
          fat,
        ]);
        const field = (name: string) =>
          Number(new RegExp(`\\n\\s*${name} (\\d+)`, "u").exec(otool)?.[1]);

        const result = await cli.run({
          arguments: ["inspect-macho", fat, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const inspected = evidenceSchema.parse(result.json).normalized_result;
        const [plain, encrypted] = inspected.encryption.items;
        expect(inspected.encryption).toMatchObject({
          total: 2,
          exhaustive: true,
        });
        expect(plain).toMatchObject({
          architecture: "x86_64",
          status: "absent",
        });
        expect(encrypted).toMatchObject({
          architecture: "arm64",
          status: "encrypted",
          commands: [
            {
              kind: "LC_ENCRYPTION_INFO_64",
              cryptoff: field("cryptoff"),
              cryptsize: field("cryptsize"),
              cryptid: 1,
            },
          ],
          range: {
            content: "ciphertext",
            mapping: {
              status: "mapped",
              sections: expect.arrayContaining([
                { segment: "__TEXT", section: "__text" },
              ]),
            },
          },
        });
        const range = encrypted?.range;
        if (range == null) throw new Error("expected the encrypted range");
        expect(range.container_start).toBe(
          (encrypted?.container_file_offset ?? 0) + field("cryptoff"),
        );
        expect(inspected.limitations).toContain(
          `Bytes ${range.container_start}-${range.container_end} (input file offsets, end exclusive) of the arm64 slice are ciphertext (cryptid 1); disassembly, decompilation, strings and references derived from them do not describe program code.`,
        );
      },
    );
  },
);
