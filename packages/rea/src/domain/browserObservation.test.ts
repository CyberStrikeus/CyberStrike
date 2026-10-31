import { describe, expect, it } from "vitest";

import {
  browserEndpointSchema,
  browserObservationEndpointSchema,
  browserOriginSchema,
  recordedBrowserOriginSchema,
  recordedBrowserObservationEndpointSchema,
  sanitizeEndpointCandidate,
  sanitizeBrowserUrl,
} from "./browserObservation.js";

describe("browser observation contracts", () => {
  it.each(["127.0.0.1", "[::1]"])(
    "preserves explicitly supplied default endpoint ports on %s",
    (host) => {
      const http = `http://${host}:80`;
      expect(browserEndpointSchema.parse(http)).toBe(http);
      expect(
        browserEndpointSchema.parse(browserEndpointSchema.parse(http)),
      ).toBe(http);
      expect(recordedBrowserObservationEndpointSchema.parse(http)).toBe(http);
      const socket = `ws://${host}:80/devtools/browser/id`;
      expect(browserObservationEndpointSchema.parse(socket)).toEqual({
        transport: "browser_websocket",
        url: socket,
        recorded: `ws://${host}:80/devtools/browser/[REDACTED]`,
      });
      for (const value of [
        `http://${host}`,
        `ws://${host}/devtools/browser/id`,
        "http://192.0.2.1:80",
      ])
        expect(
          browserObservationEndpointSchema.safeParse(value).success,
          value,
        ).toBe(false);
    },
  );
  it("normalizes exact HTTP origins without accepting broader URL scopes", () => {
    expect(browserOriginSchema.parse("https://Example.COM:443")).toBe(
      "https://example.com",
    );
    expect(browserOriginSchema.parse("http://example.com:80")).toBe(
      "http://example.com",
    );
    for (const value of [
      "https://*.example.com",
      "https://example.com/path",
      "https://example.com/?token=secret",
      "https://example.com/?",
      "https://example.com/#",
      "https://user:pass@example.com",
      "file:///tmp/page.html",
    ])
      expect(browserOriginSchema.safeParse(value).success, value).toBe(false);
  });

  it("accepts only canonical recorded HTTP origins", () => {
    expect(recordedBrowserOriginSchema.parse("https://app.example.test")).toBe(
      "https://app.example.test",
    );
    for (const value of [
      "https://%2A.example.com",
      "https://*.example.com",
      "https://Example.COM:443",
    ])
      expect(recordedBrowserOriginSchema.safeParse(value).success, value).toBe(
        false,
      );
  });

  it("accepts only literal loopback HTTP CDP endpoints", () => {
    expect(browserEndpointSchema.parse("http://127.0.0.1:9222")).toBe(
      "http://127.0.0.1:9222",
    );
    expect(browserEndpointSchema.parse("http://[::1]:9222")).toBe(
      "http://[::1]:9222",
    );
    for (const value of [
      "http://localhost:9222",
      "http://192.168.1.2:9222",
      "https://127.0.0.1:9222",
      "http://127.0.0.1:9222/json/list",
      "http://127.0.0.1:9222/?",
      "http://127.0.0.1:9222/#",
      "http://user:pass@127.0.0.1:9222",
    ])
      expect(browserEndpointSchema.safeParse(value).success, value).toBe(false);
  });

  it("accepts a loopback browser socket and records it without its identifier", () => {
    expect(
      browserObservationEndpointSchema.parse("http://127.0.0.1:9222/"),
    ).toEqual({
      transport: "http_discovery",
      url: "http://127.0.0.1:9222",
      recorded: "http://127.0.0.1:9222",
    });
    expect(
      browserObservationEndpointSchema.parse(
        "ws://[::1]:9222/devtools/browser/0b1c-socket-id",
      ),
    ).toEqual({
      transport: "browser_websocket",
      url: "ws://[::1]:9222/devtools/browser/0b1c-socket-id",
      recorded: "ws://[::1]:9222/devtools/browser/[REDACTED]",
    });
    for (const value of [
      "ws://127.0.0.1/devtools/browser/id",
      "ws://localhost:9222/devtools/browser/id",
      "wss://127.0.0.1:9222/devtools/browser/id",
      "ws://user:pass@127.0.0.1:9222/devtools/browser/id",
      "ws://127.0.0.1:9222/devtools/browser/id?token=x",
      "ws://127.0.0.1:9222/devtools/browser/id#fragment",
      "ws://127.0.0.1:9222/devtools/browser/id?",
      "ws://127.0.0.1:9222/devtools/browser/id#",
      "ws://127.0.0.1:9222/devtools/browser/",
      "ws://127.0.0.1:9222/devtools/browser/id/extra",
      "ws://127.0.0.1:9222/devtools/page/id",
    ])
      expect(
        browserObservationEndpointSchema.safeParse(value).success,
        value,
      ).toBe(false);
  });

  it("accepts recorded browser sockets only in their redacted form", () => {
    for (const value of [
      "http://127.0.0.1:9222",
      "ws://127.0.0.1:9222/devtools/browser/[REDACTED]",
    ])
      expect(
        recordedBrowserObservationEndpointSchema.safeParse(value).success,
        value,
      ).toBe(true);
    expect(
      recordedBrowserObservationEndpointSchema.safeParse(
        "ws://127.0.0.1:9222/devtools/browser/0b1c-socket-id",
      ).success,
    ).toBe(false);
  });
});

