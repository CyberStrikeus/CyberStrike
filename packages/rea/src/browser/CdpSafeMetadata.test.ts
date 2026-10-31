import { MIMEType } from "node:util";
import { describe, expect, it } from "vitest";

import { safeResponseMetadata as projectResponseMetadata } from "./CdpSafeMetadata.js";
import { readCdpResponseFacts } from "./CdpNetworkEventFacts.js";
import type { UnknownRecord } from "./CdpCaptureValues.js";

/** Admit each raw response fixture through the production field owner. */
const safeResponseMetadata = (
  requestId: string,
  url: string,
  response: UnknownRecord,
  allowedOrigins: ReadonlySet<string>,
) => {
  const facts = readCdpResponseFacts(response);
  if (facts === undefined)
    throw new Error("Expected a response fixture record");
  return projectResponseMetadata(requestId, url, facts, allowedOrigins);
};

const origin = "https://app.example.test";

describe("structured COOP and COEP declarations", () => {
  it.each([
    ["same-origin", "same-origin"],
    ['same-origin; report-to="coop"', "same-origin"],
    ['require-corp; report-to="coep"', "require-corp"],
    ['credentialless; report-to="a; b, c"', "credentialless"],
    [String.raw`same-origin; report-to="a\"b\\c"`, "same-origin"],
    [
      "same-origin; enabled; n=-999999999999999; f=999999999999.999",
      "same-origin",
    ],
    ["same-origin; flag=?0; bin=:YQ:; date=@123", "same-origin"],
    ['same-origin; label=%"%c3%a9"', "same-origin"],
    ["same-origin; value=one; value=two", "same-origin"],
    ['  same-origin;  report-to="coop"  ', "same-origin"],
    ["FuturePolicy", "FuturePolicy"],
    ['same-origin; report-to="unterminated', null],
    [String.raw`same-origin; report-to="bad\q"`, null],
    ["same-origin; Report-To=endpoint", null],
    ["same-origin ; report-to=endpoint", null],
    ["same-origin; report-to =endpoint", null],
    ["same-origin; report-to= endpoint", null],
    ["same-origin; report-to=", null],
    ["same-origin;", null],
    ["same-origin, require-corp", null],
    ["same-origin\nrequire-corp", null],
    ['"same-origin"; report-to="coop"', null],
    ["same-origin; n=1000000000000000", null],
    ["same-origin; f=1.1234", null],
    ["same-origin; b=?2", null],
    ["same-origin; bin=:a:", null],
    ["same-origin; bin=:YQ=:", null],
    ['same-origin; label=%"%ff"', null],
    ['same-origin; label=%"%C3%A9"', null],
    ['same-origin; label="é"', null],
    ["same-origin\t", null],
    ["", null],
    [undefined, null],
  ] as const)(
    "parses the complete structured token item %j",
    (value, expected) => {
      const captured = safeResponseMetadata(
        "policies",
        `${origin}/page`,
        {
          headers: {
            "Cross-Origin-Opener-Policy": value,
            "Cross-Origin-Embedder-Policy": value,
            "Cross-Origin-Resource-Policy":
              'same-origin; report-to="not-structured"',
            "X-Content-Type-Options": 'nosniff; report-to="not-structured"',
          },
        },
        new Set([origin]),
      );
      expect(captured.response.policies).toMatchObject({
        coop: expected,
        coep: expected,
        corp: null,
        x_content_type_options: null,
      });
    },
  );
});

