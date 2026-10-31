import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { GENERATED_MCP_TOOL_CATALOG } from "../../fixtures/mcpToolCatalog.js";
import { PROMPT_CONTRACTS } from "../../../src/contracts/promptContracts.js";
import { TOOL_FAMILY_DEFINITIONS } from "../../../src/contracts/toolFamilies.js";
import { evidenceSchema } from "../../../src/domain/evidence.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { SERVER_START_FAILED } from "../../../src/main/messages.js";

const connect = async (
  mode: "legacy" | "auto",
  environment: Record<string, string> = {},
  nodeArguments: readonly string[] = [],
) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...nodeArguments, resolve("scripts/rea.mjs"), "mcp"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      REA_LOG_LEVEL: "silent",
      ...environment,
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (value) => {
    stderr += value;
  });
  const client = new Client(
    { name: "deferred-runtime-boundary", version: "1" },
    { versionNegotiation: { mode } },
  );
  onTestFinished(async () => {
    await closeVerifierResources([
      () => client.close(),
      () => transport.close(),
    ]);
  });
  await client.connect(transport);
  return { client, stderr: () => stderr };
};

it.each([
  { name: "deferred", environment: {}, eager: false },
  {
    name: "compact deferred",
    environment: { REA_MCP_INPUT_SCHEMA_PROFILE: "compact" },
    eager: false,
  },
  {
    name: "full deferred",
    environment: { REA_MCP_INPUT_SCHEMA_PROFILE: "full" },
    eager: false,
  },
  {
    name: "output-off eager",
    environment: { REA_MCP_OUTPUT_SCHEMA_PROFILE: "off" },
    eager: true,
  },
])(
  "loads compiled analysis at the intended phase for $name startup",
  async ({ environment, eager }) => {
    const directory = await createTestTempDirectory("rea-mcp-module-loads-");
    const log = join(directory, "loaded.jsonl");
    await writeFile(log, "");
    const modules = [
      "main/eagerRuntime.js",
      "server/createServer.js",
      "composition/binary.js",
      "contracts/toolContracts.js",
    ];
    const hook = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from "node:module";
import { appendFileSync } from "node:fs";
const modules = ${JSON.stringify(modules)};
registerHooks({
  load(url, context, next) {
    const loaded = next(url, context);
    const source = loaded.source?.toString() ?? "";
    const names = modules.filter((name) =>
      url.endsWith("/dist/" + name) || source.includes("//#region dist/" + name + "\\n"));
    if (url.endsWith("/scripts/rea.mjs")) names.push("entrypoint");
    for (const name of names)
      appendFileSync(${JSON.stringify(log)}, JSON.stringify(name) + "\\n");
    return loaded;
  },
});
`)}`;
    const loadedModules = async () =>
      new Set(
        (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line): unknown => JSON.parse(line)),
      );
    const { client, stderr } = await connect("legacy", environment, [
      `--import=${hook}`,
    ]);
    await client.listTools();
    await client.listPrompts();
    expect(await loadedModules()).toEqual(
      new Set(eager ? ["entrypoint", ...modules] : ["entrypoint"]),
    );
    const result = await client.callTool({
      name: "list_unknowns",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(await loadedModules()).toEqual(new Set(["entrypoint", ...modules]));
    expect(stderr()).toBe("");
  },
);

it.each([
  { mode: "legacy", profile: "full" },
  { mode: "auto", profile: "full" },
  { mode: "legacy", profile: "compact" },
  { mode: "auto", profile: "compact" },
] as const)(
  "serves $profile discovery and canonical handlers over $mode negotiation",
  async ({ mode, profile }) => {
    const recorded = JSON.parse(
      await readFile(
        profile === "full"
          ? "dist/mcp-catalog-full.json"
          : "dist/mcp-catalog.json",
        "utf8",
      ),
    );
    const { client, stderr } = await connect(mode, {
      REA_MCP_INPUT_SCHEMA_PROFILE: profile,
    });
    const before = await client.listTools();
    expect(before.tools).toEqual(recorded.tools);
    const contractProjection = (tool: {
      name: string;
      title?: string | undefined;
      description?: string | undefined;
      inputSchema: unknown;
      outputSchema?: unknown;
      annotations?: unknown;
    }) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    });
    if (profile === "full")
      expect(
        new Map(
          before.tools.map((tool) => [tool.name, contractProjection(tool)]),
        ),
      ).toEqual(
        new Map(
          GENERATED_MCP_TOOL_CATALOG.map((tool) => [
            tool.name,
            contractProjection(tool),
          ]),
        ),
      );
    expect((await client.listPrompts()).prompts).toEqual(
      PROMPT_CONTRACTS.map((prompt) => ({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
        arguments: Object.entries(prompt.arguments).map(([name, argument]) => ({
          name,
          description: argument.description,
          required: argument.required,
        })),
      })),
    );

    expect((await client.listPrompts()).prompts).toEqual(
      recorded.prompts.map(
        ({ parameters: _parameters, ...prompt }: Record<string, unknown>) =>
          prompt,
      ),
    );
    const results = await Promise.all([
      client.callTool({ name: "list_unknowns", arguments: {} }),
      client.callTool({ name: "list_unknowns", arguments: { limit: 1 } }),
    ]);
    expect(results.every((result) => result.isError !== true)).toBe(true);
    expect(results.map((result) => result.structuredContent)).toEqual([
      { result: { items: [], total: 0, offset: 0, next_offset: null } },
      { result: { items: [], total: 0, offset: 0, next_offset: null } },
    ]);
    expect(await client.listTools()).toEqual(before);
    const invalid = await client.callTool({
      name: "list_unknowns",
      arguments: { limit: 1.5 },
    });
    expect(invalid.isError).toBe(true);
    expect(invalid._meta?.provenance).toEqual({
      untrusted_content: true,
      source: "analysis_target",
    });
    expect(client.getProtocolEra()).toBe(mode === "auto" ? "modern" : "legacy");
    if (mode === "auto")
      expect(invalid._meta?.["io.modelcontextprotocol/serverInfo"]).toEqual(
        recorded.info,
      );
    expect(stderr()).toBe("");
  },
);

