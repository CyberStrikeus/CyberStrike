import { rm } from "node:fs/promises";
import { Cli } from "incur";
import { expect, it, onTestFinished } from "vitest";
import { Ajv } from "ajv";
import type { AnySchema } from "ajv";

import { registerFlutterCommands } from "../../../src/cli/flutterCommands.js";
import { aotFixtureImage } from "../../../src/flutter/FlutterBuild.fixture.js";
import { FlutterBuildProvider } from "../../../src/flutter/FlutterBuildProvider.js";
import { silentLogger } from "../../../src/logger.js";
import { flutterInputSchemas } from "../../../src/domain/flutter/flutterBuildAnalysis.js";
import { createFlutterApk } from "../../fixtures/flutterApk.js";
import { serveCli } from "./cliServeHarness.js";

it.each(["identify-flutter-build", "inspect-dart-aot"])(
  "%s advertises a schema through the public CLI",
  async (command) => {
    const result = await serveCli([command, "--schema", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toBeTruthy();
  },
);

it("reports an unreadable target with an input refusal", async () => {
  const result = await serveCli([
    "identify-flutter-build",
    "/nonexistent/app.apk",
    "--json",
  ]);
  expect(result.stdout).toContain("invalid_request");
});

it.each(["identify-flutter-build", "inspect-dart-aot"])(
  "%s uses canonical local-path validation before provider admission",
  async (command) => {
    const result = await serveCli([command, "fixture\u0000.apk", "--json"]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({
          path: "path",
          message: expect.stringContaining("NUL"),
        }),
      ],
    });
  },
);

it("advertises and validates one ABI selector grammar with field correction guidance", async () => {
  const advertised = await serveCli(["inspect-dart-aot", "--schema", "--json"]);
  expect(advertised.exitCode).toBe(0);
  const schema = JSON.parse(advertised.stdout) as { options: AnySchema };
  const ajv = new Ajv({ strict: false });
  expect(ajv.validateSchema(schema.options)).toBe(true);
  const accepts = ajv.compile(schema.options);
  const abiSchema = flutterInputSchemas.inspect_dart_aot.shape.abi;
  for (const abi of [
    "ARM64-V8A",
    "ARM64",
    "arm64.v8a",
    "A",
    "a",
    "abi\\label",
    "abi\nlabel",
    "l".repeat(1010),
    "😀".repeat(1010),
  ]) {
    expect(accepts({ abi })).toBe(true);
    expect(abiSchema.safeParse(abi).success).toBe(true);
  }
  for (const abi of [
    "",
    "lib/x86_64",
    "l".repeat(1011),
    "😀".repeat(1011),
    "l".repeat(1010) + "\n",
  ]) {
    expect(accepts({ abi })).toBe(false);
    expect(abiSchema.safeParse(abi).success).toBe(false);
    const rejected = await serveCli([
      "inspect-dart-aot",
      "/nonexistent/app.apk",
      "--abi",
      abi,
      "--json",
    ]);
    expect(JSON.parse(rejected.stdout)).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({
          path: "abi",
          message: expect.stringContaining("ABI"),
        }),
      ],
    });
  }
});

it("inspects the caller-selected nonstandard ABI through the public CLI", async () => {
  const path = await createFlutterApk("selector.apk", [
    { path: "lib/ARM64-V8A/libapp.so", bytes: aotFixtureImage("a".repeat(32)) },
    { path: "lib/x86_64/libapp.so", bytes: aotFixtureImage("b".repeat(32)) },
  ]);
  const selected = await serveCli([
    "inspect-dart-aot",
    path,
    "--abi",
    "ARM64-V8A",
    "--json",
  ]);
  expect(selected.exitCode).toBe(0);
  expect(JSON.parse(selected.stdout)).toMatchObject({
    caller_input_path: path,
    parameters: { path, abi: "ARM64-V8A" },
    normalized_result: {
      abi: "ARM64-V8A",
      libapp: { snapshot_hash: "a".repeat(32), coverage: "complete" },
    },
  });
});

/** Serve one command whose first snapshot-root removal fails and is retried on close. */
const serveWithCleanupRetry = async (
  command: string,
  apk: string,
  interrupt: boolean,
  retryFails = false,
): Promise<Record<string, unknown>> => {
  const inherited = new Set(process.listeners("SIGINT"));
  const roots: string[] = [];
  const provider = new FlutterBuildProvider({
    removeRoot: async (root) => {
      roots.push(root);
      if (roots.length > 2) return rm(root, { recursive: true, force: true });
      // Deliver SIGINT to the command's own listener during the retry.
      if (roots.length === 2 && interrupt)
        for (const listener of process.listeners("SIGINT"))
          if (!inherited.has(listener)) listener("SIGINT");
      if (roots.length === 1 || retryFails)
        throw Object.assign(new Error("transient snapshot removal refusal"), {
          code: "EACCES",
        });
      await rm(root, { recursive: true, force: true });
    },
  });
  onTestFinished(() => provider.close());
  const cli = Cli.create("flutter-cleanup-retry-test", { sync: false });
  registerFlutterCommands(cli, silentLogger, provider);
  let stdout = "";
  await cli.serve([command, apk, "--format", "json"], {
    stdout: (text) => {
      stdout += text;
    },
    exit: () => {},
  });
  expect(roots).toEqual([roots[0], roots[0]]);
  return JSON.parse(stdout) as Record<string, unknown>;
};

it.each([
  ["identify-flutter-build", "identify_flutter_build"],
  ["inspect-dart-aot", "inspect_dart_aot"],
] as const)(
  "%s reports SIGINT during the cleanup retry as cancellation with completed facts",
  async (command, operation) => {
    const apk = await createFlutterApk("cleanup-retry.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotFixtureImage() },
    ]);
    const exitCode = process.exitCode;
    onTestFinished(() => {
      process.exitCode = exitCode;
    });
    const control = await serveWithCleanupRetry(command, apk, false);
    expect(control).toMatchObject({
      operation,
      confidence: "observed",
      caller_input_path: apk,
    });
    expect(process.exitCode).toBe(exitCode);
    const interrupted = await serveWithCleanupRetry(command, apk, true);
    expect(process.exitCode).toBe(130);
    expect(interrupted).toMatchObject({
      code: "cancelled",
      details: {
        operation,
        partial_observation: {
          operation,
          caller_input_path: apk,
          subject: { local_path: apk },
          confidence: "observed",
          normalized_result: control.normalized_result,
        },
      },
    });
    const incomplete = await serveWithCleanupRetry(command, apk, true, true);
    expect(incomplete).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: [expect.stringContaining("rea-flutter-")],
        partial_observation: {
          operation,
          caller_input_path: apk,
          normalized_result: control.normalized_result,
        },
      },
    });
  },
);
