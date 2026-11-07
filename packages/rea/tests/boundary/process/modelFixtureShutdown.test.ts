import { channel } from "node:diagnostics_channel";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  IncomingMessage,
  request,
  Server,
  ServerResponse,
  type ClientRequest,
} from "node:http";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { z } from "zod";

import { createOpenAiModelFixture } from "../../../scripts/verify/clients/model-fixture.mjs";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

interface ModelFixture {
  readonly baseUrl: string;
  readonly requests: readonly unknown[];
  readonly failure: string | undefined;
  close(): Promise<void>;
}

type FixtureFactory = (options: {
  readonly directory: string;
  readonly prefix: string;
  readonly onRequest: () => Promise<unknown>;
}) => Promise<ModelFixture>;

const loadFixtureFactory = async (protocol: {
  readonly module: string;
  readonly exportName: string;
}): Promise<FixtureFactory> => {
  const exports = z
    .record(z.string(), z.unknown())
    .parse(
      await import(
        new URL(
          `../../../scripts/verify/clients/${protocol.module}`,
          import.meta.url,
        ).href
      ),
    );
  return z
    .custom<FixtureFactory>((value) => typeof value === "function")
    .parse(exports[protocol.exportName]);
};

const protocols = [
  {
    name: "OpenAI",
    module: "model-fixture.mjs",
    exportName: "createOpenAiModelFixture",
    path: "/v1/chat/completions",
    body: {
      model: "rea-client-fixture",
      messages: [{ role: "user", content: "authored shutdown request" }],
    },
    response: { role: "assistant", content: "authored response" },
  },
  {
    name: "Anthropic",
    module: "anthropic-model-fixture.mjs",
    exportName: "createAnthropicModelFixture",
    path: "/v1/messages",
    body: {
      model: "rea-client-fixture",
      messages: [{ role: "user", content: "authored shutdown request" }],
    },
    response: [{ type: "text", text: "authored response" }],
  },
  {
    name: "Gemini",
    module: "gemini-model-fixture.mjs",
    exportName: "createGeminiModelFixture",
    path: "/v1beta/models/rea-client-fixture:generateContent",
    body: {
      contents: [
        { role: "user", parts: [{ text: "authored shutdown request" }] },
      ],
    },
    response: [{ text: "authored response" }],
  },
] as const;

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((finish) => {
    resolve = finish;
  });

  return { promise, resolve };
};

