import { STATE_INTAKE_LIMIT_BYTES } from "../../application/environment/environmentStateDocument.js";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

const closeFailureControl = vi.hoisted(() => ({
  failure: null as Error | null,
}));

vi.mock("../http/serveStreamableHttp.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../http/serveStreamableHttp.js")>();
  return {
    ...original,
    serveStreamableHttp: async (
      ...args: Parameters<typeof original.serveStreamableHttp>
    ) => {
      const served = await original.serveStreamableHttp(...args);
      return {
        ...served,
        close: async () => {
          await served.close();
          const failure = closeFailureControl.failure;
          closeFailureControl.failure = null;
          if (failure !== null) throw failure;
        },
      };
    },
  };
});

import { timedCaptureEvidence } from "../../../tests/fixtures/analysisView.js";
import {
  environmentStateServeFixture,
  environmentStateServeInputs,
} from "../../../tests/fixtures/environmentServe.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { EnvironmentStateStore } from "../../application/environment/environmentStateStore.js";
import { ArtifactResourceRetryFailure } from "../../artifacts/ArtifactResourceScope.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import {
  environmentCard,
  STATE_INTAKE_EXTENSION,
  STATE_OPERATIONS,
} from "../../application/environment/environmentTools.js";
import { stateDataPlane } from "./environmentDataPlane.js";
import {
  ENVIRONMENT_CARD_PATH,
  ENVIRONMENT_RPC_PATH,
  environmentRoutes,
  MAX_RPC_RESPONSE_BYTES,
  serveEnvironment,
  type ServedEnvironment,
  type ServeEnvironmentOptions,
} from "./serveEnvironment.js";
import { DEFAULT_STATE_INTAKE, type StateIntake } from "./stateIntake.js";

const { source, state } = environmentStateServeInputs();

/** The initial state as a rea-state/v1 document with user 2 renamed. */
const renamedDocument = () => {
  const document = structuredClone(new EnvironmentStateStore(state).snapshot());
  return {
    rea_state: {
      ...document.rea_state,
      entities: document.rea_state.entities.map((entity) =>
        entity.type === "/api/users" && entity.id === "2"
          ? { ...entity, fields: { ...entity.fields, login: "renamed" } }
          : entity,
      ),
    },
  };
};

/** A data plane over a fresh store, posting raw bodies to its route; `stopped` is the server's stop signal. */
const dataPlane = (
  intake: Partial<StateIntake> = {},
  stopped?: AbortSignal,
) => {
  const store = new EnvironmentStateStore(state);
  const route = environmentRoutes(
    environmentCard("grafana-example", [], "state"),
    stateDataPlane(store, { ...DEFAULT_STATE_INTAKE, ...intake }, stopped),
  ).find((entry) => entry.path === ENVIRONMENT_RPC_PATH);
  if (route === undefined) throw new Error("No data-plane route");
  const post = async (body: unknown, signal?: AbortSignal) => {
    const response = await route.handle(
      new Request(`http://127.0.0.1${ENVIRONMENT_RPC_PATH}`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      }),
    );
    return {
      status: response.status,
      json: response.status === 202 ? undefined : await response.json(),
    };
  };
  const call = async (method: string, params?: unknown) =>
    (
      await post({
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(params === undefined ? {} : { params }),
      })
    ).json;
  const add = (part: unknown) => call("data/add", { parts: [part] });
  return { store, post, call, add };
};

const loginOf = (store: EnvironmentStateStore) =>
  store.entity("/api/users", "/api/users", "2")?.fields.login;

/** The `file://` uri of a fresh file holding the renamed document. */
const renamedStateUri = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-environment-state-close-");
  const path = join(root, "state.json");
  await writeFile(path, JSON.stringify(renamedDocument()));
  return pathToFileURL(path).href;
};

/** Fail every close of the first state file opened while `failing()` holds, recording its owner; restored when the test ends. */
const failFirstFileClose = (failing: () => boolean = () => true) => {
  const owners: OwnedFileHandle[] = [];
  const close = OwnedFileHandle.prototype.close;
  const spy = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      if (owners.length === 0) owners.push(this);
      if (this === owners[0] && failing())
        throw new Error("injected state file close failure");
      await close.call(this);
    });
  onTestFinished(async () => {
    spy.mockRestore();
    for (const owner of owners) if (owner.handle.fd >= 0) await owner.close();
  });
  return owners;
};

/** A `data/add` message loading the document an https uri names. */
const addByUri = (
  id: number,
  uri = "https://state.example.test/state.json",
) => ({
  jsonrpc: "2.0",
  id,
  method: "data/add",
  params: { parts: [{ kind: "file", file: { uri } }] },
});

