import { createHash } from "node:crypto";
import { readRecordedResponseBody } from "../../domain/analysisView/recordedResponseBody.js";
import { expect, it } from "vitest";
import {
  historicalHar,
  harWithContainerLookalikes,
} from "../../../tests/fixtures/historicalHar.js";
import { decodeCaptureText } from "./CaptureJson.js";
import { CaptureFormatError } from "./CaptureFormatError.js";
import { decodeHarCapture } from "./HarCapture.js";

it.each([
  { timings: null, field: "" },
  { timings: [], field: "" },
  { timings: { send: 0, receive: 0 }, field: "" },
  ...["send", "wait", "receive"].map((field) => ({
    timings: { send: 0, wait: 0, receive: 0, [field]: -1 },
    field: `/${field}`,
  })),
  { timings: { send: 0, wait: -2, receive: 0 }, field: "/wait" },
  ...["blocked", "dns", "connect", "ssl"].map((field) => ({
    timings: { send: 0, wait: 0, receive: 0, [field]: -2 },
    field: `/${field}`,
  })),
  { timings: { send: 0, wait: 0, receive: 0, dns: -0.5 }, field: "/dns" },
])(
  "rejects malformed HAR timing facts at their source coordinate: $timings",
  ({ timings, field }) => {
    const fixture = historicalHar();
    const entry = fixture.log.entries[0];
    if (entry === undefined) throw new Error("fixture missing");
    const text = JSON.stringify({
      log: { ...fixture.log, entries: [{ ...entry, timings }] },
    });
    expect(() => decodeHarCapture(text, [])).toThrow(
      expect.objectContaining({
        reason: "format",
        pointer: `/log/entries/0/timings${field}`,
      }),
    );
  },
);

it("validates malformed timings before excluding an explicitly sensitive property", () => {
  const text = JSON.stringify(historicalHar()).replace(
    '"timings":{"send":0,"wait":1.25,"receive":0}',
    '"timings":null',
  );
  expect(() => decodeHarCapture(text, ["timings"])).toThrow(CaptureFormatError);
});

it.each([
  { cache: null },
  { cache: false },
  { cache: 0 },
  { cache: "cache" },
  { cache: [] },
])("rejects a non-object HAR cache: $cache", ({ cache }) => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0]!;
  expect(() =>
    decodeHarCapture(
      JSON.stringify({
        log: { ...fixture.log, entries: [{ ...entry, cache }] },
      }),
      [],
    ),
  ).toThrow(
    expect.objectContaining({
      reason: "format",
      pointer: "/log/entries/0/cache",
    }),
  );
});

it.each([-1, -0.5])("rejects negative HAR elapsed time: %s", (time) => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0]!;
  expect(() =>
    decodeHarCapture(
      JSON.stringify({
        log: { ...fixture.log, entries: [{ ...entry, time }] },
      }),
      [],
    ),
  ).toThrow(
    expect.objectContaining({
      reason: "format",
      pointer: "/log/entries/0/time",
    }),
  );
});

it.each(["onContentLoad", "onLoad"])(
  "rejects invalid negative HAR page timing %s",
  (field) => {
    const fixture = historicalHar();
    for (const value of [-2, -0.5, null]) {
      const pages = [
        {
          startedDateTime: fixture.log.entries[0]!.startedDateTime,
          id: "page_0",
          title: "fixture",
          pageTimings: { [field]: value },
        },
      ];
      expect(() =>
        decodeHarCapture(
          JSON.stringify({ log: { ...fixture.log, pages } }),
          [],
        ),
      ).toThrow(
        expect.objectContaining({
          reason: "format",
          pointer: `/log/pages/0/pageTimings/${field}`,
        }),
      );
    }
  },
);

it.each([0, 1.25])(
  "retains elapsed time %s and nullable cache states without normalization",
  (time) => {
    const fixture = historicalHar();
    const entry = fixture.log.entries[0]!;
    const cache = {
      beforeRequest: null,
      afterRequest: null,
      _extension: "retained",
    };
    const decoded = decodeHarCapture(
      JSON.stringify({
        log: { ...fixture.log, entries: [{ ...entry, time, cache }] },
      }),
      [],
    );
    expect(decoded.records[0]?.reported).toMatchObject({ time, cache });
  },
);

