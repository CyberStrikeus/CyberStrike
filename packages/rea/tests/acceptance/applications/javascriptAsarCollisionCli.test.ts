import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { asarHeaderBytes } from "../../fixtures/asarHeader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "reports normalized ASAR collisions as path failures",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-asar-collision-cli-");
    const path = join(root, "twins.asar");
    const entries = [
      ["café.js", "console.log(1)\n"],
      ["cafe\u0301.js", "console.log(2)\n"],
    ] as const;
    let offset = 0;
    const files = Object.fromEntries(
      entries.map(([name, text]) => {
        const bytes = Buffer.from(text);
        const record = {
          size: bytes.length,
          offset: String(offset),
          integrity: {
            algorithm: "SHA256",
            hash: createHash("sha256").update(bytes).digest("hex"),
          },
        };
        offset += bytes.length;
        return [name, record];
      }),
    );
    await writeFile(
      path,
      Buffer.concat([
        asarHeaderBytes(JSON.stringify({ files })),
        ...entries.map(([, text]) => Buffer.from(text)),
      ]),
    );
    const result = await cli.run({
      arguments: ["analyze-javascript-application", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "artifact_operation_failed",
      details: { reason: "path", detail: expect.stringContaining("café.js") },
    });
    expect(result.stdout).not.toContain("changed after inventory");
  },
);

cliTest(
  "analyzes readable sources when all colliding siblings are unavailable",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-asar-missing-cli-");
    const path = join(root, "missing.asar");
    const main = Buffer.from('require("./café.js");\n');
    const files = {
      "main.js": { size: main.length, offset: "0" },
      "café.js": { size: 10, unpacked: true },
      "cafe\u0301.js": { size: 10, unpacked: true },
    };
    await writeFile(
      path,
      Buffer.concat([asarHeaderBytes(JSON.stringify({ files })), main]),
    );
    const result = await cli.run({
      arguments: ["analyze-javascript-application", path, "--json"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      normalized_result: {
        statistics: { parsed_javascript_files: 1 },
      },
    });
    expect(result.stdout).toContain("café.js");
    expect(result.stdout).toContain("unknown");
  },
);
