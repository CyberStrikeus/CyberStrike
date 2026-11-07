import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest
  .skipIf(process.platform === "win32")
  .for(["stable", "replaced"] as const)(
  "doctor binds Kuna version output to a %s executable identity",
  async (identity, { cli }) => {
    const root = await createTestTempDirectory("rea-kuna-doctor-identity-");
    const home = join(root, "home");
    const executable = join(root, "kuna");
    await mkdir(home);
    const replacement = `#!${process.execPath}\nconsole.log("kuna 1.900");\n`;
    const mutation =
      identity === "replaced"
        ? `const fs = require("node:fs");
fs.writeFileSync(process.argv[1] + ".new", ${JSON.stringify(replacement)}, { mode: 0o700 });
fs.renameSync(process.argv[1] + ".new", process.argv[1]);`
        : "";
    const source = `#!${process.execPath}
console.log("kuna 1.833");
${mutation}
`;
    await writeFile(executable, source, { mode: 0o700 });
    const beforeHash = createHash("sha256").update(source).digest("hex");

    const result = await cli.run({
      arguments: ["doctor", "--provider", "kuna", "--json"],
      environment: {
        HOME: home,
        USERPROFILE: home,
        HOPPER_LAUNCHER_PATH: join(root, "missing-hopper"),
        GHIDRA_INSTALL_DIR: join(root, "missing-ghidra"),
        REA_KUNA_COMMAND: executable,
        REA_KUNA_CACHE_DIR: join(root, "cache"),
        REA_LOG_LEVEL: "silent",
      },
      timeoutMs: 20_000,
    });
    const after = await readFile(executable);
    const afterHash = createHash("sha256").update(after).digest("hex");

    if (identity === "stable") {
      expect(afterHash).toBe(beforeHash);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        providerInspections: expect.arrayContaining([
          expect.objectContaining({
            id: "kuna",
            available: true,
            providerVersion: "1.833",
            checks: expect.arrayContaining([
              expect.objectContaining({ name: "installation", ok: true }),
            ]),
          }),
        ]),
      });
    } else {
      expect(afterHash).not.toBe(beforeHash);
      expect(result.exitCode, result.stderr).toBe(1);
      expect(result.json).toMatchObject({
        providerInspections: expect.arrayContaining([
          expect.objectContaining({
            id: "kuna",
            available: false,
            providerVersion: null,
            checks: expect.arrayContaining([
              expect.objectContaining({
                name: "installation",
                ok: false,
                code: "version_unresolved",
                details: expect.objectContaining({
                  installation_identity_changed: true,
                  version: "1.833",
                  before_sha256: beforeHash,
                  before_bytes: Buffer.byteLength(source),
                  after_sha256: afterHash,
                  after_bytes: after.byteLength,
                  stdout: "kuna 1.833\n",
                  exit_code: 0,
                }),
              }),
            ]),
          }),
        ]),
      });
    }
  },
);