it.each([
  {},
  { onContentLoad: -1 },
  { onLoad: -1 },
  { onContentLoad: 0, onLoad: 1.25, _extension: -0.5 },
])(
  "preserves omitted, unavailable and measured HAR page timings: %j",
  (pageTimings) => {
    const fixture = historicalHar();
    const pages = [
      {
        startedDateTime: fixture.log.entries[0]!.startedDateTime,
        id: "page_0",
        title: "fixture",
        pageTimings,
      },
    ];
    const decoded = decodeHarCapture(
      JSON.stringify({ log: { ...fixture.log, pages } }),
      [],
    );
    expect(decoded.container.reported).toHaveProperty("log.pages", pages);
  },
);

it("retains valid timing measurements, optional omission and -1 without inventing values", () => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0];
  if (entry === undefined) throw new Error("fixture missing");
  const timings = {
    send: 0,
    wait: 1.25,
    receive: 0,
    blocked: -1,
    dns: -1,
    connect: -1,
    ssl: -1,
    _extension: "retained",
  };
  const decoded = decodeHarCapture(
    JSON.stringify({
      log: { ...fixture.log, entries: [{ ...entry, timings }, entry] },
    }),
    [],
  );
  expect(decoded.records[0]?.reported).toMatchObject({ timings });
  expect(decoded.records[1]?.reported).toMatchObject({
    timings: entry.timings,
  });
});

it.each([
  [undefined, "hello", { bodyText: "hello" }],
  ["base64", "aGVsbG8=", { bodyText: "hello" }],
  ["hex", "68656c6c6f", { bodyText: null }],
  ["base64url", "aGVsbG8", { bodyText: null }],
] as const)(
  "keeps HAR body encoding %s distinct from decoded text",
  (encoding, text, expected) => {
    const fixture = historicalHar();
    const first = fixture.log.entries[0]!;
    const content = {
      size: 5,
      mimeType: "text/plain",
      text,
      ...(encoding === undefined ? {} : { encoding }),
    };
    const decoded = decodeHarCapture(
      JSON.stringify({
        log: {
          ...fixture.log,
          entries: [{ ...first, response: { ...first.response, content } }],
        },
      }),
      [],
    );
    const record = decoded.records[0]!;
    expect(record.reported).toMatchObject({
      response: {
        content: {
          ...(encoding === undefined ? {} : { encoding }),
          ...(encoding === "base64" ? {} : { text }),
        },
      },
    });
    expect(readRecordedResponseBody(record, 262_144)).toEqual(expected);
  },
);

it("interprets HTTP fields only within HAR entries, preserving document lookalikes", () => {
  const fixture = harWithContainerLookalikes();
  const decoded = decodeHarCapture(JSON.stringify(fixture), []);
  expect(decoded.container.reported).toMatchObject({
    request: fixture.request,
    response: fixture.response,
  });
  expect(decoded.container.redactions).toEqual([]);
  expect(decoded.records[0]).toMatchObject({
    reported: {
      request: {
        url: "https://example.test/opaque",
        headers: [{ name: "Authorization", value: null }],
        cookies: [{ name: "session", value: null }],
      },
      response: {
        redirectURL: "https://example.test/redirect",
        headers: [{ name: "Set-Cookie", value: null }],
      },
    },
    binary_fields: [
      { pointer: "/response/content/text", content_base64: "QUJD", bytes: 3 },
    ],
  });
  const marked = decodeHarCapture(JSON.stringify(fixture), [
    "ordinary-root-evidence",
  ]);
  expect(marked.container.reported).toMatchObject({
    request: {
      headers: [{ value: null }],
      cookies: [{ value: null }],
    },
    response: { headers: [{ value: null }], content: { text: null } },
  });
  expect(marked.container.redactions).toHaveLength(4);
  expect(
    marked.container.redactions.every(
      ({ reason }) => reason === "explicit-sensitive-value",
    ),
  ).toBe(true);
});

