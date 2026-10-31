import { access, chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "reports the same headless workspace readiness through discovery and doctor",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-ida-discovery-cli-");
    const writable = join(root, "writable");
    const file = join(root, "file");
    const marker = join(root, "launched");
    const command = join(root, "fixture-ida");
    await mkdir(writable);
    await writeFile(file, "caller data");
    await writeFile(command, `#!/bin/sh\nprintf launched > '${marker}'\n`);
    await chmod(command, 0o700);
    const registration = join(root, "ida.json");
    const before = (await readdir(root)).sort();
    for (const [workspaceRoot, usable] of [
      [join(root, "missing"), false],
      [file, false],
      [writable, true],
      [undefined, true],
    ] as const) {
      await writeFile(
        registration,
        JSON.stringify({
          mode: "headless",
          command,
          ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
        }),
      );
      const environment = {
        HOME: root,
        REA_IDA_MCP_CONFIG: registration,
      };
      for (const command of ["providers", "capabilities"] as const) {
        const result = await cli.run({
          arguments: [command, "--json"],
          environment,
        });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.json).toMatchObject({
          analysis_provider_candidates: expect.arrayContaining([
            expect.objectContaining({
              provider: expect.objectContaining({ id: "ida" }),
              availability: usable
                ? expect.objectContaining({ status: "available" })
                : expect.objectContaining({
                    status: "unavailable",
                    code: "open_options_invalid",
                    reason: expect.stringContaining(workspaceRoot),
                  }),
              ...(usable
                ? {}
                : {
                    capabilities: expect.arrayContaining([
                      expect.objectContaining({
                        groups: expect.arrayContaining([
                          expect.objectContaining({
                            operations: expect.arrayContaining([
                              "list_procedures",
                            ]),
                            available: false,
                            reason: expect.stringContaining(workspaceRoot),
                          }),
                          expect.objectContaining({
                            operations: expect.arrayContaining([
                              "procedure_callers",
                            ]),
                            available: false,
                            reason:
                              expect.stringContaining("direct call edges"),
                          }),
                        ]),
                      }),
                    ]),
                  }),
            }),
          ]),
        });
      }
      const doctor = await cli.run({
        arguments: ["doctor", "--provider", "ida", "--json"],
        environment,
      });
      expect(doctor.exitCode, doctor.stderr).toBe(usable ? 0 : 1);
      expect(doctor.json).toMatchObject({
        providerInspections: expect.arrayContaining([
          expect.objectContaining({ id: "ida", available: usable }),
        ]),
      });
    }
    expect(
      (await readdir(root)).filter((name) => name !== "ida.json").sort(),
    ).toEqual(before);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
