import { expect, it, vi } from "vitest";
import { createManagedBinarySession } from "../../../src/composition/binary.js";
import { silentLogger } from "../../../src/logger.js";
import { startMcpTransport } from "../../../src/main/transport.js";
import { createServer } from "../../../src/server/createServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";

it("preserves Android sibling cleanup failures and retries only unfinished owners", async () => {
  const session = createManagedBinarySession();
  const failures = [
    new Error("first Android cleanup"),
    new Error("second Android cleanup"),
  ];
  const closes: ReturnType<typeof vi.spyOn>[] = [];
  let fail = true;
  const transport = await startMcpTransport(
    {
      env: {},
      serve: async (factory) => {
        // The SDK can create a discovery probe followed by replacement servers.
        await factory({ era: "modern" });
        await factory({ era: "legacy" });
        await factory({ era: "modern" });
        return { close: async () => undefined };
      },
      createServer: (source, options) => {
        const provider = options?.androidAnalysis;
        if (provider === undefined)
          throw new Error("Missing owned Android provider");
        const failure = failures[closes.length];
        closes.push(
          vi.spyOn(provider, "close").mockImplementation(async () => {
            if (fail && failure !== undefined) throw failure;
          }),
        );
        return createServer(source, options);
      },
      writeStderr: () => undefined,
      setExitCode: () => undefined,
      registerShutdown: () => () => undefined,
    },
    session,
    {
      logger: silentLogger,
      serverLogger: silentLogger,
      environment: {},
      delivery: createToolResultDelivery(undefined),
      loadOptionalProviders: async () => ({}),
    },
  );
  try {
    expect(transport.ok).toBe(true);
    await expect(transport.closeAndroid()).rejects.toMatchObject({
      name: "AggregateError",
      errors: failures,
    });
    expect(closes.map((close) => close.mock.calls.length)).toEqual([1, 1, 1]);
    // One recovered owner leaves the exact remaining failure available.
    closes[0]?.mockResolvedValue(undefined);
    await expect(transport.closeAndroid()).rejects.toBe(failures[1]);
    expect(closes.map((close) => close.mock.calls.length)).toEqual([2, 2, 1]);
    fail = false;
    await transport.closeAndroid();
    await transport.closeAndroid();
    expect(closes.map((close) => close.mock.calls.length)).toEqual([2, 3, 1]);
  } finally {
    fail = false;
    for (const close of closes) close.mockRestore();
    await transport.handle.close();
    await transport.closeAndroid();
    await transport.closeOptionalProviders();
    await session.close();
  }
});