describe("media type parameter preservation", () => {
  it.each([
    [
      'Multipart/Mixed; boundary="AaB03x"',
      'multipart/mixed; boundary="AaB03x"',
    ],
    [
      'Application/LD+JSON; profile="https://api.example/Profiles/Book;V=One,Two"',
      'application/ld+json; profile="https://api.example/Profiles/Book;V=One,Two"',
    ],
    [
      'Application/X-Protobuf; type="Example.Message"',
      'application/x-protobuf; type="Example.Message"',
    ],
  ])(
    "preserves case-sensitive media type parameters in %s",
    (raw, expected) => {
      const linkType = raw.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      const captured = safeResponseMetadata(
        "request-media-type",
        `${origin}/page`,
        {
          mimeType: `  ${raw}  `,
          headers: {
            "Content-Encoding": " GZip ",
            Link: `</resource>; rel="PreLoad MCP"; type="${linkType}"; as=SCRIPT; crossorigin=ANONYMOUS`,
          },
        },
        new Set([origin]),
      );

      for (const projected of [
        captured.response.mime_type,
        captured.response.links[0]?.type,
      ]) {
        expect(projected).toBe(expected);
        expect([...new MIMEType(projected ?? "").params]).toEqual([
          ...new MIMEType(raw).params,
        ]);
      }
      expect(captured.response.content_encoding).toBe("gzip");
      expect(captured.response.links).toMatchObject([
        {
          href: `${origin}/resource`,
          destination_scope: "approved",
          context_url: `${origin}/page`,
          context_scope: "approved",
          rel: ["preload", "mcp"],
          as: "script",
          crossorigin: "anonymous",
        },
      ]);
      expect(captured.agentHints).toEqual([
        {
          mechanism: "link_rel",
          declaration: "preload mcp",
          url: `${origin}/resource`,
          trust: "page-declared-untrusted",
        },
      ]);
    },
  );
});

describe("safe CDP response metadata", () => {
  it("drops credential headers and preserves complete local link URLs", () => {
    const captured = safeResponseMetadata(
      "request-1",
      `${origin}/api`,
      {
        mimeType: "application/json",
        headers: {
          Authorization: "Bearer credential-secret",
          Cookie: "session=cookie-secret",
          "Set-Cookie": "session=response-secret",
          Link: `</agent?token=link-secret>; rel="mcp service-desc"; title="a,b", <https://private.example.test/x>; rel="mcp"`,
          "Content-Security-Policy":
            "default-src 'self'; script-src 'nonce-nonce-secret' 'sha256-hash-secret' https://private.example.test",
          "Permissions-Policy":
            "camera=(), geolocation=(self), invalid secret=()",
          "X-Model-Context": "agent-header-secret",
        },
      },
      new Set([origin]),
    );

    expect(captured.response).toMatchObject({
      url: `${origin}/api`,
      csp: {
        nonce_count: 1,
        hash_count: 1,
        directives: expect.arrayContaining([
          expect.objectContaining({
            name: "script-src",
            sources: expect.arrayContaining([
              { kind: "external_origin", value: null },
            ]),
          }),
        ]),
      },
      links: [
        {
          href: `${origin}/agent?token=link-secret`,
          destination_scope: "approved",
          rel: ["mcp", "service-desc"],
          as: null,
          type: null,
          crossorigin: null,
        },
        expect.objectContaining({
          href: "https://private.example.test/x",
          destination_scope: "outside_policy",
        }),
      ],
      policies: { permissions_policy_features: ["camera", "geolocation"] },
    });
    expect(captured.agentHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mechanism: "link_rel" }),
        expect.objectContaining({
          mechanism: "response_header",
          declaration: "x-model-context",
        }),
      ]),
    );
    const serialized = JSON.stringify(captured);
    for (const secret of [
      "credential-secret",
      "cookie-secret",
      "response-secret",
      "nonce-secret",
      "hash-secret",
      "agent-header-secret",
    ])
      expect(serialized).not.toContain(secret);
  });

  it("reports well-known agent resources as untrusted observations", () => {
    const captured = safeResponseMetadata(
      "request-2",
      `${origin}/.well-known/mcp?token=secret`,
      { headers: {} },
      new Set([origin]),
    );

    expect(captured.agentHints).toEqual([
      {
        mechanism: "well_known_resource",
        declaration: "/.well-known/mcp",
        url: `${origin}/.well-known/mcp?token=secret`,
        trust: "page-declared-untrusted",
      },
    ]);
  });

  it.each(["/.well-known/MCP", "/.WELL-KNOWN/mcp"])(
    "does not case-fold a different well-known resource path: %s",
    (path) => {
      const captured = safeResponseMetadata(
        "request-case-variant",
        `${origin}${path}`,
        { headers: {} },
        new Set([origin]),
      );
      expect(captured.response.url).toBe(`${origin}${path}`);
      expect(captured.agentHints).toEqual([]);
    },
  );

  it("retains every parsed header, CSP directive, link, relation, and policy feature", () => {
    const csp = Array.from(
      { length: 105 },
      (_, index) => `x-${String(index)} 'self'`,
    ).join("; ");
    const links = Array.from(
      { length: 105 },
      (_, index) => `</${String(index)}>; rel="mcp service-desc"`,
    ).join(", ");
    const permissions = Array.from(
      { length: 205 },
      (_, index) => `feature-${String(index)}=()`,
    ).join(", ");
    const headers = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        `x-extra-${String(index)}`,
        "ok",
      ]),
    );
    const captured = safeResponseMetadata(
      "request-1",
      `${origin}/api`,
      {
        mimeType: "application/json",
        headers: {
          ...headers,
          "Content-Security-Policy": csp,
          Link: links,
          "Permissions-Policy": permissions,
          "X-Model-Context": "present-after-many-headers",
        },
      },
      new Set([origin]),
    );

    expect(captured.response.csp.directives).toHaveLength(105);
    expect(captured.response.links).toHaveLength(105);
    expect(captured.response.policies.permissions_policy_features).toHaveLength(
      205,
    );
    expect(captured.agentHints).toContainEqual(
      expect.objectContaining({ declaration: "x-model-context" }),
    );
  });
});

