import { expect, it } from "vitest";
import { z } from "zod";
import { verifyCompleteToolCatalog } from "../../../scripts/lib/verify-package-core.mjs";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

it("verifies canonical names, converted schemas and session metadata together", async () => {
  const harness = await createApplicationMcpHarness();
  try {
    const listed = await harness.client.listTools();
    const sessionDefinition = listed.tools.find(
      ({ name }) => name === "binary_session",
    );
    if (sessionDefinition === undefined)
      throw new Error("Expected the binary_session definition");
    // Catalog order must not select which schema validates the lifecycle call.
    const tools = {
      ...listed,
      tools: [
        ...listed.tools.filter(({ name }) => name !== "binary_session"),
        sessionDefinition,
      ],
    };
    const status = await harness.client.callTool(
      {
        name: "binary_session",
        arguments: {},
      },
      { toolDefinition: sessionDefinition },
    );
    const forwarded: unknown[][] = [];
    const client = {
      listTools: async (...args: unknown[]) => {
        forwarded.push(args);
        return tools;
      },
      callTool: async (...args: unknown[]) => {
        forwarded.push(args);
        return status;
      },
    };
    const options = { timeout: 12_345 };
    const canonical = await verifyCompleteToolCatalog(client, options);
    expect(forwarded).toEqual([
      [undefined, options],
      [
        { name: "binary_session", arguments: {} },
        { ...options, toolDefinition: sessionDefinition },
      ],
    ]);
    expect(canonical).toEqual(tools.tools.map(({ name }) => name).sort());

    const omitted = tools.tools[0];
    if (omitted === undefined) throw new Error("Expected canonical tools");
    const reduced = { ...tools, tools: tools.tools.slice(1) };
    const body = z
      .object({
        result: z
          .object({
            tool_availability: z
              .object({
                groups: z.array(
                  z.object({ names: z.array(z.string()) }).passthrough(),
                ),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(
        JSON.parse(
          status.content.find((item) => item.type === "text")?.text ?? "null",
        ),
      );
    body.result.tool_availability.groups = body.result.tool_availability.groups
      .map((group) => ({
        ...group,
        names: group.names.filter((name) => name !== omitted.name),
      }))
      .filter((group) => group.names.length > 0);
    toolContract("binary_session").outputSchema.parse(body);
    const disagreeingOmission = {
      ...status,
      content: [{ type: "text" as const, text: JSON.stringify(body) }],
    };
    const matchingOmission = {
      ...disagreeingOmission,
      structuredContent: body,
    };
    await expect(
      verifyCompleteToolCatalog({
        ...client,
        callTool: async () => disagreeingOmission,
      }),
    ).rejects.toThrow("binary_session text and structured results disagree");
    // Equal inventories are insufficient when both omit the same canonical tool.
    await expect(
      verifyCompleteToolCatalog({
        listTools: async () => reduced,
        callTool: async () => matchingOmission,
      }),
    ).rejects.toThrow("invalid canonical tool catalog");
    await expect(
      verifyCompleteToolCatalog({
        ...client,
        listTools: async () => ({ ...tools, tools: [...tools.tools, omitted] }),
      }),
    ).rejects.toThrow("invalid canonical tool catalog");
    await expect(
      verifyCompleteToolCatalog({
        ...client,
        listTools: async () => ({
          ...tools,
          tools: [
            { ...omitted, name: "unknown_tool" },
            ...tools.tools.slice(1),
          ],
        }),
      }),
    ).rejects.toThrow("invalid canonical tool catalog");

    for (const kind of ["inputSchema", "outputSchema"] as const) {
      const malformed = {
        ...omitted,
        [kind]: {
          ...omitted[kind],
          type: "object" as const,
          properties: { broken: { type: "invalid-json-schema-type" } },
        },
      };
      await expect(
        verifyCompleteToolCatalog({
          ...client,
          listTools: async () => ({
            ...tools,
            tools: [malformed, ...tools.tools.slice(1)],
          }),
        }),
      ).rejects.toThrow(`invalid ${omitted.name}.${kind}`);
    }
    await expect(
      verifyCompleteToolCatalog({
        ...client,
        callTool: async () => matchingOmission,
      }),
    ).rejects.toThrow("tool inventory diverged from session metadata");
    // Optional output schemas remain valid for clients using that output profile.
    await expect(
      verifyCompleteToolCatalog({
        ...client,
        listTools: async () => ({
          ...tools,
          tools: tools.tools.map(({ outputSchema: _output, ...tool }) => tool),
        }),
      }),
    ).resolves.toEqual(canonical);
  } finally {
    await harness.close();
  }
});