const bounded = async <Value>(
  work: Promise<Value>,
  boundary: string,
): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Fixture did not reach ${boundary}`)),
          5_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const serverRequestSchema = z.object({
  request: z.instanceof(IncomingMessage),
  response: z.instanceof(ServerResponse),
  server: z.instanceof(Server),
});

// This scoped Node diagnostic observes real HTTP resources; the producers keep
// their existing public API, request parsers, callbacks and filesystem writes.
for (const protocol of protocols)
  for (const outcome of ["success", "late-error"] as const)
    it(`${protocol.name} joins a disconnected request's ${outcome} finalization before fixture close`, async () => {
      const workspace = await createTestWorkspace("rea-model-fixture-close-");
      const artifactPath = workspace.path("final request evidence.bin");
      const artifact = Buffer.from("accepted request evidence α\0\n");
      const entered = deferred<void>();
      const release = deferred<void>();
      const handlerFinished = deferred<void>();
      const observedRequest = deferred<z.infer<typeof serverRequestSchema>>();
      const serverResponseClosed = deferred<void>();
      const serverSocketClosed = deferred<void>();
      const clientSocketClosed = deferred<void>();
      const lateFailure = new Error("authored late model handler failure");
      const diagnostic = channel("http.server.request.start");
      let port: number | undefined;
      let callbackEntered = false;
      let callbackFinished = false;
      let fixture: ModelFixture | undefined;
      let client: ClientRequest | undefined;
      const observeRequest = (message: unknown) => {
        const parsed = serverRequestSchema.safeParse(message);
        if (
          !parsed.success ||
          parsed.data.request.socket.localPort !== port ||
          parsed.data.request.url !== protocol.path
        )
          return;
        parsed.data.response.once("close", () =>
          serverResponseClosed.resolve(),
        );
        parsed.data.request.socket.once("close", () =>
          serverSocketClosed.resolve(),
        );
        observedRequest.resolve(parsed.data);
      };
      diagnostic.subscribe(observeRequest);
      try {
        const createFixture = await loadFixtureFactory(protocol);
        fixture = await createFixture({
          directory: workspace.root,
          prefix: "shutdown",
          onRequest: async () => {
            callbackEntered = true;
            entered.resolve();
            try {
              await release.promise;
              await writeFile(artifactPath, artifact);
              if (outcome === "late-error") throw lateFailure;
              return protocol.response;
            } finally {
              callbackFinished = true;
              handlerFinished.resolve();
            }
          },
        });
        port = Number(new URL(fixture.baseUrl).port);
        client = request(new URL(protocol.path, fixture.baseUrl), {
          method: "POST",
          agent: false,
          headers: { "content-type": "application/json" },
        });
        // A peer disconnect is the authored stimulus, so observe its error and
        // close independently rather than letting ECONNRESET escape the test.
        client.on("error", () => {});
        client.once("socket", (socket) => {
          socket.once("close", () => clientSocketClosed.resolve());
        });
        client.end(JSON.stringify(protocol.body));
        await bounded(entered.promise, "request callback admission");
        const physical = await bounded(
          observedRequest.promise,
          "server request observation",
        );
        client.destroy();
        await bounded(
          Promise.all([
            clientSocketClosed.promise,
            serverResponseClosed.promise,
            serverSocketClosed.promise,
          ]),
          "both ends of the disconnected HTTP request",
        );
        expect(fixture.requests).toHaveLength(1);
        expect(physical.response.destroyed).toBe(true);
        expect(physical.request.socket.destroyed).toBe(true);
        const serverClosed = deferred<void>();
        physical.server.once("close", () => serverClosed.resolve());
        const closing = fixture.close().then(
          () => ({ kind: "fixture-closed" as const }),
          (cause: unknown) => ({
            kind: "fixture-close-failed" as const,
            cause,
          }),
        );
        // Node emits server close and invokes close callbacks together. The
        // following check-phase barrier lets those callbacks and their promise
        // reactions settle; no elapsed duration decides whether work was joined.
        const transportClosed = serverClosed.promise.then(async () => {
          await setImmediate();
          return { kind: "transport-closed" as const };
        });
        const first = await bounded(
          Promise.race([closing, transportClosed]),
          "physical server close with the handler still admitted",
        );
        expect(physical.server.listening).toBe(false);
        expect(physical.server.address()).toBeNull();
        expect(callbackFinished).toBe(false);
        expect(existsSync(artifactPath)).toBe(false);
        expect(first).toEqual({ kind: "transport-closed" });
        release.resolve();
        const closed = await bounded(closing, "joined fixture finalization");
        if (outcome === "late-error") {
          expect(closed.kind).toBe("fixture-close-failed");
          if (closed.kind !== "fixture-close-failed")
            throw new Error("Fixture close discarded the late handler error");
          expect(closed.cause).toBe(lateFailure);
        } else expect(closed).toEqual({ kind: "fixture-closed" });
        expect(callbackFinished).toBe(true);
        expect(Buffer.compare(await readFile(artifactPath), artifact)).toBe(0);
        expect(fixture.failure).toBe(
          outcome === "late-error" ? String(lateFailure) : undefined,
        );
      } finally {
        release.resolve();
        client?.destroy();
        try {
          if (callbackEntered)
            await bounded(handlerFinished.promise, "authored callback cleanup");
          if (fixture !== undefined) {
            const cleanup = await bounded(
              fixture.close().then(
                () => ({ kind: "closed" as const }),
                (cause: unknown) => ({ kind: "failed" as const, cause }),
              ),
              "HTTP fixture cleanup",
            );
            if (
              cleanup.kind === "failed" &&
              !(outcome === "late-error" && cleanup.cause === lateFailure)
            )
              throw cleanup.cause;
          }
          // The baseline close does not join handlers. Let the released callback
          // finish its producer catch before removing the test-owned directory.
          await setImmediate();
        } finally {
          diagnostic.unsubscribe(observeRequest);
          await removeTestWorkspace(workspace.root);
        }
      }
    });