/** A fetcher that reports each call and the signal it was given, then answers only when `answer` settles. */
const heldFetcher = (answer: () => Promise<Response>) => {
  const signals: AbortSignal[] = [];
  let started: () => void = () => undefined;
  const fetching = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetchState = (_: URL, signal: AbortSignal) => {
    signals.push(signal);
    started();
    return answer();
  };
  return { signals, fetching, fetchState };
};

describe("state data plane", () => {
  it("answers data/get, data/add and data/reset in the AgentEnv shapes", async () => {
    const plane = dataPlane();
    await expect(plane.call("data/get")).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        parts: [
          {
            kind: "data",
            data: JSON.parse(JSON.stringify(plane.store.snapshot())),
          },
        ],
      },
    });
    await expect(
      plane.add({ kind: "data", data: renamedDocument() }),
    ).resolves.toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(loginOf(plane.store)).toBe("renamed");
    await expect(plane.call("data/reset")).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
    expect(loginOf(plane.store)).toBe("probe");
    await expect(plane.call("data/remove")).resolves.toMatchObject({
      error: { code: -32601, message: "method not found: data/remove" },
    });
  });

  it("refuses anything but exactly one data or file part as invalid params", async () => {
    const plane = dataPlane();
    for (const params of [
      { parts: [] },
      undefined,
      {
        parts: [
          { kind: "data", data: {} },
          { kind: "data", data: {} },
        ],
      },
      { parts: [{ kind: "text", text: "{}" }] },
      { parts: [{ kind: "file", file: { bytes: "e30=", uri: "file:///x" } }] },
      { parts: [{ kind: "file", file: { bytes: "not base64!" } }] },
      {
        parts: [
          { kind: "file", file: { bytes: "e30=", mimeType: "text/plain" } },
        ],
      },
      { parts: [{ kind: "file", file: { uri: "http://example.test/x" } }] },
    ])
      await expect(plane.call("data/add", params)).resolves.toMatchObject({
        error: { code: -32602 },
      });
    expect(loginOf(plane.store)).toBe("probe");
  });

  it("names the first invalid member by JSON pointer and changes nothing", async () => {
    const plane = dataPlane();
    const document = renamedDocument();
    const entities = document.rea_state.entities.map((entity, index) =>
      index === 3 ? { ...entity, collection: "/api/elsewhere" } : entity,
    );
    const reply = await plane.add({
      kind: "data",
      data: { rea_state: { ...document.rea_state, entities } },
    });
    expect(reply).toMatchObject({
      error: {
        code: -32602,
        message: expect.stringContaining("/rea_state/entities/3/collection"),
        data: { path: "/rea_state/entities/3/collection" },
      },
    });
    expect(loginOf(plane.store)).toBe("probe");
    // Numbers parsing or serialization would alter are refused where they sit.
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "data/add",
      params: { parts: [{ kind: "data", data: renamedDocument() }] },
    });
    for (const altered of [
      '"login":9007199254740993',
      // Exact in this spelling, but data/get would write it as digits it could not load again.
      '"login":1e20',
    ]) {
      const reply = await plane.post(
        body.replace('"login":"renamed"', altered),
      );
      expect(reply.json).toMatchObject({
        error: {
          code: -32602,
          data: { path: expect.stringMatching(/\/fields$/u) },
        },
      });
    }
    expect(loginOf(plane.store)).toBe("probe");
  });
});

it("preserves arbitrary own data keys in inline and encoded file parts", async () => {
  const plane = dataPlane();
  const initial = renamedDocument();
  const original = initial.rea_state.entities[0]!;
  const members = JSON.parse(
    '{"__proto__":{"constructor":0},"toString":false}',
  );
  const entity = { ...original, fields: { ...original.fields, ...members } };
  const document = {
    rea_state: {
      ...initial.rea_state,
      entities: [entity, ...initial.rea_state.entities.slice(1)],
    },
  };
  for (const part of [
    { kind: "data", data: document },
    {
      kind: "file",
      file: {
        bytes: Buffer.from(JSON.stringify(document)).toString("base64"),
      },
    },
  ]) {
    await expect(plane.add(part)).resolves.toMatchObject({ result: {} });
    const retained = plane.store.entity(
      entity.type,
      entity.collection,
      entity.id,
    )!;
    expect(Object.hasOwn(retained.fields, "__proto__")).toBe(true);
    expect(retained.fields).toEqual(entity.fields);
  }
});

