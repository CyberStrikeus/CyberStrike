import { channel } from "node:diagnostics_channel";
import { readFile, writeFile } from "node:fs/promises";
import { IncomingMessage, request, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { startJebMcpFixture } from "../../fixtures/jebMcp.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const physicalRequestSchema = z.object({
  request: z.instanceof(IncomingMessage),
  response: z.instanceof(ServerResponse),
  server: z.instanceof(Server),
});
const observeRequest = (port: number) => {
  const observed = createDeferred<z.infer<typeof physicalRequestSchema>>();
  const diagnostic = channel("http.server.request.start");
  const observer = (message: unknown) => {
    const parsed = physicalRequestSchema.safeParse(message);
    if (parsed.success && parsed.data.request.socket.localPort === port)
      observed.resolve(parsed.data);
  };
  diagnostic.subscribe(observer);
  return {
    promise: observed.promise,
    close: () => diagnostic.unsubscribe(observer),
  };
};
const closed = (emitter: NodeJS.EventEmitter): Promise<void> =>
  new Promise((resolve) => emitter.once("close", () => resolve()));
const bounded = async <Value>(operation: Promise<Value>): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("JEB fixture lifecycle barrier was not reached")),
          2_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

for (const scenario of ["tool", "catalog", "late-render-failure"] as const) {
  it(`JEB fixture close joins admitted ${scenario} work after transport disconnect`, async () => {
    const root = await createTestTempDirectory("rea-jeb-fixture-close-");
    const artifact = join(root, "completed callback.txt");
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const finished = createDeferred<void>();
    let admitted = false;
    let callbackFinished = false;
    const complete = async () => {
      admitted = true;
      entered.resolve();
      try {
        await release.promise;
        await writeFile(artifact, "admitted JEB callback completed");
        return { success: true };
      } finally {
        callbackFinished = true;
        finished.resolve();
      }
    };
    const fixture = await startJebMcpFixture(
      complete,
      scenario === "catalog" ? complete : undefined,
    );
    const observed = observeRequest(Number(new URL(fixture.endpoint).port));
    const client = request(fixture.endpoint, { method: "POST", agent: false });
    const clientClosed = createDeferred<void>();
    client.on("error", () => {});
    client.once("socket", (socket) =>
      socket.once("close", () => clientClosed.resolve()),
    );
    const renderFailure = new Error("authored response rendering failed");
    let restoreRender: (() => void) | undefined;
    const settle = (operation: Promise<void>) =>
      operation.then(
        () => ({ ok: true as const }),
        (cause: unknown) => ({ ok: false as const, cause }),
      );
    let closing: ReturnType<typeof settle> | undefined;
    try {
      client.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: scenario === "catalog" ? "tools/list" : "tools/call",
          params: { name: "get_client_information" },
        }),
      );
      await bounded(entered.promise);
      const physical = await bounded(observed.promise);
      if (scenario === "late-render-failure") {
        const fault = vi
          .spyOn(physical.response, "writeHead")
          .mockImplementation(() => {
            throw renderFailure;
          });
        restoreRender = () => fault.mockRestore();
      }
      const responseClosed = closed(physical.response);
      const socketClosed = closed(physical.request.socket);
      client.destroy();
      await bounded(
        Promise.all([clientClosed.promise, responseClosed, socketClosed]),
      );
      const transportClosed = closed(physical.server).then(async () => {
        await setImmediate();
        return { kind: "transport-closed" };
      });
      closing = settle(fixture.close());
      const first = await bounded(Promise.race([closing, transportClosed]));
      expect(first).toEqual({ kind: "transport-closed" });
      expect(physical.server.listening).toBe(false);
      expect(callbackFinished).toBe(false);
      release.resolve();
      const outcome = await bounded(closing);
      if (scenario === "late-render-failure") {
        if (outcome.ok)
          throw new Error("Escaping response failure was discarded");
        if (!(outcome.cause instanceof AggregateError)) throw outcome.cause;
        expect(outcome.cause.errors).toHaveLength(1);
        expect(outcome.cause.errors[0]).toBe(renderFailure);
      } else expect(outcome).toEqual({ ok: true });
      expect(callbackFinished).toBe(true);
      expect(await readFile(artifact, "utf8")).toBe(
        "admitted JEB callback completed",
      );
    } finally {
      release.resolve();
      client.destroy();
      observed.close();
      try {
        if (admitted) await bounded(finished.promise);
        await bounded(closing ?? settle(fixture.close()));
      } finally {
        restoreRender?.();
      }
    }
  });
}

it("JEB fixture preserves intentionally handled 500 replies and ordinary callback completion", async () => {
  const refusal = new Error("intentional protocol refusal");
  const fixture = await startJebMcpFixture((tool) => {
    if (tool === "refuse") throw refusal;
    return { success: true, selected: tool };
  });
  try {
    const send = (name: string) =>
      fetch(fixture.endpoint, {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name },
        }),
        signal: AbortSignal.timeout(2_000),
      });
    const ordinary = await send("ordinary");
    expect(ordinary.status).toBe(200);
    expect(await ordinary.json()).toMatchObject({
      result: { structuredContent: { success: true, selected: "ordinary" } },
    });
    const refused = await send("refuse");
    expect(refused.status).toBe(500);
    expect(await refused.text()).toBe(String(refusal));
    expect(fixture.calls).toEqual(["ordinary", "refuse"]);
  } finally {
    await fixture.close();
  }
});
