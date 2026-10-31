import { describe, expect, it } from "vitest";

import { scenarioCaptureFixture } from "../../../tests/fixtures/browserScenarioCapture.js";
import type { WebNetworkCaptureRecord } from "../../domain/webNetworkCapture.js";
import {
  anonymousOrigin,
  credentialNamed,
  nameFromCaptureFile,
  savedCredentialWarnings,
  scanCredentialNames,
  scanScenarioCredentialNames,
} from "./environmentBuildReport.js";

const record = (
  ordinal: number,
  request: unknown,
  response: unknown,
): WebNetworkCaptureRecord =>
  ({
    ordinal,
    reported: {
      request: {
        method: "POST",
        url: "http://127.0.0.1/api",
        ...(request === undefined
          ? {}
          : {
              postData: {
                mimeType: "application/json",
                text: JSON.stringify(request),
              },
            }),
      },
      response: {
        status: 200,
        content: {
          mimeType: "application/json",
          text: JSON.stringify(response),
        },
      },
    },
    redactions: [],
    binary_fields: [],
  }) as unknown as WebNetworkCaptureRecord;

/** Every body of these records was small enough to scan. */
const NONE_SKIPPED = { count: 0, pointers: [] };

describe("credentialNamed", () => {
  it("matches whole name segments, not substrings", () => {
    for (const name of [
      "password",
      "authToken",
      "api_key",
      "apiKey",
      "sessionId",
      "client_secret",
      "X-Session",
      "refresh.token",
      "Authorization",
      "APIToken",
      "accesstoken",
      "passphrase",
      "api_keys",
      "ssh_key",
    ])
      expect(credentialNamed(name), name).toBe(true);
    for (const name of ["author", "authority_level", "keyboard", "tokenizer"])
      expect(credentialNamed(name), name).toBe(false);
  });
});

describe("scanCredentialNames", () => {
  it("counts string values under credential names in request and response bodies, by pointer and never by value", () => {
    const scanned = scanCredentialNames([
      record(
        3,
        { name: "Folder", secret: "s3cr3t-value" },
        { data: [{ id: 1, sessionId: "abc123def" }], hasPassword: true },
      ),
      record(4, undefined, { token: "", "a/b": { apiKey: "k-1" } }),
    ]);
    expect(scanned).toEqual({
      count: 3,
      pointers: [
        "record 3 request /secret",
        "record 3 response /data/0/sessionId",
        "record 4 response /a~1b/apiKey",
      ],
      skipped: NONE_SKIPPED,
    });
    expect(JSON.stringify(scanned)).not.toContain("s3cr3t");
  });

  it("scans header and query names, form bodies and string arrays", () => {
    const withHeaders = {
      ordinal: 7,
      reported: {
        request: {
          method: "POST",
          url: "http://127.0.0.1/api?api_key=k&page=1",
          headers: [
            { name: "X-Api-Key", value: "k-123" },
            { name: "Accept", value: "application/json" },
            { name: "Authorization", value: null },
          ],
          queryString: [
            { name: "api_key", value: "k" },
            { name: "page", value: "1" },
          ],
          postData: {
            mimeType: "application/x-www-form-urlencoded",
            text: "user=a&password=hunter22",
          },
        },
        response: {
          status: 200,
          headers: [{ name: "X-Auth-Token", value: "t-9" }],
          content: {
            mimeType: "application/json",
            text: JSON.stringify({ tokens: ["a", "b"], token_count: 2 }),
          },
        },
      },
      redactions: [],
      binary_fields: [],
    } as unknown as WebNetworkCaptureRecord;
    expect(scanCredentialNames([withHeaders])).toEqual({
      count: 5,
      pointers: [
        "record 7 request header X-Api-Key",
        "record 7 response header X-Auth-Token",
        "record 7 request query api_key",
        "record 7 request /password",
        "record 7 response /tokens",
      ],
      skipped: NONE_SKIPPED,
    });
  });

  it("counts every occurrence of a repeated form field that holds a value", () => {
    const form = (text: string): WebNetworkCaptureRecord => {
      const scanned = record(3, undefined, undefined);
      (
        scanned.reported as { request: { postData?: unknown } }
      ).request.postData = {
        mimeType: "application/x-www-form-urlencoded",
        text,
      };
      return scanned;
    };
    // A later empty occurrence does not hide the earlier value the Evidence ships.
    expect(scanCredentialNames([form("api_key=secret&api_key=")])).toEqual({
      count: 1,
      pointers: ["record 3 request /api_key"],
      skipped: NONE_SKIPPED,
    });
    expect(scanCredentialNames([form("token=a&page=1&token=b")])).toEqual({
      count: 2,
      pointers: ["record 3 request /token", "record 3 request /token"],
      skipped: NONE_SKIPPED,
    });
  });

  it("walks bodies nested deeper than the call stack allows", () => {
    const depth = 20_000;
    const deep = record(1, undefined, undefined);
    (
      deep.reported as { response: { content: { text: string } } }
    ).response.content.text =
      `${"[".repeat(depth)}{"token":"x"}${"]".repeat(depth)}`;
    expect(scanCredentialNames([deep]).count).toBe(1);
  });
});

