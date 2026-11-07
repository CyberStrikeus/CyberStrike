import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

describe("JavaScript semantic analysis: runtime boundaries 1", () => {
  it("recovers EventEmitter candidates and imported timer handle cancellation", () => {
    const ir = analyzeJavaScriptSemantics(`
      import {
        setTimeout as later,
        clearTimeout as cancel,
      } from "node:timers";
      function run(bus, dynamicName) {
        const handle = later(work, 25);
        bus.on("ready", handler);
        bus.once(dynamicName, handler);
        bus.emit("ready");
        bus.off("ready", handler);
        cancel(handle);
      }
    `);

    expect(
      ir.eventOperations.map(({ kind, method, eventName, resolution }) => ({
        kind,
        method,
        eventName,
        resolution,
      })),
    ).toEqual([
      {
        kind: "register",
        method: "on",
        eventName: "ready",
        resolution: "complete",
      },
      {
        kind: "register",
        method: "once",
        eventName: null,
        resolution: "unresolved",
      },
      {
        kind: "dispatch",
        method: "emit",
        eventName: "ready",
        resolution: "complete",
      },
      {
        kind: "remove",
        method: "off",
        eventName: "ready",
        resolution: "complete",
      },
    ]);
    expect(ir.timerOperations).toEqual([
      expect.objectContaining({
        kind: "schedule",
        method: "setTimeout",
        delayMilliseconds: 25,
        resolution: "complete",
      }),
      expect.objectContaining({
        kind: "cancel",
        method: "clearTimeout",
        delayMilliseconds: null,
        resolution: "complete",
        linkedTimerId: ir.timerOperations[0]?.timerId,
      }),
    ]);
    expect(ir.functionFingerprints[0]?.components.effects).toEqual([
      "event",
      "timer",
    ]);
  });

  it("keeps an overflowing timer delay unknown in a complete semantic result", () => {
    const ir = analyzeJavaScriptSemantics(`
      function greet() { return "hello"; }
      setTimeout(() => greet(), 1e999);
    `);

    expect(ir.timerOperations).toEqual([
      expect.objectContaining({
        kind: "schedule",
        method: "setTimeout",
        delayMilliseconds: null,
        resolution: "complete",
      }),
    ]);
    expect(ir.callables.some(({ name }) => name === "greet")).toBe(true);
  });

  it("does not treat shadowed timer globals as Node timers", () => {
    const ir = analyzeJavaScriptSemantics(`
      function run(setTimeout, clearTimeout) {
        const handle = setTimeout(work, 1);
        clearTimeout(handle);
      }
    `);

    expect(ir.timerOperations).toEqual([]);
  });

  it("does not invent request fields or option keys from dynamic properties", () => {
    const ir = analyzeJavaScriptSemantics(`
      const key = resolveKey();
      fetch("https://example.test", { [key]: 1, body: "x" });
      spawn("/bin/tool", { [key]: vars });
    `);
    expect(
      ir.requestOperations.flatMap(({ fields }) =>
        fields.map(({ name }) => name),
      ),
    ).toEqual(["body"]);
    expect(
      ir.childProcessSpawns.some(
        ({ environmentSupplied }) => environmentSupplied,
      ),
    ).toBe(false);
  });

  it("retains every added semantic effect family", () => {
    const ir = analyzeJavaScriptSemantics(
      `
        import { spawn } from "node:child_process";
        import { open } from "node:fs/promises";
        Promise.resolve(1);
        bus.on("ready", handler);
        setTimeout(work, 1);
        spawn("/bin/tool");
        const endpoint = process.env.API_URL;
        fetch("https://example.test");
        JSON.parse(raw);
        open(path);
      `,
    );

    expect(ir.coverage.status).toBe("complete");
    expect(ir.promiseOperations).toHaveLength(1);
    expect(ir.eventOperations).toHaveLength(1);
    expect(ir.timerOperations).toHaveLength(1);
    expect(ir.childProcessSpawns).toHaveLength(1);
    expect(ir.configurationOperations).toHaveLength(1);
    expect(ir.requestOperations).toHaveLength(1);
    expect(ir.boundaryOperations).toHaveLength(1);
    expect(ir.resourceOperations).toHaveLength(1);
    expect(ir.objectOperations.length).toBeGreaterThan(0);
  });
});

