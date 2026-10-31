import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../src/domain/evidence.js";
import { pythonPycFixture } from "../../src/python/PythonPyc.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../support/cli/cliFixture.js";

const fileCommands = [
  "inspect-sqlite-database",
  "inspect-python-pyc",
  "inspect-apk-signature",
  "inspect-packet-capture",
  "decode-signal-recording",
  "inspect-model-artifact",
  "inspect-elf-notes",
  "inspect-kernel-module",
  "inspect-byte-entropy",
  "inspect-pe-resources",
  "inspect-pe-certificates",
  "inspect-native-exports",
  "inspect-binary-layout",
  "inspect-recorded-crash",
  "inspect-go-binary",
  "inspect-rust-binary",
  "inspect-gpu-code-objects",
  "inspect-il2cpp-metadata",
] as const;

cliTest(
  "rejects empty file selections before they can become the working directory",
  async ({ cli }) => {
    const cwd = await createTestTempDirectory("rea-empty-local-path-");
    const selections = [
      ...fileCommands.map((command) => ({
        arguments: [command, ""],
        field: "path",
      })),
      { arguments: ["inspect-evm-interface", "", "hex"], field: "path" },
      {
        arguments: ["inspect-web-network-capture", "", "har"],
        field: "capturePath",
      },
    ];
    for (const selection of selections) {
      const result = await runFileCli(cli, {
        arguments: [...selection.arguments, "--json"],
        cwd,
      });
      expect(result.exitCode, selection.arguments[0]).toBe(1);
      expect(result.json, selection.arguments[0]).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: expect.arrayContaining([
          expect.objectContaining({
            path: selection.field,
            code: "too_small",
            missing: false,
          }),
        ]),
      });
    }
  },
);

cliTest(
  "rejects empty auxiliary selections and output destinations before reading inputs",
  async ({ cli }) => {
    const cwd = await createTestTempDirectory("rea-empty-auxiliary-path-");
    const selections = [
      {
        arguments: ["inspect-il2cpp-metadata", "unread", "--binary", ""],
        field: "binary",
      },
      {
        arguments: ["inspect-il2cpp-metadata", "unread", "--ghidra-seeds", ""],
        field: "ghidraSeeds",
      },
      {
        arguments: [
          "inspect-web-network-capture",
          "unread",
          "har",
          "--protobuf-schema",
          "",
        ],
        field: "protobufSchema",
      },
      {
        arguments: ["decompile-all", "unread", "--output", ""],
        field: "output",
      },
      { arguments: ["environment-export", "unread", ""], field: "directory" },
      {
        arguments: [
          "environment-export",
          "unread",
          "output",
          "--package-tarball",
          "",
        ],
        field: "packageTarball",
      },
    ];
    for (const selection of selections) {
      const result = await runFileCli(cli, {
        arguments: [...selection.arguments, "--json"],
        cwd,
      });
      expect(result.exitCode, selection.field).toBe(1);
      expect(result.json, selection.field).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: expect.arrayContaining([
          expect.objectContaining({ path: selection.field, code: "too_small" }),
        ]),
      });
    }
  },
);

cliTest(
  "still inspects an explicit relative file with its exact digest",
  async ({ cli }) => {
    const cwd = await createTestTempDirectory("rea-relative-local-path-");
    const bytes = pythonPycFixture();
    const path = join(cwd, "selected.pyc");
    await writeFile(path, bytes);
    const result = await runFileCli(cli, {
      arguments: ["inspect-python-pyc", "./selected.pyc", "--json"],
      cwd,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseEvidence(result.json)).toMatchObject({
      operation: "inspect_python_pyc",
      subject: {
        local_path: path,
        digest: { sha256: createHash("sha256").update(bytes).digest("hex") },
      },
    });
  },
);
