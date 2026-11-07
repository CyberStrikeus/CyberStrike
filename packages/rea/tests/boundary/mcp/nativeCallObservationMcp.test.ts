import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { z } from "zod";

import { nativeCallObservationResultSchema } from "../../../src/domain/native/nativeCallObservation.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { nativeCallPartialObservationSchema } from "../../../src/domain/native/nativeCallPartialObservation.js";
import { err, ok } from "../../../src/domain/result.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import type { NativeCallTracer } from "../../../src/native/LldbCallTracer.js";
import { NativeMacOSProvider } from "../../../src/native/NativeMacOSProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { NativeFixtureRunner } from "../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

/** A thin little-endian arm64 MH_EXECUTE header with no load commands. */
const machoHeader = (): Buffer => {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(2, 12);
  return header;
};

const tracer: NativeCallTracer & { calls: number } = {
  calls: 0,
  trace(request) {
    this.calls++;
    expect(request.input.environment).toEqual(
      JSON.parse(
        '{"__proto__":"selected literal value","constructor":"ordinary value"}',
      ),
    );
    expect(Object.hasOwn(request.input.environment, "__proto__")).toBe(true);
    return Promise.resolve(
      ok({
        debugger: {
          path: "/usr/bin/lldb",
          sha256: "b".repeat(64),
          version: "lldb-fixture",
        },
        run: {
          status: "traced",
          version: "lldb-fixture",
          pid: 99,
          outcome: "exited",
          exit_status: 0,
          exit_description: null,
          killed: false,
          terminated: true,
          target_identity: {
            loaded_image_sha256: null,
            selected_file_sha256: request.expectedSha256,
            file_device: "1",
            file_inode: "2",
            module_path: request.executable,
            module_uuid: "fixture-uuid",
            stable: true,
          },
          elapsed_ms: 1,
          breakpoints: request.input.breakpoints.map((_, index) => ({
            index,
            location_count: 1,
            locations: [],
          })),
          events: [],
          resource_limit_reached: false,
          target_output: {
            stdout_bytes: 0,
            stderr_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            stdout_complete: true,
            stderr_complete: true,
          },
          other_stops: [],
        },
        stdout: { text: "", bytes: 0, truncated: false, complete: true },
        stderr: { text: "", bytes: 0, truncated: false, complete: true },
        terminated: true,
      }),
    );
  },
  close: () => Promise.resolve(ok(null)),
};

it("routes observe_native_calls through MCP with schema-checked input and output", async () => {
  const directory = await createTestTempDirectory("rea-native-calls-mcp-");
  const path = join(directory, "Tool");
  await writeFile(path, machoHeader());
  const session = createTestBinarySession(
    new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
      () => tracer,
    ),
  );
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "native-calls-mcp-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const called = await client.callTool({
      name: "observe_native_calls",
      arguments: {
        breakpoints: [{ kind: "function", name: "open" }],
        duration_ms: 1000,
        environment: JSON.parse(
          '{"__proto__":"selected literal value","constructor":"ordinary value"}',
        ),
      },
    });
    expect(called.isError, JSON.stringify(called.structuredContent)).not.toBe(
      true,
    );
    const result = nativeCallObservationResultSchema.parse(
      z
        .object({ normalized_result: z.unknown() })
        .parse(called.structuredContent).normalized_result,
    );
    expect(result.process).toMatchObject({ pid: 99, outcome: "exited" });
    expect(result.target.environment).toEqual(
      JSON.parse(
        '{"__proto__":"selected literal value","constructor":"ordinary value"}',
      ),
    );
    expect(Object.hasOwn(result.target.environment, "__proto__")).toBe(true);
    expect(result.breakpoints[0]?.request).toEqual({
      kind: "function",
      name: "open",
      module: null,
    });
    const invalidEnvironment = await client.callTool({
      name: "observe_native_calls",
      arguments: {
        breakpoints: [{ kind: "function", name: "open" }],
        environment: JSON.parse('{"__proto__":7}'),
      },
    });
    expect(parseMcpToolError(invalidEnvironment).error).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          expect.objectContaining({
            path: ["environment", "__proto__"],
            reason: "invalid_type",
            expected: "string",
          }),
        ],
      },
    });
    const rejected = await client.callTool({
      name: "observe_native_calls",
      arguments: {
        breakpoints: [{ kind: "function", name: "open" }],
        duration_ms: 1,
      },
    });
    expect(rejected.isError).toBe(true);
    expect(tracer.calls).toBe(1);
  } finally {
    await client.close();
    await server.close();
  }
});