describe("JavaScript semantic analysis: event dispatch data", () => {
  it("keeps emitted data out of dispatch listener fields", () => {
    const ir = analyzeJavaScriptSemantics(`
      import { EventEmitter } from "node:events";
      const bus = new EventEmitter();
      const data = 1;
      const handler = () => {};
      bus.on("ready", handler);
      bus.emit("ready", data);
      bus.emit("ready");
      bus.off("ready", handler);
      bus.removeAllListeners("ready", data);
    `);
    const handler = ir.bindings.find(({ name }) => name === "handler");
    expect(handler).toBeDefined();
    expect(
      ir.eventOperations.map(
        ({ kind, method, listenerBindingId, listenerLocation }) => ({
          kind,
          method,
          listenerBindingId,
          hasListenerLocation: listenerLocation !== null,
        }),
      ),
    ).toEqual([
      {
        kind: "register",
        method: "on",
        listenerBindingId: handler?.bindingId,
        hasListenerLocation: true,
      },
      {
        kind: "dispatch",
        method: "emit",
        listenerBindingId: null,
        hasListenerLocation: false,
      },
      {
        kind: "dispatch",
        method: "emit",
        listenerBindingId: null,
        hasListenerLocation: false,
      },
      {
        kind: "remove",
        method: "off",
        listenerBindingId: handler?.bindingId,
        hasListenerLocation: true,
      },
      {
        kind: "remove",
        method: "removeAllListeners",
        listenerBindingId: null,
        hasListenerLocation: false,
      },
    ]);
    expect(
      ir.eventOperations.map(({ eventName, resolution }) => [
        eventName,
        resolution,
      ]),
    ).toEqual([
      ["ready", "complete"],
      ["ready", "complete"],
      ["ready", "complete"],
      ["ready", "complete"],
      ["ready", "complete"],
    ]);
  });
});

describe("JavaScript semantic analysis: replaced built-in globals", () => {
  it.each([
    ["setTimeout", "setTimeout = local; setTimeout(work, 1);", "timer"],
    [
      "globalThis.setTimeout",
      "globalThis.setTimeout = local; setTimeout(work, 1);",
      "timer",
    ],
    ["fetch", "fetch = local; fetch('https://example.test');", "request"],
    [
      "WebSocket",
      "WebSocket = local; new WebSocket('wss://example.test');",
      "request",
    ],
    // A replaced JSON.parse keeps only the generic, partial `.parse` candidate.
    ["JSON.parse", "JSON.parse = local; JSON.parse('null');", "boundary"],
    ["JSON", "JSON = { parse: local }; JSON.parse('null');", "boundary"],
    ["String", "String = local; String(value);", "boundary"],
  ] as const)(
    "does not admit built-in effects after a visible %s replacement",
    (_name, source, family) => {
      const ir = analyzeJavaScriptSemantics(source);
      const operations = {
        timer: ir.timerOperations,
        request: ir.requestOperations,
        boundary: ir.boundaryOperations,
      };
      expect(
        operations[family].filter(
          ({ resolution }) => resolution === "complete",
        ),
      ).toEqual([]);
    },
  );

  it("keeps built-in effects for unmodified globals beside unrelated writes", () => {
    const ir = analyzeJavaScriptSemantics(`
      JSON.stringify = local; other.setTimeout = local;
      setTimeout(work, 1);
      fetch('https://example.test');
      new WebSocket('wss://example.test');
      JSON.parse('null');
      String(value);
    `);
    expect(ir.timerOperations).toMatchObject([
      { method: "setTimeout", resolution: "complete" },
    ]);
    expect(ir.requestOperations.map(({ method }) => method)).toEqual([
      "fetch",
      "WebSocket",
    ]);
    expect(ir.boundaryOperations).toMatchObject([
      { method: "JSON.parse", resolution: "complete" },
      { method: "String", resolution: "complete" },
    ]);
  });
});
