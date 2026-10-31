import assert from "node:assert/strict";
import {
  networkFixtureBinary,
  networkFixtureDecoded,
  networkFixtureSecret,
} from "../fixtures/browser-network-site.mjs";

const retained = (event) => {
  assert.equal(event?.kind, "network-content");
  assert.equal(event.body.state, "captured", JSON.stringify(event.body));
  return Buffer.from(event.body.content, "base64");
};

/** Verify association against server-authored markers rather than provider-derived expectations. */
export function assertBrowserNetworkEvidence(
  capture,
  origin,
  expectedCleanup = "terminated-owned-process",
) {
  assert.ok(capture.steps.every((step) => step.status === "completed"));
  assert.equal(capture.browser.cleanup, expectedCleanup);
  assert.deepEqual(capture.scenario.network_content, {
    request_body: true,
    response_body: true,
    header_values: true,
  });
  assert.equal(capture.completeness.equality_eligible, false);
  assert.ok(!JSON.stringify(capture).includes(networkFixtureSecret));
  const events = capture.events.items;
  const content = events.filter((event) => event.kind === "network-content");
  const requestEvents = events.filter((event) => event.kind === "request");
  const sameUrlRequests = requestEvents.filter(
    (event) => event.url.url === `${origin}/same`,
  );
  assert.equal(sameUrlRequests.length, 2);
  assert.equal(
    new Set(sameUrlRequests.map((event) => event.transaction_id)).size,
    2,
  );
  const markers = [];
  for (const request of sameUrlRequests) {
    const requestContent = content.find(
      (event) =>
        event.phase === "request" &&
        event.transaction_id === request.transaction_id,
    );
    const responseContent = content.find(
      (event) =>
        event.phase === "response" &&
        event.transaction_id === request.transaction_id,
    );
    const input = JSON.parse(retained(requestContent).toString());
    const output = JSON.parse(retained(responseContent).toString());
    assert.equal(
      output.marker,
      input.marker,
      "Response was associated with a different same-URL request",
    );
    assert.equal(output.password, "ordinary-selected-value");
    assert.equal(input.declared, "[REDACTED:network_secret]");
    assert.equal(output.declared, input.declared);
    assert.equal(requestContent.body.redacted, true);
    assert.equal(responseContent.headers.state, "captured");
    assert.ok(
      responseContent.headers.items.some(
        (item) =>
          item.name.toLowerCase() === "x-declared" &&
          item.value === "[REDACTED:network_secret]" &&
          item.redacted,
      ),
    );
    assert.deepEqual(
      responseContent.headers.items
        .filter((item) => item.name.toLowerCase() === "x-repeat")
        .map((item) => item.value),
      ["first", "second"],
    );
    assert.ok(
      responseContent.headers.items.some(
        (item) =>
          item.name.toLowerCase() === "set-cookie" &&
          item.value === null &&
          item.redacted,
      ),
    );
    assert.ok(
      requestContent.headers.items.some(
        (item) =>
          item.name.toLowerCase() === "authorization" &&
          item.value === null &&
          item.redacted,
      ),
    );
    assert.ok(
      events.some(
        (event) =>
          event.kind === "request-finished" &&
          event.transaction_id === request.transaction_id,
      ),
    );
    markers.push(input.marker);
  }
  assert.deepEqual(markers.sort(), ["fast", "slow"]);
  const responseFor = (path) => {
    const response = events.find(
      (event) =>
        event.kind === "response" && event.url.url === `${origin}${path}`,
    );
    assert.ok(response, `Missing response ${path}`);
    return content.find(
      (event) =>
        event.phase === "response" &&
        event.source_event_sequence === response.sequence,
    );
  };
  assert.deepEqual(retained(responseFor("/binary")), networkFixtureBinary);
  assert.deepEqual(retained(responseFor("/compressed")), networkFixtureDecoded);
  assert.equal(
    responseFor("/compressed").body.representation,
    "playwright-response-body-bytes",
  );
  const formRequest = requestEvents.find(
    (event) => event.url.url === `${origin}/form`,
  );
  assert.ok(formRequest);
  const formContent = content.find(
    (event) =>
      event.phase === "request" &&
      event.transaction_id === formRequest.transaction_id,
  );
  assert.equal(
    retained(formContent).toString(),
    "declared=[REDACTED:network_secret]",
  );
  assert.equal(
    retained(responseFor("/form")).toString(),
    "[REDACTED:network_secret]",
  );
  assert.equal(responseFor("/stream").body.state, "unavailable");
  assert.equal(responseFor("/stream").body.reason, "response-unfinished");
  const first = requestEvents.find(
    (event) => event.url.url === `${origin}/redirect`,
  );
  const next = requestEvents.find(
    (event) => event.url.url === `${origin}/landing`,
  );
  assert.ok(first && next);
  assert.equal(next.redirected_from_transaction_id, first.transaction_id);
  // Every request is stamped when it was observed; finished ones carry the browser's duration.
  for (const request of requestEvents)
    assert.ok(
      Number.isFinite(Date.parse(request.observed_at)),
      `Request ${request.url.url} has no observation time`,
    );
  const timed = events.filter((event) => event.kind === "request-finished");
  for (const finished of timed)
    assert.ok(
      typeof finished.elapsed_ms === "number" &&
        Number.isFinite(Date.parse(finished.started_at)),
      `Finished request ${finished.url.url} has no browser start or duration`,
    );
  assert.ok(timed.length > 0, "No request finished");
  return {
    timed_requests: requestEvents.length,
    timed_completions: timed.length,
    same_url_markers: markers,
    binary_bytes: networkFixtureBinary.length,
    compressed_representation: "playwright-response-body-bytes",
    unfinished_stream: "response-unfinished",
    empty_response_state: responseFor("/empty").body.state,
  };
}