it("does not decode container lookalikes when excluding explicitly sensitive body bytes", () => {
  const fixture = harWithContainerLookalikes();
  fixture.response.content.text = "QUJD";
  const decoded = decodeHarCapture(JSON.stringify(fixture), ["ABC"]);
  expect(decoded.container.reported).toMatchObject({
    response: { content: { text: "QUJD" } },
  });
  expect(decoded.container.redactions).toEqual([]);
  expect(decoded.records[0]).toMatchObject({
    reported: { response: { content: { text: null } } },
    binary_fields: [
      { state: "redacted", content_base64: null, bytes: null, sha256: null },
    ],
  });
});

it.each([
  { values: [] },
  { values: ["response"] },
  { values: ["content"] },
  { values: ["log"] },
  { values: ["entries"] },
])(
  "validates canonical base64 even when its parent property is sensitive: %j",
  ({ values }) => {
    const fixture = historicalHar();
    const first = fixture.log.entries[0];
    if (first === undefined) throw new Error("fixture missing");
    const input = {
      log: {
        ...fixture.log,
        entries: [
          {
            ...first,
            response: {
              ...first.response,
              content: {
                size: 1,
                mimeType: "application/octet-stream",
                encoding: "base64",
                text: "AR==",
              },
            },
          },
        ],
      },
    };
    expect(() => decodeHarCapture(JSON.stringify(input), values)).toThrow(
      "not valid canonical base64",
    );
  },
);

it.each(["log", "entries", "ntries"])(
  "excludes extracted record payloads beneath the marked structural property %s",
  (literal) => {
    const decoded = decodeHarCapture(JSON.stringify(historicalHar()), [
      literal,
    ]);
    expect(decoded.total_records).toBeGreaterThan(0);
    expect(decoded.container.records_pointer).toBe(null);
    for (const [ordinal, record] of decoded.records.entries()) {
      expect(record).toMatchObject({
        ordinal,
        location: { kind: "unknown", reason: "explicit-sensitive-value" },
        reported: null,
        binary_fields: [],
        numeric_literals: [],
        redactions: [{ pointer: "", reason: "explicit-sensitive-value" }],
      });
    }
  },
);

it("excludes sensitive property identities before emitting keys and sidecar coordinates", () => {
  const fixture = historicalHar();
  const first = fixture.log.entries[0];
  if (first === undefined) throw new Error("fixture missing");
  const result = decodeHarCapture(
    JSON.stringify({
      ...fixture,
      _extension: {
        "api-secret/~": { numeric: 123, text: "api-secret" },
        kept: 7,
      },
      log: { ...fixture.log, entries: [{ ...first, "api-secret": 42 }] },
    }),
    ["api-secret"],
  );
  expect(JSON.stringify(result)).not.toContain("api-secret");
  expect(result.container.reported).toMatchObject({ _extension: { kept: 7 } });
  expect(result.container.redactions).toContainEqual({
    pointer: "/_extension",
    reason: "explicit-sensitive-value",
    scope: "property-name",
  });
  expect(result.records[0]?.redactions).toContainEqual({
    pointer: "",
    reason: "explicit-sensitive-value",
    scope: "property-name",
  });
});

it.each([
  { value: "REDACTED", sensitive: ["REDACTED"] },
  { value: "literal[", sensitive: ["["] },
  { value: "before secret after", sensitive: ["secret", "REDACTED"] },
  { value: "before secret after", sensitive: ["secret", "[RED"] },
])(
  "excludes sensitive text without introducing replacement literals: $value",
  ({ value, sensitive }) => {
    const fixture = historicalHar();
    const result = decodeHarCapture(
      JSON.stringify({ ...fixture, _sensitive: value, _ordinary: "unmarked" }),
      sensitive,
    );
    expect(result.container.reported).toMatchObject({
      _sensitive: null,
      _ordinary: "unmarked",
    });
    expect(result.container.redactions).toContainEqual({
      pointer: "/_sensitive",
      reason: "explicit-sensitive-value",
    });
  },
);

