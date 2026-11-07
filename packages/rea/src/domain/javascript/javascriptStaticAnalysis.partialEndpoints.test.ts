import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const endpoints = (source: string) =>
  analyzeJavaScriptStaticSource(source).endpoints.map((endpoint) => ({
    kind: endpoint.kind,
    value: endpoint.value,
    mechanism: endpoint.mechanism,
    resolution: endpoint.resolution,
  }));

it("resolves unchanged lexical strings and object properties", () => {
  expect(
    endpoints(`
        const target = "/items";
        const config = { url: "/accounts" };
        fetch(target);
        fetch("/direct");
        fetch(config.url);
      `),
  ).toEqual([
    {
      kind: "network",
      value: "/items",
      mechanism: "call:fetch",
      resolution: undefined,
    },
    {
      kind: "network",
      value: "/direct",
      mechanism: "call:fetch",
      resolution: undefined,
    },
    {
      kind: "network",
      value: "/accounts",
      mechanism: "call:fetch",
      resolution: undefined,
    },
  ]);
});

it("resolves unchanged URL objects and aliases using URL serialization", () => {
  expect(
    endpoints(`
        const socket = new URL("HTTPS://EXAMPLE.COM:443");
        const alias = socket;
        const relative = new URL("/items", "https://api.example.test/base");
        fetch(alias);
        fetch(relative);
      `),
  ).toEqual([
    {
      kind: "network",
      value: "https://example.com/",
      mechanism: "call:fetch",
      resolution: undefined,
    },
    {
      kind: "network",
      value: "https://api.example.test/items",
      mechanism: "call:fetch",
      resolution: undefined,
    },
  ]);
});

it("keeps an interpolated request expression verbatim", () => {
  expect(
    endpoints("fetch(`https://${hosts['a@b']}/items/${id}`);"),
  ).toContainEqual({
    kind: "network",
    value: "`https://${hosts['a@b']}/items/${id}`",
    mechanism: "call:fetch",
    resolution: "partial",
  });
});

it("keeps writes to a config property partial instead of resolving its initializer", () => {
  expect(
    endpoints(`
        const config = { url: "https://old.example.test" };
        config.url = "https://new.example.test";
        fetch(config.url);
      `),
  ).toContainEqual({
    kind: "network",
    value: "config.url",
    mechanism: "call:fetch",
    resolution: "partial",
  });
});

it("keeps a reassigned endpoint binding partial", () => {
  expect(
    endpoints(`
        let endpoint = "https://old.example.test";
        endpoint = "https://new.example.test";
        fetch(endpoint);
      `),
  ).toContainEqual({
    kind: "network",
    value: "endpoint",
    mechanism: "call:fetch",
    resolution: "partial",
  });
});

it("does not resolve an endpoint from a declaration after the request", () => {
  expect(
    endpoints(`
        fetch(endpoint);
        const endpoint = "https://api.example.test/items";
      `),
  ).toEqual([
    {
      kind: "network",
      value: "endpoint",
      mechanism: "call:fetch",
      resolution: "partial",
    },
  ]);
});

it("keeps URLSearchParams mutations partial", () => {
  expect(
    endpoints(`
        const socket = new URL("wss://old.example.test/socket");
        socket.searchParams.set("token", token);
        new WebSocket(socket);
      `),
  ).toContainEqual({
    kind: "network",
    value: "socket",
    mechanism: "call:WebSocket",
    resolution: "partial",
  });
});

it("resolves a URL object against a literal base", () => {
  expect(
    endpoints(`
        const socket = new URL("/socket", "wss://api.example.test");
        new WebSocket(socket);
      `),
  ).toEqual([
    {
      kind: "network",
      value: "wss://api.example.test/socket",
      mechanism: "call:WebSocket",
      resolution: undefined,
    },
  ]);
});

it("resolves an unchanged URL object's toString target", () => {
  expect(
    endpoints(`
        const socket = new URL("wss://api.example.test/socket");
        new WebSocket(socket.toString());
      `),
  ).toEqual([
    {
      kind: "network",
      value: "wss://api.example.test/socket",
      mechanism: "call:WebSocket",
      resolution: undefined,
    },
  ]);
});

it("keeps a URL object partial when its base is unresolved", () => {
  expect(
    endpoints(`
        const socket = new URL("/socket", apiOrigin);
        new WebSocket(socket);
      `),
  ).toContainEqual({
    kind: "network",
    value: "socket",
    mechanism: "call:WebSocket",
    resolution: "partial",
  });
});

