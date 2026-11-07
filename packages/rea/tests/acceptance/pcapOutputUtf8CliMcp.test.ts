import { expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { toolContract } from "../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { pcapResultSchemas } from "../../src/domain/pcap/pcapAnalysis.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  writeStubTools,
  type PcapStubToolsOptions,
} from "../fixtures/pcap/pcapTestTools.js";
import { cliTest } from "../support/cli/cliFixture.js";

const invalidVersionCases = [
  {
    tool: "tshark",
    stream: "stdout",
    options: { invalidTsharkVersionStream: "stdout" },
  },
  {
    tool: "tshark",
    stream: "stderr",
    options: { invalidTsharkVersionStream: "stderr" },
  },
  {
    tool: "capinfos",
    stream: "stdout",
    options: { invalidCapinfosVersionStream: "stdout" },
  },
  {
    tool: "capinfos",
    stream: "stderr",
    options: { invalidCapinfosVersionStream: "stderr" },
  },
] as const;

const environmentFor = (
  root: string,
  tools: { readonly tshark: string; readonly capinfos: string },
) => ({
  HOME: root,
  USERPROFILE: root,
  XDG_CONFIG_HOME: root,
  XDG_CACHE_HOME: root,
  REA_LOG_LEVEL: "silent",
  REA_TSHARK_COMMAND: tools.tshark,
  REA_CAPINFOS_COMMAND: tools.capinfos,
});

cliTest.skipIf(process.platform !== "linux")(
  "preserves contradictory packet counts through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pcap-count-mismatch-");
    const path = join(root, "capture.pcap");
    await writeFile(path, Buffer.from("pcap-fixture-bytes"));
    const { tshark, capinfos } = await writeStubTools(root, {
      tsharkJson: "[]",
      capinfosText:
        "File type: pcap\nFile encapsulation: Ethernet\nNumber of packets: 1\n",
    });
    const environment = environmentFor(root, { tshark, capinfos });
    const response = await cli.run({
      arguments: ["inspect-pcap-capture", path, "--json"],
      environment,
    });
    expect(response.exitCode, response.stdout).toBe(1);
    expect(response.json).toMatchObject({
      code: "unreadable_output",
      details: {
        diagnostics: {
          reason: "packet_count_mismatch",
          capinfos_packet_count: 1,
          tshark_packet_count: 0,
        },
      },
    });
    const { client, call } = await connectLocalToolsMcp(environment);
    try {
      const reply = await call("inspect_pcap_capture", { path });
      expect(reply.isError).toBe(true);
      const text = reply.content.find((item) => item.type === "text");
      if (text?.type !== "text") throw new Error("Missing MCP error text");
      expect(JSON.parse(text.text)).toEqual({ error: response.json });
    } finally {
      await client.close();
    }
  },
);

cliTest.skipIf(process.platform === "win32")(
  "returns the same unreadable-output diagnostic for invalid version streams through CLI and stdio MCP",
  async ({ cli }) => {
    for (const scenario of invalidVersionCases) {
      const root = await createTestTempDirectory("rea-pcap-version-utf8-");
      const tools = await writeStubTools(
        root,
        scenario.options as PcapStubToolsOptions,
      );
      const environment = environmentFor(root, tools);
      const cliResponse = await cli.run({
        arguments: ["inspect-pcap-client", "--json"],
        environment,
      });
      expect(cliResponse.exitCode, cliResponse.stdout).toBe(1);
      expect(cliResponse.json).toMatchObject({
        code: "unreadable_output",
        details: {
          diagnostics: {
            stage: "version",
            invalid_utf8_streams: [scenario.stream],
          },
          captured_output: {
            stdout: expect.stringContaining(
              scenario.tool === "tshark" ? "TShark" : "Capinfos",
            ),
          },
        },
      });

      const { client, call } = await connectLocalToolsMcp(environment);
      try {
        const reply = await call("inspect_pcap_client", {});
        expect(reply.isError).toBe(true);
        const content = reply.content.find((item) => item.type === "text");
        if (content?.type !== "text") throw new Error("Missing MCP error text");
        expect(JSON.parse(content.text)).toEqual({ error: cliResponse.json });
      } finally {
        await client.close();
      }
    }
  },
);

cliTest.skipIf(process.platform === "win32")(
  "preserves literal replacement characters in version output through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pcap-version-literal-");
    const tools = await writeStubTools(root, { literalTsharkVersion: true });
    const environment = environmentFor(root, tools);
    const outputSchema = toolContract("inspect_pcap_client").outputSchema;
    const cliResponse = await cli.run({
      arguments: ["inspect-pcap-client", "--json"],
      environment,
    });
    expect(cliResponse.exitCode, cliResponse.stdout).toBe(0);
    const cliEvidence = parseEvidence(outputSchema.parse(cliResponse.json));
    const cliClient = pcapResultSchemas.inspect_pcap_client.parse(
      cliEvidence.normalized_result,
    ).client;

    const { client, call } = await connectLocalToolsMcp(environment);
    try {
      const reply = await call("inspect_pcap_client", {});
      expect(reply.isError).not.toBe(true);
      const mcpEvidence = parseEvidence(
        outputSchema.parse(reply.structuredContent),
      );
      const mcpClient = pcapResultSchemas.inspect_pcap_client.parse(
        mcpEvidence.normalized_result,
      ).client;
      expect(cliClient).toEqual(mcpClient);
      expect(cliClient.tshark_version).toBe("TShark (Wireshark) 4.6.6�-stub");
    } finally {
      await client.close();
    }
  },
);