describe("safe CDP response metadata CSP sources", () => {
  it("classifies scheme-less CSP host sources by their own host, not the page origin", () => {
    const captured = safeResponseMetadata(
      "request-csp",
      `${origin}/api`,
      {
        headers: {
          "Content-Security-Policy":
            "script-src cdn.example.test *.trusted.test * 'self' https://api.other.test",
        },
      },
      new Set([origin]),
    );

    expect(captured.response.csp.directives).toEqual([
      {
        name: "script-src",
        sources: [
          { kind: "external_origin", value: null },
          { kind: "external_origin", value: null },
          { kind: "external_origin", value: null },
          { kind: "keyword", value: "'self'" },
          { kind: "external_origin", value: null },
        ],
      },
    ]);
  });

  it.each(["\n", "\r\n", ", "])(
    "parses every policy of a repeated CSP field joined by %j",
    (delimiter) => {
      const captured = safeResponseMetadata(
        "request-csp-repeated",
        `${origin}/api`,
        {
          headers: {
            "Content-Security-Policy": [
              "default-src 'self'",
              "script-src https://private.example.test; img-src data:",
            ].join(delimiter),
          },
        },
        new Set([origin]),
      );

      expect(captured.response.csp.directives).toEqual([
        {
          name: "default-src",
          sources: [{ kind: "keyword", value: "'self'" }],
        },
        {
          name: "script-src",
          sources: [{ kind: "external_origin", value: null }],
        },
        { name: "img-src", sources: [{ kind: "scheme", value: "data:" }] },
      ]);
    },
  );

  it("inherits the protected resource scheme for a scheme-less host source", () => {
    const captured = safeResponseMetadata(
      "request-csp-scheme",
      `${origin}/api`,
      {
        headers: {
          "Content-Security-Policy":
            "script-src cdn.example.test app.example.test",
        },
      },
      new Set([origin, "https://cdn.example.test"]),
    );

    expect(captured.response.csp.directives[0]?.sources).toEqual([
      { kind: "approved_origin", value: "https://cdn.example.test" },
      { kind: "approved_origin", value: origin },
    ]);
  });

  it("ignores a directive repeated within one policy but not across policies", () => {
    const captured = safeResponseMetadata(
      "request-csp-duplicate",
      `${origin}/api`,
      {
        headers: {
          "Content-Security-Policy":
            "script-src 'self'; Script-Src 'unsafe-inline' 'nonce-abc', script-src data:",
        },
      },
      new Set([origin]),
    );

    expect(captured.response.csp).toEqual({
      directives: [
        { name: "script-src", sources: [{ kind: "keyword", value: "'self'" }] },
        { name: "script-src", sources: [{ kind: "scheme", value: "data:" }] },
      ],
      nonce_count: 0,
      hash_count: 0,
    });
  });
});

