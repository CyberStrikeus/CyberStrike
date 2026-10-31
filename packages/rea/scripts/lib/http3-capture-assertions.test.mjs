import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { verifyNormalRecords } from "./http3-capture-assertions.mjs";

function connectionFactsFixture() {
  const body = Buffer.from([0, 255, 128, 1]);
  const view = (bytes) => ({
    base64: bytes.toString("base64"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const producer = {
    id: "flow-id",
    error: null,
    request: { http_version: "HTTP/3", content: view(body) },
    response: { http_version: "HTTP/3", content: view(body) },
    client_conn: {
      id: "client-id",
      transport_protocol: "udp",
      tls_version: "QUICv1",
      timestamp_tls_setup: 1_700_000_000.125678,
      error: null,
    },
    server_conn: {
      id: "server-id",
      transport_protocol: "udp",
      tls_version: "QUICv1",
      timestamp_tls_setup: 1_700_000_000.987654,
      error: null,
    },
  };
  const reported = structuredClone(producer);
  const requestFields = {
    method: "POST",
    scheme: "https",
    authority: "lab.test:18443",
    path: "/echo?case=readable",
  };
  Object.assign(reported.request, requestFields);
  const headers = [
    [Buffer.from("x-repeat"), Buffer.from("first-α")],
    [Buffer.from("x-repeat"), Buffer.from("second-β")],
    [Buffer.from("x-binary"), Buffer.from([255])],
  ];
  for (const side of ["request", "response"])
    reported[side].headers = [
      ["x-repeat", "first-α"],
      ["x-repeat", "second-β"],
      ["x-binary", null],
    ];
  reported.client_conn.alpn = "h3";
  reported.server_conn.alpn = "h3";
  reported.response.status_code = 200;
  const binary_fields = [
    ["/request/content", body],
    ["/response/content", body],
    ["/client_conn/alpn", Buffer.from("h3")],
    ["/server_conn/alpn", Buffer.from("h3")],
    ...Object.entries(requestFields).map(([name, value]) => [
      `/request/${name}`,
      Buffer.from(value),
    ]),
    ...["request", "response"].flatMap((side) =>
      headers.flatMap((pair, index) =>
        pair.map((value, part) => [`/${side}/headers/${index}/${part}`, value]),
      ),
    ),
  ].map(([pointer, bytes]) => {
    const { base64, ...facts } = view(bytes);
    return {
      pointer,
      representation: "producer-bytes",
      state: "retained",
      content_base64: base64,
      ...facts,
    };
  });
  return {
    normal: { records: [{ reported, binary_fields }] },
    manifest: {
      requests: {
        curl: {
          headers: [
            ...Object.entries(requestFields).map(([name, value]) => [
              view(Buffer.from(`:${name}`)),
              view(Buffer.from(value)),
            ]),
            ...headers.map((pair) => pair.map(view)),
          ],
          body: view(body),
        },
      },
      responses: {
        curl: {
          headers: headers.map((pair) => pair.map(view)),
          body: view(body),
        },
      },
    },
    producer: [producer],
  };
}

test("positive assertions retain exact producer connection facts on both legs", () => {
  const { normal, manifest, producer } = connectionFactsFixture();
  verifyNormalRecords(normal, manifest, producer);
});

for (const [field, value] of [
  ["method", "GET"],
  ["scheme", "http"],
  ["authority", "other.test:18443"],
  ["path", "/different"],
])
  test(`positive assertions reject changed readable request ${field}`, () => {
    const { normal, manifest, producer } = connectionFactsFixture();
    normal.records[0].reported.request[field] = value;
    assert.throws(() => verifyNormalRecords(normal, manifest, producer), {
      code: "ERR_ASSERTION",
    });
  });

for (const side of ["client_conn", "server_conn"])
  test(`positive assertions reject null readable ${side} ALPN`, () => {
    const { normal, manifest, producer } = connectionFactsFixture();
    normal.records[0].reported[side].alpn = null;
    assert.throws(() => verifyNormalRecords(normal, manifest, producer), {
      code: "ERR_ASSERTION",
    });
  });

for (const side of ["request", "response"])
  for (const [index, part, value] of [
    [0, 0, "x-changed"],
    [0, 1, "changed-first"],
    [1, 1, "changed-second"],
    [2, 1, "�"],
  ])
    test(`positive assertions reject changed readable ${side} header ${index}/${part}`, () => {
      const { normal, manifest, producer } = connectionFactsFixture();
      normal.records[0].reported[side].headers[index][part] = value;
      assert.throws(() => verifyNormalRecords(normal, manifest, producer), {
        code: "ERR_ASSERTION",
      });
    });

for (const side of ["client_conn", "server_conn"])
  for (const [field, value] of [
    ["tls_version", null],
    ["tls_version", "changed-producer-label"],
    ["error", "changed-connection-error"],
    ["error", undefined],
    ["timestamp_tls_setup", 0],
    ["timestamp_tls_setup", 1_700_000_000],
  ])
    test(`positive assertions reject ${side}.${field} changed to ${String(value)}`, () => {
      const { normal, manifest, producer } = connectionFactsFixture();
      normal.records[0].reported[side][field] = value;
      assert.throws(() => verifyNormalRecords(normal, manifest, producer), {
        code: "ERR_ASSERTION",
      });
    });
