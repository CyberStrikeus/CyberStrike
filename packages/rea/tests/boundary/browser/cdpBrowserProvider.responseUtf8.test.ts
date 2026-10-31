import { expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser } from "./cdpBrowserProvider.support.js";

it.each([
  {
    name: "invalid UTF-8 property name",
    body: Buffer.from([123, 34, 255, 34, 58, 116, 114, 117, 101, 125]),
    property: null,
  },
  {
    name: "invalid UTF-8 string value",
    body: Buffer.from([123, 34, 107, 34, 58, 34, 255, 34, 125]),
    property: null,
  },
  {
    name: "overlong UTF-8 property name",
    body: Buffer.from([123, 34, 192, 175, 34, 58, 116, 114, 117, 101, 125]),
    property: null,
  },
  {
    name: "valid UTF-8 property name",
    body: Buffer.from('{"é":true}'),
    property: "é",
  },
  {
    name: "literal replacement-character property name",
    body: Buffer.from('{"�":true}'),
    property: "�",
  },
])("preserves JSON-shape uncertainty for $name", async ({ body, property }) => {
  const browser = await startFakeCdpBrowser({
    eventsBeforeReply: ["Network.enable"],
    commandEvents(command, origin) {
      if (command.method !== "Network.enable") return [];
      const session =
        command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      return [false, true].flatMap((hasRequestShape) => {
        const requestId = hasRequestShape
          ? "request-and-response"
          : "response-only";
        const url = `${origin}/${requestId}`;
        return [
          {
            ...session,
            method: "Network.requestWillBeSent",
            params: {
              requestId,
              request: {
                url,
                method: hasRequestShape ? "POST" : "GET",
                ...(hasRequestShape
                  ? {
                      headers: { "Content-Type": "application/json" },
                      postData: '{"request":true}',
                    }
                  : {}),
              },
              initiator: { type: "other" },
            },
          },
          {
            ...session,
            method: "Network.responseReceived",
            params: {
              requestId,
              response: { url, status: 200, mimeType: "application/json" },
            },
          },
          {
            ...session,
            method: "Network.loadingFinished",
            params: { requestId, encodedDataLength: body.length },
          },
        ];
      });
    },
    commandResult(command) {
      return command.method === "Network.getResponseBody"
        ? { body: body.toString("base64"), base64Encoded: true }
        : undefined;
    },
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().inspectPage(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
      include_json_body_shapes: true,
    }),
  );
  if (!result.ok) throw result.error;
  const requests = result.value.network.requests;
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    const hasRequestShape = request.request_id === "request-and-response";
    expect(request).toMatchObject({
      url: `${browser.allowedOrigin}/${request.request_id}`,
      status: 200,
      mime_type: "application/json",
      encoded_data_length: body.length,
      body_shapes: {
        status:
          property === null
            ? hasRequestShape
              ? "partial"
              : "unavailable"
            : "included",
        request: hasRequestShape ? expect.any(Object) : null,
        response:
          property === null
            ? null
            : {
                root_type: "object",
                node_count: 2,
                max_depth_observed: 1,
                properties: [
                  {
                    path: [{ kind: "property", name: property }],
                    types: ["boolean"],
                    observations: 1,
                  },
                ],
              },
      },
    });
  }
  expect(
    browser.commands.filter(
      (command) => command.method === "Network.getResponseBody",
    ),
  ).toHaveLength(2);
  if (property === null) {
    expect(result.value.completeness.unavailable_sections).toContain(
      "json_body_shapes",
    );
    expect(result.value.completeness.excluded).toContainEqual({
      section: "json_body_shapes",
      reason: "provider_unavailable",
      count: null,
    });
  } else {
    expect(result.value.completeness.unavailable_sections).not.toContain(
      "json_body_shapes",
    );
  }
  expect(result.value.completeness.excluded).not.toContainEqual(
    expect.objectContaining({
      section: "json_body_shapes",
      reason: "invalid_protocol_value",
    }),
  );
});