describe("state data plane intake", () => {
  it("loads file parts from bytes and from a file uri", async () => {
    const plane = dataPlane();
    const text = JSON.stringify(renamedDocument());
    await expect(
      plane.add({
        kind: "file",
        file: {
          bytes: Buffer.from(text).toString("base64"),
          mimeType: "application/json; charset=utf-8",
        },
      }),
    ).resolves.toMatchObject({ result: {} });
    expect(loginOf(plane.store)).toBe("renamed");
    plane.store.reset();
    const root = await createTestTempDirectory("rea-environment-state-file-");
    const path = join(root, "state.json");
    await writeFile(path, text);
    await expect(
      plane.add({ kind: "file", file: { uri: pathToFileURL(path).href } }),
    ).resolves.toMatchObject({ result: {} });
    expect(loginOf(plane.store)).toBe("renamed");
    await mkdir(join(root, "directory"));
    for (const [name, reason] of [
      ["missing.json", "not-found"],
      ["directory", "not-regular-file"],
    ] as const) {
      const uri = pathToFileURL(join(root, name)).href;
      const reply = await plane.add({ kind: "file", file: { uri } });
      expect(reply).toMatchObject({
        error: { code: -32602, data: { reason } },
      });
      expect(JSON.stringify(reply)).not.toContain(root);
    }
  });

  it("downloads https uris through the injected fetcher within its limits, never echoing the uri", async () => {
    const requested: string[] = [];
    let answer = (): Response =>
      new Response(JSON.stringify(renamedDocument()));
    const plane = dataPlane({
      fetchState: (url, signal) => {
        requested.push(url.href);
        expect(signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve(answer());
      },
    });
    const uri = "https://state.example.test/state.json?token=secret-token";
    const add = () => plane.add({ kind: "file", file: { uri } });
    await expect(add()).resolves.toMatchObject({ result: {} });
    expect(requested).toEqual([uri]);
    expect(loginOf(plane.store)).toBe("renamed");
    answer = () => new Response("missing", { status: 404 });
    const missing = await add();
    expect(missing).toMatchObject({
      error: { code: -32000, data: { reason: "http-status" } },
    });
    expect(JSON.stringify(missing)).not.toContain("secret-token");
    answer = () =>
      new Response("{}", {
        headers: { "content-length": String(STATE_INTAKE_LIMIT_BYTES + 1) },
      });
    await expect(add()).resolves.toMatchObject({ error: { code: -32602 } });
    const chunk = new Uint8Array(1024 * 1024);
    answer = () => {
      let sent = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += chunk.length;
            controller.enqueue(chunk);
            if (sent > STATE_INTAKE_LIMIT_BYTES + chunk.length)
              controller.close();
          },
        }),
      );
    };
    await expect(add()).resolves.toMatchObject({
      error: { code: -32602, message: expect.stringContaining("exceeds") },
    });
    answer = () => new Response("not json");
    await expect(add()).resolves.toMatchObject({ error: { code: -32602 } });
  });

  it("opens file uris only on this host, refusing another host or a network share before opening anything", async () => {
    const plane = dataPlane();
    for (const uri of [
      "file://remote.example.test/share/state.json",
      "file:////remote.example.test/share/state.json",
    ]) {
      const reply = await plane.add({ kind: "file", file: { uri } });
      expect(reply).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32602,
          message:
            "invalid params: a file:// uri names a path on this host, not a network share",
        },
      });
    }
    const root = await createTestTempDirectory("rea-environment-state-host-");
    const path = join(root, "state.json");
    await writeFile(path, JSON.stringify(renamedDocument()));
    await expect(
      plane.add({
        kind: "file",
        file: { uri: `file://localhost${pathToFileURL(path).pathname}` },
      }),
    ).resolves.toMatchObject({ result: {} });
    expect(loginOf(plane.store)).toBe("renamed");
  });

  it("runs batches in order and runs notifications without replying", async () => {
    const plane = dataPlane();
    const batch = await plane.post([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "data/add",
        params: { parts: [{ kind: "data", data: renamedDocument() }] },
      },
      { jsonrpc: "2.0", id: 2, method: "data/get" },
    ]);
    expect(batch.json).toMatchObject([
      { id: 1, result: {} },
      {
        id: 2,
        result: {
          parts: [
            {
              kind: "data",
              data: {
                rea_state: {
                  entities: expect.arrayContaining([
                    expect.objectContaining({
                      type: "/api/users",
                      id: "2",
                      fields: expect.objectContaining({ login: "renamed" }),
                    }),
                  ]),
                },
              },
            },
          ],
        },
      },
    ]);
    const notified = await plane.post({ jsonrpc: "2.0", method: "data/reset" });
    expect(notified.status).toBe(202);
    expect(loginOf(plane.store)).toBe("probe");
  });
});

