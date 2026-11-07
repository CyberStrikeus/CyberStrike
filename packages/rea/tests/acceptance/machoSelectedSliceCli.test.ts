import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

const thin = (subtype: number): Buffer => {
  const bytes = Buffer.alloc(4096);
  [0xfeedfacf, 0x0100000c, subtype, 1, 1, 152, 0, 0].forEach((value, index) =>
    bytes.writeUInt32LE(value, index * 4),
  );
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(152, 36);
  bytes.writeBigUInt64LE(16n, 64);
  bytes.writeBigUInt64LE(184n, 72);
  bytes.writeBigUInt64LE(16n, 80);
  bytes.writeUInt32LE(7, 88);
  bytes.writeUInt32LE(7, 92);
  bytes.writeUInt32LE(1, 96);
  bytes.write("__data", 104);
  bytes.write("__DATA", 120);
  bytes.writeBigUInt64LE(16n, 144);
  bytes.writeUInt32LE(184, 152);
  bytes.writeUInt32LE(3, 156);
  bytes.fill(0x41 + subtype, 184, 200);
  return bytes;
};

const fat = (reversed: boolean): Buffer => {
  const bytes = Buffer.alloc(36864);
  bytes.writeUInt32BE(0xcafebabe);
  bytes.writeUInt32BE(2, 4);
  const entries = reversed
    ? [
        [0, 32768],
        [1, 16384],
      ]
    : [
        [1, 16384],
        [0, 32768],
      ];
  entries.forEach(([subtype, offset], index) => {
    [0x0100000c, subtype!, offset!, 4096, 14].forEach((value, field) =>
      bytes.writeUInt32BE(value, 8 + index * 20 + field * 4),
    );
    thin(subtype!).copy(bytes, offset!);
  });
  return bytes;
};

cliTest.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "reports the selected ARM64 slice and segment coordinates despite repeated lipo names",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-macho-selected-slice-");
    for (const [name, bytes, selectedOffset] of [
      ["v8-first", fat(false), 32768],
      ["all-first", fat(true), 32768],
      ["thin-all", thin(0), 0],
    ] as const) {
      const path = join(root, name);
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-macho", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          selected_architecture: {
            name: "arm64",
            container_file_offset: selectedOffset,
          },
        },
        locations: expect.arrayContaining([
          {
            kind: "file-offset-range",
            start: selectedOffset + 184,
            end: selectedOffset + 200,
          },
        ]),
      });
    }
  },
);

cliTest.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "retains a linker-generated multiline section name without changing the input",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-macho-multiline-section-");
    const code = join(root, "main.c");
    const payload = join(root, "data");
    const path = join(root, "target");
    await writeFile(code, "int main(void) { return 0; }\n");
    await writeFile(payload, "data");
    execFileSync("/usr/bin/clang", [
      "-arch",
      "arm64",
      "-o",
      path,
      code,
      `-Wl,-sectcreate,__DATA,x\naddr 0x1,${payload}`,
    ]);
    const before = await readFile(path);
    const result = await cli.run({
      arguments: ["inspect-macho", path, "--json"],
    });
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.json).toMatchObject({
      normalized_result: {
        segments: {
          items: expect.arrayContaining([
            expect.objectContaining({
              sections: expect.objectContaining({
                items: expect.arrayContaining([
                  expect.objectContaining({
                    name: "x\naddr 0x1",
                    segment: "__DATA",
                  }),
                ]),
              }),
            }),
          ]),
        },
      },
    });
    expect(Buffer.compare(await readFile(path), before)).toBe(0);

    const patched = Buffer.from(before);
    const sectionName = patched.indexOf(Buffer.from("x\naddr 0x1"));
    expect(sectionName).toBeGreaterThan(0);
    patched[sectionName] = 0xff;
    await writeFile(path, patched);
    const undecodable = await cli.run({
      arguments: ["inspect-macho", path, "--json"],
    });
    expect(undecodable.exitCode, undecodable.stderr + undecodable.stdout).toBe(
      0,
    );
    expect(undecodable.json).toMatchObject({
      normalized_result: {
        segments: {
          items: expect.arrayContaining([
            expect.objectContaining({
              sections: expect.objectContaining({
                items: expect.arrayContaining([
                  expect.objectContaining({
                    name: null,
                    name_bytes_hex: expect.stringMatching(
                      /^ff0a6164647220307831/u,
                    ),
                  }),
                ]),
              }),
            }),
          ]),
        },
      },
    });
    expect(Buffer.compare(await readFile(path), patched)).toBe(0);
  },
);
