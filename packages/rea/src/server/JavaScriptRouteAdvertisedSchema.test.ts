import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

import { toolContract } from "../contracts/toolContracts.js";
import { toolOutputSchemaWithMetadata } from "../contracts/toolSchemaMetadata.js";
import { javaScriptRouteCandidateSchema } from "../domain/javascript/javascriptRouteFacts.js";
import { javaScriptInventoryRouteSchema } from "../domain/javascript/javascriptRouteInventory.js";
import { RequestTrackingMcpServer } from "./RequestTrackingMcpServer.js";

it("advertises JavaScript route outputs with standard JSON Schema path constraints", async () => {
  const server = new RequestTrackingMcpServer({
    name: "route-schema",
    version: "1",
  });
  const contract = toolContract("analyze_javascript_application");
  server.registerTool(
    contract.name,
    {
      outputSchema: toolOutputSchemaWithMetadata(contract),
    },
    () => ({ content: [] }),
  );
  const client = new Client({ name: "route-schema-client", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const advertised = (await client.listTools()).tools.find(
      (tool) => tool.name === contract.name,
    )?.outputSchema;
    expect(advertised).toBeDefined();
    if (advertised === undefined)
      throw new Error("Missing advertised route schema");
    const ajv = new Ajv2020({
      strictSchema: true,
      strictTypes: false,
      code: { optimize: false },
    });
    const require = createRequire(import.meta.url);
    const addFormats: unknown = require("ajv-formats");
    if (typeof addFormats !== "function")
      throw new Error("Pinned AJV formats plugin is unavailable");
    addFormats(ajv);
    expect(() => ajv.compile(advertised as AnySchema)).not.toThrow();

    // The inventory path is nested inside the advertised complete Evidence branch.
    const patterns: Record<string, unknown>[] = [];
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const record = value as Record<string, unknown>;
      if (record.pattern === "^\\/") patterns.push(record);
      Object.values(record).forEach(visit);
    };
    visit(advertised);
    expect(patterns.length).toBeGreaterThan(0);
    for (const schema of patterns) {
      const validate = ajv.compile(schema);
      for (const path of ["/", "/users", "/users\nsettings", "/\r\n"]) {
        expect(validate(path), path).toBe(true);
        expect(
          javaScriptRouteCandidateSchema.shape.path.safeParse(path).success,
        ).toBe(true);
        expect(
          javaScriptInventoryRouteSchema.shape.path.safeParse(path).success,
        ).toBe(true);
      }
      for (const path of ["", "users", "\n/users", "https://example.test/"]) {
        expect(validate(path), path).toBe(false);
        expect(
          javaScriptRouteCandidateSchema.shape.path.safeParse(path).success,
        ).toBe(false);
        expect(
          javaScriptInventoryRouteSchema.shape.path.safeParse(path).success,
        ).toBe(false);
      }
    }
  } finally {
    await client.close();
    await server.close();
  }
});