describe("state data plane file closes", () => {
  it("keeps a state file whose close failed and closes it before the next file read", async () => {
    const plane = dataPlane();
    const uri = await renamedStateUri();
    let failing = true;
    const owners = failFirstFileClose(() => failing);
    const failed = await plane.add({ kind: "file", file: { uri } });
    expect(failed).toMatchObject({
      error: {
        code: -32000,
        message: expect.stringContaining("could not be closed"),
      },
    });
    expect(JSON.stringify(failed)).not.toContain(uri);
    expect(loginOf(plane.store)).toBe("probe");
    expect(owners[0]?.handle.fd).toBeGreaterThanOrEqual(0);
    failing = false;
    await expect(
      plane.add({ kind: "file", file: { uri } }),
    ).resolves.toMatchObject({ result: {} });
    expect(owners[0]?.handle.fd).toBe(-1);
    expect(loginOf(plane.store)).toBe("renamed");
  });
});

describe("state data plane timing and order", () => {
  it("ends a download that outlives its time limit, whether or not the fetcher honours the signal", async () => {
    const uri = "https://state.example.test/slow.json?token=secret-token";
    const waitForAbort = (signal: AbortSignal) =>
      new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    const stalledBody = () =>
      Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ pull: () => undefined })),
      );
    for (const fetchState of [
      (_: URL, signal: AbortSignal) => waitForAbort(signal),
      stalledBody,
      () => new Promise<Response>(() => undefined),
    ]) {
      const plane = dataPlane({ fetchState, timeoutMs: 20 });
      const reply = await plane.add({ kind: "file", file: { uri } });
      expect(reply).toMatchObject({
        error: { code: -32000, data: { reason: "timeout" } },
      });
      expect(JSON.stringify(reply)).not.toContain("secret-token");
      expect(loginOf(plane.store)).toBe("probe");
    }
    const failing = dataPlane({
      fetchState: () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(
      failing.add({ kind: "file", file: { uri } }),
    ).resolves.toMatchObject({
      error: { code: -32000, data: { reason: "network" } },
    });
  });

  it("applies data-plane calls from separate requests in arrival order", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plane = dataPlane({
      fetchState: async () => {
        await gate;
        return new Response(JSON.stringify(renamedDocument()));
      },
    });
    const slowAdd = plane.add({
      kind: "file",
      file: { uri: "https://state.example.test/state.json" },
    });
    const reset = plane.call("data/reset");
    release();
    await expect(slowAdd).resolves.toMatchObject({ result: {} });
    await expect(reset).resolves.toMatchObject({ result: {} });
    // The reset arrived after the add, so it wins even though the add finished loading later.
    expect(loginOf(plane.store)).toBe("probe");
  });

  it("queues every message of a batch at arrival, so a later request's reset never lands between them", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = heldFetcher(async () => {
      await gate;
      return new Response(JSON.stringify(renamedDocument()));
    });
    const plane = dataPlane({ fetchState: held.fetchState });
    const batch = plane.post([
      addByUri(1),
      { jsonrpc: "2.0", id: 2, method: "data/get" },
    ]);
    await held.fetching;
    const reset = plane.call("data/reset");
    release();
    const replies = (await batch).json;
    expect(replies).toMatchObject([
      { id: 1, result: {} },
      {
        id: 2,
        result: {
          parts: [
            {
              kind: "data",
              data: {
                rea_state: {
                  entities: expect.arrayContaining([
                    expect.objectContaining({
                      type: "/api/users",
                      id: "2",
                      fields: expect.objectContaining({ login: "renamed" }),
                    }),
                  ]),
                },
              },
            },
          ],
        },
      },
    ]);
    // The get arrived with the add, before the reset, so it reports the loaded state.
    await expect(reset).resolves.toMatchObject({ result: {} });
    expect(loginOf(plane.store)).toBe("probe");
  });
});

