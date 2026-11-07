import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { evidenceResultOf } from "../../src/contracts/toolOutputSchemaPrimitives.js";
import { goBinarySchema } from "../../src/domain/go/goBinary.js";
import { createGoBinaryFixture, GO_MODULE_TEXT } from "../fixtures/go/image.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../support/cli/cliFixture.js";

cliTest(
  "inspects ELF64 Go metadata with four-byte amd64p32 pointers through CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-amd64p32-cli-");
    const fixture = createGoBinaryFixture({
      format: "elf",
      bits: 64,
      encoding: "pointer",
      pointerSize: 4,
      goVersion: "go1.13.15",
    });
    const path = join(root, "nacl-amd64p32.nexe");
    await writeFile(path, fixture.bytes);
    const result = await runFileCli(cli, {
      arguments: ["inspect-go-binary", path, "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
    expect(evidence.subject?.architecture).toBe("x86_64");
    expect(evidence.normalized_result).toMatchObject({
      format: "elf",
      architecture: "amd64",
      bits: 64,
      build_info: {
        encoding: "pointer",
        go_version: "go1.13.15",
        module_text: GO_MODULE_TEXT,
        version_location: { offset: fixture.versionOffset, bytes: 9 },
        module_location: {
          offset: fixture.moduleOffset,
          bytes: fixture.moduleBytes.length,
        },
      },
    });
  },
);