describe("Link header value delimiters", () => {
  const captureLinks = (link: string) =>
    safeResponseMetadata(
      "owned",
      "https://owned.test/page",
      {
        headers: { Link: link },
      },
      new Set(["https://owned.test"]),
    ).response.links;

  it.each([", ", "\n", "\r\n"])(
    "preserves repeated field declarations and agent hints joined by %j",
    (separator) => {
      const captured = safeResponseMetadata(
        "document-response",
        `${origin}/page`,
        {
          headers: {
            Link: [
              '</assets/red,blue.js>; rel="preload"; type="text/javascript; charset=utf-8"; title="a,b"',
              '</agent?selected=keep>; rel="mcp service-desc"',
            ].join(separator),
          },
        },
        new Set([origin]),
      );
      expect(captured.response.links).toMatchObject([
        {
          href: `${origin}/assets/red,blue.js`,
          rel: ["preload"],
          type: "text/javascript; charset=utf-8",
        },
        {
          href: `${origin}/agent?selected=keep`,
          rel: ["mcp", "service-desc"],
        },
      ]);
      expect(captured.agentHints).toContainEqual({
        mechanism: "link_rel",
        declaration: "mcp service-desc",
        url: `${origin}/agent?selected=keep`,
        trust: "page-declared-untrusted",
      });
    },
  );

  it.each(["\u00a0", "\u000b", "\u000c", "\u2003", "\ufeff"])(
    "preserves non-HTTP whitespace %j without inventing agent relations",
    (separator) => {
      for (const declaration of [
        `"alternate${separator}mcp"`,
        `${separator}mcp${separator}`,
        `"${separator}mcp${separator}"`,
      ]) {
        const captured = safeResponseMetadata(
          "owned",
          "https://owned.test/page",
          { headers: { Link: `</agent>; rel=${declaration}` } },
          new Set(["https://owned.test"]),
        );
        expect(captured.response.links[0]?.rel).toEqual([
          declaration.replace(/^"|"$/gu, ""),
        ]);
        expect(captured.agentHints).toEqual([]);
      }
    },
  );

  it("does not trim non-HTTP whitespace into link or parameter syntax", () => {
    expect(captureLinks("\u00a0</agent>; rel=mcp")).toEqual([]);
    const links = captureLinks(
      "</agent>; \u00a0rel=mcp; rel\u00a0=service-desc",
    );
    expect(links[0]?.rel).toEqual([]);
  });

  it("uses HTTP spaces and tabs for relation and parameter boundaries", () => {
    const captured = safeResponseMetadata(
      "owned",
      "https://owned.test/page",
      { headers: { Link: '\t</agent>; \trel\t=\t" MCP\t service-desc "\t' } },
      new Set(["https://owned.test"]),
    );
    expect(captured.response.links[0]?.rel).toEqual(["mcp", "service-desc"]);
    expect(captured.agentHints).toContainEqual({
      mechanism: "link_rel",
      declaration: "mcp service-desc",
      url: "https://owned.test/agent",
      trust: "page-declared-untrusted",
    });
  });

  it("keeps delimiters scoped to each CDP field line", () => {
    const links = captureLinks(
      '</first>; title="unterminated\n</agent>; rel=mcp',
    );
    expect(links.map(({ href }) => href)).toEqual([
      "https://owned.test/first",
      "https://owned.test/agent",
    ]);
    expect(links[1]?.rel).toEqual(["mcp"]);
  });

  it("preserves commas in URI references and separates later links", () => {
    const links = captureLinks(
      '</assets/red,blue.js>; rel="preload"; as=script, </ordinary.js>; rel="modulepreload"',
    );
    expect(links.map(({ href }) => href)).toEqual([
      "https://owned.test/assets/red,blue.js",
      "https://owned.test/ordinary.js",
    ]);
    expect(links[0]?.as).toBe("script");
  });

  it("preserves semicolons and commas inside quoted parameter values", () => {
    const links = captureLinks(
      '</plugin.js>; rel="preload"; type="text/javascript; charset=utf-8"; title="a,b", </ordinary.js>; rel="modulepreload"',
    );
    expect(links).toHaveLength(2);
    expect(links[0]?.type).toBe("text/javascript; charset=utf-8");
    expect(links[1]?.href).toBe("https://owned.test/ordinary.js");
  });

  it("counts quoted-pair escapes rather than treating every preceding slash as an escape", () => {
    const links = captureLinks(
      String.raw`</one.js>; title="ends with \\"; rel="preload", </two.js>; rel="modulepreload"`,
    );
    expect(links.map(({ href }) => href)).toEqual([
      "https://owned.test/one.js",
      "https://owned.test/two.js",
    ]);
    expect(links[0]?.rel).toEqual(["preload"]);
  });

  it("keeps a quoted escaped quote from exposing a delimiter", () => {
    const links = captureLinks(
      String.raw`</one.js>; title="quoted \" comma, value"; rel="preload", </two.js>; rel="modulepreload"`,
    );
    expect(links).toHaveLength(2);
    expect(links[0]?.rel).toEqual(["preload"]);
  });

  it("retains the existing outside-policy classification", () => {
    const links = captureLinks(
      '<https://elsewhere.test/red,blue.js>; rel="preload", </ordinary.js>; rel="modulepreload"',
    );
    expect(links[0]?.destination_scope).toBe("outside_policy");
    expect(links[1]?.destination_scope).toBe("approved");
  });
});
describe("safe CDP response metadata referrer policy", () => {
  it.each<[string | undefined, string | null]>([
    [
      "no-referrer, strict-origin-when-cross-origin",
      "strict-origin-when-cross-origin",
    ],
    ["origin, future-policy", "origin"],
    ["future-policy, no-referrer", "no-referrer"],
    ["unsafe-url, NO-REFERRER", "unsafe-url"],
    ["origin,, no-referrer", "no-referrer"],
    // CDP joins repeated field lines with LF.
    ["no-referrer\nstrict-origin", "strict-origin"],
    ["no-referrer\r\nfuture-policy", "no-referrer"],
    ["future-policy", null],
    ['unsafe-url, "no-referrer"', null],
    ["no-referrer; report-to=x, origin", null],
    ["origin, no-referrer; report-to=x", null],
    ["origin, \u00a0no-referrer", null],
    ["\u00a0no-referrer, origin", null],
    ["NO-REFERRER", null],
    ["NO-REFERRER, origin", "origin"],
    ["origin, \u212a", null],
    ["origin, \u017f", null],
    // Legacy meta names do not declare a policy through the response header.
    ["never, always, default, origin-when-crossorigin", null],
    ["no-referrer, never, always", "no-referrer"],
    ['"no-referrer"', null],
    ["no-referrer; report-to=x", null],
    ["", null],
    [undefined, null],
    ...[
      "no-referrer",
      "no-referrer-when-downgrade",
      "same-origin",
      "origin",
      "strict-origin",
      "origin-when-cross-origin",
      "strict-origin-when-cross-origin",
      "unsafe-url",
    ].map((policy): [string, string] => [policy, policy]),
  ])("normalizes declared Referrer-Policy %s", (raw, expected) => {
    const captured = safeResponseMetadata(
      "request-referrer",
      `${origin}/api`,
      {
        headers: {
          "Referrer-Policy": raw,
          "Cross-Origin-Opener-Policy": "same-origin",
        },
      },
      new Set([origin]),
    );
    expect(captured.response.policies.referrer_policy).toBe(expected);
    expect(captured.response.policies.coop).toBe("same-origin");
  });

  it.each<[string | number | undefined, number | null]>([
    ["100", 100],
    [" 0 ", 0],
    [100, 100],
    ["-5", null],
    ["+12", null],
    ["0x10", null],
    ["1e3", null],
    ["9007199254740991", 9007199254740991],
    ["9007199254740992", null],
    [undefined, null],
  ])("declares Content-Length %j only for decimal digits", (raw, expected) => {
    const captured = safeResponseMetadata(
      "request-length",
      `${origin}/api`,
      { headers: raw === undefined ? {} : { "Content-Length": raw } },
      new Set([origin]),
    );
    expect(captured.response.content_length).toBe(expected);
  });
});