describe("state data plane cancellation", () => {
  /** A download that never answers on its own and outlives any test. */
  const stalled = () =>
    heldFetcher(() => new Promise<Response>(() => undefined));

  it("ends the running download and skips queued calls once the server stops", async () => {
    const stopping = new AbortController();
    const held = stalled();
    const plane = dataPlane(
      { fetchState: held.fetchState, timeoutMs: 600_000 },
      stopping.signal,
    );
    await plane.add({ kind: "data", data: renamedDocument() });
    const batch = plane.post([
      addByUri(1),
      { jsonrpc: "2.0", id: 2, method: "data/reset" },
    ]);
    await held.fetching;
    stopping.abort();
    expect((await batch).json).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32000,
          message: "the state document could not be downloaded",
          data: { reason: "cancelled" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        error: {
          code: -32000,
          message: "the call was cancelled and left the state unchanged",
          data: { reason: "cancelled" },
        },
      },
    ]);
    expect(held.signals.map((signal) => signal.aborted)).toEqual([true]);
    // The queued reset never ran, and nothing runs after the stop.
    expect(loginOf(plane.store)).toBe("renamed");
    await expect(plane.call("data/reset")).resolves.toMatchObject({
      error: { data: { reason: "cancelled" } },
    });
    expect(loginOf(plane.store)).toBe("renamed");
  });

  it("ends a download whose caller left, leaving the state unchanged", async () => {
    const held = stalled();
    const plane = dataPlane({
      fetchState: held.fetchState,
      timeoutMs: 600_000,
    });
    const leaving = new AbortController();
    const add = plane.post(addByUri(1), leaving.signal);
    await held.fetching;
    leaving.abort();
    expect((await add).json).toMatchObject({
      error: { code: -32000, data: { reason: "cancelled" } },
    });
    expect(held.signals[0]?.aborted).toBe(true);
    expect(loginOf(plane.store)).toBe("probe");
    // Other callers' calls still run.
    await expect(
      plane.add({ kind: "data", data: renamedDocument() }),
    ).resolves.toMatchObject({ result: {} });
  });
});

describe("state data plane response budget", () => {
  it("answers replies past the response budget with an error stating it instead of building the body", async () => {
    const document = renamedDocument();
    const large = {
      rea_state: {
        ...document.rea_state,
        entities: document.rea_state.entities.map((entity) =>
          entity.type === "/api/users" && entity.id === "2"
            ? {
                ...entity,
                fields: {
                  ...entity.fields,
                  login: "x".repeat(Math.ceil(MAX_RPC_RESPONSE_BYTES / 3)),
                },
              }
            : entity,
        ),
      },
    };
    const root = await createTestTempDirectory("rea-environment-state-budget-");
    const path = join(root, "large.json");
    await writeFile(path, JSON.stringify(large));
    const plane = dataPlane();
    await expect(
      plane.add({ kind: "file", file: { uri: pathToFileURL(path).href } }),
    ).resolves.toMatchObject({ result: {} });
    const get = (id: number) => ({ jsonrpc: "2.0", id, method: "data/get" });
    const batch = await plane.post([
      get(1),
      get(2),
      get(3),
      get(4),
      { jsonrpc: "2.0", id: 5, method: "data/reset" },
    ]);
    // Two reads fit; the third and fourth would pass the budget, and the reset's small reply is kept.
    expect(batch.json).toMatchObject([
      { id: 1, result: { parts: [{ kind: "data" }] } },
      { id: 2, result: { parts: [{ kind: "data" }] } },
      {
        id: 3,
        error: {
          code: -32000,
          data: {
            max_response_bytes: MAX_RPC_RESPONSE_BYTES,
            reply_bytes: expect.any(Number),
          },
        },
      },
      { id: 4, error: { code: -32000 } },
      { id: 5, result: {} },
    ]);
    expect(Buffer.byteLength(JSON.stringify(batch.json))).toBeLessThanOrEqual(
      MAX_RPC_RESPONSE_BYTES,
    );
    expect(loginOf(plane.store)).toBe("probe");
  });

  it("measures each reply before building it, so one past the budget is never serialized whole", async () => {
    const document = renamedDocument();
    const login = "x".repeat(Math.ceil(MAX_RPC_RESPONSE_BYTES / 3));
    const large = {
      rea_state: {
        ...document.rea_state,
        entities: document.rea_state.entities.map((entity) =>
          entity.type === "/api/users" && entity.id === "2"
            ? { ...entity, fields: { ...entity.fields, login } }
            : entity,
        ),
      },
    };
    const root = await createTestTempDirectory(
      "rea-environment-state-measure-",
    );
    const path = join(root, "large.json");
    await writeFile(path, JSON.stringify(large));
    const plane = dataPlane();
    await plane.add({ kind: "file", file: { uri: pathToFileURL(path).href } });
    const reply = (id: number) => ({
      jsonrpc: "2.0",
      id,
      result: { parts: [{ kind: "data", data: plane.store.snapshot() }] },
    });
    const replyBytes = Buffer.byteLength(JSON.stringify(reply(3)));
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      const batch = await plane.post(
        [1, 2, 3].map((id) => ({ jsonrpc: "2.0", id, method: "data/get" })),
      );
      // A refused read is measured exactly, from bounded parts.
      expect(batch.json).toMatchObject([
        { id: 1 },
        { id: 2 },
        {
          id: 3,
          error: {
            data: { reply_bytes: replyBytes },
          },
        },
      ]);
      // No whole reply was handed to JSON.stringify by the server.
      expect(
        stringify.mock.calls.some(
          ([value]) =>
            typeof value === "object" &&
            value !== null &&
            "result" in value &&
            typeof (value as { result?: unknown }).result === "object" &&
            (value as { id?: unknown }).id === 3,
        ),
      ).toBe(false);
    } finally {
      stringify.mockRestore();
    }
  });
});

