import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { z } from "zod";

import {
  closeVerifierResources,
  withVerifierCleanup,
} from "../../../scripts/lib/verifier-cleanup.mjs";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { toolOutputSchemaWithMetadata } from "../../../src/contracts/toolSchemaMetadata.js";

const advertised = <
  Schema extends z.ZodType<Readonly<Record<string, unknown>>>,
>(
  schema: Schema,
): Schema =>
  toolOutputSchemaWithMetadata({
    ...toolContract("binary_session"),
    outputSchema: schema,
  });

const connect = async (server: McpServer, client: Client): Promise<void> => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
};

const expectState = async (
  client: Client,
  name: string,
  state: string,
): Promise<void> => {
  const result = await client.callTool({ name });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ state });
};

it("validates changed schemas after catalog refreshes and availability changes", async () => {
  const client = new Client({ name: "output-reuse-test", version: "1" });
  const server = new McpServer({ name: "output-reuse-fixture", version: "1" });
  const schema = advertised(z.strictObject({ state: z.literal("ready") }));
  let state = "ready";
  const selected = server.registerTool(
    "selected",
    { inputSchema: z.strictObject({}), outputSchema: schema },
    () => ({ content: [], structuredContent: { state } }),
  );
  server.registerTool(
    "equivalent",
    { inputSchema: z.strictObject({}), outputSchema: schema },
    () => ({ content: [], structuredContent: { state: "ready" } }),
  );
  await withVerifierCleanup(async () => {
    await connect(server, client);
    await client.listTools();
    await expectState(client, "selected", "ready");
    await client.listTools();
    await expectState(client, "equivalent", "ready");

    selected.update({
      outputSchema: advertised(z.strictObject({ state: z.literal("updated") })),
    });
    state = "updated";
    await client.listTools();
    await expectState(client, "selected", "updated");
    selected.disable();
    const unavailable = await client.listTools();
    expect(unavailable.tools.some((tool) => tool.name === "selected")).toBe(
      false,
    );
    await expect(client.callTool({ name: "selected" })).rejects.toThrow(
      /not found|disabled/iu,
    );
    await expectState(client, "equivalent", "ready");
    selected.enable();
    await client.listTools();
    await expectState(client, "selected", "updated");
  }, [() => client.close(), () => server.close()]);
});

it("uses the new server's schema after reconnecting the client", async () => {
  const client = new Client({ name: "output-reconnect-test", version: "1" });
  const servers: McpServer[] = [];
  await withVerifierCleanup(async () => {
    for (const state of ["first", "second"]) {
      const server = new McpServer({ name: `fixture-${state}`, version: "1" });
      servers.push(server);
      server.registerTool(
        "selected",
        {
          inputSchema: z.strictObject({}),
          outputSchema: advertised(z.strictObject({ state: z.literal(state) })),
        },
        () => ({ content: [], structuredContent: { state } }),
      );
      await connect(server, client);
      await client.listTools();
      await expectState(client, "selected", state);
      await client.close();
      await server.close();
    }
  }, [
    () => client.close(),
    () => closeVerifierResources(servers.map((server) => () => server.close())),
  ]);
});

it("advertises stable output identity without interpreting example data as references", async () => {
  const client = new Client({ name: "literal-output-test", version: "1" });
  const server = new McpServer({
    name: "literal-output-fixture",
    version: "1",
  });
  const value = { payload: { $ref: "child.json", $id: "example-only" } };
  const schema = advertised(
    z
      .strictObject({
        payload: z.strictObject({ $ref: z.string(), $id: z.string() }),
      })
      .meta({ examples: [value], default: value }),
  );
  server.registerTool(
    "literal_output",
    {
      inputSchema: z.strictObject({}),
      outputSchema: schema,
    },
    () => ({ content: [], structuredContent: value }),
  );
  await withVerifierCleanup(async () => {
    await connect(server, client);
    const first = await client.listTools();
    const second = await client.listTools();
    const output = first.tools.find(
      (tool) => tool.name === "literal_output",
    )?.outputSchema;
    expect(output?.$id).toMatch(/^urn:rea:tool-output:sha256:[a-f0-9]{64}$/u);
    expect(second.tools[0]?.outputSchema).toEqual(output);
    expect(output?.examples).toEqual([value]);
    expect(output?.default).toEqual(value);
    expect(
      (await client.callTool({ name: "literal_output" })).structuredContent,
    ).toEqual(value);
    expect(output).toBeDefined();
    const validate = new AjvJsonSchemaValidator().getValidator(
      z.record(z.string(), z.unknown()).parse(output),
    );
    expect(validate({ payload: 7 }).valid).toBe(false);
    expect(validate({ ...value, unexpected: true }).valid).toBe(false);
  }, [() => client.close(), () => server.close()]);
});
