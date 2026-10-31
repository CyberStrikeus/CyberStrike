import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished, vi } from "vitest";

import { AnalysisCleanupLease } from "../../../src/artifacts/AnalysisCleanupLease.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import * as runtimes from "../../../src/native/NativeUiHelperRuntime.js";
import { NativeMacOSProvider } from "../../../src/native/NativeMacOSProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { NativeFixtureRunner } from "../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const scope = {
  pid: 123,
  window_id: 456,
  screenshot: false,
  accessibility: true,
};
const connectNativeUi = async () => {
  const directory = await createTestTempDirectory("rea-native-ui-facts-");
  const path = join(directory, "Inert.macho");
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(2, 12);
  await writeFile(path, header);
  const replies: unknown[] = [];
  const factory = vi
    .spyOn(runtimes, "createNativeUiHelperRuntime")
    .mockImplementation(() => {
      const cleanupLease = new AnalysisCleanupLease(async () => {});
      return {
        signal: new AbortController().signal,
        cleanupLease,
        invoke: async () => {
          if (replies.length === 0)
            throw new Error("Missing fixture helper reply");
          return replies.shift();
        },
        close: () => cleanupLease.release(),
        resources: () => [],
      };
    });
  const session = createTestBinarySession(
    new NativeMacOSProvider({}, new NativeFixtureRunner(), "darwin"),
  );
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "native-ui-facts", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    factory.mockRestore();
    try {
      await client.close();
    } finally {
      await server.close();
      await session.close();
    }
  });
  await server.connect(st);
  await client.connect(ct);
  expect(
    (await client.callTool({ name: "open_binary", arguments: { path } }))
      .isError,
  ).not.toBe(true);
  const snapshot = (values: (string | number | boolean | null)[]) => ({
    ok: true,
    result: {
      window: {
        pid: 123,
        window_id: 456,
        executable: path,
        launch_time: 1,
        title: "Fixture",
      },
      nodes: values.map((value, index) => ({
        path: [index],
        role: "AXSlider",
        title: null,
        value,
        actions: [],
        children_count: 0,
      })),
      screenshot: null,
      gaps: [],
      truncated: false,
    },
  });
  return { client, replies, snapshot };
};

it("preserves scalar accessibility values in passive and scenario Evidence", async () => {
  const { client, replies, snapshot } = await connectNativeUi();
  replies.push(snapshot([0.25, true, "selected", null]));
  const passive = await client.callTool({
    name: "observe_native_ui",
    arguments: scope,
  });
  expect(passive.isError).not.toBe(true);
  expect(
    parseEvidence(passive.structuredContent).normalized_result,
  ).toMatchObject({
    initial: {
      nodes: [
        { value: 0.25 },
        { value: true },
        { value: "selected" },
        { value: null },
      ],
    },
  });
  replies.push(snapshot([0.25, false]), snapshot([0.75, true]));
  const scenario = await client.callTool({
    name: "capture_native_ui_scenario",
    arguments: { ...scope, steps: [{ kind: "wait", milliseconds: 0 }] },
  });
  expect(scenario.isError).not.toBe(true);
  expect(
    parseEvidence(scenario.structuredContent).normalized_result,
  ).toMatchObject({
    initial: { nodes: [{ value: 0.25 }, { value: false }] },
    steps: [
      {
        before: { nodes: [{ value: 0.25 }, { value: false }] },
        after: { nodes: [{ value: 0.75 }, { value: true }] },
        outcome: "completed",
      },
    ],
  });
});

it("keeps native UI availability after initial selection errors and preserves later failures", async () => {
  const { client, replies, snapshot } = await connectNativeUi();
  for (const [code, field] of [
    ["pid-not-application", "pid"],
    ["target-mismatch", "pid"],
    ["window-mismatch", "window_id"],
  ] as const)
    for (const tool of [
      "observe_native_ui",
      "capture_native_ui_scenario",
    ] as const) {
      const message = `Fixture ${code} reason`;
      replies.push({ ok: false, code, message });
      const response = await client.callTool({
        name: tool,
        arguments: {
          ...scope,
          ...(tool === "capture_native_ui_scenario"
            ? { steps: [{ kind: "wait", milliseconds: 0 }] }
            : {}),
        },
      });
      expect(parseMcpToolError(response)).toMatchObject({
        error: {
          code: "invalid_request",
          retryable: false,
          message,
          details: {
            issues: [{ path: [field], message: `${code}: ${message}` }],
          },
        },
      });
      const inventory = toolContract("binary_session").outputSchema.parse(
        (await client.callTool({ name: "binary_session", arguments: {} }))
          .structuredContent,
      );
      expect(
        expandToolAvailability(inventory.result.tool_availability).find(
          (entry) => entry.name === tool,
        ),
      ).toMatchObject({ available: true });
    }
  replies.push(snapshot([0.25]));
  expect(
    (await client.callTool({ name: "observe_native_ui", arguments: scope }))
      .isError,
  ).not.toBe(true);
  replies.push(snapshot([0.25]), {
    ok: false,
    code: "window-mismatch",
    message: "Selected window disappeared after initial capture",
  });
  const changed = await client.callTool({
    name: "capture_native_ui_scenario",
    arguments: { ...scope, steps: [{ kind: "wait", milliseconds: 0 }] },
  });
  expect(parseMcpToolError(changed)).toMatchObject({
    error: {
      code: "capability_unavailable",
      message: "Selected window disappeared after initial capture",
      details: {
        partial_observation: {
          initial: { nodes: [{ value: 0.25 }] },
          steps: [{ outcome: "failed" }],
        },
      },
    },
  });
  replies.push({
    ok: false,
    code: "accessibility-denied",
    message: "Grant Accessibility to the REA host in System Settings",
  });
  const denied = await client.callTool({
    name: "observe_native_ui",
    arguments: scope,
  });
  expect(parseMcpToolError(denied)).toMatchObject({
    error: {
      code: "capability_unavailable",
      message: "Grant Accessibility to the REA host in System Settings",
    },
  });
  await client.ping();
});

it.each(["application-executable-unavailable", "executable-path-unavailable"])(
  "preserves unknown executable identity from %s",
  async (code) => {
    const { client, replies } = await connectNativeUi();
    const message = `Fixture ${code} diagnostic`;
    replies.push({ ok: false, code, message });
    const response = await client.callTool({
      name: "observe_native_ui",
      arguments: scope,
    });
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        code: "capability_unavailable",
        message,
        details: { reason: `${code}: ${message}` },
      },
    });
    await client.ping();
  },
);
