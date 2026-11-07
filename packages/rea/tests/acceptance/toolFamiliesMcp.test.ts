import { join } from "node:path";
import { expect, it } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";

it.each(["full", "compact", "off"] as const)(
  "keeps real stdio discovery, status identity and disabled calls in the same family scope (%s)",
  async (outputProfile) => {
    const { client, call } = await connectLocalToolsMcp({
      REA_MCP_TOOL_FAMILIES: "session",
      REA_MCP_OUTPUT_SCHEMA_PROFILE: outputProfile,
    });
    const tools = (await client.listTools()).tools;
    const names = tools.map(({ name }) => name).sort();
    expect(names).toContain("binary_session");
    expect(names).toContain("export_evidence_bundle");
    expect(names).not.toContain("inspect_native_exports");
    const reply = await call("binary_session", {});
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const status = toolContract("binary_session").outputSchema.parse(
      reply.structuredContent,
    ).result;
    expect(status.server_identity.catalog.counts.mcp_tools).toBe(names.length);
    expect(
      status.tool_availability.groups.flatMap(({ names }) => names).sort(),
    ).toEqual(names);
    await expect(
      call("inspect_native_exports", {
        path: join(process.cwd(), "disabled-target-is-never-read.elf"),
      }),
    ).rejects.toThrow(/disabled/u);
  },
);