it("excludes a declared literal introduced by stripping transport URL userinfo", () => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0];
  if (entry === undefined) throw new Error("fixture missing");
  const url = "https://example.test/sensitive";
  const input = {
    log: {
      ...fixture.log,
      entries: [
        {
          ...entry,
          request: {
            ...entry.request,
            url: "https://user:password@example.test/sensitive",
          },
        },
      ],
    },
  };
  const result = decodeHarCapture(JSON.stringify(input), [url]);
  expect(result.records[0]?.reported).toMatchObject({ request: { url: null } });
});

it.each([
  '"_duplicate":1,"_duplicate":1',
  '"_duplicate":null,"_duplicate":null',
  '"_duplicate":{"value":1},"_duplicate":{"value":1}',
  '"_duplicate":1,"\\u005fduplicate":1',
])(
  "rejects equal-valued duplicate JSON members before projection: %s",
  (members) => {
    const text = JSON.stringify(historicalHar()).replace(
      '"cache":{}',
      `"cache":{},${members}`,
    );
    expect(() => decodeHarCapture(text, [])).toThrow("duplicate");
  },
);

it("rejects identical duplicate core fields before schema validation", () => {
  const text = JSON.stringify(historicalHar()).replace(
    '"version":"1.2"',
    '"version":"1.2","version":"1.2"',
  );
  expect(() => decodeHarCapture(text, [])).toThrow("duplicate");
});

it("names the violated HAR schema constraint without restating capture values", () => {
  expect(() =>
    decodeHarCapture(
      JSON.stringify({
        log: { creator: { name: "x", version: "1" }, entries: [] },
      }),
      [],
    ),
  ).toThrow(
    "HAR schema validation failed: required (must have required property 'version').",
  );
});

it("preserves prototype-named producer members through the capture boundary", () => {
  const text = JSON.stringify(historicalHar()).replace(
    '"cache":{}',
    '"cache":{},"_extension":{"__proto__":{"preserved":7},"constructor":"ordinary"}',
  );
  const result = decodeHarCapture(text, []);
  const reported = result.records[0]?.reported;
  expect(reported).toBeDefined();
  if (
    reported === undefined ||
    reported === null ||
    typeof reported !== "object" ||
    Array.isArray(reported)
  )
    throw new Error("No HAR object record was retained");
  const extension = reported["_extension"];
  expect(extension).toEqual({
    ["__proto__"]: { preserved: 7 },
    constructor: "ordinary",
  });
  expect(Object.getPrototypeOf(extension)).toBe(Object.prototype);
  expect(Reflect.get(Object.prototype, "preserved")).toBeUndefined();
});

it("preserves Unicode, offsets, sizes, duplicate URLs and opaque extensions without inventing bytes", () => {
  const fixture = historicalHar();
  const first = fixture.log.entries[0];
  if (first === undefined) throw new Error("fixture missing");
  fixture.log.entries.push(structuredClone(first));
  const result = decodeHarCapture(
    JSON.stringify({
      ...fixture,
      _extension: { isLosslessNumber: true, value: "ordinary" },
    }),
    [],
  );
  expect(result.total_records).toBe(2);
  expect(result.records[0]?.reported).toEqual(fixture.log.entries[0]);
  expect(result.records[0]?.binary_fields).toEqual([]);
  expect(result.records[0]?.numeric_literals).toContainEqual({
    pointer: "/response/bodySize",
    producer_type: "json-number",
    literal: "99",
  });
  expect(result.records[1]?.location).toEqual({
    kind: "json-pointer",
    pointer: "/log/entries/1",
  });
  expect(result.container.reported).toMatchObject({
    _extension: { isLosslessNumber: true, value: "ordinary" },
    log: { entries: null },
  });
});

it.each(["9007199254740993", "4740993", "99"])(
  "excludes explicitly sensitive numeric lexemes and their reported values: %s",
  (literal) => {
    const text = JSON.stringify(historicalHar()).replace(
      '"cache":{}',
      '"cache":{},"_big":9007199254740993',
    );
    const result = decodeHarCapture(text, [literal]);
    for (const record of result.records) {
      expect(
        record.numeric_literals.every(
          (number) => !number.literal.includes(literal),
        ),
      ).toBe(true);
    }
    const pointer = literal === "99" ? "/response/bodySize" : "/_big";
    expect(result.records[0]?.redactions).toContainEqual({
      pointer,
      reason: "explicit-sensitive-value",
    });
    if (literal === "99")
      expect(result.records[0]?.reported).toMatchObject({
        response: { bodySize: null },
      });
    else expect(result.records[0]?.reported).toMatchObject({ _big: null });
  },
);