it("composes a scoped registration instead of serving the recorded catalog", async () => {
  const { client, stderr } = await connect("legacy", {
    REA_MCP_TOOL_FAMILIES: "session",
  });
  const advertised = (await client.listTools()).tools
    .map(({ name }) => name)
    .sort();
  expect(advertised).toEqual(
    TOOL_FAMILY_DEFINITIONS.filter(({ id }) => id === "session")
      .flatMap(({ contracts }) => contracts.map(({ name }) => name))
      .sort(),
  );
  expect(advertised).not.toContain("inspect_macho");
  // The recorded catalog cannot verify a scoped identity, so the scope must
  // serve real calls instead of failing every one after materialization.
  const status = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  expect(status.isError).not.toBe(true);
  expect(stderr()).toBe("");
});

it("preserves connection creation time across deferred materialization", async () => {
  const directory = await createTestTempDirectory("rea-mcp-started-at-");
  const clock = join(directory, "clock");
  const startedAt = "2020-01-01T00:00:00.000Z";
  await writeFile(clock, startedAt);
  const hook = `data:text/javascript,${encodeURIComponent(`
import { readFileSync } from "node:fs";
const NativeDate = Date;
globalThis.Date = class extends NativeDate {
  constructor(...args) {
    super(...(args.length === 0 ? [readFileSync(${JSON.stringify(clock)}, "utf8")] : args));
  }
};
`)}`;
  const { client } = await connect("legacy", {}, [`--import=${hook}`]);
  await client.listTools();
  await writeFile(clock, "2021-01-01T00:00:00.000Z");
  const first = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  expect(first.isError).not.toBe(true);
  expect(first.structuredContent).toMatchObject({
    result: { server_identity: { server: { started_at: startedAt } } },
  });
  const again = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  expect(again.structuredContent).toMatchObject({
    result: { server_identity: { server: { started_at: startedAt } } },
  });
});

