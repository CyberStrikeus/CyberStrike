import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const protocolsOf = (source: string) =>
  analyzeJavaScriptStaticSource(source).electron.protocols;

const literal = (value: string) => ({
  status: "literal",
  value,
  expression: null,
});

describe("Electron custom protocol registrations", () => {
  it("does not invent the module-only privileged API on a session protocol", () => {
    const protocols = protocolsOf(`
      const { protocol, session } = require("electron");
      session.defaultSession.protocol.registerSchemesAsPrivileged([{ scheme: "fake" }]);
      session.defaultSession.protocol.handle("real", handler);
      protocol.registerSchemesAsPrivileged([{ scheme: "real" }]);
    `);
    expect(protocols.map(({ api, scheme }) => [api, scheme])).toEqual([
      ["handle", literal("real")],
      ["registerSchemesAsPrivileged", literal("real")],
    ]);
  });

  it("records OS registration, privileged schemes, handlers and interceptors", () => {
    const protocols = protocolsOf(`
      const { app, protocol, session } = require("electron");
      app.setAsDefaultProtocolClient("myapp");
      protocol.registerSchemesAsPrivileged([
        { scheme: "app", privileges: { standard: true, secure: true, bypassCSP: false } },
        { scheme: "media", privileges: { stream: true } },
      ]);
      protocol.handle("app", (request) => fetch(request.url));
      session.defaultSession.protocol.registerFileProtocol("media", serve);
      protocol.interceptHttpProtocol("https", rewrite);
    `);
    expect(protocols).toMatchObject([
      {
        api: "setAsDefaultProtocolClient",
        role: "os-default-client",
        scheme: literal("myapp"),
        session: "default-protocol",
        enabled_privileges: null,
      },
      {
        api: "registerSchemesAsPrivileged",
        role: "privileged-scheme",
        scheme: literal("app"),
        enabled_privileges: ["secure", "standard"],
      },
      {
        api: "registerSchemesAsPrivileged",
        role: "privileged-scheme",
        scheme: literal("media"),
        enabled_privileges: ["stream"],
      },
      { api: "handle", role: "handler", scheme: literal("app") },
      {
        api: "registerFileProtocol",
        role: "handler",
        scheme: literal("media"),
        session: "default-session",
      },
      {
        api: "interceptHttpProtocol",
        role: "interceptor",
        scheme: literal("https"),
      },
    ]);
  });

  it("follows Electron identity through namespace and alias forms", () => {
    expect(
      protocolsOf(`
        const electron = require("electron");
        const desktop = electron.app;
        desktop.setAsDefaultProtocolClient("notes");
      `),
    ).toMatchObject([{ scheme: literal("notes") }]);
  });

  it("keeps non-literal schemes and privileges as unknown values", () => {
    const protocols = protocolsOf(`
      const { app, protocol } = require("electron");
      app.setAsDefaultProtocolClient(config.scheme);
      protocol.registerSchemesAsPrivileged([{ scheme: name, privileges: options }]);
      protocol.registerSchemesAsPrivileged(schemes);
    `);
    expect(protocols).toMatchObject([
      {
        role: "os-default-client",
        scheme: { status: "dynamic", expression: "config.scheme" },
      },
      {
        role: "privileged-scheme",
        scheme: { status: "dynamic", expression: "name" },
        enabled_privileges: null,
      },
      {
        role: "privileged-scheme",
        scheme: { status: "dynamic", expression: "schemes" },
        enabled_privileges: null,
      },
    ]);
  });

  it("keeps one finding per entry when entries are not object literals", () => {
    expect(
      protocolsOf(`
        const { protocol } = require("electron");
        protocol.registerSchemesAsPrivileged([firstScheme, secondScheme]);
      `),
    ).toMatchObject([
      { scheme: { status: "dynamic", expression: "firstScheme" } },
      { scheme: { status: "dynamic", expression: "secondScheme" } },
    ]);
  });

  it("uses the last value of a repeated privilege key", () => {
    expect(
      protocolsOf(`
        const { protocol } = require("electron");
        protocol.registerSchemesAsPrivileged([{
          scheme: "app",
          privileges: { secure: true, standard: true, secure: false, standard: true },
        }]);
      `),
    ).toMatchObject([{ enabled_privileges: ["standard"] }]);
  });

  it.each([
    [
      "a local object named protocol",
      'const protocol = { handle() {} }; protocol.handle("app", h);',
    ],
    [
      "a query rather than a registration",
      'const { protocol } = require("electron"); protocol.isProtocolHandled("app");',
    ],
    [
      "a removal",
      'const { app } = require("electron"); app.removeAsDefaultProtocolClient("app");',
    ],
    [
      "a non-default session",
      'const { session } = require("electron"); session.fromPartition("p").protocol.handle("app", h);',
    ],
  ])("ignores %s", (_name, source) => {
    expect(protocolsOf(source)).toEqual([]);
  });
});

