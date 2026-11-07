import { artifactMcpCall } from "../../../scripts/lib/artifact-e2e.mjs";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

import { AdbProvider } from "../../../src/adb/AdbProvider.js";
import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "preserves caller destination and reports the effective pushed file path through MCP",
  async () => {
    const directory = await createTestTempDirectory("rea-adb-push-mcp-");
    const localPath = join(directory, "payload.bin");
    const adbPath = join(directory, "adb");
    const stagedMode = join(directory, "staged-mode");
    const destination = "/data/local/tmp/drop/";
    const effectivePath = `${destination}payload.bin`;
    const digest = createHash("sha256").update("push-payload").digest("hex");
    await writeFile(localPath, "push-payload", { mode: 0o755 });
    await chmod(localPath, 0o755);
    await writeFile(
      adbPath,
      `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "version") { process.stdout.write("Android Debug Bridge version 1.0.41\\nVersion 34.0.5-stub\\n"); }
else if (args[0] === "-s" && args[2] === "shell" && args[3] === "test") {
  if (args[4] === "-d" && args[5] === ${JSON.stringify(destination)}) process.exitCode = 0;
  else process.exitCode = 1;
} else if (args[0] === "-s" && args[2] === "push") {
  fs.writeFileSync(${JSON.stringify(stagedMode)}, (fs.statSync(args[3]).mode & 0o7777).toString(8) + "\\n");
} else if (args[0] === "-s" && args[2] === "shell" && args[3] === "sha256sum") {
  process.stdout.write(${JSON.stringify(`${digest}  ${effectivePath}\n`)});
}
`,
    );
    await chmod(adbPath, 0o755);
    const server = createServer(
      {
        kind: "session",
        session: createTestBinarySession(() => {
          throw new Error("ADB push must not open a deep-analysis provider");
        }),
      },
      {
        adbDeviceAnalysis: new AdbProvider({
          environment: { REA_ADB_PATH: adbPath },
        }),
      },
    );
    onTestFinished(() => server.close());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "adb-push-boundary", version: "0.0.0" });
    onTestFinished(() => client.close());
    await client.connect(clientTransport);
    const response = await artifactMcpCall(client, {
      name: "push_adb_file",
      arguments: {
        serial: "emulator-5554",
        local_path: localPath,
        device_path: destination,
      },
    });
    expect(response.isError).not.toBe(true);
    const evidence = toolContract("push_adb_file").outputSchema.parse(
      parseEvidence(JSON.parse(responseText(response))),
    );
    expect(evidence.parameters).toMatchObject({ device_path: destination });
    expect(evidence.normalized_result).toMatchObject({
      device_path: effectivePath,
      overwritten: false,
      device_sha256: digest,
    });
    expect(await readFile(stagedMode, "utf8")).toBe("511\n");
  },
);

