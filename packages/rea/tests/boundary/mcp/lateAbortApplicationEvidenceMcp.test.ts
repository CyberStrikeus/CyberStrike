import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished, vi } from "vitest";
import {
  createTestBinarySession,
  createDeferred,
} from "../../fixtures/binarySession.js";
import { GoBinaryService } from "../../../src/application/go/GoBinaryService.js";
import type { GoBinary } from "../../../src/domain/go/goBinary.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { ok } from "../../../src/domain/result.js";
import type { JavaScriptRuntimeObservationPort } from "../../../src/application/javascript/JavaScriptRuntimeObservationPort.js";
import type { BrowserObservationPort } from "../../../src/application/BrowserObservationPort.js";
import type { BrowserTargetList } from "../../../src/domain/browserObservationSchemas.js";
import type { JavaScriptRuntimeTargetList } from "../../../src/domain/javascript/javascriptRuntimeObservation.js";

it("retains late-cancelled Go artifact Evidence through MCP and keeps the server usable", async () => {
  const gate = createDeferred<void>();
  const started = createDeferred<void>();
  const controller = new AbortController();
  const report: GoBinary = {
    artifact: { path: "/artifacts/example", sha256: "a".repeat(64), bytes: 10 },
    format: "elf",
    architecture: "amd64",
    bits: 64,
    byte_order: "little",
    build_info: null,
    limitations: [],
  };
  const session = createTestBinarySession(() => {
    throw new Error("unexpected binary admission");
  });
  const service = new GoBinaryService({
    close: async () => {},
    identity: { id: "fixture", name: "fixture", version: "1" },
    inspect: async (_input, options) => {
      started.resolve();
      await gate.promise;
      if (!options?.signal) throw new Error("MCP did not forward its signal");
      return ok(report);
    },
  });
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger, goBinary: service },
  );
  const client = new Client({ name: "late-abort-artifact", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    gate.resolve();
    controller.abort();
    await client.close();
    await server.close();
    await session.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = client.callTool(
    { name: "inspect_go_binary", arguments: { path: report.artifact.path } },
    { signal: controller.signal },
  );
  await started.promise;
  controller.abort();
  gate.resolve();
  await expect(call).rejects.toThrow();
  await vi.waitFor(() => {
    expect(session.exportEvidenceBundle().records).toContainEqual(
      expect.objectContaining({
        operation: "inspect_go_binary",
        normalized_result: report,
      }),
    );
  });
  await expect(client.ping()).resolves.toEqual({});
});

it("retains late-cancelled Inspector target Evidence through MCP and keeps the server usable", async () => {
  const gate = createDeferred<void>();
  const started = createDeferred<void>();
  const controller = new AbortController();
  const targetList: JavaScriptRuntimeTargetList = {
    runtime: { product: "Node.js", protocol_version: "1.0", v8_version: null },
    targets: [],
    excluded: { unsupported_location: 0, unconnectable: 0 },
    limitations: [],
  };
  const provider: JavaScriptRuntimeObservationPort = {
    identity: () => ({
      id: "fixture-inspector",
      name: "fixture",
      version: "1",
    }),
    listTargets: async (_input, options) => {
      started.resolve();
      await gate.promise;
      if (!options?.signal) throw new Error("MCP did not forward its signal");
      return ok(targetList);
    },
    observe: async () => {
      throw new Error("Unexpected observe call");
    },
  };
  const session = createTestBinarySession(() => {
    throw new Error("unexpected binary admission");
  });
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger, javascriptRuntimeObservation: provider },
  );
  const client = new Client({ name: "late-abort-inspector", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    gate.resolve();
    controller.abort();
    await client.close();
    await server.close();
    await session.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = client.callTool(
    {
      name: "list_javascript_runtime_targets",
      arguments: { inspector_endpoint: "http://127.0.0.1:9222" },
    },
    { signal: controller.signal },
  );
  await started.promise;
  controller.abort();
  gate.resolve();
  await expect(call).rejects.toThrow();
  await vi.waitFor(() => {
    expect(session.exportEvidenceBundle().records).toContainEqual(
      expect.objectContaining({
        operation: "list_javascript_runtime_targets",
        normalized_result: targetList,
      }),
    );
  });
  await expect(client.ping()).resolves.toEqual({});
});

it("records late-cancelled Browser target Evidence and keeps the server usable", async () => {
  const gate = createDeferred<void>();
  const started = createDeferred<void>();
  const controller = new AbortController();
  const targetList: BrowserTargetList = {
    browser: {
      product: "Chromium",
      protocol_version: "1.3",
      revision: "fixture",
      user_agent: "fixture",
      js_version: "fixture",
    },
    targets: [],
    excluded: { disallowed_origin: 0, unsupported_url: 0, non_page: 0 },
    limitations: [],
  };
  const browser: BrowserObservationPort = {
    identity: () => ({ id: "fixture-browser", name: "fixture", version: "1" }),
    listTargets: async (_input, options) => {
      started.resolve();
      await gate.promise;
      if (!options?.signal) throw new Error("MCP did not forward its signal");
      return ok(targetList);
    },
    inspectPage: async () => {
      throw new Error("Unexpected inspect call");
    },
    analyzeBundle: async () => {
      throw new Error("Unexpected bundle call");
    },
    observeSession: async () => {
      throw new Error("Unexpected session call");
    },
    discoverWebMcpTools: async () => {
      throw new Error("Unexpected discovery call");
    },
    compareCaptures: async () => {
      throw new Error("Unexpected comparison call");
    },
    captureScreenshot: async () => {
      throw new Error("Unexpected screenshot call");
    },
    compareScreenshots: async () => {
      throw new Error("Unexpected diff call");
    },
  };
  const session = createTestBinarySession(() => {
    throw new Error("unexpected binary admission");
  });
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger, browserObservation: browser },
  );
  const client = new Client({ name: "late-abort-browser", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    gate.resolve();
    controller.abort();
    await client.close();
    await server.close();
    await session.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = client.callTool(
    {
      name: "list_browser_targets",
      arguments: { cdp_endpoint: "http://127.0.0.1:9222", allowed_origins: [] },
    },
    { signal: controller.signal },
  );
  await started.promise;
  controller.abort();
  gate.resolve();
  await expect(call).rejects.toThrow();
  await vi.waitFor(() => {
    expect(session.exportEvidenceBundle().records).toContainEqual(
      expect.objectContaining({
        operation: "list_browser_targets",
        normalized_result: targetList,
      }),
    );
  });
  await expect(client.ping()).resolves.toEqual({});
});