describe("scanCredentialNames body formats", () => {
  const posted = (mimeType: string, text: string): WebNetworkCaptureRecord => {
    const scanned = record(3, undefined, undefined);
    (scanned.reported as { request: { postData?: unknown } }).request.postData =
      { mimeType, text };
    return scanned;
  };
  const FORM = "application/x-www-form-urlencoded; charset=UTF-8";

  it("reads a form body as the form parser does, by its media type or, without one, by its shape", () => {
    for (const mimeType of [FORM, ""]) {
      expect(
        scanCredentialNames([posted(mimeType, "password=example&")]),
        mimeType,
      ).toEqual({
        count: 1,
        pointers: ["record 3 request /password"],
        skipped: NONE_SKIPPED,
      });
      expect(
        scanCredentialNames([posted(mimeType, "user=a&&flag&token=example")]),
        mimeType,
      ).toEqual({
        count: 1,
        pointers: ["record 3 request /token"],
        skipped: NONE_SKIPPED,
      });
    }
  });

  it("finds nothing in plain text that is not a form", () => {
    for (const mimeType of ["text/plain", ""])
      for (const text of ["token=abc to sign in", "Use token=abc", ""])
        expect(
          scanCredentialNames([posted(mimeType, text)]),
          `${mimeType} ${text}`,
        ).toEqual({ count: 0, pointers: [], skipped: NONE_SKIPPED });
  });
});

describe("scanCredentialNames over structured form parameters", () => {
  it.each([undefined, null])(
    "scans each structured form parameter with absent text: %s",
    (text) => {
      const structured = record(4, undefined, undefined);
      (
        structured.reported as { request: { postData?: unknown } }
      ).request.postData = {
        mimeType: "multipart/form-data",
        text,
        params: [
          { name: "api_key", value: "secret" },
          { name: "api_key", value: "" },
          { name: "user", value: "a" },
          { name: "token", value: "t" },
        ],
      };
      expect(scanCredentialNames([structured])).toEqual({
        count: 2,
        pointers: ["record 4 request /api_key", "record 4 request /token"],
        skipped: NONE_SKIPPED,
      });
    },
  );
});

