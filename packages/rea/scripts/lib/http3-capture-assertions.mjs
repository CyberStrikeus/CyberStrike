import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// The native decoder displays strict UTF-8 and retains invalid bytes as null text.
const textOf = (expected) => {
  const value = Buffer.from(expected.base64, "base64");
  return isUtf8(value) ? value.toString("utf8") : null;
};
const field = (record, pointer) =>
  record.binary_fields.find((item) => item.pointer === pointer);
const bytes = (record, pointer) => {
  const value = field(record, pointer);
  assert.equal(
    value?.state,
    "retained",
    `Missing retained bytes at ${pointer}`,
  );
  const decoded = Buffer.from(value.content_base64, "base64");
  assert.equal(value.bytes, decoded.length);
  assert.equal(value.sha256, digest(decoded));
  return decoded;
};
const binaryEqual = (record, pointer, expected) => {
  const decoded = bytes(record, pointer);
  assert.deepEqual(decoded, Buffer.from(expected.base64, "base64"), pointer);
  assert.equal(field(record, pointer).sha256, expected.sha256);
  assert.equal(field(record, pointer).bytes, expected.bytes);
};
const caseOf = (record) =>
  record.reported.request.headers.find(
    ([name]) => name === "x-lab-case",
  )?.[1] ?? "curl";
const byCase = (value, name) => {
  const selected = value.records.filter((record) => caseOf(record) === name);
  assert.equal(
    selected.length,
    1,
    `Expected exactly one producer record for ${name}`,
  );
  return selected[0];
};
const connectionH3 = (record, side) => {
  const conn = record.reported[side];
  assert.equal(conn.transport_protocol, "udp");
  assert.equal(bytes(record, `/${side}/alpn`).toString(), "h3");
  assert.equal(conn.alpn, "h3", `${side}.alpn readable value`);
  assert.equal(typeof conn.timestamp_tls_setup, "number");
};

function assertHeaders(record, side, headers) {
  const regular = headers.filter(
    ([name]) => !Buffer.from(name.base64, "base64").toString().startsWith(":"),
  );
  assert.equal(record.reported[side].headers.length, regular.length);
  for (const [index, pair] of regular.entries()) {
    binaryEqual(record, `/${side}/headers/${index}/0`, pair[0]);
    binaryEqual(record, `/${side}/headers/${index}/1`, pair[1]);
    assert.deepEqual(
      record.reported[side].headers[index],
      pair.map(textOf),
      `${side}.headers[${index}] readable values`,
    );
  }
}

export function assertEndpointHeaders(actual, expected) {
  // The proxy rebuilds pseudo fields from its HTTP state. Compare their values
  // by name while retaining the exact order and duplicates of regular headers.
  const partition = (headers) => {
    const pseudo = new Map();
    const regular = [];
    for (const pair of headers) {
      const name = Buffer.from(pair[0].base64, "base64").toString();
      if (name.startsWith(":")) {
        assert.equal(pseudo.has(name), false);
        pseudo.set(name, pair);
      } else regular.push(pair);
    }
    return { pseudo, regular };
  };
  assert.deepEqual(partition(actual), partition(expected));
}

export function requireHttp3(record) {
  for (const side of ["request", "response"])
    assert.equal(record.reported[side].http_version, "HTTP/3");
  connectionH3(record, "client_conn");
  connectionH3(record, "server_conn");
}

