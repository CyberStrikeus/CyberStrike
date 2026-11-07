import type { BrowserScenarioCapture } from "../../domain/browserScenarioCapture.js";
import type { BrowserScenarioEvent } from "../../domain/browserScenarioCaptureValues.js";
import type { BrowserNetworkBody } from "../../domain/browserNetworkEvidence.js";
import type { CapturedWebScript } from "../../domain/webScriptExport.js";
import {
  indexBrowserScenarioTransactions,
  type BrowserScenarioTransactionIndex,
} from "../../domain/browserScenarioTransactions.js";

type RequestEvent = Extract<BrowserScenarioEvent, { kind: "request" }>;

/** Join script response bytes only through explicit transaction and event identity. */
export const scenarioScripts = (
  capture: Pick<BrowserScenarioCapture, "events">,
): CapturedWebScript[] => {
  const index = indexBrowserScenarioTransactions(capture.events.items);
  return capture.events.items.flatMap((request): CapturedWebScript[] => {
    if (request.kind !== "request" || request.resource_type !== "script")
      return [];
    return [projectRequest(request, index)];
  });
};

const projectRequest = (
  request: RequestEvent,
  index: BrowserScenarioTransactionIndex,
): CapturedWebScript => {
  const id = request.transaction_id;
  const matches = index.responses.get(id) ?? [];
  const response = matches.length === 1 ? matches[0] : undefined;
  const bodies =
    response === undefined
      ? []
      : (index.contents.get(response.sequence) ?? []).filter(
          ({ phase }) => phase === "response",
        );
  const body = bodies.length === 1 ? bodies[0]?.body : undefined;
  const ambiguous =
    index.requestCounts.get(id) !== 1 ||
    matches.length > 1 ||
    bodies.length > 1;
  return {
    source: {
      kind: "scenario-response",
      transaction_id: id,
      request_sequence: request.sequence,
      response_sequence: ambiguous ? null : (response?.sequence ?? null),
      status: ambiguous ? null : (response?.status ?? null),
    },
    url: request.url.url,
    content: projectBody(body, ambiguous),
  };
};

const unavailable = (
  reason: string,
  message: string,
): CapturedWebScript["content"] => ({ state: "unavailable", reason, message });

const projectBody = (
  body: BrowserNetworkBody | undefined,
  ambiguous: boolean,
): CapturedWebScript["content"] => {
  if (ambiguous)
    return unavailable(
      "ambiguous-transaction",
      "The capture does not identify one request, response, and content record for this transaction.",
    );
  if (body === undefined)
    return unavailable(
      "response-content-not-retained",
      "No selected, completed script response bytes were retained for this request.",
    );
  if (body.state === "unavailable")
    return unavailable(body.reason, body.message);
  if (body.state !== "captured")
    return unavailable(
      body.state,
      "No selected, completed script response bytes were retained for this request.",
    );
  if (
    body.representation !== "playwright-response-body-bytes" &&
    body.representation !== "browser-decoded-response-bytes"
  )
    return unavailable(
      "unsupported-body-representation",
      `Captured representation ${body.representation} is not script response bytes.`,
    );
  return {
    state: "captured",
    bytes: Buffer.from(body.content, "base64"),
    sha256: body.sha256,
    media_type: body.media_type,
    redacted: body.redacted,
    representation: body.representation,
  };
};