describe("scanScenarioCredentialNames", () => {
  it("scans each content event, and each transaction URL once, by event index", () => {
    const capture = scenarioCaptureFixture(
      [
        {
          method: "POST",
          url: "/api/session?api_key=k-1",
          status: 200,
          mediaType: "application/json",
          body: "{}",
          // Recorded without a media type, so its shape decides how it is read.
          requestBody: '{"password":"x"}',
          requestHeaders: [{ name: "X-Api-Key", value: "k-2" }],
        },
      ],
      { request_body: true, response_body: true, header_values: true },
    );
    const response = capture.events.items.find(
      (event) => event.kind === "response",
    );
    if (response === undefined) throw new Error("Fixture lacks a response");
    // A second response leaves the transaction unattributable; its events still ship.
    const scanned = scanScenarioCredentialNames([
      ...capture.events.items,
      { ...response, sequence: 99 },
    ]);
    expect(scanned).toEqual({
      count: 3,
      pointers: [
        "event 0 request query api_key",
        "event 1 request header X-Api-Key",
        "event 1 request /password",
      ],
      skipped: NONE_SKIPPED,
    });
    expect(JSON.stringify(scanned)).not.toContain("k-2");
  });

  it("scans each content event of a phase the capture recorded twice", () => {
    const capture = scenarioCaptureFixture([
      {
        method: "GET",
        url: "/api/session",
        status: 200,
        mediaType: "application/json",
        body: '{"token":"t-1"}',
      },
    ]);
    const content = capture.events.items.find(
      (event) => event.kind === "network-content",
    );
    if (content === undefined) throw new Error("Fixture lacks content");
    expect(
      scanScenarioCredentialNames([
        ...capture.events.items,
        { ...content, sequence: 99 },
      ]),
    ).toEqual({
      count: 2,
      pointers: ["event 2 response /token", "event 3 response /token"],
      skipped: NONE_SKIPPED,
    });
  });
});

describe("scanCredentialNames coverage", () => {
  it("measures the scan limit in UTF-8 bytes for multibyte text", () => {
    const multibyte = record(
      9,
      { token: "界".repeat(2 * 1024 * 1024) },
      undefined,
    );
    expect(scanCredentialNames([multibyte])).toMatchObject({
      count: 0,
      skipped: { count: 1, pointers: ["record 9 request"] },
    });
  });
  it("reports text bodies too large to scan by record and side, never by content", () => {
    const large = JSON.stringify({
      token: "t-large",
      pad: "a".repeat(4 * 1024 * 1024),
    });
    const oversized = record(5, undefined, undefined);
    const reported = oversized.reported as {
      request: { postData?: unknown };
      response: { content: { text: string } };
    };
    reported.request.postData = { mimeType: "application/json", text: large };
    reported.response.content.text = large;
    const base64 = (ordinal: number, bytes: Buffer): WebNetworkCaptureRecord =>
      ({
        ...record(ordinal, undefined, undefined),
        reported: {
          request: { method: "GET", url: "http://127.0.0.1/api" },
          response: {
            status: 200,
            content: {
              mimeType: "application/json",
              text: "",
              encoding: "base64",
            },
          },
        },
        binary_fields: [
          {
            pointer: "/response/content/text",
            state: "retained",
            content_base64: bytes.toString("base64"),
          },
        ],
      }) as unknown as WebNetworkCaptureRecord;
    const scanned = scanCredentialNames([
      oversized,
      // Decoded only as a prefix, so its end is never read.
      base64(6, Buffer.from(large)),
      // Binary bytes hold no JSON or form text, so nothing was left unscanned.
      base64(7, Buffer.alloc(5 * 1024 * 1024, 0xff)),
      record(8, { token: "t-small" }, {}),
    ]);
    expect(scanned).toEqual({
      count: 1,
      pointers: ["record 8 request /token"],
      skipped: {
        count: 3,
        pointers: [
          "record 5 request",
          "record 5 response",
          "record 6 response",
        ],
      },
    });
    expect(JSON.stringify(scanned)).not.toContain("t-large");
  });
});

describe("anonymousOrigin", () => {
  it("is true for loopback names and IP literals", () => {
    for (const origin of [
      "http://127.0.0.1:3101",
      "http://localhost:3000",
      "http://app.localhost",
      "http://[::1]:8080",
      "http://10.0.0.5",
    ])
      expect(anonymousOrigin(origin), origin).toBe(true);
    expect(anonymousOrigin("http://localhost.:3000")).toBe(true);
    for (const origin of ["https://grafana.example", "not a url"])
      expect(anonymousOrigin(origin), origin).toBe(false);
  });
});