describe("Link context identity and display", () => {
  it.each([
    [
      "https://user:secret@app.example.test/page",
      "/page",
      true,
      `${origin}/page`,
      "approved",
    ],
    [
      "https://user:secret@app.example.test/page",
      "https://user:secret@app.example.test/page",
      true,
      `${origin}/page`,
      "approved",
    ],
    [
      `${origin}/page`,
      "https://other:secret@app.example.test/page",
      false,
      `${origin}/page`,
      "approved",
    ],
    [`${origin}/page`, "http://[", false, "http://[", "unsupported"],
    ["http://[", "/page", false, "/page", "unsupported"],
    [
      `${origin}/page`,
      "https://elsewhere.test/page",
      false,
      "https://elsewhere.test/page",
      "outside_policy",
    ],
  ] as const)(
    "preserves resolved context identity for response %s and anchor %s",
    (responseUrl, anchor, matches, displayUrl, scope) => {
      const captured = safeResponseMetadata(
        "context",
        `${origin}/page`,
        {
          url: responseUrl,
          headers: { Link: `</agent>; rel=mcp; anchor="${anchor}"` },
        },
        new Set([origin]),
      );
      expect(captured.response.links[0]).toMatchObject({
        context_url: displayUrl,
        context_scope: scope,
      });
      expect(
        captured.agentHints.filter(({ mechanism }) => mechanism === "link_rel"),
      ).toHaveLength(matches ? 1 : 0);
      expect(JSON.stringify(captured)).not.toContain("secret");
    },
  );
});

