import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  analysisCliErrorEnvelopeSchema,
  analysisErrorProjectionSchema,
} from "../../../src/contracts/errorSchemas.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const unsupportedHostOutput = expect.objectContaining({
  error: "Import failed",
  category: "unsupported_provider",
  message: expect.stringContaining(
    "Safe no-follow file opens are unavailable on this host.",
  ),
});

const permissionChecksUnavailable =
  process.platform === "win32" || process.getuid?.() === 0;

describe("compiled Windows reference-source import", () => {
  for (const scenario of [
    { fullOutput: false, logging: false },
    { fullOutput: true, logging: true },
  ]) {
    cliTest.runIf(process.platform === "win32")(
      `readable root, ${scenario.fullOutput ? "full-output" : "JSON"}, logging ${String(scenario.logging)}`,
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-reference-host-");
        const source = join(root, "source.js");
        const bytes = "export const answer = 42;\n";
        await writeFile(source, bytes);
        const result = await cli.run({
          arguments: [
            "import-reference-source",
            root,
            "--json",
            ...(scenario.fullOutput ? ["--full-output"] : []),
          ],
          cwd: root,
          environment: {
            USERPROFILE: root,
            XDG_CONFIG_HOME: root,
            XDG_CACHE_HOME: root,
            ...(scenario.logging ? { REA_LOG_LEVEL: "info" } : {}),
          },
        });
        expect(result.json).toEqual(
          scenario.fullOutput
            ? expect.objectContaining({
                ok: false,
                error: expect.objectContaining({
                  code: "capability_unavailable",
                  category: "unsupported_provider",
                  message: expect.stringContaining(
                    "Safe no-follow file opens are unavailable on this host.",
                  ),
                }),
              })
            : unsupportedHostOutput,
        );
        expect.soft(result.exitCode).toBe(1);
        expect(await readFile(source, "utf8")).toBe(bytes);
        if (scenario.logging) {
          expect(JSON.parse(result.stderr.trim())).toMatchObject({
            command: "import-reference-source",
            status: "error",
            level: 50,
            msg: "CLI command failed",
          });
        } else expect(result.stderr).toBe("");
      },
      60_000,
    );
  }
});

describe("compiled reference-source import preflight failures", () => {
  for (const scenario of [
    { rootKind: "missing", fullOutput: false, logging: false },
    { rootKind: "missing", fullOutput: true, logging: true },
    { rootKind: "regular-file", fullOutput: false, logging: true },
    { rootKind: "regular-file", fullOutput: true, logging: false },
  ] as const) {
    cliTest(
      `${scenario.rootKind} root, ${scenario.fullOutput ? "full-output" : "JSON"}, logging ${String(scenario.logging)}`,
      async ({ cli }) => {
        const directory = await createTestTempDirectory(
          "rea-reference-cli-status-",
        );
        // Exercise JSON escaping on POSIX too; Windows paths already need it.
        const root = join(
          directory,
          process.platform === "win32" ? "input" : "input\\escaped",
        );
        if (scenario.rootKind === "regular-file")
          await writeFile(root, "inert input\n");
        const result = await cli.run({
          arguments: [
            "import-reference-source",
            root,
            "--json",
            ...(scenario.fullOutput ? ["--full-output"] : []),
          ],
          cwd: directory,
          environment: {
            HOME: directory,
            USERPROFILE: directory,
            XDG_CONFIG_HOME: directory,
            XDG_CACHE_HOME: directory,
            ...(scenario.logging ? { REA_LOG_LEVEL: "info" } : {}),
          },
        });
        const rootReason =
          scenario.rootKind === "missing"
            ? "Reference source root could not be resolved"
            : "Reference source root is not a directory";
        const invalidRootOutput = {
          category: "invalid_input",
          message: expect.stringContaining(rootReason),
        };
        if (scenario.fullOutput) {
          expect(result.json).toMatchObject({
            ok: false,
            error: invalidRootOutput,
          });
        } else {
          expect(result.json).toMatchObject({
            ...invalidRootOutput,
            error: "Import failed",
          });
        }
        const projection = scenario.fullOutput
          ? (result.json as { error: unknown }).error
          : result.json;
        expect(
          (scenario.fullOutput
            ? analysisErrorProjectionSchema
            : analysisCliErrorEnvelopeSchema
          ).safeParse(projection).success,
        ).toBe(true);
        const messagePath = scenario.fullOutput ? "error.message" : "message";
        expect(result.json).toHaveProperty(
          messagePath,
          expect.stringContaining(
            "Check that the path exists, is readable, and points to a directory.",
          ),
        );
        expect(result.json).toHaveProperty(
          messagePath,
          expect.stringContaining(root),
        );
        expect.soft(result.exitCode).toBe(1);
        if (scenario.logging) {
          const records: unknown[] = result.stderr
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as unknown);
          expect(records).toEqual([
            expect.objectContaining({
              command: "import-reference-source",
              status: "error",
              level: 50,
              msg: "CLI command failed",
            }),
          ]);
        } else {
          expect(result.stderr).toBe("");
        }
      },
    );
  }

  cliTest.skipIf(permissionChecksUnavailable)(
    "classifies a blocked parent directory as an execution failure",
    async ({ cli }) => {
      const directory = await createTestTempDirectory(
        "rea-reference-cli-blocked-root-",
      );
      const parent = join(directory, "blocked-parent");
      const root = join(parent, "input");
      await mkdir(root, { recursive: true });
      await chmod(parent, 0);
      try {
        const result = await cli.run({
          arguments: ["import-reference-source", root, "--json"],
          cwd: directory,
          environment: {
            HOME: directory,
            USERPROFILE: directory,
            XDG_CONFIG_HOME: directory,
            XDG_CACHE_HOME: directory,
          },
        });
        expect(result.json).toMatchObject({
          error: "Import failed",
          category: "execution_failure",
          message: expect.stringContaining("EACCES: permission denied"),
        });
        expect(result.json).toHaveProperty(
          "message",
          expect.stringContaining(root),
        );
        expect(result.json).toHaveProperty(
          "message",
          expect.stringContaining("Check directory permissions and try again."),
        );
        expect(result.exitCode).toBe(1);
      } finally {
        await chmod(parent, 0o700);
      }
    },
  );
});