export function verifyNormalRecords(normal, manifest, finalProducer) {
  for (const record of normal.records) {
    const name = caseOf(record);
    const producer = finalProducer.find(
      (event) => event.id === record.reported.id,
    );
    assert.ok(producer, `No actual producer observation for ${name}`);
    assert.equal(record.reported.error, null);
    assert.equal(producer.error, null);
    assert.equal(record.reported.response.status_code, 200);
    requireHttp3(record);
    for (const side of ["request", "response"]) {
      assert.equal(
        record.reported[side].http_version,
        producer[side].http_version,
      );
      binaryEqual(record, `/${side}/content`, producer[side].content);
      assertHeaders(
        record,
        side,
        manifest[side === "request" ? "requests" : "responses"][name].headers,
      );
    }
    // Native UUIDs must be retained as UUIDs; the producer exports no stream mapping.
    for (const side of ["client_conn", "server_conn"])
      for (const key of ["id", "tls_version", "timestamp_tls_setup", "error"])
        assert.equal(
          record.reported[side][key],
          producer[side][key],
          `${side}.${key} differs from producer observation ${producer.id}`,
        );
    binaryEqual(record, "/request/content", manifest.requests[name].body);
    binaryEqual(record, "/response/content", manifest.responses[name].body);
    const pseudo = {
      ":method": "method",
      ":scheme": "scheme",
      ":authority": "authority",
      ":path": "path",
    };
    for (const [headerName, headerValue] of manifest.requests[name].headers) {
      const decodedName = Buffer.from(headerName.base64, "base64").toString();
      if (pseudo[decodedName]) {
        binaryEqual(record, `/request/${pseudo[decodedName]}`, headerValue);
        assert.equal(
          record.reported.request[pseudo[decodedName]],
          textOf(headerValue),
          `request.${pseudo[decodedName]} readable value`,
        );
      }
    }
  }
}

export { bytes, caseOf, byCase };

export function verifyConcurrency(normal, manifest) {
  const parallelNames = ["parallel-0", "parallel-1", "parallel-2"];
  const sent = manifest.events.filter(
    (event) =>
      event.event === "request-sent" && parallelNames.includes(event.case),
  );
  const received = manifest.events.filter(
    (event) =>
      event.event === "request-received" && parallelNames.includes(event.case),
  );
  const responses = manifest.events.filter(
    (event) =>
      event.event === "response-sent" && parallelNames.includes(event.case),
  );
  assert.equal(new Set(sent.map((event) => event.connection)).size, 1);
  assert.equal(new Set(received.map((event) => event.connection)).size, 1);
  assert.equal(new Set(sent.map((event) => event.stream_id)).size, 3);
  assert.equal(new Set(received.map((event) => event.stream_id)).size, 3);
  assert.ok(
    Math.max(...received.map((event) => event.monotonic)) <
      responses[0].monotonic,
  );
  assert.deepEqual(
    responses.map((event) => event.case),
    received.map((event) => event.case).reverse(),
  );
  for (const side of ["client_conn", "server_conn"])
    assert.equal(
      new Set(
        parallelNames.map((name) => byCase(normal, name).reported[side].id),
      ).size,
      1,
    );
  const normalConnections = new Set(
    [...sent, ...received].map((event) => event.connection),
  );
  for (const connection of normalConnections) {
    const handshakes = manifest.events.filter(
      (event) => event.event === "handshake" && event.connection === connection,
    );
    assert.equal(handshakes.length, 1);
    assert.equal(handshakes[0].alpn, "h3");
    assert.equal(handshakes[0].quic_version, 1);
  }
  assert.equal(
    new Set(normal.records.map((record) => record.reported.id)).size,
    4,
  );
  assert.equal(sent.length, 3);
  const receivedByClient = manifest.events.filter(
    (event) =>
      event.event === "response-received" &&
      sent.some(
        (request) =>
          request.connection === event.connection &&
          request.stream_id === event.stream_id,
      ),
  );
  assert.equal(receivedByClient.length, 3);
  for (const request of sent) {
    const response = receivedByClient.find(
      (event) =>
        event.connection === request.connection &&
        event.stream_id === request.stream_id,
    );
    assert.ok(
      response,
      "Each sent request needs an independently observed client response",
    );
    assert.deepEqual(response.body, manifest.responses[request.case].body);
    assert.deepEqual(request.body, manifest.requests[request.case].body);
    assertEndpointHeaders(
      request.headers,
      manifest.requests[request.case].headers,
    );
    assertEndpointHeaders(
      response.headers,
      manifest.responses[request.case].headers,
    );
  }
  return {
    sent: sent.map((event) => event.case),
    completed_at_origin: received.map((event) => event.case),
    dispatched_at_origin: responses.map((event) => event.case),
    completed_at_client: receivedByClient.map(
      (event) =>
        sent.find(
          (request) =>
            request.connection === event.connection &&
            request.stream_id === event.stream_id,
        ).case,
    ),
    saved_in_capture: normal.records
      .filter((record) => parallelNames.includes(caseOf(record)))
      .map(caseOf),
  };
}