describe("repeated state reads", () => {
  it("reuses the encoded size of a state for refused repeated data/get calls", async () => {
    const plane = dataPlane();
    const document = renamedDocument();
    const large = {
      rea_state: {
        ...document.rea_state,
        entities: document.rea_state.entities.map((entity) =>
          entity.type === "/api/users" && entity.id === "2"
            ? {
                ...entity,
                fields: { ...entity.fields, large: "x".repeat(1024 * 1024) },
              }
            : entity,
        ),
      },
    };
    await plane.add({ kind: "data", data: large });
    const fields = plane.store
      .snapshot()
      .rea_state.entities.find((entity) => entity.id === "2")?.fields;
    if (fields === undefined) throw new Error("Expected the loaded entity");

    const originalKeys = Object.keys;
    let fieldEnumerations = 0;
    const keys = vi.spyOn(Object, "keys").mockImplementation((value) => {
      if (value === fields) fieldEnumerations += 1;
      return originalKeys(value);
    });
    try {
      const batch = await plane.post(
        Array.from({ length: 100 }, (_, index) => ({
          jsonrpc: "2.0",
          id: index + 1,
          method: "data/get",
        })),
      );
      expect(
        (batch.json as { error?: unknown }[]).filter((reply) => reply.error),
      ).not.toHaveLength(0);
      expect(fieldEnumerations).toBeLessThan(65);
      expect(Buffer.byteLength(JSON.stringify(batch.json))).toBeLessThanOrEqual(
        MAX_RPC_RESPONSE_BYTES,
      );
    } finally {
      keys.mockRestore();
    }
  });
});

describe("state data plane response budget reserve", () => {
  it("keeps room for every later refusal and the batch's framing, so the body never passes the budget", async () => {
    const document = renamedDocument();
    const withLogin = (login: string) => ({
      rea_state: {
        ...document.rea_state,
        entities: document.rea_state.entities.map((entity) =>
          entity.type === "/api/users" && entity.id === "2"
            ? { ...entity, fields: { ...entity.fields, login } }
            : entity,
        ),
      },
    });
    const plane = dataPlane();
    await plane.add({ kind: "data", data: withLogin("") });
    const base = Buffer.byteLength(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { parts: [{ kind: "data", data: plane.store.snapshot() }] },
      }),
    );
    // Three reads that alone fall 100 bytes short of the budget.
    const login = "x".repeat(
      Math.floor((MAX_RPC_RESPONSE_BYTES - 100) / 3) - base,
    );
    const root = await createTestTempDirectory(
      "rea-environment-state-reserve-",
    );
    const path = join(root, "large.json");
    await writeFile(path, JSON.stringify(withLogin(login)));
    await plane.add({ kind: "file", file: { uri: pathToFileURL(path).href } });
    const ids = Array.from({ length: 23 }, (_, index) => index + 1);
    const batch = await plane.post(
      ids.map((id) => ({ jsonrpc: "2.0", id, method: "data/get" })),
    );
    // The third read would leave no room for the twenty refusals after it.
    expect((batch.json as unknown[]).slice(0, 3)).toMatchObject([
      { id: 1, result: {} },
      { id: 2, result: {} },
      { id: 3, error: { code: -32000 } },
    ]);
    expect((batch.json as { id: number }[]).map((reply) => reply.id)).toEqual(
      ids,
    );
    expect(Buffer.byteLength(JSON.stringify(batch.json))).toBeLessThanOrEqual(
      MAX_RPC_RESPONSE_BYTES,
    );
  });
});

const served: ServedEnvironment[] = [];
afterEach(async () => {
  await Promise.all(served.splice(0).map((entry) => entry.close()));
});

/** Serve a state on a loopback port until the test ends. */
const serveState = async (
  inputs: ReturnType<typeof environmentStateServeInputs>,
  options: Pick<ServeEnvironmentOptions, "fetchState"> = {},
): Promise<ServedEnvironment> => {
  const entry = await serveEnvironment({
    ...inputs,
    ...options,
    host: "127.0.0.1",
    port: 0,
  });
  if (!entry.ok) throw entry.error;
  served.push(entry.value);
  return entry.value;
};

