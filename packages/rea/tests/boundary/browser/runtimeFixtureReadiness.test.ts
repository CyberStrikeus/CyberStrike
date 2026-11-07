import { ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";

const mock = vi.hoisted(() => ({ spawn: vi.fn(), port: vi.fn() }));
vi.mock("../../../dist/process/ProviderProcess.js", () => ({
  spawnOwnedProviderProcess: mock.spawn,
  ProviderProcessSupervisor: class {
    constructor(
      readonly launch: {
        process: ChildProcess;
        cleanup: () => Promise<unknown>;
      },
    ) {}
    snapshot() {
      return { stderr: { text: "" } };
    }
    async stop() {
      await this.launch.cleanup();
      return { status: "complete" };
    }
  },
}));
vi.mock("../../../dist/process/ProcessOwnershipObservation.js", () => ({
  createSystemProcessOwnershipHost: () => ({ listProcesses: async () => [] }),
}));
vi.mock("../../../scripts/lib/verifier-source-loader.mjs", () => ({
  importVerifierSource: async () => ({
    BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS: 60_000,
    waitForBrowserDevtoolsPort: mock.port,
  }),
}));
afterEach(() => vi.restoreAllMocks());

interface FixtureLease {
  readonly port: number;
  close(): Promise<void>;
}
type StartFixture = (
  executable: string,
  origin: string,
) => Promise<FixtureLease>;

const startFixture = async (): Promise<StartFixture> =>
  z
    .object({
      startRuntimeFixtureBrowser: z.custom<StartFixture>(
        (value) => typeof value === "function",
      ),
    })
    .parse(
      await import(
        new URL(
          "../../../scripts/lib/browser-runtime-fixture-lifecycle.mjs",
          import.meta.url,
        ).href
      ),
    ).startRuntimeFixtureBrowser;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const fixture = async (
  mode: "empty targets" | "discovery timeout" | "malformed" | "exited",
) => {
  let ready = false;
  let requests = 0;
  const listed = deferred();
  const published = deferred();
  const server = createServer((request, response) => {
    requests += 1;
    if (mode === "exited") {
      listed.resolve();
      return;
    }
    if (mode === "malformed") {
      response.end("{broken");
      return;
    }
    if (mode === "discovery timeout" && requests === 1) {
      response.once("close", () => {
        ready = true;
      });
      return;
    }
    response.end(
      JSON.stringify(
        request.url === "/json/version"
          ? {
              Browser: "FixtureChrome/1",
              "Protocol-Version": "1.3",
              "User-Agent": "FixtureChrome",
              "V8-Version": "1",
              "WebKit-Version": "1",
              webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fixture`,
            }
          : ready
            ? [{ id: "fixture", type: "page", title: "fixture", url: origin }]
            : [],
      ),
    );
    if (request.url === "/json/list") listed.resolve();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing fixture address");
  const port = address.port;
  const origin = `http://127.0.0.1:${port}`;
  const child = new ChildProcess();
  let signalCode: NodeJS.Signals | null = null;
  Object.defineProperty(child, "signalCode", { get: () => signalCode });
  vi.spyOn(child, "kill").mockImplementation(() => {
    signalCode = "SIGTERM";
    child.emit("exit", null, "SIGTERM");
    return true;
  });
  const cleanup = vi.fn(async () => ({ cleaned: true }));
  mock.spawn.mockResolvedValue({
    process: child,
    ownership: { processGroupId: 7 },
    cleanup,
  });
  mock.port.mockImplementation(async () => {
    published.resolve();
    return port;
  });
  return {
    origin,
    listed: listed.promise,
    published: published.promise,
    cleanup,
    exit: () => child.kill("SIGTERM"),
    makeReady: () => {
      ready = true;
    },
    requests: () => requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

it.each(["empty targets", "discovery timeout"] as const)(
  "does not hand out the owned fixture while CDP has %s",
  async (mode) => {
    const start = await startFixture();
    const server = await fixture(mode);
    const pending = start(process.execPath, server.origin);
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      await awaitAcknowledgement(
        server.published,
        pending,
        "fixture port publication",
      );
      await setImmediate();
      expect(settled).toBe(false);
      if (mode === "empty targets") {
        await awaitAcknowledgement(
          server.listed,
          pending,
          "fixture target listing",
        );
        expect(settled).toBe(false);
        server.makeReady();
      }
      await pending;
      expect(server.requests()).toBeGreaterThanOrEqual(3);
    } finally {
      server.makeReady();
      await (await pending.catch(() => undefined))?.close();
      await server.close();
    }
  },
);

it("preserves malformed discovery and closes the owned fixture", async () => {
  const start = await startFixture();
  const server = await fixture("malformed");
  const pending = start(process.execPath, server.origin);
  try {
    await expect(pending).rejects.toMatchObject({
      reason: "invalid_endpoint_response",
    });
    expect(server.requests()).toBe(1);
    expect(server.cleanup).toHaveBeenCalledTimes(1);
  } finally {
    await (await pending.catch(() => undefined))?.close();
    await server.close();
  }
});

it("interrupts pending discovery when the owned fixture exits", async () => {
  const start = await startFixture();
  const server = await fixture("exited");
  const pending = start(process.execPath, server.origin);
  const rejected = expect(pending).rejects.toThrow(
    "exited before CDP discovery",
  );
  try {
    await awaitAcknowledgement(
      server.listed,
      pending,
      "fixture target listing",
    );
    server.exit();
    await rejected;
    expect(server.cleanup).toHaveBeenCalledTimes(1);
  } finally {
    await (await pending.catch(() => undefined))?.close();
    await server.close();
  }
});