it("keeps URL aliases partial after a member mutation", () => {
  expect(
    endpoints(`
        const socket = new URL("wss://old.example.test/socket");
        const alias = socket;
        alias.hostname = "new.example.test";
        fetch(socket);
      `),
  ).toContainEqual({
    kind: "network",
    value: "socket",
    mechanism: "call:fetch",
    resolution: "partial",
  });
});

it("keeps an escaped URL object partial", () => {
  expect(
    endpoints(`
        const socket = new URL("wss://old.example.test/socket");
        configure(socket);
        new WebSocket(socket);
      `),
  ).toContainEqual({
    kind: "network",
    value: "socket",
    mechanism: "call:WebSocket",
    resolution: "partial",
  });
});

it("retains dynamic targets on known global fetch receivers", () => {
  expect(
    endpoints(`
        window.fetch(endpoint);
        globalThis.fetch(endpoint);
        self.fetch(endpoint);
      `),
  ).toEqual([
    {
      kind: "network",
      value: "endpoint",
      mechanism: "call:window.fetch",
      resolution: "partial",
    },
    {
      kind: "network",
      value: "endpoint",
      mechanism: "call:globalThis.fetch",
      resolution: "partial",
    },
    {
      kind: "network",
      value: "endpoint",
      mechanism: "call:self.fetch",
      resolution: "partial",
    },
  ]);
});

it("does not treat a locally bound fetch function as a network API", () => {
  expect(
    endpoints(`
        function fetch(key) { return records[key]; }
        fetch(key);
      `),
  ).toEqual([]);
});

it("keeps exact literal targets exact", () => {
  expect(endpoints('fetch("https://api.example.test/items");')).toEqual([
    {
      kind: "network",
      value: "https://api.example.test/items",
      mechanism: "call:fetch",
      resolution: undefined,
    },
  ]);
});

it("resolves inline Request constructor targets with literal URLs", () => {
  expect(
    endpoints(`
        fetch(new Request("/api/chat", { method: "POST" }));
        window.fetch(new Request("/api/window"));
      `),
  ).toEqual([
    {
      kind: "network",
      value: "/api/chat",
      mechanism: "call:fetch",
      resolution: undefined,
    },
    {
      kind: "network",
      value: "/api/window",
      mechanism: "call:window.fetch",
      resolution: undefined,
    },
  ]);
});

it("keeps Request calls without new partial", () => {
  expect(endpoints('fetch(Request("/api/stream"));')).toEqual([
    {
      kind: "network",
      value: 'Request("/api/stream")',
      mechanism: "call:fetch",
      resolution: "partial",
    },
  ]);
});

it("resolves unchanged Request objects and aliases", () => {
  expect(
    endpoints(`
        const req = new Request("/api/chat", { method: "POST" });
        const alias = req;
        fetch(alias);
      `),
  ).toEqual([
    {
      kind: "network",
      value: "/api/chat",
      mechanism: "call:fetch",
      resolution: undefined,
    },
  ]);
});

it("keeps Request objects partial when called with toString", () => {
  expect(
    endpoints(`
        const req = new Request("/api/chat");
        fetch(req.toString());
      `),
  ).toEqual([
    {
      kind: "network",
      value: "req.toString()",
      mechanism: "call:fetch",
      resolution: "partial",
    },
  ]);
});

it("keeps Request targets partial on non-fetch network APIs", () => {
  expect(
    endpoints(`
        const socketReq = new Request("wss://host/socket");
        new WebSocket(new Request("wss://host/direct"));
        new WebSocket(socketReq);
        navigator.sendBeacon(new Request("https://api.example.test/beacon"));
      `),
  ).toEqual([
    {
      kind: "network",
      value: 'new Request("wss://host/direct")',
      mechanism: "call:WebSocket",
      resolution: "partial",
    },
    {
      kind: "network",
      value: "socketReq",
      mechanism: "call:WebSocket",
      resolution: "partial",
    },
    {
      kind: "network",
      value: 'new Request("https://api.example.test/beacon")',
      mechanism: "call:navigator.sendBeacon",
      resolution: "partial",
    },
  ]);
});

it("keeps Request objects partial when Request is locally shadowed", () => {
  expect(
    endpoints(`
        function test(Request) {
          fetch(new Request("/api/shadowed"));
        }
      `),
  ).toContainEqual({
    kind: "network",
    value: 'new Request("/api/shadowed")',
    mechanism: "call:fetch",
    resolution: "partial",
  });
});
