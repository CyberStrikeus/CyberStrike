import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { sessionOutputSchemas } from "../../../src/contracts/toolOutputSchemaGroups.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

// The server enables default packet tools only on Linux, where they can run.
const linux = process.platform === "linux";

const packetCaptureAvailability = async (
  environment: Readonly<Record<string, string | undefined>>,
  name = "inspect_packet_capture",
): Promise<Record<string, unknown> | undefined> => {
  const session = createTestBinarySession(() => {
    throw new Error("binary analysis must not start during status discovery");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    serverOptions: {
      environment: { ...environment, REA_MCP_OUTPUT_SCHEMA_PROFILE: "off" },
    },
    clientIdentity: { name: "packet-capture-availability", version: "1" },
  });
  const response = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  if (response.isError === true) throw new Error("binary_session failed");
  const parsed = sessionOutputSchemas.binary_session.parse(
    response.structuredContent,
  ).result;
  return expandToolAvailability(parsed.tool_availability).find(
    (tool) => tool.name === name,
  );
};

const executableTshark = async (prefix: string): Promise<string> => {
  const directory = await createTestTempDirectory(prefix);
  await mkdir(join(directory, "bin"));
  const tshark = join(directory, "bin", "tshark");
  await writeFile(tshark, "");
  await chmod(tshark, 0o700);
  return join(directory, "bin");
};

it.runIf(linux)(
  "reports packet tools available for a PATH-only TShark install",
  async () => {
    const bin = await executableTshark("rea-packet-path-only-");
    expect(await packetCaptureAvailability({ PATH: bin })).toMatchObject({
      available: true,
      reason: "available",
    });
  },
);

it.runIf(linux)(
  "reports packet tools available for an absolute REA_TSHARK_COMMAND",
  async () => {
    const bin = await executableTshark("rea-packet-absolute-");
    expect(
      await packetCaptureAvailability({
        PATH: "",
        REA_TSHARK_COMMAND: join(bin, "tshark"),
      }),
    ).toMatchObject({ available: true, reason: "available" });
  },
);

it.runIf(linux)(
  "reports packet tools missing for a relative REA_TSHARK_COMMAND even when PATH holds TShark",
  async () => {
    const bin = await executableTshark("rea-packet-relative-");
    expect(
      await packetCaptureAvailability({
        PATH: bin,
        REA_TSHARK_COMMAND: "bin/tshark",
      }),
    ).toMatchObject({ available: false, reason: "provider_missing" });
  },
);

it("reports packet tools unavailable when no absolute PATH entry holds TShark", async () => {
  // Off Linux the host, not the missing tool, keeps packet tools unavailable.
  expect(
    await packetCaptureAvailability({ PATH: "relative-entry" }),
  ).toMatchObject({
    available: false,
    reason: linux ? "provider_missing" : "unsupported_host",
  });
});

it("advertises pcap capture host support separately from the always available client probe", async () => {
  expect(
    await packetCaptureAvailability({}, "inspect_pcap_client"),
  ).toMatchObject({ available: true, reason: "available" });
  expect(
    await packetCaptureAvailability({}, "inspect_pcap_capture"),
  ).toMatchObject(
    process.platform === "linux" || process.platform === "win32"
      ? { available: true, reason: "available" }
      : {
          available: false,
          reason: "unsupported_host",
          remediation: expect.stringContaining("native memory bound"),
        },
  );
});