it.each([
  { level: "info", asynchronous: false, errorObject: true },
  { level: "info", asynchronous: true, errorObject: false },
  { level: "silent", asynchronous: false, errorObject: true },
])(
  "logs deferred startup failure with $level logging and asynchronous=$asynchronous",
  ({ level, asynchronous, errorObject }) => {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
import assert from "node:assert/strict";
import { runDeferred } from "./dist/main/deferredRuntime.js";
import { parseConfig } from "./dist/config/parseConfig.js";
const config = parseConfig({ HOME: process.env.HOME, REA_LOG_LEVEL: ${JSON.stringify(level)} });
assert.equal(config.ok, true);
const output = [];
let closeCalls = 0;
let unregistrations = 0;
const result = await runDeferred({
  env: {},
  writeStderr: (text) => output.push(text),
  setExitCode: () => {},
  registerShutdown: () => () => { unregistrations++; },
  serve: (factory) => {
    const server = factory({});
    const close = server.server.close.bind(server.server);
    server.server.close = async () => { closeCalls++; await close(); };
    const cause = ${errorObject ? 'new Error("transport setup reason")' : '"transport setup reason"'};
    if (${asynchronous}) return Promise.reject(cause);
    throw cause;
  },
}, config.value);
console.log(JSON.stringify({ result, output, closeCalls, unregistrations }));
`,
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      result: 1,
      output: [`${SERVER_START_FAILED}\n`],
      closeCalls: 1,
      unregistrations: 1,
    });
    if (level === "silent") {
      expect(child.stderr).toBe("");
    } else {
      expect(JSON.parse(child.stderr)).toMatchObject({
        level: 50,
        application: "rea",
        mode: "mcp",
        layer: "server",
        error: "transport setup reason",
        msg: SERVER_START_FAILED,
      });
    }
  },
);

it("retains process cleanup ownership after partial startup and failed cleanup", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
import assert from "node:assert/strict";
import { runDeferred } from "./dist/main/deferredRuntime.js";
import { parseConfig } from "./dist/config/parseConfig.js";
const config = parseConfig({ HOME: process.env.HOME, REA_LOG_LEVEL: "silent" });
assert.equal(config.ok, true);
const handlers = [];
const calls = [0, 0];
let unregistrations = 0;
let captured;
let registeredBeforeServe;
const result = await runDeferred({
  env: {},
  writeStderr: () => {},
  setExitCode: () => {},
  registerShutdown: (handler) => {
    handlers.push(handler);
    return () => { unregistrations++; };
  },
  captureShutdown: (close) => { captured = close; },
  serve: (factory) => {
    registeredBeforeServe = handlers.length;
    for (let index = 0; index < calls.length; index++) {
      const server = factory({});
      const close = server.server.close.bind(server.server);
      server.server.close = async () => {
        calls[index]++;
        if (index === 0 && calls[index] === 1) throw new Error("close denied");
        await close();
      };
    }
    throw new Error("serve failed after creating servers");
  },
}, config.value).then(() => "unexpected success", (cause) => cause);
assert.ok(result instanceof AggregateError);
assert.equal(result.errors[0].message, "serve failed after creating servers");
assert.ok(result.errors[1] instanceof AggregateError);
assert.match(String(result.errors[1].errors[0].errors[0]), /close denied/);
assert.equal(registeredBeforeServe, 1);
assert.deepEqual(calls, [1, 1]);
assert.equal(unregistrations, 0);
assert.equal(typeof captured, "function");
const retry = captured();
handlers[0]();
await retry;
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(calls, [2, 1]);
assert.equal(unregistrations, 1);
await captured();
assert.deepEqual(calls, [2, 1]);
assert.equal(unregistrations, 1);
console.log("STARTUP_CLEANUP_RETRIED");
`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe("STARTUP_CLEANUP_RETRIED\n");
  expect(child.stderr).toBe("");
});

