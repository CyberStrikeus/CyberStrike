import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

describe("JavaScript semantic analysis: native bindings 1", () => {
  it("recovers child-process argv, env, stdio, listeners, and signals", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { spawn as launch } from "node:child_process";
      function run() {
        const child = launch(
          "/bin/tool",
          ["--mode", "fast"],
          { env: { MODE: "test" }, stdio: ["ignore", "pipe", "pipe"] },
        );
        child.on("exit", onExit);
        child.once("error", onError);
        child.kill("SIGINT");
      }
    `);

    expect(ir.childProcessSpawns).toEqual([
      expect.objectContaining({
        method: "spawn",
        command: "/bin/tool",
        argvCount: 2,
        environmentSupplied: true,
        stdioMode: "array",
        resolution: "complete",
      }),
    ]);
    expect(
      ir.childProcessInteractions.map(
        ({ kind, eventName, signalName, resolution }) => ({
          kind,
          eventName,
          signalName,
          resolution,
        }),
      ),
    ).toEqual([
      {
        kind: "listener",
        eventName: "exit",
        signalName: null,
        resolution: "complete",
      },
      {
        kind: "listener",
        eventName: "error",
        signalName: null,
        resolution: "complete",
      },
      {
        kind: "signal",
        eventName: null,
        signalName: "SIGINT",
        resolution: "complete",
      },
    ]);
    expect(ir.functionFingerprints[0]?.components.effects).toContain(
      "child-process",
    );
  });

  it("recovers configuration, requests, response consumers, and boundaries", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { readFileSync } from "node:fs";
      import * as http from "node:http";
      async function run(schema) {
        const endpoint = process.env.API_URL ?? "https://fallback.test";
        const mode = process.argv[2];
        const raw = readFileSync("./config.json", "utf8");
        const parsed = JSON.parse(raw);
        const port = Number(process.env.PORT);
        const validated = schema.parse(parsed);
        const response = await fetch(endpoint, {
          method: "POST",
          body: validated,
        });
        const body = await response.json();
        http.request("https://audit.test", { body });
        return { mode, port, body };
      }
    `);

    expect(
      ir.configurationOperations.map(({ kind, key }) => ({ kind, key })),
    ).toEqual(
      expect.arrayContaining([
        { kind: "environment", key: "API_URL" },
        { kind: "default", key: "API_URL" },
        { kind: "argv", key: "2" },
        { kind: "file", key: "./config.json" },
        { kind: "environment", key: "PORT" },
      ]),
    );
    expect(
      ir.requestOperations.map(({ kind, method, endpoint, resolution }) => ({
        kind,
        method,
        endpoint,
        resolution,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "request",
          method: "fetch",
          endpoint: null,
          resolution: "partial",
        },
        {
          kind: "response-consumer",
          method: "json",
          endpoint: null,
          resolution: "complete",
        },
        {
          kind: "request",
          method: "request",
          endpoint: "https://audit.test",
          resolution: "complete",
        },
      ]),
    );
    expect(
      ir.boundaryOperations.map(({ kind, method, resolution }) => ({
        kind,
        method,
        resolution,
      })),
    ).toEqual(
      expect.arrayContaining([
        { kind: "parse", method: "JSON.parse", resolution: "complete" },
        { kind: "coerce", method: "Number", resolution: "complete" },
        { kind: "parse", method: "parse", resolution: "partial" },
      ]),
    );
    expect(ir.functionFingerprints[0]?.components.effects).toContain("network");
  });
});

describe("JavaScript semantic analysis: native bindings 2", () => {
  it("recovers built-in resource acquisition and exact local release", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { open } from "node:fs/promises";
      import { connect as dial } from "node:net";
      async function run(path) {
        const file = await open(path);
        const socket = dial({ port: 9000 });
        await file.close();
        socket.destroy();
      }
    `);

    expect(
      ir.resourceOperations.map(({ kind, method, resolution }) => ({
        kind,
        method,
        resolution,
      })),
    ).toEqual([
      { kind: "acquire", method: "open", resolution: "complete" },
      { kind: "acquire", method: "connect", resolution: "complete" },
      { kind: "release", method: "close", resolution: "complete" },
      { kind: "release", method: "destroy", resolution: "complete" },
    ]);
    expect(ir.functionFingerprints[0]?.components.effects).toContain(
      "resource",
    );
  });
});

describe("JavaScript semantic analysis: child-process signals", () => {
  it("keeps unresolved kill signals distinct from default and literal signals", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { spawn } from "node:child_process";
      function run(signal) {
        const child = spawn("/bin/tool");
        child.kill(signal);
        child.kill();
        child.kill("SIGINT");
        child.kill(undefined);
        child.kill(undefined as NodeJS.Signals | undefined);
        child.kill(void 0);
        child.kill(void signal);
      }
      function shadowed(undefined) {
        const child = spawn("/bin/tool");
        child.kill(undefined);
      }
    `);

    expect(ir.childProcessSpawns).toHaveLength(2);
    expect(
      ir.childProcessInteractions.map(({ signalName }) => signalName),
    ).toEqual([
      null,
      "SIGTERM",
      "SIGINT",
      "SIGTERM",
      "SIGTERM",
      "SIGTERM",
      "SIGTERM",
      null,
    ]);
  });
});

describe("JavaScript semantic analysis: configuration value escapes", () => {
  const configurationReads = (body: string) =>
    analyzeJavaScriptSemantics(`function run() { ${body} }`)
      .configurationOperations.filter(({ kind }) => kind !== "default")
      .map(({ kind, key }) => [kind, key]);

  it.each([
    [
      "an environment value",
      "return Number(process.env.PORT);",
      "environment",
      "PORT",
    ],
    ["an argv entry", "return Number(process.argv[2]);", "argv", "2"],
  ])("keeps a read after passing %s to a call", (_name, body, kind, key) => {
    expect(configurationReads(body)).toEqual([[kind, key]]);
  });

  it.each([
    "patch(process.argv[key]); return process.argv[3];",
    "patch(process.argv.__proto__); return process.argv[3];",
    "const args = process.argv; patch(args[key]); return args[3];",
  ])(
    "retains uncertainty after an object-valued argv selection escapes: %s",
    (body) => {
      expect(configurationReads(body)).not.toContainEqual(["argv", "3"]);
    },
  );

  it("preserves an earlier top-level read and unrelated configuration after an argv escape", () => {
    const captured = analyzeJavaScriptSemantics(
      "const saved = process.argv[3]; patch(process.argv[key]); globalThis.saved = saved;",
    );
    expect(
      captured.configurationOperations.map(({ kind, key }) => [kind, key]),
    ).toContainEqual(["argv", "3"]);
    expect(
      configurationReads("patch(process.argv[key]); return process.env.PORT;"),
    ).toContainEqual(["environment", "PORT"]);
  });

  it.each([
    [
      "a direct argv entry",
      "process.argv[2] = {}; return Number(process.argv[2]);",
    ],
    [
      "an aliased argv entry",
      "const argv = process.argv; argv[2] = {}; return Number(process.argv[2]);",
    ],
    [
      "the argv container",
      "mutate(process.argv); return Number(process.argv[2]);",
    ],
    [
      "the env container",
      "mutate(process.env); return Number(process.env.PORT);",
    ],
  ])("leaves a read unknown after replacing %s", (_name, body) => {
    expect(configurationReads(body)).toEqual([]);
  });
});