/** Run `use` with an MCP client, after checking it lists the card's tools, then end its session. */
const withClient = async (
  environment: ServedEnvironment,
  use: (client: Client) => Promise<void>,
): Promise<void> => {
  const transport = new StreamableHTTPClientTransport(new URL(environment.url));
  const client = new Client({ name: "environment-state", version: "1" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toEqual(
      environment.card.capabilities.tools.map(({ name }) => name),
    );
    await use(client);
  } finally {
    await transport.terminateSession();
    await client.close();
  }
};

it("loads a padded inline state file and keeps the RPC result compact", async () => {
  const environment = await serveState({ source, state });
  const document = JSON.stringify(renamedDocument()).padEnd(
    2 * 1024 * 1024,
    " ",
  );
  const added = await fetch(new URL(ENVIRONMENT_RPC_PATH, environment.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "data/add",
      params: {
        parts: [
          {
            kind: "file",
            file: { bytes: Buffer.from(document).toString("base64") },
          },
        ],
      },
    }),
  });
  expect(added.status).toBe(200);
  const reply = await added.text();
  expect(JSON.parse(reply)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  expect(Buffer.byteLength(reply)).toBeLessThan(128);
  await withClient(environment, async (client) => {
    const read = await client.callTool({
      name: "get_users_by_id",
      arguments: { id: "2" },
    });
    expect(read.isError).toBeFalsy();
    expect(read.structuredContent).toMatchObject({
      body: { login: "renamed" },
    });
  });
  await expect(environment.close()).resolves.toBeUndefined();
});

describe("serveEnvironment with a state", () => {
  it("replays safe non-GET methods with the recorded-view reason", async () => {
    const environment = await serveState(
      environmentStateServeInputs(
        environmentStateServeFixture(
          timedCaptureEvidence([
            ["GET", "/api/items", [{ id: 1 }]],
            ["HEAD", "/api/items"],
            ["OPTIONS", "/api/items", { allow: "GET, HEAD, OPTIONS" }],
            ["TRACE", "/api/items", { trace: true }],
          ]),
        ),
      ),
    );
    await withClient(environment, async (client) => {
      for (const name of ["head_items", "options_items", "trace_items"]) {
        const response = await client.callTool({ name, arguments: {} });
        expect(response.isError).not.toBe(true);
        expect(response.structuredContent).toMatchObject({
          state: { source: "recording", reason: "method-replay" },
        });
      }
    });
  });

  it("declares the data plane, serves read tools from the state and reflects data/add in the next answer", async () => {
    const environment = await serveState({ source, state });
    const url = new URL(environment.url);
    const card: unknown = await (
      await fetch(new URL(ENVIRONMENT_CARD_PATH, url))
    ).json();
    expect(card).toEqual(JSON.parse(JSON.stringify(environment.card)));
    const { capabilities } = environment.card;
    expect(capabilities.extensions).toEqual([STATE_INTAKE_EXTENSION]);
    expect(capabilities.operations).toEqual(STATE_OPERATIONS);
    const names = capabilities.tools.map((tool) => tool.name);
    expect(names).toContain("get_users_by_id");
    for (const write of [
      "post_annotations",
      "delete_dashboards_by_uid",
      "post_folders",
      "put_folders_by_uid",
      "delete_teams_by_id",
    ])
      expect(names).not.toContain(write);
    await withClient(environment, async (client) => {
      const before = await client.callTool({
        name: "get_users_by_id",
        arguments: { id: "2" },
      });
      expect(before.structuredContent).toMatchObject({
        body: { login: "probe" },
        state: { source: "state", view: "item", id: "2" },
      });
      const added = await fetch(new URL(ENVIRONMENT_RPC_PATH, url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "data/add",
          params: { parts: [{ kind: "data", data: renamedDocument() }] },
        }),
      });
      await expect(added.json()).resolves.toMatchObject({ result: {} });
      const after = await client.callTool({
        name: "get_users_by_id",
        arguments: { id: "2" },
      });
      expect(after.structuredContent).toMatchObject({
        body: { login: "renamed" },
      });
      const missing = await client.callTool({
        name: "get_users_by_id",
        arguments: { id: "999" },
      });
      expect(missing.isError).toBe(true);
    });
  });

  it("stops without waiting for a stalled download", async () => {
    const held = heldFetcher(() => new Promise<Response>(() => undefined));
    const environment = await serveState(
      { source, state },
      { fetchState: held.fetchState },
    );
    const answered = fetch(new URL(ENVIRONMENT_RPC_PATH, environment.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(addByUri(1)),
    }).then(
      (response) => response.status,
      () => "closed",
    );
    await held.fetching;
    // The download's own limit is 30 s; stopping must not wait for it.
    const started = performance.now();
    await environment.close();
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(held.signals[0]?.aborted).toBe(true);
    await answered;
  });

  it("refuses file reads while an earlier state file stays open, and reports it on close until it closes", async () => {
    const environment = await serveState({ source, state });
    const uri = await renamedStateUri();
    let failing = true;
    const owners = failFirstFileClose(() => failing);
    const add = async (part: unknown) =>
      (
        await fetch(new URL(ENVIRONMENT_RPC_PATH, environment.url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "data/add",
            params: { parts: [part] },
          }),
        })
      ).json();
    await expect(add({ kind: "file", file: { uri } })).resolves.toMatchObject({
      error: {
        code: -32000,
        message: expect.stringContaining("could not be closed"),
      },
    });
    await expect(add({ kind: "file", file: { uri } })).resolves.toMatchObject({
      error: { code: -32000, message: expect.stringContaining("still open") },
    });
    // Documents that need no file still load.
    await expect(
      add({ kind: "data", data: renamedDocument() }),
    ).resolves.toMatchObject({ result: {} });
    await expect(environment.close()).rejects.toMatchObject({
      _tag: "AnalysisOutputError",
      diagnostics: { cleanup_stages: ["state-files"] },
      cause: expect.any(ArtifactResourceRetryFailure),
      cleanupIncomplete: true,
    });
    expect(owners[0]?.handle.fd).toBeGreaterThanOrEqual(0);
    failing = false;
    await expect(environment.close()).resolves.toBeUndefined();
    expect(owners[0]?.handle.fd).toBe(-1);
  });
});