it.each(["handle", "server"])(
  "retries only the failed %s cleanup owner",
  (failedOwner) => {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
import assert from "node:assert/strict";
import { runDeferred } from "./dist/main/deferredRuntime.js";
import { parseConfig } from "./dist/config/parseConfig.js";
const config = parseConfig({ HOME: process.env.HOME });
assert.equal(config.ok, true);
const failedOwner = ${JSON.stringify(failedOwner)};
const calls = { handle: 0, server: 0 };
let captured;
let unregistrations = 0;
const result = await runDeferred({
  env: {}, writeStderr: () => {}, setExitCode: () => {},
  registerShutdown: () => () => { unregistrations++; },
  captureShutdown: (close) => { captured = close; },
  serve: (factory) => {
    const server = factory({});
    const close = server.server.close.bind(server.server);
    server.server.close = async () => {
      calls.server++;
      if (failedOwner === "server" && calls.server === 1) throw new Error("server denied");
      await close();
    };
    return { close: () => {
      calls.handle++;
      if (failedOwner === "handle" && calls.handle === 1) throw new Error("handle denied");
      // Deliberately not idempotent: a successful handle must never be retried.
      assert.ok(calls.handle <= (failedOwner === "handle" ? 2 : 1));
      return Promise.resolve();
    } };
  },
}, config.value);
assert.equal(result, 0);
await assert.rejects(captured(), AggregateError);
assert.deepEqual(calls, { handle: 1, server: 1 });
assert.equal(unregistrations, 0);
await captured();
assert.deepEqual(calls, { handle: failedOwner === "handle" ? 2 : 1, server: failedOwner === "server" ? 2 : 1 });
assert.equal(unregistrations, 1);
await captured();
assert.equal(unregistrations, 1);
console.log("MIXED_CLEANUP_RETRIED");
`,
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe("MIXED_CLEANUP_RETRIED\n");
    expect(child.stderr).toBe("");
  },
);

it("joins shutdown with a transport and server published after shutdown starts", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
import assert from "node:assert/strict";
import { runDeferred } from "./dist/main/deferredRuntime.js";
import { parseConfig } from "./dist/config/parseConfig.js";
const config = parseConfig({ HOME: process.env.HOME });
assert.equal(config.ok, true);
const transport = Promise.withResolvers();
let factory;
let captured;
let signal;
let unregistrations = 0;
let handleCalls = 0;
let serverCalls = 0;
const running = runDeferred({
  env: {}, writeStderr: () => {}, setExitCode: () => {},
  registerShutdown: (handler) => {
    signal = handler;
    return () => { unregistrations++; };
  },
  captureShutdown: (close) => { captured = close; },
  serve: (create) => { factory = create; return transport.promise; },
}, config.value);
signal();
const closing = captured();
let closed = false;
void closing.then(() => { closed = true; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(closed, false);
assert.equal(unregistrations, 0);
const server = factory({});
const close = server.server.close.bind(server.server);
server.server.close = async () => { serverCalls++; await close(); };
transport.resolve({ close: async () => { handleCalls++; } });
assert.equal(await running, 0);
await closing;
assert.deepEqual([handleCalls, serverCalls, unregistrations], [1, 1, 1]);
await captured();
assert.deepEqual([handleCalls, serverCalls, unregistrations], [1, 1, 1]);
console.log("LATE_TRANSPORT_CLOSED");
`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe("LATE_TRANSPORT_CLOSED\n");
  expect(child.stderr).toBe("");
});