it.each([
  { encoded: "1e3", sensitive: "1000" },
  { encoded: "123.4500", sensitive: "123.45" },
  { encoded: "0.0000001", sensitive: "1e-7" },
])(
  "excludes sensitive numbers introduced by JSON normalization: $encoded",
  ({ encoded, sensitive }) => {
    const text = JSON.stringify(historicalHar())
      .replace('"log":{', `"_number":${encoded},"log":{`)
      .replace('"cache":{}', `"cache":{},"_number":${encoded}`);
    const result = decodeHarCapture(text, [sensitive]);
    for (const projection of [result.container, ...result.records]) {
      expect(projection.reported).toMatchObject({ _number: null });
      expect(projection.numeric_literals).not.toContainEqual(
        expect.objectContaining({ pointer: "/_number" }),
      );
      expect(projection.redactions).toContainEqual({
        pointer: "/_number",
        reason: "explicit-sensitive-value",
      });
    }
    const unmarked = decodeHarCapture(text, []);
    for (const projection of [unmarked.container, ...unmarked.records]) {
      expect(projection.reported).toMatchObject({ _number: Number(encoded) });
      expect(projection.numeric_literals).toContainEqual({
        pointer: "/_number",
        producer_type: "json-number",
        literal: encoded,
      });
    }
  },
);

it("keeps unsafe numeric lexemes in extension and mandatory schema fields", () => {
  const text = JSON.stringify(historicalHar());
  const result = decodeHarCapture(
    text.replace('"cache":{}', '"cache":{},"_big":9007199254740993'),
    [],
  );
  expect(result.records[0]?.numeric_literals).toContainEqual({
    pointer: "/_big",
    producer_type: "json-number",
    literal: "9007199254740993",
  });
  expect(result.records[0]?.reported).toMatchObject({ _big: null });
  // The pinned schema admits a valid integer the evidence cannot publish exactly.
  const mandatory = decodeHarCapture(
    text.replace('"bodySize":0', '"bodySize":9007199254740993'),
    [],
  ).records[0];
  expect(mandatory?.numeric_literals).toContainEqual({
    pointer: "/request/bodySize",
    producer_type: "json-number",
    literal: "9007199254740993",
  });
  expect(mandatory?.reported).toMatchObject({ request: { bodySize: null } });
});

it.each(["container", "record"] as const)(
  "retains %s extension content without interpreting it as an HTTP body",
  (location) => {
    const fixture = historicalHar();
    const extension = {
      response: { content: { encoding: "base64", text: "opaque extension" } },
    };
    const input =
      location === "container"
        ? { ...fixture, _extension: extension }
        : {
            log: {
              ...fixture.log,
              entries: fixture.log.entries.map((entry) => ({
                ...entry,
                _extension: extension,
              })),
            },
          };
    const result = decodeHarCapture(JSON.stringify(input), []);
    expect(
      location === "container"
        ? result.container.reported
        : result.records[0]?.reported,
    ).toMatchObject({ _extension: extension });
    expect(result.records[0]?.binary_fields).toEqual([]);
  },
);

it("retains valid base64 bytes independently of declared sizes", () => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0];
  if (entry === undefined) throw new Error("fixture missing");
  const text = JSON.stringify({
    log: {
      ...fixture.log,
      entries: [
        {
          ...entry,
          response: {
            ...entry.response,
            content: {
              size: 999,
              mimeType: "application/octet-stream",
              encoding: "base64",
              text: "AP9B\n",
            },
          },
        },
      ],
    },
  });
  const result = decodeHarCapture(text, []);
  expect(result.records[0]?.binary_fields[0]).toMatchObject({
    pointer: "/response/content/text",
    state: "retained",
    content_base64: "AP9B",
    bytes: 3,
  });
  expect(result.records[0]?.reported).toMatchObject({
    response: { content: { size: 999, text: "AP9B\n" } },
  });
  expect(() => decodeHarCapture(text.replace("AP9B", "AR=="), [])).toThrow(
    "not valid canonical base64",
  );
});