describe("nameFromCaptureFile", () => {
  it("drops capture suffixes and keeps a kebab-case label", () => {
    expect(nameFromCaptureFile("/w/grafana.har")).toBe("grafana");
    expect(nameFromCaptureFile("/w/grafana.capture.json")).toBe("grafana");
    expect(nameFromCaptureFile("/w/My App.scoped.HAR")).toBe("my-app-scoped");
    expect(nameFromCaptureFile("/w/--.json")).toBe("");
  });
});

it.each([
  { text: "password=example", pointers: ["/password"] },
  { text: "token=a&page=1&token=b", pointers: ["/token", "/token"] },
  { text: "%70assword=encoded", pointers: ["/password"] },
  { text: "flag&password=example", pointers: ["/password"] },
])(
  "reviews retained form names without a recorded media type: $text",
  ({ text, pointers }) => {
    const capture = scenarioCaptureFixture(
      [
        {
          method: "POST",
          url: "/api/session",
          status: 200,
          mediaType: "application/json",
          body: "{}",
          requestBody: text,
        },
      ],
      { request_body: true, response_body: true, header_values: true },
    );
    expect(scanScenarioCredentialNames(capture.events.items)).toEqual({
      count: pointers.length,
      pointers: pointers.map((pointer) => `event 1 request ${pointer}`),
      skipped: NONE_SKIPPED,
    });
  },
);

it.each([
  { mimeType: "text/plain", count: 1 },
  { mimeType: "text/markdown", count: 1 },
  { mimeType: "application/octet-stream", count: 2 },
  { mimeType: "", count: 2 },
])(
  "prefers JSON-like media types before form fallback ($mimeType)",
  ({ mimeType, count }) => {
    const json = record(7, undefined, undefined);
    const plain = record(8, undefined, undefined);
    (json.reported as { request: { postData: unknown } }).request.postData = {
      mimeType: "",
      text: '{"name":"password=example","token":"actual"}',
    };
    (plain.reported as { request: { postData: unknown } }).request.postData = {
      mimeType,
      text: "password=example",
    };
    expect(scanCredentialNames([json, plain])).toEqual({
      count,
      pointers: [
        "record 7 request /token",
        ...(count === 2 ? ["record 8 request /password"] : []),
      ],
      skipped: NONE_SKIPPED,
    });
  },
);

describe("savedCredentialWarnings", () => {
  const entry = (name: string, secret?: boolean) => ({
    name,
    json_pointer: "/x",
    ...(secret === undefined ? {} : { secret }),
  });

  it("points at saved values named like credentials that are not marked secret", () => {
    expect(
      savedCredentialWarnings({
        actions: [
          { action: "goto" },
          {
            action: "request",
            save: [
              entry("item_id"),
              entry("access_token"),
              entry("api_key", true),
            ],
          },
          {
            action: "click",
            save_response: { save: [entry("password", false), entry("list")] },
          },
        ],
      }),
    ).toEqual([
      {
        code: "credential-named-saved-values",
        message: expect.stringContaining("2 saved values"),
        pointers: [
          "/parameters/actions/1/save/1",
          "/parameters/actions/2/save_response/save/0",
        ],
      },
    ]);
  });

  it("warns about nothing when every credential-named value is secret, or the parameters are not a scenario", () => {
    expect(
      savedCredentialWarnings({
        actions: [
          { action: "request", save: [entry("token", true), entry("id")] },
        ],
      }),
    ).toEqual([]);
    expect(savedCredentialWarnings({ operation: "har" })).toEqual([]);
    expect(savedCredentialWarnings(undefined)).toEqual([]);
  });
});