describe("browser observation sensitive surfaces and retention", () => {
  it("removes only URL userinfo and preserves the original query and fragment", () => {
    expect(
      sanitizeBrowserUrl(
        "https://user:pass@app.example.test/path?token=secret&mode=full&token=again#part",
      ),
    ).toEqual({
      url: "https://app.example.test/path?token=secret&mode=full&token=again#part",
      origin: "https://app.example.test",
      query_parameter_names: ["token", "mode", "token"],
      redacted: true,
    });

    const backslashAuthority = String.raw`https:\\user:pass@app.example.test/path?x=a+b&x=two#part`;
    const sanitized = sanitizeBrowserUrl(backslashAuthority);
    expect(sanitized.url).toBe(
      "https://app.example.test/path?x=a+b&x=two#part",
    );
    expect(sanitized.url).not.toContain("user:pass");
    expect(sanitized.redacted).toBe(true);
  });

  it("preserves path userinfo-like text after a special-scheme backslash", () => {
    const suffix = String.raw`\path@tail/../keep?x=1#frag`;
    expect(
      sanitizeBrowserUrl(`https://user:pass@app.example.test${suffix}`),
    ).toEqual({
      url: `https://app.example.test${suffix}`,
      origin: "https://app.example.test",
      query_parameter_names: ["x"],
      redacted: true,
    });
    expect(sanitizeBrowserUrl(`https://app.example.test${suffix}`)).toEqual({
      url: `https://app.example.test${suffix}`,
      origin: "https://app.example.test",
      query_parameter_names: ["x"],
      redacted: false,
    });
    expect(
      sanitizeBrowserUrl(
        String.raw`custom://user:pass@host\name@tail/path?x=1#frag`,
      ),
    ).toEqual({
      url: "custom://tail/path?x=1#frag",
      origin: null,
      query_parameter_names: ["x"],
      redacted: true,
    });
    expect(
      sanitizeBrowserUrl("https://us\ter:pass@app.example.test/path?x=1#frag"),
    ).toEqual({
      url: "https://app.example.test/path?x=1#frag",
      origin: "https://app.example.test",
      query_parameter_names: ["x"],
      redacted: true,
    });
  });

  it("retains ordinary query values and malformed URL diagnostics", () => {
    const longName = `a${"x".repeat(400)}`;
    const parameters = [
      `${longName}=secret`,
      ...Array.from(
        { length: 300 },
        (_value, index) => `k${String(index).padStart(3, "0")}=secret`,
      ),
    ].join("&");
    const sanitized = sanitizeBrowserUrl(
      `https://app.example.test/path?${parameters}`,
    );
    expect(sanitized.query_parameter_names).toHaveLength(301);
    expect(sanitized.query_parameter_names).toContain(longName);
    expect(sanitized.url).toContain(`${longName}=secret`);
    expect(sanitized.url).toContain("k299=secret");

    const oversized = sanitizeBrowserUrl(
      `https://app.example.test/${"p".repeat(70_000)}`,
    );
    expect(oversized.origin).toBe("https://app.example.test");
    expect(oversized.url.length).toBeGreaterThan(70_000);
    expect(oversized.redacted).toBe(false);

    const malformed = "https://[invalid?token=diagnostic#fragment";
    expect(sanitizeBrowserUrl(malformed)).toEqual({
      url: malformed,
      origin: null,
      query_parameter_names: [],
      redacted: false,
    });
    expect(sanitizeEndpointCandidate(malformed)).toBe(malformed);
    expect(sanitizeEndpointCandidate("/api/search?q=rea#results")).toBe(
      "/api/search?q=rea#results",
    );
  });
});