it("redacts actual authentication fields and explicit binary values while preserving similarly named extensions", () => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0];
  if (entry === undefined) throw new Error("fixture missing");
  const raw = {
    log: {
      ...fixture.log,
      entries: [
        {
          ...entry,
          request: {
            ...entry.request,
            url: "https://user:password@example.test/a?token=ordinary#fragment",
            headers: [
              { name: "Authorization", value: "Bearer transport-secret" },
              { name: "X-Test", value: "a" },
              { name: "X-Test", value: "b" },
            ],
            cookies: [{ name: "session", value: "cookie-secret" }],
          },
          response: {
            ...entry.response,
            content: {
              size: 5,
              mimeType: "application/octet-stream",
              encoding: "base64",
              text: Buffer.from("chosen-private").toString("base64"),
            },
          },
          _extension: {
            response: {
              headers: [{ name: "Authorization", value: "ordinary-extension" }],
            },
          },
        },
      ],
    },
  };
  const result = decodeHarCapture(JSON.stringify(raw), ["chosen-private"]);
  const output = JSON.stringify(result);
  for (const secret of [
    "password",
    "transport-secret",
    "cookie-secret",
    Buffer.from("chosen-private").toString("base64"),
  ])
    expect(output).not.toContain(secret);
  expect(output).toContain("token=ordinary#fragment");
  expect(output).toContain("ordinary-extension");
  expect(result.records[0]?.reported).toMatchObject({
    request: {
      headers: [
        { name: "Authorization", value: null },
        { name: "X-Test", value: "a" },
        { name: "X-Test", value: "b" },
      ],
    },
  });
  expect(result.records[0]?.binary_fields[0]).toMatchObject({
    state: "redacted",
    sha256: null,
    content_base64: null,
  });
});

it.each([
  "{",
  '{"log":{},"log":{}}',
  JSON.stringify({ log: { version: "1.2", entries: [] } }),
])("rejects malformed producer data %s", (text) => {
  expect(() => decodeHarCapture(text, [])).toThrow();
});

it("preserves observed SaveHar null post-data without broadening arbitrary HAR producers", () => {
  const fixture = historicalHar();
  const first = fixture.log.entries[0];
  if (first === undefined) throw new Error("fixture missing");
  const log = {
    ...fixture.log,
    creator: { name: "mitmproxy", version: "12.2.3" },
    entries: [
      {
        ...first,
        request: {
          ...first.request,
          postData: { mimeType: "text/plain", text: null },
        },
      },
    ],
  };
  expect(
    decodeHarCapture(JSON.stringify({ log }), []).records[0]?.reported,
  ).toMatchObject({ request: { postData: { text: null } } });
  expect(() =>
    decodeHarCapture(
      JSON.stringify({
        log: { ...log, creator: { name: "other", version: "1" } },
      }),
      [],
    ),
  ).toThrow("HAR schema validation failed");
});

it.each(["[2001:db8::1]", "[::1]", "[::ffff:192.0.2.1]"])(
  "retains Playwright 1.58.2 bracketed IPv6 spelling in reported Evidence: %s",
  (address) => {
    const fixture = historicalHar();
    const first = fixture.log.entries[0];
    if (first === undefined) throw new Error("fixture missing");
    const input = {
      log: {
        ...fixture.log,
        creator: { name: "Playwright", version: "1.58.2" },
        entries: [
          {
            ...first,
            serverIPAddress: address,
            _extension: { serverIPAddress: address },
          },
          structuredClone(first),
        ],
      },
    };
    const decoded = decodeHarCapture(JSON.stringify(input), []);
    expect(decoded.records[0]).toMatchObject({
      reported: {
        serverIPAddress: address,
        _extension: { serverIPAddress: address },
      },
    });
    expect(decoded.records[0]?.limitations).toContain(
      "This capture declares Playwright 1.58.2 and reports bracketed IPv6 serverIPAddress. Original spellings are retained; brackets were removed only from valid IPv6 values in the validation copy. Producer declarations are not authenticated.",
    );
    expect(
      decoded.records[1]?.limitations.some((limitation) =>
        limitation.includes("bracketed IPv6 serverIPAddress"),
      ),
    ).toBe(false);
  },
);

