import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "classifies a ZIP-signature safetensors length before applying its representation limit",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-model-zip-collision-");
    const length = 67_324_752;
    const path = join(root, "model.safetensors");
    const prefix = Buffer.alloc(8);
    prefix.writeBigUInt64LE(BigInt(length));
    const header = Buffer.from(
      JSON.stringify({
        weight: { dtype: "U8", shape: [1], data_offsets: [0, 1] },
      }),
    );
    const padding = Buffer.alloc(1024 * 1024, 0x20);
    const file = await open(path, "wx");
    try {
      await file.writeFile(prefix);
      await file.writeFile(header);
      for (let remaining = length - header.length; remaining > 0;) {
        const count = Math.min(remaining, padding.length);
        await file.writeFile(padding.subarray(0, count));
        remaining -= count;
      }
      await file.writeFile(Buffer.from([0x5a]));
    } finally {
      await file.close();
    }
    const result = await cli.run({
      arguments: ["inspect-model-artifact", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "resource_constraint",
      category: "resource_constraint",
      details: {
        resource: "memory",
        reported_limits: { maximum_representation_bytes: 33_554_432 },
      },
    });
    const zip = join(root, "archive.zip");
    await writeFile(
      zip,
      Buffer.from(
        "504b0304140000000000000021008bc5848d05000000050000000a00000074656e736f722e747874696e657274504b01021403140000000000000021008bc5848d05000000050000000a000000000000000000000080010000000074656e736f722e747874504b05060000000001000100380000002d0000000000",
        "hex",
      ),
    );
    const unsupported = await cli.run({
      arguments: ["inspect-model-artifact", zip, "--json"],
    });
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.json).toMatchObject({ code: "unsupported_target" });
  },
);