describe("serveEnvironment cleanup retries", () => {
  it("attempts state-file cleanup after listener failure and keeps both failures retryable", async () => {
    const environment = await serveState({ source, state });
    const uri = await renamedStateUri();
    let failing = true;
    const owners = failFirstFileClose(() => failing);
    const response = await fetch(
      new URL(ENVIRONMENT_RPC_PATH, environment.url),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(addByUri(1, uri)),
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: -32000,
        message: expect.stringContaining("could not be closed"),
      },
    });

    const listenerFailure = new Error("injected listener cleanup failure");
    closeFailureControl.failure = listenerFailure;
    await expect(environment.close()).rejects.toSatisfy((cause: unknown) => {
      if (!(cause instanceof Error) || !(cause.cause instanceof AggregateError))
        return false;
      expect(cause).toMatchObject({
        _tag: "AnalysisOutputError",
        diagnostics: { cleanup_stages: ["http-server", "state-files"] },
        cleanupIncomplete: true,
      });
      return (
        cause.cause.errors[0] === listenerFailure &&
        cause.cause.errors[1] instanceof ArtifactResourceRetryFailure
      );
    });
    expect(owners[0]?.handle.fd).toBeGreaterThanOrEqual(0);

    failing = false;
    await expect(environment.close()).resolves.toBeUndefined();
    expect(owners[0]?.handle.fd).toBe(-1);
  });
});

describe("serveEnvironment with a state", () => {
  it("serves query POSTs from their recordings and leaves state-changing writes out", async () => {
    const environment = await serveState(
      environmentStateServeInputs(
        environmentStateServeFixture(
          timedCaptureEvidence([
            ["GET", "/api/items", [{ id: 1, name: "a" }]],
            ["POST", "/api/search", [{ id: 1, name: "a" }]],
            ["POST", "/api/items", { id: 2, name: "b" }],
          ]),
        ),
      ),
    );
    const { tools } = environment.card.capabilities;
    expect(tools.map(({ name }) => name)).toEqual(["get_items", "post_search"]);
    expect(
      tools.find(({ name }) => name === "post_search")?.description,
    ).toContain(
      "answers from the served environment state where the state backs this tool",
    );
    await withClient(environment, async (client) => {
      const searched = await client.callTool({
        name: "post_search",
        arguments: {},
      });
      expect(searched.structuredContent).toMatchObject({
        body: [{ id: 1, name: "a" }],
        state: { source: "recording", reason: "query-body" },
      });
    });
  });
});

it("keeps the stateless card's data plane empty", () => {
  expect(environmentCard("x", []).capabilities).toEqual({
    extensions: null,
    tools: [],
    operations: [],
  });
});