it.each([
  { name: "other", version: "1.58.2", address: "[2001:db8::1]" },
  { name: "Playwright", version: "1.58.1", address: "[2001:db8::1]" },
  { name: "Playwright", version: "1.58.2", address: "[192.0.2.1]" },
  { name: "Playwright", version: "1.58.2", address: "[2001:db8::1]:443" },
  { name: "Playwright", version: "1.58.2", address: "[fe80::1%eth0]" },
])(
  "rejects unrecognized bracketed HAR address input: $name $version $address",
  ({ name, version, address }) => {
    const fixture = historicalHar();
    const first = fixture.log.entries[0];
    if (first === undefined) throw new Error("fixture missing");
    expect(() =>
      decodeHarCapture(
        JSON.stringify({
          log: {
            ...fixture.log,
            creator: { name, version },
            entries: [{ ...first, serverIPAddress: address }],
          },
        }),
        [],
      ),
    ).toThrow("HAR schema validation failed");
  },
);

it.each([
  "c2VjcmV0",
  "c2Vj",
  createHash("sha256").update("secret").digest("hex"),
])(
  "excludes sensitive derived byte representations from spaced HAR text: %s",
  (literal) => {
    const fixture = historicalHar();
    const first = fixture.log.entries[0];
    if (first === undefined) throw new Error("fixture missing");
    const result = decodeHarCapture(
      JSON.stringify({
        log: {
          ...fixture.log,
          entries: [
            {
              ...first,
              response: {
                ...first.response,
                content: {
                  size: 6,
                  mimeType: "application/octet-stream",
                  encoding: "base64",
                  text: "c2 VjcmV0",
                },
              },
            },
          ],
        },
      }),
      [literal],
    );
    expect(result.records[0]?.reported).toMatchObject({
      response: { content: { text: null } },
    });
    expect(result.records[0]?.binary_fields).toContainEqual({
      pointer: "/response/content/text",
      representation: "har-base64-content",
      state: "redacted",
      content_base64: null,
      bytes: null,
      sha256: null,
    });
  },
);

it("excludes a declared literal in encoded HAR text from its binary sidecar too", () => {
  const fixture = historicalHar();
  const first = fixture.log.entries[0];
  if (first === undefined) throw new Error("fixture missing");
  const log = {
    ...fixture.log,
    entries: [
      {
        ...first,
        response: {
          ...first.response,
          content: {
            size: 3,
            mimeType: "application/octet-stream",
            encoding: "base64",
            text: "AP9B",
          },
        },
      },
    ],
  };
  const result = decodeHarCapture(JSON.stringify({ log }), ["AP9B"]);
  expect(JSON.stringify(result)).not.toContain("AP9B");
  expect(result.records[0]?.binary_fields[0]?.state).toBe("redacted");
});

it.each([
  { depth: 64, innermost: "[]", accepted: true },
  { depth: 64, innermost: "{}", accepted: true },
  { depth: 64, innermost: "[0]", accepted: true },
  { depth: 65, innermost: "[]", accepted: false },
  { depth: 65, innermost: "{}", accepted: false },
  { depth: 65, innermost: "[0]", accepted: false },
  { depth: 66, innermost: "[]", accepted: false },
])(
  "bounds a $innermost extension at container level $depth",
  ({ depth, innermost, accepted }) => {
    // The root and log objects are the first two levels.
    const enclosing = depth - 3;
    const text = `{"log":{"version":"1.2","creator":{"name":"fixture","version":"1"},"entries":[],"_extension":${"[".repeat(enclosing)}${innermost}${"]".repeat(enclosing)}}}`;
    if (accepted) expect(decodeHarCapture(text, []).total_records).toBe(0);
    else expect(() => decodeHarCapture(text, [])).toThrow("nesting budget");
  },
);

