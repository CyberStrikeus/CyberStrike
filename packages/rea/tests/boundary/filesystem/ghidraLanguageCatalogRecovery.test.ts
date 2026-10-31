import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import type { BinaryTarget } from "../../../src/domain/binaryTargetTypes.js";
import { ghidraProfileInstallationHost } from "../../../src/ghidra/GhidraInstallation.fixture.js";
import { GhidraProvider } from "../../../src/ghidra/GhidraProvider.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { nativeAotPeFixture } from "../../fixtures/nativeaotPe.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Fault only the installed x86 language definition; its real descriptor stays
// open while close is refused, and closes for real once the fault clears.
const fault = vi.hoisted(() => ({
  enabled: false,
  deny: false,
  opens: 0,
  closes: 0,
  onClose: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (fault.enabled && String(args[0]).endsWith("/x86.ldefs")) {
        fault.opens++;
        const close = handle.close.bind(handle);
        handle.close = async () => {
          fault.closes++;
          await fault.onClose?.();
          if (fault.deny)
            throw Object.assign(new Error("injected close EIO"), {
              code: "EIO",
            });
          return close();
        };
      }
      return handle;
    },
  };
});

afterEach(() => {
  Object.assign(fault, {
    enabled: false,
    deny: false,
    opens: 0,
    closes: 0,
    onClose: undefined,
  });
});

const fixture = async () => {
  const root = await createTestTempDirectory("rea-ghidra-catalog-close-");
  const languages = join(root, "Ghidra/Processors/x86/data/languages");
  const path = join(root, "fixture.exe");
  await mkdir(languages, { recursive: true });
  await writeFile(
    join(languages, "x86.ldefs"),
    '<language_definitions><language id="x86:LE:64:default"><compiler id="windows"/></language></language_definitions>',
  );
  await writeFile(path, nativeAotPeFixture());
  const config = parseConfig({
    GHIDRA_INSTALL_DIR: root,
    REA_GHIDRA_LANGUAGE_ID: "x86:LE:64:default",
  });
  if (!config.ok) throw config.error;
  const provider = new GhidraProvider(
    config.value,
    silentLogger,
    {},
    ghidraProfileInstallationHost,
    () => {
      throw new Error("unexpected engine startup");
    },
  );
  const registry = new AnalysisProviderRegistry([provider]);
  onTestFinished(async () => {
    fault.deny = false;
    fault.onClose = undefined;
    await registry.closeOwnedResources();
  });
  const target: BinaryTarget = {
    path,
    sha256: "a".repeat(64),
    kind: "executable",
    format: "pe",
    architecture: "x86_64",
    availableArchitectures: ["x86_64"],
    executableRole: "application",
    managed: false,
  };
  return {
    definition: join(languages, "x86.ldefs"),
    path,
    provider,
    registry,
    target,
  };
};