const responseText = (response: { readonly content: readonly unknown[] }) =>
  response.content
    .flatMap((part) =>
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("");

const createFakeAdb = async () => {
  const directory = await createTestTempDirectory("rea-adb-start-mcp-");
  const binary = join(directory, "adb");
  const stdoutFile = join(directory, "stdout");
  const stderrFile = join(directory, "stderr");
  const callsFile = join(directory, "calls");
  const exitCodeFile = join(directory, "exit-code");
  const fakeAdbSource = `#!${process.execPath}
const fs = require("node:fs");
const [stdoutPath, stderrPath, callsPath, exitCodePath] = ${JSON.stringify([stdoutFile, stderrFile, callsFile, exitCodeFile])};
const args = process.argv.slice(2);
fs.appendFileSync(callsPath, args.join(" ") + "\\n");
if (args[0] === "version") {
  process.stdout.write("Android Debug Bridge version 1.0.41\\nVersion 34.0.5-stub\\n");
} else if (args.includes("resolve-activity")) {
  process.stdout.write("com.example/.Main\\n");
} else {
  process.stdout.write(fs.readFileSync(stdoutPath, "utf8"));
  process.stderr.write(fs.readFileSync(stderrPath, "utf8"));
  if (args.includes("start")) process.exitCode = Number(fs.readFileSync(exitCodePath, "utf8"));
}
`;
  await writeFile(binary, fakeAdbSource);
  await chmod(binary, 0o755);
  return {
    binary,
    calls: async () => (await readFile(callsFile, "utf8")).trim().split("\n"),
    setReport: async (stdout: string, stderr: string, exitCode = 0) => {
      await writeFile(stdoutFile, stdout);
      await writeFile(stderrFile, stderr);
      await writeFile(exitCodeFile, String(exitCode));
    },
  };
};

const assertAdvertisedActivityExtras = async (
  client: Client,
  input: Readonly<Record<string, unknown>>,
  calls: () => Promise<string[]>,
) => {
  const advertised = (await client.listTools()).tools.find(
    ({ name }) => name === "start_adb_activity",
  );
  if (advertised === undefined) throw new Error("Missing ADB activity tool");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(advertised.inputSchema)).toBe(true);
  const validateCompactInput = ajv.compile(advertised.inputSchema);
  expect(validateCompactInput(input)).toBe(true);
  expect(
    validateCompactInput({
      ...input,
      extras: [
        { key: "bool", type: "boolean", value: "false" },
        { key: "int", type: "int", value: "-3" },
        { key: "long", type: "long", value: "9007199254740993" },
        { key: "float", type: "float", value: "-1.25" },
      ],
    }),
  ).toBe(true);
  // Canonical validation rejects malformed extras before starting ADB.
  const callsBeforeInvalidExtra = await calls();
  const invalidExtra = await artifactMcpCall(client, {
    name: "start_adb_activity",
    arguments: {
      ...input,
      extras: [{ key: "invalid", type: "boolean", value: "yes" }],
    },
  });
  expect(parseMcpToolError(invalidExtra).error).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
  });
  expect(await calls()).toEqual(callsBeforeInvalidExtra);
};