it("rejects excessive extension nesting instead of returning a partial capture", () => {
  let extension: unknown = null;
  for (let index = 0; index < 66; index++) extension = { child: extension };
  expect(() =>
    decodeHarCapture(
      JSON.stringify({ ...historicalHar(), _extension: extension }),
      [],
    ),
  ).toThrow("nesting budget");
});

it.each([
  { name: "Location", side: "response" as const },
  { name: "Referer", side: "request" as const },
  { name: "Origin", side: "request" as const },
])(
  "excludes leading-OWS userinfo from a producer $name header",
  ({ name, side }) => {
    const fixture = historicalHar();
    const first = fixture.log.entries[0];
    if (first === undefined) throw new Error("fixture missing");
    const value =
      " \tHTTPS://user:password@example.test/path?token=ordinary#fragment\t ";
    const result = decodeHarCapture(
      JSON.stringify({
        log: {
          ...fixture.log,
          entries: [
            {
              ...first,
              [side]: { ...first[side], headers: [{ name, value }] },
            },
          ],
        },
      }),
      [],
    );
    expect(result.records[0]?.reported).toMatchObject({
      [side]: {
        headers: [
          {
            name,
            value: " \tHTTPS://example.test/path?token=ordinary#fragment\t ",
          },
        ],
      },
    });
    expect(result.records[0]?.redactions).toContainEqual({
      pointer: `/${side}/headers/0/value`,
      reason: "transport-credential",
    });
  },
);

it("ignores one leading byte-order mark, as HAR 1.2 requires of readers", () => {
  const text = JSON.stringify(historicalHar());
  const body = Buffer.from(text, "utf8");
  const marked = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
  expect(decodeCaptureText(marked, "HAR")).toBe(text);
  expect(decodeHarCapture(decodeCaptureText(marked, "HAR"), [])).toEqual(
    decodeHarCapture(decodeCaptureText(body, "HAR"), []),
  );
  // A second mark is content, not an encoding signature.
  expect(() =>
    decodeHarCapture(
      decodeCaptureText(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), marked]),
        "HAR",
      ),
      [],
    ),
  ).toThrow("HAR is malformed JSON.");
  expect(() =>
    decodeCaptureText(Buffer.from([0x7b, 0xff, 0x7d]), "HAR"),
  ).toThrow("HAR is not valid UTF-8 JSON.");
});

const reportedAt = (reported: unknown, pointer: string): unknown =>
  pointer
    .split("/")
    .slice(1)
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === "object"
          ? Reflect.get(value, key)
          : undefined,
      reported,
    );

it.each([
  {
    from: '"time":1.25',
    literal: "0.123456789012345678901",
    pointer: "/time",
  },
  { from: '"bodySize":99', literal: "1e400", pointer: "/response/bodySize" },
])(
  "admits a schema-valid number that evidence cannot publish exactly: $literal",
  ({ from, literal, pointer }) => {
    const key = from.slice(0, from.indexOf(":") + 1);
    const text = JSON.stringify(historicalHar()).replace(
      from,
      `${key}${literal}`,
    );
    expect(text).toContain(`${key}${literal}`);
    const record = decodeHarCapture(text, []).records[0];
    // The exact producer lexeme is retained, and the published value stays unknown.
    expect(record?.numeric_literals).toContainEqual({
      pointer,
      producer_type: "json-number",
      literal,
    });
    expect(reportedAt(record?.reported, pointer)).toBeNull();
  },
);

it.each([
  "9007199254740993.5",
  "1e-400",
  "1.0000000000000000001",
  `1${"0".repeat(309)}.5`,
  `-1${"0".repeat(309)}.5`,
])(
  "judges an integer field by the lexeme when rounding or overflow would hide a fraction: %s",
  (literal) => {
    const text = JSON.stringify(historicalHar()).replace(
      '"bodySize":99',
      `"bodySize":${literal}`,
    );
    expect(() => decodeHarCapture(text, [])).toThrow(
      "HAR schema validation failed: type (must be integer).",
    );
  },
);