for (const protocol of protocols)
  it(`${protocol.name} preserves an ordinary 400 and gracefully joins admitted work across repeated closes`, async () => {
    const workspace = await createTestWorkspace("rea-model-fixture-graceful-");
    const artifactPath = workspace.path("graceful request evidence.bin");
    const artifact = Buffer.from("graceful request evidence α\0\n");
    const entered = deferred<void>();
    const release = deferred<void>();
    const handlerFinished = deferred<void>();
    const observedServer = deferred<Server>();
    const diagnostic = channel("http.server.request.start");
    const controller = new AbortController();
    let callbackEntered = false;
    let callbackFinished = false;
    let callbacks = 0;
    let closedCalls = 0;
    let port: number | undefined;
    let fixture: ModelFixture | undefined;
    let requestFinished: Promise<unknown> | undefined;
    const observeRequest = (message: unknown) => {
      const parsed = serverRequestSchema.safeParse(message);
      if (
        parsed.success &&
        parsed.data.request.socket.localPort === port &&
        parsed.data.request.url === protocol.path
      )
        observedServer.resolve(parsed.data.server);
    };
    diagnostic.subscribe(observeRequest);
    try {
      const createFixture = await loadFixtureFactory(protocol);
      fixture = await createFixture({
        directory: workspace.root,
        prefix: "graceful",
        onRequest: async () => {
          callbacks += 1;
          callbackEntered = true;
          entered.resolve();
          try {
            await release.promise;
            await writeFile(artifactPath, artifact);
            return protocol.response;
          } finally {
            callbackFinished = true;
            handlerFinished.resolve();
          }
        },
      });
      port = Number(new URL(fixture.baseUrl).port);
      const endpoint = new URL(protocol.path, fixture.baseUrl);
      const invalid = await bounded(
        fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: controller.signal,
        }),
        "ordinary invalid request response",
      );
      await bounded(invalid.text(), "ordinary invalid response consumption");
      expect(invalid.status).toBe(400);
      expect(callbacks).toBe(0);
      expect(fixture.requests).toHaveLength(0);
      const ordinaryFailure = fixture.failure;
      expect(typeof ordinaryFailure).toBe("string");
      const responding = fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(protocol.body),
        signal: controller.signal,
      })
        .then(async (response) => ({
          kind: "response" as const,
          status: response.status,
          text: await response.text(),
        }))
        .catch((cause: unknown) => ({
          kind: "request-failed" as const,
          cause,
        }));
      requestFinished = responding;
      await bounded(entered.promise, "graceful request callback admission");
      const server = await bounded(
        observedServer.promise,
        "graceful HTTP server observation",
      );
      expect(callbacks).toBe(1);
      expect(fixture.requests).toHaveLength(1);
      expect(server).toBeInstanceOf(Server);
      const closing = [fixture.close(), fixture.close()].map((close) =>
        close.then(
          () => {
            closedCalls += 1;
            return { kind: "fixture-closed" as const };
          },
          (cause: unknown) => {
            closedCalls += 1;
            return { kind: "fixture-close-failed" as const, cause };
          },
        ),
      );
      // Admission is acknowledged and its live request still needs a response.
      // Give both close calls a check-phase turn while that work remains gated.
      await setImmediate();
      expect(closedCalls).toBe(0);
      expect(callbackFinished).toBe(false);
      expect(existsSync(artifactPath)).toBe(false);
      release.resolve();
      const response = await bounded(responding, "graceful model response");
      expect(response.kind).toBe("response");
      if (response.kind !== "response") throw response.cause;
      expect(response.status).toBe(200);
      expect(response.text).toContain("authored response");
      expect(
        await bounded(Promise.all(closing), "both admitted fixture closes"),
      ).toEqual([{ kind: "fixture-closed" }, { kind: "fixture-closed" }]);
      expect(callbackFinished).toBe(true);
      expect(Buffer.compare(await readFile(artifactPath), artifact)).toBe(0);
      expect(fixture.failure).toBe(ordinaryFailure);
      expect(server.listening).toBe(false);
      expect(server.address()).toBeNull();
      await bounded(fixture.close(), "repeated completed fixture close");
      expect(fixture.failure).toBe(ordinaryFailure);
    } finally {
      release.resolve();
      controller.abort(new Error("authored fixture control cleanup"));
      try {
        if (requestFinished !== undefined)
          await bounded(requestFinished, "graceful client cleanup");
        if (callbackEntered)
          await bounded(handlerFinished.promise, "graceful callback cleanup");
        if (fixture !== undefined)
          await bounded(fixture.close(), "graceful HTTP fixture cleanup");
      } finally {
        diagnostic.unsubscribe(observeRequest);
        await removeTestWorkspace(workspace.root);
      }
    }
  });

