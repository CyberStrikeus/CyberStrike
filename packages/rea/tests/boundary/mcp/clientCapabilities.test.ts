import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { createServer } from "../../../src/server/createServer.js";
import {
  TOOL_CONTRACTS,
  toolContract,
} from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import {
  createCacheProvider,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";

const assertCompleteToolAvailability = (structuredContent: unknown): void => {
  const status =
    toolContract("binary_session").outputSchema.parse(structuredContent);
  const availability = expandToolAvailability(status.result.tool_availability);
  expect(availability.map(({ name }) => name).sort()).toEqual(
    TOOL_CONTRACTS.map(({ name }) => name).sort(),
  );
};

describe("per-request client capability reporting", () => {
  it.each([
    [{ elicitation: {} }, true, false],
    [{ elicitation: { form: {} } }, true, false],
    [{ elicitation: { url: {} } }, false, true],
    [{ elicitation: { form: {}, url: {} } }, true, true],
    [{}, false, false],
  ] as const)(
    "reports the negotiated capability %j",
    async (capabilities, form, url) => {
      const session = createTestBinarySession(createCacheProvider([]));
      const server = createServer({ kind: "session", session });
      const client = new Client({ name: "capabilities-test", version: "1" });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const status = await client.callTool({
          name: "binary_session",
          arguments: {},
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
            [CLIENT_INFO_META_KEY]: { name: "capabilities-test", version: "1" },
            [CLIENT_CAPABILITIES_META_KEY]: capabilities,
          },
        });
        assertCompleteToolAvailability(status.structuredContent);
        expect(status.structuredContent).toMatchObject({
          result: {
            client_features: { elicitation_form: form, elicitation_url: url },
          },
        });
      } finally {
        await Promise.allSettled([
          client.close(),
          server.close(),
          session.close(),
        ]);
      }
    },
  );
});

describe("initialize-scoped client metadata", () => {
  const statusFor = async (
    capabilities: Record<string, unknown>,
    meta?: Record<string, unknown>,
  ) => {
    const session = createTestBinarySession(createCacheProvider([]));
    const server = createServer({ kind: "session", session });
    const client = new Client(
      { name: "initialize-test", version: "2" },
      { capabilities },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = (
        await client.callTool({
          name: "binary_session",
          arguments: {},
          ...(meta === undefined ? {} : { _meta: meta }),
        })
      ).structuredContent;
      assertCompleteToolAvailability(result);
      return result;
    } finally {
      await Promise.allSettled([
        client.close(),
        server.close(),
        session.close(),
      ]);
    }
  };
  const allFeatures = {
    elicitation: { form: {}, url: {} },
    roots: {},
    sampling: {},
  };

  it("reports a 2025-era client from its initialize handshake", async () => {
    expect(await statusFor(allFeatures)).toMatchObject({
      result: {
        server_identity: {
          client: { name: "initialize-test", version: "2" },
          negotiated_protocol_version: expect.any(String),
        },
        client_features: {
          elicitation_form: true,
          elicitation_url: true,
          roots: true,
          sampling: true,
        },
      },
    });
    expect(await statusFor({})).toMatchObject({
      result: {
        client_features: {
          elicitation_form: false,
          elicitation_url: false,
          roots: false,
          sampling: false,
        },
      },
    });
  });

  it("prefers a per-request envelope over initialize values", async () => {
    expect(
      await statusFor(allFeatures, {
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
        [CLIENT_INFO_META_KEY]: { name: "envelope-test", version: "3" },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      }),
    ).toMatchObject({
      result: {
        server_identity: {
          client: { name: "envelope-test", version: "3" },
          negotiated_protocol_version: "2026-07-28",
        },
        client_features: {
          elicitation_form: false,
          elicitation_url: false,
          roots: false,
          sampling: false,
        },
      },
    });
  });
});