it
  .skipIf(process.platform === "win32")
  .each(["start_adb_app", "start_adb_activity"] as const)(
  "%s preserves successful reports and failed launch attempts through MCP (ADB process output simulated)",
  async (operation) => {
    const fakeAdb = await createFakeAdb();
    const { binary } = fakeAdb;
    const starting =
      "Starting: Intent { act=android.intent.action.MAIN cmp=com.example/.Main }\n";
    let stdout = `${starting}Warning: Activity not started, intent has been delivered to currently running top-most instance.\nStatus: ok\nActivity: com.example/.Main\nWaitTime: 315\nComplete\n`;
    let stderr = "";
    await fakeAdb.setReport(stdout, stderr);

    const server = createServer(
      {
        kind: "session",
        session: createTestBinarySession(() => {
          throw new Error("ADB start must not open a deep-analysis provider");
        }),
      },
      {
        adbDeviceAnalysis: new AdbProvider({
          environment: { REA_ADB_PATH: binary },
        }),
      },
    );
    onTestFinished(() => server.close());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "adb-start-boundary", version: "0.0.0" });
    onTestFinished(() => client.close());
    await client.connect(clientTransport);

    const input =
      operation === "start_adb_app"
        ? { serial: "emulator-5554", package: "com.example" }
        : {
            serial: "emulator-5554",
            action: "android.intent.action.MAIN",
            data_uri: "https://example.invalid/launch",
            component: "com.example/.Main",
            extras: [
              { key: "mode", type: "string" as const, value: "test" },
              { key: "empty", type: "string" as const, value: "" },
              { key: "scale", type: "float" as const, value: "1e-3" },
            ],
          };
    const success = await artifactMcpCall(client, {
      name: operation,
      arguments: input,
    });
    expect(success.isError).not.toBe(true);
    const evidence = toolContract(operation).outputSchema.parse(
      parseEvidence(JSON.parse(responseText(success))),
    );
    expect(evidence.confidence).toBe("observed");
    expect(evidence.normalized_result).toMatchObject({
      started_activity: "act=android.intent.action.MAIN cmp=com.example/.Main",
      reported_activity: "com.example/.Main",
      reported_status: "ok",
    });
    expect(evidence.raw_result).toEqual({ stdout, stderr });

    if (operation === "start_adb_activity")
      await assertAdvertisedActivityExtras(client, input, fakeAdb.calls);

    stdout = `${starting}Status: timeout\nActivity: com.example/.Main\nWaitTime: 10004\nComplete\n`;
    await fakeAdb.setReport(stdout, stderr);
    const timeout = await artifactMcpCall(client, {
      name: operation,
      arguments: input,
    });
    expect(timeout.isError).toBe(true);
    const timeoutError = analysisErrorProjectionSchema.parse(
      JSON.parse(responseText(timeout)).error,
    );
    expect(timeoutError).toMatchObject({
      code: "unsupported_target",
      details: {
        path: "emulator-5554",
        reason: "am start reported status: timeout",
        captured_output: { stdout, stderr, truncated: false },
        partial_observation: {
          provider_id: "adb",
          operation,
          result: {
            started_activity:
              "act=android.intent.action.MAIN cmp=com.example/.Main",
            reported_activity: "com.example/.Main",
            reported_status: "timeout",
          },
        },
      },
    });
    expect(timeoutError).not.toHaveProperty("timeout_ms");

    stdout = `${starting}Status: ok\nActivity: com.example/.Main\nComplete\n`;
    stderr = "Exception: Activity class does not exist\n";
    await fakeAdb.setReport(stdout, stderr);
    const hardError = await artifactMcpCall(client, {
      name: operation,
      arguments: input,
    });
    expect(hardError.isError).toBe(true);
    const hardErrorProjection = analysisErrorProjectionSchema.parse(
      JSON.parse(responseText(hardError)).error,
    );
    expect(hardErrorProjection.message).toContain(
      "Activity class does not exist",
    );
    expect(hardErrorProjection.details).toMatchObject({
      captured_output: { stdout, stderr, truncated: false },
      partial_observation: {
        operation,
        result: { reported_status: "ok" },
      },
    });

    const calls = await fakeAdb.calls();
    expect(
      calls.filter((arguments_) => arguments_.includes("start -W")),
    ).toEqual(
      Array.from({ length: 3 }, () =>
        [
          "-s emulator-5554 shell am start -W",
          ...(operation === "start_adb_app"
            ? ["-n com.example/.Main"]
            : [
                "-a android.intent.action.MAIN",
                "-d https://example.invalid/launch",
                "-n com.example/.Main",
                "--es mode test",
                "--es empty ''",
                "--ef scale 1e-3",
              ]),
        ].join(" "),
      ),
    );
  },
);