it("refuses server publication after the shutdown snapshot and completed close", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
import assert from "node:assert/strict";
import { runDeferred } from "./dist/main/deferredRuntime.js";
import { parseConfig } from "./dist/config/parseConfig.js";
const config = parseConfig({ HOME: process.env.HOME });
assert.equal(config.ok, true);
const closingHandle = Promise.withResolvers();
const releaseHandle = Promise.withResolvers();
let factory;
let captured;
let handleCalls = 0;
let serverCalls = 0;
let unregistrations = 0;
const result = await runDeferred({
  env: {}, writeStderr: () => {}, setExitCode: () => {},
  registerShutdown: () => () => { unregistrations++; },
  captureShutdown: (close) => { captured = close; },
  serve: (create) => {
    factory = create;
    const server = factory({});
    const close = server.server.close.bind(server.server);
    server.server.close = async () => { serverCalls++; await close(); };
    return { close: async () => {
      handleCalls++;
      closingHandle.resolve();
      await releaseHandle.promise;
    } };
  },
}, config.value);
assert.equal(result, 0);
const closing = captured();
await closingHandle.promise;
assert.throws(() => factory({}), /MCP connection is closed/);
releaseHandle.resolve();
await closing;
assert.throws(() => factory({}), /MCP connection is closed/);
await captured();
assert.deepEqual([handleCalls, serverCalls, unregistrations], [1, 1, 1]);
console.log("LATE_PUBLICATION_REFUSED");
`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe("LATE_PUBLICATION_REFUSED\n");
  expect(child.stderr).toBe("");
});

it.each([{}, { REA_MCP_OUTPUT_SCHEMA_PROFILE: "off" }])(
  "preserves the configured catalog profile %j",
  async (environment) => {
    const { client } = await connect("legacy", environment);
    const before = await client.listTools();
    const catalog = JSON.parse(await readFile("dist/mcp-catalog.json", "utf8"));
    expect(before.tools).toHaveLength(catalog.tools.length);
    const expected =
      environment.REA_MCP_OUTPUT_SCHEMA_PROFILE === "off"
        ? catalog.tools.map(
            ({ outputSchema: _output, ...tool }: Record<string, unknown>) =>
              tool,
          )
        : catalog.tools;
    expect(before.tools).toEqual(expected);
    const result = await client.callTool({
      name: "list_unknowns",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(await client.listTools()).toEqual(before);
  },
);

it("runs the real static artifact workflow after deferred initialization", async () => {
  const { client } = await connect("legacy");
  const opened = await client.callTool({
    name: "open_binary",
    arguments: { path: resolve("scripts/rea.mjs") },
  });
  expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
  const inspected = await client.callTool({
    name: "inspect_artifact",
    arguments: { detail: "summary" },
  });
  expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
  const evidence = evidenceSchema.parse(inspected.structuredContent);
  expect(evidence.operation).toBe("inspect_analysis_view");
  const view = analysisViewResultSchema.parse(evidence.normalized_result);
  expect(view.parent_operation).toBe("inspect_artifact");
  const retained = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: {
        kind: "retained-evidence",
        evidence_id: view.parent_evidence_id,
      },
      view: { kind: "summary" },
    },
  });
  expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
  const closed = await client.callTool({ name: "close_binary", arguments: {} });
  expect(closed.isError, JSON.stringify(closed)).not.toBe(true);
});

const copyCompiledPackage = async (prefix: string): Promise<string> => {
  const directory = await createTestTempDirectory(prefix);
  await cp(resolve("dist"), join(directory, "dist"), { recursive: true });
  await mkdir(join(directory, "scripts/lib"), { recursive: true });
  await cp(resolve("scripts/rea.mjs"), join(directory, "scripts/rea.mjs"));
  // The launcher imports its process-environment owner, as the package ships it.
  await cp(
    resolve("scripts/lib/cli-process-environment.mjs"),
    join(directory, "scripts/lib/cli-process-environment.mjs"),
  );
  await cp(resolve("package.json"), join(directory, "package.json"));
  await symlink(
    resolve("node_modules"),
    join(directory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  return directory;
};

// Recorder cleanup tests replace every runtime import through their loader
// hook. Keep only resolvable sentinels so an unmodeled import fails closed.
const createRecorderCleanupFixture = async (): Promise<string> => {
  const directory = await createTestTempDirectory("rea-catalog-cleanup-");
  await mkdir(join(directory, "scripts"), { recursive: true });
  await cp(
    resolve("scripts/record-mcp-catalog.mjs"),
    join(directory, "scripts/record-mcp-catalog.mjs"),
  );
  await cp(resolve("package.json"), join(directory, "package.json"));
  for (const path of [
    "server/createServer.js",
    "composition/binary.js",
    "config/parseConfig.js",
    "logger.js",
    "contracts/promptContracts.js",
  ]) {
    const file = join(directory, "dist", path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      `throw new Error(${JSON.stringify(`Fixture import not replaced: ${path}`)});\n`,
    );
  }
  return directory;
};

it("records the canonical catalog without a host account or ambient configuration", async () => {
  const directory = await copyCompiledPackage("rea-catalog-without-account-");
  await cp(
    resolve("scripts/record-mcp-catalog.mjs"),
    join(directory, "scripts/record-mcp-catalog.mjs"),
  );
  const temporary = join(directory, "temporary");
  await mkdir(temporary);
  const hook = `data:text/javascript,${encodeURIComponent(`
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
os.userInfo = () => { throw new Error("Host account is unavailable"); };
syncBuiltinESMExports();
`)}`;
  const child = spawnSync(
    process.execPath,
    [`--import=${hook}`, join(directory, "scripts/record-mcp-catalog.mjs")],
    {
      cwd: directory,
      env: {
        ...process.env,
        HOME: join(directory, "ambient-home"),
        USERPROFILE: join(directory, "ambient-home"),
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
        REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
        REA_MCP_OUTPUT_SCHEMA_PROFILE: "off",
      },
      encoding: "utf8",
      timeout: 30000,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe("");
  expect(child.stderr).toBe("");
  expect(await readFile(join(directory, "dist/mcp-catalog.json"), "utf8")).toBe(
    await readFile("dist/mcp-catalog.json", "utf8"),
  );
  expect(
    await readFile(join(directory, "dist/recordedMcpCatalog.js"), "utf8"),
  ).toBe(await readFile("dist/recordedMcpCatalog.js", "utf8"));
  expect(await readdir(temporary)).toEqual([]);
});

it.each([
  { failures: ["client"], producerFails: false },
  { failures: ["client", "server", "session"], producerFails: false },
  { failures: ["client"], producerFails: true },
  { failures: [], producerFails: true },
])(
  "preserves producer failure=$producerFails and settles every recorder owner with cleanup failures=$failures",
  async ({ failures, producerFails }) => {
    const directory = await createRecorderCleanupFixture();
    const log = join(directory, "cleanup.jsonl");
    const temporary = join(directory, "temporary");
    await mkdir(temporary);
    // Fault injection tests recorder ownership, not provider or SDK behavior.
    const close = (owner: string) => `async () => {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(${JSON.stringify(log)}, JSON.stringify(${JSON.stringify(owner)}) + "\\n");
      if (${JSON.stringify(failures)}.includes(${JSON.stringify(owner)}))
        throw new Error(${JSON.stringify(`${owner} cleanup failed`)});
      return { ok: true };
    }`;
    const replacements = {
      "/dist/server/createServer.js": `export const createServer = () => ({ connect: async () => {}, close: ${close("server")} });`,
      "/dist/composition/binary.js": `export const createBinarySession = () => ({ close: ${close("session")} });`,
      "/dist/config/parseConfig.js":
        "export const parseConfig = () => ({ ok: true, value: {} });",
      "/dist/logger.js": "export const silentLogger = {};",
      "/dist/contracts/promptContracts.js":
        "export const PROMPT_CONTRACTS = [];",
    };
    const clientModule = `data:text/javascript,${encodeURIComponent(`
export class Client {
  async connect() {}
  async listTools() {
    if (${JSON.stringify(producerFails)}) throw new Error("catalog generation failed");
    return { tools: [] };
  }
  async listPrompts() { return { prompts: [] }; }
  getServerVersion() {}
  getServerCapabilities() {}
  getInstructions() {}
  close = ${close("client")};
}
export const InMemoryTransport = { createLinkedPair: () => [null, null] };
`)}`;
    const hook = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from "node:module";
const replacements = ${JSON.stringify(replacements)};
registerHooks({
  resolve(specifier, context, next) {
    return specifier === "@modelcontextprotocol/client"
      ? { url: ${JSON.stringify(clientModule)}, shortCircuit: true }
      : next(specifier, context);
  },
  load(url, context, next) {
    const replacement = Object.entries(replacements).find(([path]) => url.endsWith(path));
    return replacement === undefined ? next(url, context)
      : { source: replacement[1], format: "module", shortCircuit: true };
  },
});
`)}`;
    const child = spawnSync(
      process.execPath,
      [`--import=${hook}`, join(directory, "scripts/record-mcp-catalog.mjs")],
      {
        cwd: directory,
        env: {
          ...process.env,
          TMPDIR: temporary,
          TMP: temporary,
          TEMP: temporary,
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(
      new Set(
        (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .map((line): unknown => JSON.parse(line)),
      ),
    ).toEqual(new Set(["client", "server", "session"]));
    for (const owner of failures)
      expect(child.stderr).toContain(`${owner} cleanup failed`);
    if (producerFails) {
      expect(child.stderr).toContain("Error: catalog generation failed");
      if (failures.length > 0)
        expect(
          child.stderr.indexOf("Error: catalog generation failed"),
        ).toBeLessThan(child.stderr.indexOf(`${failures[0]} cleanup failed`));
    }
    if (failures.length > 0)
      expect(child.stderr).toContain("AggregateError: Catalog cleanup failed");
    else expect(child.stderr).not.toContain("AggregateError");
    expect(await readdir(temporary)).toHaveLength(failures.length > 0 ? 1 : 0);
  },
);

it("rejects a corrupted build-owned catalog before starting the connection", async () => {
  const directory = await copyCompiledPackage("rea-corrupted-mcp-catalog-");
  await writeFile(join(directory, "dist/mcp-catalog.json"), "{}");
  const child = spawnSync(
    process.execPath,
    [join(directory, "scripts/rea.mjs"), "mcp"],
    { cwd: directory, input: "", encoding: "utf8", timeout: 10000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(1);
  expect(child.stdout).toBe("");
  expect(child.stderr).toBe(`${SERVER_START_FAILED}\n`);
});

it("keeps the outer SDK as the only raw-input owner during deferred materialization", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { runDeferred } from "./dist/main/deferredRuntime.js";
import { parseConfig } from "./dist/config/parseConfig.js";
const parsed = parseConfig({ REA_LOG_LEVEL: "silent" });
assert.equal(parsed.ok, true);
const input = new PassThrough();
const output = new PassThrough();
const received = [];
input.on("data", chunk => received.push(Buffer.from(chunk)));
const writes = [];
const responses = [];
let pendingOutput = "";
output.on("data", chunk => {
  pendingOutput += chunk.toString("utf8");
  for (;;) {
    const boundary = pendingOutput.indexOf("\\n");
    if (boundary < 0) break;
    responses.push(JSON.parse(pendingOutput.slice(0, boundary)));
    pendingOutput = pendingOutput.slice(boundary + 1);
  }
});
const until = async (predicate) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Deferred SDK control did not settle");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
let entered = false;
let release;
const held = new Promise(resolve => { release = resolve; });
let close;
const result = await runDeferred({
  env: { REA_LOG_LEVEL: "silent" }, stdin: input,
  serve: (factory, options) => serveStdio(factory, { ...options, transport: new StdioServerTransport(input, output) }),
  loadOptionalProviders: async () => { entered = true; await held; return {}; },
  captureShutdown: owned => { close = owned; },
  registerShutdown: () => () => {}, writeStderr: text => { throw new Error(text); }, setExitCode: () => {},
}, parsed.value);
assert.equal(result, 0);
const send = value => { const bytes = Buffer.from(JSON.stringify(value) + "\\n"); writes.push(bytes); input.write(bytes); };
try {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "deferred-input-owner", version: "1" } } });
  await until(() => responses.some(value => value.id === 1));
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_unknowns", arguments: {} } });
  await until(() => entered);
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_unknowns", arguments: { limit: 1 } } });
  release();
  await until(() => responses.some(value => value.id === 2) && responses.some(value => value.id === 3));
  await close();
  assert.deepEqual(Buffer.concat(received), Buffer.concat(writes));
  assert.equal(responses.filter(value => value.id === 2).length, 1);
  assert.equal(responses.filter(value => value.id === 3).length, 1);
  console.log("ONE_INPUT_OWNER");
} finally { release(); await close?.(); input.destroy(); output.destroy(); }
`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 15000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe("ONE_INPUT_OWNER\n");
});