describe("Electron protocol registrations in TypeScript sources", () => {
  it("reads TypeScript-asserted lists, entries and privileges", () => {
    expect(
      protocolsOf(`
        const { protocol } = require("electron");
        protocol.registerSchemesAsPrivileged([
          { scheme: "a", privileges: { secure: true } as const },
          { scheme: "b" } satisfies Entry,
        ] as const);
      `),
    ).toMatchObject([
      { scheme: literal("a"), enabled_privileges: ["secure"] },
      { scheme: literal("b"), enabled_privileges: [] },
    ]);
  });

  it("reads TypeScript-asserted schemes and privilege values", () => {
    expect(
      protocolsOf(`
        const { app, protocol } = require("electron");
        app.setAsDefaultProtocolClient("notes" as const);
        protocol.registerSchemesAsPrivileged([
          {
            scheme: "app" as const,
            privileges: { secure: true as const, standard: true satisfies boolean, stream: false as const },
          },
        ]);
      `),
    ).toMatchObject([
      { role: "os-default-client", scheme: literal("notes") },
      { scheme: literal("app"), enabled_privileges: ["secure", "standard"] },
    ]);
  });
});

describe("Electron privileged scheme spreads", () => {
  const privilegesOf = (privileges: string) =>
    protocolsOf(`
      const { protocol } = require("electron");
      protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: ${privileges} }]);
    `)[0]?.enabled_privileges;

  it.each([
    [
      "a literal spread before a key",
      "{ ...{ secure: true }, standard: true }",
      ["secure", "standard"],
    ],
    [
      "a later key overriding a spread",
      "{ ...{ secure: true, stream: true }, stream: false }",
      ["secure"],
    ],
    [
      "a later spread overriding a key",
      "{ standard: true, ...{ standard: false } }",
      [],
    ],
    [
      "nested literal spreads",
      "{ ...{ ...{ secure: true } as const } }",
      ["secure"],
    ],
    [
      "a __proto__ setter, which is not an own key",
      "{ ...{ __proto__: true }, secure: true }",
      ["secure"],
    ],
    ["a nullish spread", "{ secure: true, ...null, ...void 0 }", ["secure"]],
    ["allowExtensions", "{ allowExtensions: true }", ["allowExtensions"]],
    [
      "a key that is not an Electron privilege",
      "{ secure: true, notAPrivilege: true }",
      ["secure"],
    ],
  ])("reads %s", (_name, privileges, expected) => {
    expect(privilegesOf(privileges)).toEqual(expected);
  });

  it.each([
    ["a spread of an unknown value", "{ ...options, secure: true }"],
    [
      "a privilege with an unknown value",
      "{ secure: true, bypassCSP: config.allow }",
    ],
    [
      "a spread containing a getter",
      "{ ...{ get secure() { return true; } } }",
    ],
  ])("keeps %s unknown", (_name, privileges) => {
    expect(privilegesOf(privileges)).toBeNull();
  });
});

describe("Electron protocol registrations without a scheme", () => {
  it("records nothing when the scheme is known to be absent", () => {
    expect(
      protocolsOf(`
        const { app, protocol } = require("electron");
        protocol.handle();
        app.setAsDefaultProtocolClient(void 0);
        protocol.registerFileProtocol(null, serve);
      `),
    ).toEqual([]);
  });

  it.each([
    ["a hole", ","],
    ["an entry without a scheme", "{ privileges: { secure: true } },"],
    ["an entry with a null scheme", "{ scheme: null },"],
    ["a string entry", '"other",'],
  ])("records nothing for a list with %s", (_name, invalid) => {
    // Electron converts the whole list or throws before registering anything.
    expect(
      protocolsOf(`
        const { protocol } = require("electron");
        protocol.registerSchemesAsPrivileged([${invalid} { scheme: "app" }]);
      `),
    ).toEqual([]);
  });

  it("keeps entries next to a spread, which can supply any entries", () => {
    expect(
      protocolsOf(`
        const { protocol } = require("electron");
        protocol.registerSchemesAsPrivileged([...base, { scheme: "app" }]);
      `),
    ).toMatchObject([
      { scheme: { status: "dynamic" } },
      { scheme: literal("app") },
    ]);
  });
});

describe("Electron protocol calls that register nothing", () => {
  it.each([
    ["a handler without a callback", 'protocol.handle("app");'],
    ["a handler with a null callback", 'protocol.handle("app", null);'],
    [
      "an interceptor without a callback",
      'protocol.interceptHttpProtocol("https");',
    ],
    [
      "a privileged scheme object outside an array",
      'protocol.registerSchemesAsPrivileged({ scheme: "app" });',
    ],
    [
      "a privileged scheme string outside an array",
      'protocol.registerSchemesAsPrivileged("app");',
    ],
  ])("ignores %s", (_name, call) => {
    expect(
      protocolsOf(`const { protocol } = require("electron"); ${call}`),
    ).toEqual([]);
  });

  it("keeps a handler whose callback may come from a spread", () => {
    expect(
      protocolsOf(`
        const { protocol } = require("electron");
        protocol.handle("app", ...rest);
      `),
    ).toMatchObject([{ role: "handler", scheme: literal("app") }]);
  });

  it("reads privileges past a nullish spread in the entry", () => {
    expect(
      protocolsOf(`
        const { protocol } = require("electron");
        protocol.registerSchemesAsPrivileged([
          { scheme: "app", privileges: { secure: true }, ...null, ...void 0 },
        ]);
      `),
    ).toMatchObject([
      { scheme: literal("app"), enabled_privileges: ["secure"] },
    ]);
  });
});
