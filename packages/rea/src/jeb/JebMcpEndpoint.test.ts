import { describe, expect, it } from "vitest";

import { parseJebMcpEndpoint } from "../config/jebMcpEndpoint.js";

describe("JEB MCP endpoint", () => {
  it("rejects an explicit empty query or fragment instead of dropping it", () => {
    expect(parseJebMcpEndpoint("http://127.0.0.1:8425/mcp").ok).toBe(true);
    expect(parseJebMcpEndpoint("http://127.0.0.1:8425/mcp/").ok).toBe(true);
    for (const value of [
      "http://127.0.0.1:8425/mcp?",
      "http://127.0.0.1:8425/mcp#",
      "http://127.0.0.1:8425/mcp?#",
    ])
      expect(parseJebMcpEndpoint(value).ok, value).toBe(false);
  });

  it("accepts only the declared MCP route", () => {
    expect(parseJebMcpEndpoint("http://127.0.0.1:8425/mcp").ok).toBe(true);
    for (const path of ["/mcp/extra", "/not-mcp", "/"])
      expect(parseJebMcpEndpoint(`http://127.0.0.1:8425${path}`).ok, path).toBe(
        false,
      );
  });
});
