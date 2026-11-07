import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { z } from "zod";

import { expandToolAvailability } from "../../src/contracts/toolOutputSchemaPrimitives.js";
import { sessionOutputSchemas } from "../../src/contracts/toolOutputSchemaGroups.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

/** Each tool with the host its execution check admits. */
const HOST_RESTRICTED_TOOLS = [
  ["inspect_packet_capture", "linux"],
  ["inspect_packet_fields", "linux"],
  ["decode_signal_recording", "linux"],
  ["inspect_signal_decoders", "linux"],
  ["inspect_firmware_regions", "linux"],
  ["extract_firmware", "linux"],
  ["inspect_binary_layout", "linux-x64"],
  ["inspect_recorded_crash", "linux-x64"],
  ["recover_javascript_sources", "linux-x64"],
  ["inspect_evm_interface", "linux-x64"],
] as const;

/** Run with the host identity that discovery and execution checks read. */
const emulateHost = async (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  run: () => Promise<void>,
): Promise<void> => {
  const original = {
    platform: Object.getOwnPropertyDescriptor(process, "platform"),
    arch: Object.getOwnPropertyDescriptor(process, "arch"),
  };
  Object.defineProperty(process, "platform", {
    ...original.platform,
    value: platform,
  });
  Object.defineProperty(process, "arch", { ...original.arch, value: arch });
  try {
    await run();
  } finally {
    if (original.platform !== undefined)
      Object.defineProperty(process, "platform", original.platform);
    if (original.arch !== undefined)
      Object.defineProperty(process, "arch", original.arch);
  }
};

const connect = async (
  options: Parameters<typeof createServer>[1] = {},
): Promise<{
  readonly path: (name: string) => string;
  readonly availability: () => Promise<
    ReturnType<typeof expandToolAvailability>
  >;
  readonly call: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  readonly close: () => Promise<void>;
}> => {
  const directory = await createTestTempDirectory("rea-host-restricted-mcp-");
  const path = (name: string) => join(directory, name);
  const session = createTestBinarySession(() => {
    throw new Error("binary analysis must not start during status discovery");
  });
  // Absolute paths configure every integration; discovery does not run them.
  const server = createServer(
    { kind: "session", session },
    {
      environment: {
        REA_TSHARK_COMMAND: path("tshark"),
        REA_SIGROK_COMMAND: path("sigrok-cli"),
        REA_BINWALK_COMMAND: path("binwalk"),
        REA_UNBLOB_COMMAND: path("unblob"),
        REA_PWNTOOLS_PYTHON: path("python3"),
        REA_WAKARU_COMMAND: path("wakaru"),
        REA_EVM_PRLIMIT_COMMAND: path("missing-prlimit"),
        REA_MCP_OUTPUT_SCHEMA_PROFILE: "off",
      },
      ...options,
    },
  );
  const client = new Client({
    name: "host-restricted-availability",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    const text = z
      .array(z.object({ type: z.string(), text: z.string().optional() }))
      .parse(response.content)
      .find((item) => item.type === "text")?.text;
    return z
      .record(z.string(), z.unknown())
      .parse(response.structuredContent ?? JSON.parse(text ?? "null"));
  };
  return {
    path,
    availability: async () =>
      expandToolAvailability(
        sessionOutputSchemas.binary_session.parse(
          await call("binary_session", {}),
        ).result.tool_availability,
      ),
    call,
    close: async () => {
      await Promise.allSettled([
        client.close(),
        server.close(),
        session.close(),
      ]);
    },
  };
};

it.each([
  ["darwin", "arm64"],
  ["linux", "arm64"],
  ["linux", "x64"],
] as const)(
  "reports host-restricted integrations on %s %s by host before configuration",
  async (platform, arch) =>
    emulateHost(platform, arch, async () => {
      const harness = await connect();
      try {
        const availability = await harness.availability();
        for (const [name, requirement] of HOST_RESTRICTED_TOOLS) {
          const supported =
            platform === "linux" && (requirement === "linux" || arch === "x64");
          const entry = availability.find((tool) => tool.name === name);
          if (!supported)
            expect(entry, name).toMatchObject({
              available: false,
              reason: "unsupported_host",
            });
          else if (name === "inspect_evm_interface")
            // The configured limiter is absent; the host itself is supported.
            expect(entry, name).toMatchObject({
              available: false,
              reason: "provider_missing",
            });
          else expect(entry, name).toMatchObject({ available: true });
        }
      } finally {
        await harness.close();
      }
    }),
);

it.each([
  ["the observed host", "darwin", "arm64", {}],
  [
    "the caller",
    "linux",
    "x64",
    { hostUnsupported: { signalRecording: true } },
  ],
] as const)(
  "keeps a host restriction from %s under a configured availability policy",
  async (_source, platform, arch, restriction) =>
    emulateHost(platform, arch, async () => {
      const harness = await connect({
        availabilityPolicy: () => ({
          processCaptureEnabled: true,
          signalRecordingEnabled: true,
          ...restriction,
        }),
      });
      try {
        expect(
          (await harness.availability()).find(
            (tool) => tool.name === "decode_signal_recording",
          ),
        ).toMatchObject({ available: false, reason: "unsupported_host" });
      } finally {
        await harness.close();
      }
    }),
);

it("refuses execution on the hosts that discovery reports unsupported", async () =>
  emulateHost("darwin", "arm64", async () => {
    const harness = await connect();
    try {
      for (const [name, args] of [
        ["inspect_signal_decoders", {}],
        ["inspect_binary_layout", { path: harness.path("runtime.hex") }],
        [
          "inspect_evm_interface",
          { path: harness.path("runtime.hex"), encoding: "hex" },
        ],
      ] as const)
        expect(await harness.call(name, args), name).toMatchObject({
          error: { code: "capability_unavailable", retryable: false },
        });
    } finally {
      await harness.close();
    }
  }));