describe("response metadata whitespace boundaries", () => {
  it.each(["\u00a0", "\u2003", "\ufeff", "\v"])(
    "keeps %j out of CSP delimiters and HTTP optional whitespace",
    (whitespace) => {
      const captured = safeResponseMetadata(
        "whitespace",
        `${origin}/page`,
        {
          mimeType: `${whitespace}Text/Plain${whitespace}`,
          headers: {
            "Content-Security-Policy":
              `default-src${whitespace}'self'; ` +
              `script-src 'self'${whitespace}https:; ` +
              `${whitespace}img-src data:`,
            "Content-Length": `${whitespace}100${whitespace}`,
            "Cross-Origin-Resource-Policy": `${whitespace}same-origin${whitespace}`,
            "X-Content-Type-Options": `${whitespace}nosniff${whitespace}`,
            "Referrer-Policy": `${whitespace}no-referrer${whitespace}`,
            "Permissions-Policy": `${whitespace}camera=(), geolocation=()`,
            "Content-Encoding": `${whitespace}GZip${whitespace}`,
          },
        },
        new Set([origin]),
      );
      expect(captured.response.csp).toEqual({
        directives:
          whitespace === "\v"
            ? [
                {
                  name: "script-src",
                  sources: [{ kind: "other", value: null }],
                },
              ]
            : [],
        nonce_count: 0,
        hash_count: 0,
      });
      expect(captured.response.content_length).toBeNull();
      expect(captured.response.policies).toMatchObject({
        corp: null,
        x_content_type_options: null,
        referrer_policy: null,
        permissions_policy_features: ["geolocation"],
      });
      expect(captured.response.mime_type).toBe(
        `${whitespace}text/plain${whitespace}`,
      );
      expect(captured.response.content_encoding).toBe(
        `${whitespace}gzip${whitespace}`,
      );
    },
  );

  it("accepts CSP ASCII whitespace and HTTP SP/HTAB at their owning boundaries", () => {
    const captured = safeResponseMetadata(
      "ascii-whitespace",
      `${origin}/page`,
      {
        headers: {
          "Content-Security-Policy":
            "\tdefault-src\f'self'\r; script-src\t'data' ",
          "Content-Length": "\t100 \t",
          "Cross-Origin-Resource-Policy": "\tsame-origin \t",
          "Referrer-Policy": "\tno-referrer \t",
        },
      },
      new Set([origin]),
    );
    expect(captured.response.csp.directives).toEqual([
      { name: "default-src", sources: [{ kind: "keyword", value: "'self'" }] },
      { name: "script-src", sources: [{ kind: "keyword", value: "'data'" }] },
    ]);
    expect(captured.response.content_length).toBe(100);
    expect(captured.response.policies.corp).toBe("same-origin");
    expect(captured.response.policies.referrer_policy).toBe("no-referrer");
  });
});