it.skipIf(process.platform === "win32")(
  "retains nonzero Activity Manager refusals and leaves transport failures distinct through MCP",
  async () => {
    const fakeAdb = await createFakeAdb();
    const stdout =
      "Starting: Intent { act=android.intent.action.MAIN cmp=com.example/.Outer$InnerActivity }\n" +
      "Error type 3\n" +
      "Error: Activity class {com.example/com.example.Outer$InnerActivity} does not exist.\n";
    await fakeAdb.setReport(stdout, "", 1);

    const server = createServer(
      {
        kind: "session",
        session: createTestBinarySession(() => {
          throw new Error("ADB start must not open a deep-analysis provider");
        }),
      },
      {
        adbDeviceAnalysis: new AdbProvider({
          environment: { REA_ADB_PATH: fakeAdb.binary },
        }),
      },
    );
    onTestFinished(() => server.close());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({
      name: "adb-start-refusal-mcp",
      version: "0.0.0",
    });
    onTestFinished(() => client.close());
    await client.connect(clientTransport);

    const input = {
      serial: "emulator-5554",
      action: "android.intent.action.MAIN",
      component: "com.example/.Outer$InnerActivity",
    };
    const advertised = (await client.listTools()).tools.find(
      ({ name }) => name === "start_adb_activity",
    );
    if (advertised === undefined) throw new Error("Missing ADB activity tool");
    const validateInput = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(advertised.inputSchema);
    expect(validateInput(input)).toBe(true);
    const refused = await artifactMcpCall(client, {
      name: "start_adb_activity",
      arguments: input,
    });
    expect(refused.isError).toBe(true);
    const refusal = analysisErrorProjectionSchema.parse(
      JSON.parse(responseText(refused)).error,
    );
    expect(refusal).toMatchObject({
      code: "unsupported_target",
      details: {
        path: "emulator-5554",
        reason:
          "Activity class {com.example/com.example.Outer$InnerActivity} does not exist.",
        captured_output: { stdout, stderr: "", exit_code: 1, truncated: false },
        partial_observation: {
          provider_id: "adb",
          operation: "start_adb_activity",
          result: {
            component: input.component,
            started_activity:
              "act=android.intent.action.MAIN cmp=com.example/.Outer$InnerActivity",
          },
        },
      },
    });

    const transportStdout =
      "Starting: Intent { act=android.intent.action.MAIN cmp=com.example/.Outer$InnerActivity }\n";
    const transportStderr = "error: device offline\n";
    await fakeAdb.setReport(transportStdout, transportStderr, 1);
    const transport = await artifactMcpCall(client, {
      name: "start_adb_activity",
      arguments: input,
    });
    expect(transport.isError).toBe(true);
    const transportError = analysisErrorProjectionSchema.parse(
      JSON.parse(responseText(transport)).error,
    );
    expect(transportError).toMatchObject({
      code: "unsupported_target",
      details: { path: "emulator-5554", reason: "error: device offline" },
    });
    expect(transportError.details).not.toHaveProperty("partial_observation");

    const incompleteStdout =
      "Starting: Intent { act=android.intent.action.MAIN cmp=com.example/.Outer$InnerActivity }\n";
    const incompleteStderr = "transport disconnected by peer\n";
    await fakeAdb.setReport(incompleteStdout, incompleteStderr, 1);
    const incomplete = await artifactMcpCall(client, {
      name: "start_adb_activity",
      arguments: input,
    });
    expect(incomplete.isError).toBe(true);
    const incompleteError = analysisErrorProjectionSchema.parse(
      JSON.parse(responseText(incomplete)).error,
    );
    expect(incompleteError).toMatchObject({
      code: "unreadable_output",
      details: {
        captured_output: {
          stdout: incompleteStdout,
          stderr: incompleteStderr,
          exit_code: 1,
          truncated: false,
        },
      },
    });
    expect(incompleteError.details).not.toHaveProperty("partial_observation");

    const stderrOnly =
      "Error: Activity class {com.example/com.example.Outer$InnerActivity} does not exist.\n";
    await fakeAdb.setReport("", stderrOnly, 1);
    const stderrOnlyFailure = await artifactMcpCall(client, {
      name: "start_adb_activity",
      arguments: input,
    });
    expect(stderrOnlyFailure.isError).toBe(true);
    const stderrOnlyError = analysisErrorProjectionSchema.parse(
      JSON.parse(responseText(stderrOnlyFailure)).error,
    );
    expect(stderrOnlyError).toMatchObject({
      code: "unreadable_output",
      details: {
        captured_output: {
          stdout: "",
          stderr: stderrOnly,
          exit_code: 1,
          truncated: false,
        },
      },
    });
    expect(stderrOnlyError.details).not.toHaveProperty("partial_observation");

    const oversizedReport =
      "Starting: Intent { act=android.intent.action.MAIN cmp=com.example/.Outer$InnerActivity }\n" +
      "Error: " +
      "x".repeat(70 * 1024);
    await fakeAdb.setReport(oversizedReport, "", 1);
    const truncated = await artifactMcpCall(client, {
      name: "start_adb_activity",
      arguments: input,
    });
    expect(truncated.isError).toBe(true);
    const truncatedError = analysisErrorProjectionSchema.parse(
      JSON.parse(responseText(truncated)).error,
    );
    expect(truncatedError.code).toBe("resource_constraint");
    expect(truncatedError.details).not.toHaveProperty("partial_observation");
  },
);