for (const opaqueFailure of [undefined, null])
  it(`OpenAI retains a late ${String(opaqueFailure)} rejection through HTTP fixture close`, async () => {
    const workspace = await createTestWorkspace("rea-model-fixture-opaque-");
    const entered = deferred<void>();
    const release = deferred<void>();
    const handlerFinished = deferred<void>();
    const clientClosed = deferred<void>();
    let callbackEntered = false;
    let fixture: ModelFixture | undefined;
    let client: ClientRequest | undefined;
    try {
      fixture = await createOpenAiModelFixture({
        directory: workspace.root,
        prefix: "opaque",
        onRequest: async () => {
          callbackEntered = true;
          entered.resolve();
          try {
            await release.promise;
            throw opaqueFailure;
          } finally {
            handlerFinished.resolve();
          }
        },
      });
      client = request(new URL("/v1/chat/completions", fixture.baseUrl), {
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json" },
      });
      client.on("error", () => {});
      client.once("close", () => clientClosed.resolve());
      client.end(
        JSON.stringify({
          model: "rea-client-fixture",
          messages: [{ role: "user", content: "authored opaque failure" }],
        }),
      );
      await bounded(entered.promise, "opaque request callback admission");
      client.destroy();
      await bounded(clientClosed.promise, "opaque client disconnect");
      const closing = fixture.close().then(
        () => ({ ok: true as const }),
        (cause: unknown) => ({ ok: false as const, cause }),
      );
      release.resolve();
      const closed = await bounded(closing, "opaque handler finalization");
      expect(closed.ok).toBe(false);
      if (closed.ok)
        throw new Error("Fixture close discarded an opaque handler rejection");
      expect(Object.hasOwn(closed, "cause")).toBe(true);
      expect(closed.cause).toBe(opaqueFailure);
      expect(fixture.failure).toBe(String(opaqueFailure));
    } finally {
      release.resolve();
      client?.destroy();
      try {
        if (callbackEntered)
          await bounded(handlerFinished.promise, "opaque callback cleanup");
        if (fixture !== undefined) {
          const cleanup = await bounded(
            fixture.close().then(
              () => ({ ok: true as const }),
              (cause: unknown) => ({ ok: false as const, cause }),
            ),
            "opaque HTTP fixture cleanup",
          );
          if (!cleanup.ok && !Object.is(cleanup.cause, opaqueFailure))
            throw cleanup.cause;
        }
      } finally {
        await removeTestWorkspace(workspace.root);
      }
    }
  });