const partialObservationFor = (options: {
  readonly path: string;
  readonly sha256: string;
  readonly arguments: string[];
  readonly environment: Record<string, string>;
  readonly workingDirectory: string;
  readonly reason: "cancelled" | "cleanup-failure";
}) =>
  nativeCallPartialObservationSchema.parse({
    kind: "native-call-observation",
    target: {
      path: options.path,
      sha256: options.sha256,
      architecture: "arm64",
      arguments: options.arguments,
      environment: options.environment,
      working_directory: options.workingDirectory,
    },
    process: {
      pid: 4242,
      stdout: {
        text: "partial target output",
        bytes: 21,
        truncated: true,
        complete: false,
      },
      stderr: {
        text: "debugger diagnostic",
        bytes: 19,
        truncated: false,
        complete: false,
      },
      other_stops: ["signal SIGSTOP"],
    },
    debugger: { version: "lldb-fixture" },
    events: [
      {
        sequence: 0,
        elapsed_ms: 4,
        thread_id: 3,
        breakpoint_index: 0,
        load_address: "0x1000",
        file_address: "0x1000",
        module: "Tool",
        module_path: options.path,
        symbol: "open",
        receiver_class: null,
        selector: null,
        registers: [{ name: "x0", value: "0x2" }],
        backtrace: [],
      },
    ],
    coverage: { status: "partial", reason: options.reason },
    limitations: ["Observation ended before the requested window completed."],
  });

it.each([
  ["cancelled", "cancelled", undefined],
  [
    "tracer failure with cleanup uncertainty",
    "cleanup_incomplete",
    {
      reason: "target process termination could not be verified",
      resources: ["native-target:4242"],
    },
  ],
] as const)(
  "preserves typed native partial observations over MCP after %s",
  async (_label, expectedCode, cleanup) => {
    const directory = await createTestTempDirectory(
      "rea-native-calls-partial-mcp-",
    );
    const path = join(directory, "Tool");
    const selectedBytes = machoHeader();
    const sha256 = createHash("sha256").update(selectedBytes).digest("hex");
    await writeFile(path, selectedBytes);
    const launchArguments = ["--fixture", "selected argument"];
    const launchEnvironment = { REA_NATIVE_FIXTURE: "selected value" };
    const workingDirectory = directory;
    const partialObservation = partialObservationFor({
      path,
      sha256,
      arguments: launchArguments,
      environment: launchEnvironment,
      workingDirectory,
      reason: cleanup === undefined ? "cancelled" : "cleanup-failure",
    });
    const tracer: NativeCallTracer = {
      close: () => Promise.resolve(ok(null)),
      trace: () =>
        Promise.resolve(
          err(
            cleanup === undefined
              ? new AnalysisCancelledError("observe_native_calls", {
                  partialObservation,
                })
              : new ProviderAdapterError(
                  "native-macos",
                  "observe_native_calls",
                  {
                    cleanup,
                    partialObservation,
                  },
                ),
          ),
        ),
    };
    const session = createTestBinarySession(
      new NativeMacOSProvider(
        {},
        new NativeFixtureRunner(),
        "darwin",
        () => tracer,
      ),
    );
    const server = createServer({ kind: "session", session });
    const client = new Client({
      name: "native-calls-partial-mcp-test",
      version: "1",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path },
      });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);

      const called = await client.callTool({
        name: "observe_native_calls",
        arguments: {
          breakpoints: [{ kind: "function", name: "open" }],
          arguments: launchArguments,
          environment: launchEnvironment,
          working_directory: workingDirectory,
          duration_ms: 1000,
        },
      });

      expect(called.isError).toBe(true);
      expect(parseMcpToolError(called)).toMatchObject({
        error: {
          code: expectedCode,
          details: {
            ...(cleanup === undefined
              ? { cleanup: "complete" }
              : {
                  execution_failure: "execution_failure",
                  cleanup: "incomplete",
                  cleanup_reason: cleanup.reason,
                }),
            partial_observation: {
              kind: "native-call-observation",
              target: {
                path,
                sha256,
                architecture: "arm64",
                arguments: launchArguments,
                environment: launchEnvironment,
                working_directory: workingDirectory,
              },
              debugger: { version: "lldb-fixture" },
              process: {
                pid: 4242,
                stdout: {
                  text: "partial target output",
                  bytes: 21,
                  truncated: true,
                  complete: false,
                },
              },
              events: [{ sequence: 0, symbol: "open" }],
            },
          },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  },
);
