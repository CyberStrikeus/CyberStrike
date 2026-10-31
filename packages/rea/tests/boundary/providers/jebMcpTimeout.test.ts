import { expect, it } from "vitest";
import { JebProvider } from "../../../src/jeb/JebProvider.js";
import { createStreamableHttpJebMcpConnection } from "../../../src/jeb/JebMcpConnection.js";
import { AnalysisTimeoutError } from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  startJebMcpFixture,
  jebPrimaryResponses,
} from "../../fixtures/jebMcp.js";

it.each([
  { operation: "inspect_jeb_client", stage: "catalog" },
  { operation: "inspect_jeb_client", stage: "tool" },
  { operation: "list_jeb_units", stage: "catalog" },
  { operation: "list_jeb_units", stage: "tool" },
] as const)(
  "attributes a real SDK $stage timeout to $operation",
  async ({ operation, stage }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await startJebMcpFixture(
      async (tool) => {
        await gate;
        return jebPrimaryResponses[tool]!;
      },
      stage === "catalog"
        ? async () => {
            await gate;
            return { tools: [] };
          }
        : undefined,
    );
    const provider = new JebProvider({
      environment: { REA_JEB_MCP_URL: fixture.endpoint },
      connectionFactory: (endpoint) =>
        createStreamableHttpJebMcpConnection(endpoint, {
          discoveryTimeoutMs: 100,
          requestTimeoutMs: 100,
        }),
    });
    try {
      const result = await provider.execute(
        operation === "inspect_jeb_client"
          ? { operation, input: {} }
          : { operation, input: { count: 2, index: 0 } },
      );
      if (result.ok) throw new Error("Timed-out MCP request passed");
      expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
      expect(result.error).toMatchObject({ operation, timeoutMs: 100 });
      const projected = projectAnalysisError(result.error);
      expect(projected.message).toContain(
        stage === "catalog" ? "catalog discovery" : "tools/call",
      );
      expect(projected.message).toContain("100 ms");
      expect(projected.remediation.action).toContain("REA_JEB_MCP_TIMEOUT_MS");
      expect(projected.remediation.action).toContain("2147483647");
      expect(projected.remediation.action).toContain("60000");
      expect(projected.remediation.action).toContain("restart");
      expect(result.error.cause).toBeDefined();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      release();
      await provider.close();
      await fixture.close();
    }
  },
);