it("retries the retained catalog close on later MCP admission and reopens the same registry", async () => {
  const { definition, path, provider, registry } = await fixture();
  const session = composeBinarySession(registry);
  const server = createServer(
    { kind: "session", session },
    {
      logger: silentLogger,
    },
  );
  const client = new Client({ name: "catalog-close-recovery", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const call = (name: "open_binary" | "close_binary") =>
    client.callTool({
      name,
      arguments: name === "open_binary" ? { path, provider_id: "ghidra" } : {},
    });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect((await call("open_binary")).isError).not.toBe(true);
    expect((await call("close_binary")).isError).not.toBe(true);

    fault.enabled = true;
    fault.deny = true;
    const failed = parseMcpToolError(await call("open_binary"));
    expect(failed.error).toMatchObject({
      code: "cleanup_incomplete",
      details: { cleanup: "incomplete", resources: [definition] },
    });
    expect(provider.hasPendingOwnedResources()).toBe(true);
    expect(registry.hasPendingOwnedResources()).toBe(true);
    expect({ opens: fault.opens, closes: fault.closes }).toEqual({
      opens: 1,
      closes: 1,
    });

    // While the exact owner still refuses close, admission retries it and stays
    // fail-closed without reading the catalog again.
    const refused = parseMcpToolError(await call("open_binary"));
    expect(refused.error).toMatchObject({
      code: "cleanup_incomplete",
      details: { cleanup: "incomplete", resources: [definition] },
    });
    expect({ opens: fault.opens, closes: fault.closes }).toEqual({
      opens: 1,
      closes: 2,
    });
    expect(registry.hasPendingOwnedResources()).toBe(true);

    fault.deny = false;
    expect((await call("open_binary")).isError).not.toBe(true);
    // The retained owner released once, then a fresh catalog read closed cleanly.
    expect({ opens: fault.opens, closes: fault.closes }).toEqual({
      opens: 2,
      closes: 4,
    });
    expect(provider.hasPendingOwnedResources()).toBe(false);
    expect((await call("close_binary")).isError).not.toBe(true);
    expect(registry.hasPendingOwnedResources()).toBe(false);
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});

it.each(["released", "still failing"] as const)(
  "finishes the catalog cleanup retry when admission is cancelled during it (%s)",
  async (outcome) => {
    const { definition, registry, target } = await fixture();
    fault.enabled = true;
    fault.deny = true;
    const first = await registry.select(target, "ghidra");
    if (first.ok) throw new Error("Expected incomplete catalog cleanup");
    expect(first.error.cleanupIncomplete).toBe(true);
    expect(first.error.cleanupResources).toEqual([definition]);

    const entered = createDeferred<undefined>();
    const release = createDeferred<undefined>();
    fault.onClose = async () => {
      entered.resolve(undefined);
      await release.promise;
    };
    const controller = new AbortController();
    const reason = { caller: "cancel during catalog cleanup retry" };
    let settled = false;
    const admission = registry
      .select(target, "ghidra", { signal: controller.signal })
      .finally(() => {
        settled = true;
      });
    await entered.promise;
    controller.abort(reason);
    await Promise.resolve();
    // Cancellation never abandons the in-flight close of the retained owner.
    expect(settled).toBe(false);
    if (outcome === "released") fault.deny = false;
    fault.onClose = undefined;
    release.resolve(undefined);
    const cancelled = await admission;
    if (cancelled.ok) throw new Error("Expected cancelled admission");
    expect(fault.closes).toBe(2);
    expect(fault.opens).toBe(1);

    if (outcome === "released") {
      expect(cancelled.error).toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
        cleanupIncomplete: false,
      });
      expect(first.error.cleanupIncomplete).toBe(false);
      expect(registry.hasPendingOwnedResources()).toBe(false);
    } else {
      expect(cancelled.error.cleanupIncomplete).toBe(true);
      expect(cancelled.error.cleanupResources).toEqual([definition]);
      expect(first.error.cleanupIncomplete).toBe(true);
      expect(registry.hasPendingOwnedResources()).toBe(true);
      fault.deny = false;
    }
    const recovered = await registry.select(target, "ghidra");
    expect(recovered.ok).toBe(true);
    expect(first.error.cleanupIncomplete).toBe(false);
    expect(registry.hasPendingOwnedResources()).toBe(false);
  },
);

it("keeps the caller's reason and the catalog owner when cancellation lands during the final close", async () => {
  const { definition, provider, target } = await fixture();
  const controller = new AbortController();
  const reason = { caller: "cancel during final catalog close" };
  fault.enabled = true;
  fault.deny = true;
  fault.onClose = async () => {
    controller.abort(reason);
  };
  const resolved = await provider.resolveAnalysisProfile(target, {
    signal: controller.signal,
  });
  if (resolved.ok) throw new Error("Expected cancelled catalog read");
  expect(resolved.error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cleanupIncomplete: true,
    cleanupResources: [definition],
  });
  expect(JSON.stringify(resolved.error.cause)).toContain(reason.caller);
  expect(provider.hasPendingOwnedResources()).toBe(true);
  fault.deny = false;
  fault.onClose = undefined;
  expect((await provider.closeOwnedResources()).ok).toBe(true);
  expect(resolved.error.cleanupIncomplete).toBe(false);
  expect(provider.hasPendingOwnedResources()).toBe(false);
});
