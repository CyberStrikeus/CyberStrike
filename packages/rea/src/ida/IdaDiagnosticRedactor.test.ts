import { describe, expect, it } from "vitest";
import {
  createIdaDiagnosticRedactor,
  IDA_DIAGNOSTIC_SOURCE_BYTES,
} from "./IdaDiagnosticRedactor.js";

describe("IDA diagnostic credential redaction", () => {
  it("redacts known URL-encoded credentials while preserving unrelated URL spelling", () => {
    const redact = createIdaDiagnosticRedactor({
      url: "http://localhost:1234/mcp",
      headers: { Authorization: "Bearer fixture-secret" },
      mode: "attached",
      timeoutMs: 1000,
    }).url;
    expect(
      redact("HTTP://localhost:1234/mcp?token=fixture%2Dsecret&cursor=%2Fkeep"),
    ).toBe(
      "HTTP://localhost:1234/mcp?token=[redacted transport credential]&cursor=%2Fkeep",
    );
  });

  it("maps encoded UTF-8 and query plus signs to their original URL spans", () => {
    const redact = createIdaDiagnosticRedactor({
      url: "http://localhost:1234/mcp",
      headers: { "X-Private": "café secret" },
      sensitive: { headers: ["X-Private"], env: [] },
      mode: "attached",
      timeoutMs: 1000,
    }).url;
    expect(
      redact("http://localhost/mcp?token=caf%C3%A9+secret&cursor=keep"),
    ).toBe(
      "http://localhost/mcp?token=[redacted transport credential]&cursor=keep",
    );
  });
  it.each([false, true])(
    "redacts literal credentials once regardless of header order (reversed: %s)",
    (reversed) => {
      const entries = [
        ["Authorization", "Bearer fixture"],
        ["proxy-AUTHORIZATION", "bAsIc fixture-long.$[token]"],
        ["cOoKiE", "session=fixture-long.$[token]; marker=redacted"],
        ["X-Evidence", "caller-selected-evidence"],
      ];
      const redact = createIdaDiagnosticRedactor({
        url: "http://127.0.0.1:12345/mcp",
        headers: Object.fromEntries(reversed ? entries.reverse() : entries),
        mode: "attached",
        timeoutMs: 1000,
      }).text;
      expect(
        redact(
          "Bearer fixture / fixture / bAsIc fixture-long.$[token] / fixture-long.$[token] / session=fixture-long.$[token]; marker=redacted /caller/input?token=visible API_KEY=visible caller-selected-evidence",
        ),
      ).toBe(
        "␟ / ␟ / ␟ / ␟ / ␟ /caller/input?token=visible API_KEY=visible caller-selected-evidence",
      );
    },
  );
  it("redacts configured and HTTP-normalized header values", () => {
    const redact = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      headers: {
        aUtHoRiZaTiOn: "\r\n \tBearer fixture-secret \t\r\n",
        "pRoXy-AuThOrIzAtIoN": "\tBasic proxy-secret ",
        CoOkIe: " session=cookie-secret\t",
      },
      mode: "attached",
      timeoutMs: 1000,
    }).text;
    expect(
      redact(
        "raw=\r\n \tBearer fixture-secret \t\r\n; wire=Bearer fixture-secret; token=fixture-secret; proxy=Basic proxy-secret; bare=proxy-secret; cookie=session=cookie-secret",
      ),
    ).toBe(
      "raw=[redacted transport credential]; wire=[redacted transport credential]; token=[redacted transport credential]; proxy=[redacted transport credential]; bare=[redacted transport credential]; cookie=[redacted transport credential]",
    );
  });
  it("does not treat empty HTTP authentication as diagnostic content", () => {
    const redact = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      headers: {
        Authorization: "\r\n \t \r\n",
        "Proxy-Authorization": "",
        Cookie: "\t",
      },
      mode: "attached",
      timeoutMs: 1000,
    }).text;
    const message = "Failed at /caller/input \t with ordinary whitespace";
    expect(redact(message)).toBe(message);
  });
  it.each(["X-Caller-Value", "Authorization"])(
    "redacts explicitly marked whitespace in %s independently of HTTP authentication",
    (name) => {
      const redact = createIdaDiagnosticRedactor({
        url: "http://127.0.0.1:12345/mcp",
        headers: { [name]: "\t" },
        sensitive: { headers: [name.toLowerCase()], env: [] },
        mode: "attached",
        timeoutMs: 1000,
      }).text;
      expect(redact("input\tvalue")).toBe(
        "input[redacted transport credential]value",
      );
    },
  );
  it("does not reprocess the replacement marker as another credential", () => {
    const redact = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      headers: { Authorization: "Bearer alpha", Cookie: "redacted" },
      mode: "attached",
      timeoutMs: 1000,
    }).text;
    expect(redact("alpha redacted")).toBe("␟ ␟");
  });
});

const credentialCases: readonly {
  readonly name: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly message: string;
  readonly expected: string;
}[] = [
  {
    name: "duplicate cookie names, quoted values, and equals padding",
    headers: {
      Cookie:
        'session=first-secret; session=second-secret; signed="padded=value=="',
    },
    message: "first-secret / second-secret / padded=value== / session signed",
    expected:
      "[redacted transport credential] / [redacted transport credential] / [redacted transport credential] / session signed",
  },
  {
    name: "empty cookie and auth-param values",
    headers: { Cookie: 'a=; b=""', Authorization: 'Custom empty=""' },
    message: 'Ordinary spaces and "" remain; a b empty are names',
    expected: 'Ordinary spaces and "" remain; a b empty are names',
  },
  {
    name: "opaque token68 and explicit one-character credentials",
    headers: { Authorization: "Negotiate opaque+/==", Cookie: "a=Q" },
    message: "opaque+/== Q Negotiate a",
    expected:
      "[redacted transport credential] [redacted transport credential] Negotiate a",
  },
  {
    name: "auth-param values retain quoted commas and decode quoted pairs",
    headers: {
      Authorization: String.raw`Digest first="nonce,part", response="quote\"part", opaque="back\\part", tail=last-secret`,
    },
    message: String.raw`nonce,part / quote"part / quote\"part / back\part / back\\part / last-secret / Digest first response opaque tail`,
    expected:
      "[redacted transport credential] / [redacted transport credential] / [redacted transport credential] / [redacted transport credential] / [redacted transport credential] / [redacted transport credential] / Digest first response opaque tail",
  },
  {
    name: "complete parameters before a malformed quoted member",
    headers: {
      Authorization:
        'Digest first=known-secret, broken="unterminated, second=visible',
    },
    message: "known-secret visible broken second",
    expected: "[redacted transport credential] visible broken second",
  },
  {
    name: "unclosed quotes do not create parameters from their contents",
    headers: { Authorization: 'Digest broken="unterminated, second=visible' },
    message: "unterminated visible broken second",
    expected: "unterminated visible broken second",
  },
  {
    name: "malformed cookie members do not hide valid later pairs",
    headers: {
      Cookie: 'broken; =not-a-value; malformed="unclosed; session=valid-secret',
    },
    message: "valid-secret broken not-a-value unclosed session",
    expected:
      "[redacted transport credential] broken not-a-value unclosed session",
  },
  {
    name: "cookie octets remain opaque without URL decoding",
    headers: { Cookie: "session=encoded%2Fcredential" },
    message: "encoded%2Fcredential / encoded/credential",
    expected: "[redacted transport credential] / encoded/credential",
  },
];
it.each(credentialCases)(
  "parses $name at the configured credential boundary",
  ({ headers, message, expected }) => {
    const redact = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      headers,
      mode: "attached",
      timeoutMs: 1000,
    }).text;
    expect(redact(message)).toBe(expected);
  },
);

it("redacts full configured malformed headers without guessing their internal values", () => {
  const header = 'Digest broken="unterminated, second=visible';
  const redactor = createIdaDiagnosticRedactor({
    url: "http://127.0.0.1:12345/mcp",
    headers: { Authorization: header },
    mode: "attached",
    timeoutMs: 1000,
  });
  expect(redactor.text(header)).toBe("[redacted transport credential]");
  expect(redactor.json(JSON.stringify(header))).toBe(
    '"[redacted transport credential]"',
  );
});

const marker = "[redacted transport credential]";
const redactorFor = (header: string, name = "Authorization") =>
  createIdaDiagnosticRedactor({
    url: "http://127.0.0.1:12345/mcp",
    headers: { [name]: header },
    mode: "attached",
    timeoutMs: 1000,
  });

describe("IDA Basic authentication payload components", () => {
  it.each(["aUtHoRiZaTiOn", "pRoXy-AuThOrIzAtIoN"])(
    "protects decoded Basic pairs and passwords while preserving user names for %s",
    (name) => {
      const pair = "fixture-user:fixture-password:tail";
      const encoded = Buffer.from(pair, "utf8").toString("base64");
      const redactor = redactorFor("bAsIc " + encoded, name);
      const reason =
        "pair=" +
        pair +
        "; user=fixture-user; password=fixture-password:tail; wire=" +
        encoded;
      const safe =
        "pair=" +
        marker +
        "; user=fixture-user; password=" +
        marker +
        "; wire=" +
        marker;
      expect(redactor.text(reason + "; path=/caller/input?token=visible")).toBe(
        safe + "; path=/caller/input?token=visible",
      );
      expect(
        redactor.json(JSON.stringify({ reason, path: "/caller/input" })),
      ).toBe(JSON.stringify({ reason: safe, path: "/caller/input" }));
    },
  );

  it.each([
    [
      ":fixture-password",
      "pair=:fixture-password; password=fixture-password; empty values leave spaces",
      "pair=" + marker + "; password=" + marker + "; empty values leave spaces",
    ],
    [
      "fixture-user:",
      "pair=fixture-user:; user=fixture-user; empty values leave spaces",
      "pair=" + marker + "; user=fixture-user; empty values leave spaces",
    ],
    [
      ":",
      "pair=:; empty values leave spaces",
      "pair=" + marker + "; empty values leave spaces",
    ],
  ])(
    "protects a decoded pair with empty components: %s",
    (pair, reason, safe) => {
      const encoded = Buffer.from(pair, "utf8").toString("base64");
      expect(redactorFor("Basic " + encoded).text(reason)).toBe(safe);
    },
  );
});

describe("IDA Basic authentication charset and invalid data", () => {
  it("retains both strict UTF-8 and exact octet-compatible interpretations when charset is unknown", () => {
    const pair = "tést-user:päss£word";
    const bytes = Buffer.from(pair, "utf8");
    const octets = bytes.toString("latin1");
    const redactor = redactorFor("Basic " + bytes.toString("base64"));
    const reason =
      "utf8=" +
      pair +
      "; octets=" +
      octets +
      "; user=tést-user; password=päss£word; octet-user=tÃ©st-user; octet-password=pÃ¤ssÂ£word; caller=/caller/input";
    expect(redactor.text(reason)).toBe(
      "utf8=" +
        marker +
        "; octets=" +
        marker +
        "; user=tést-user; password=" +
        marker +
        "; octet-user=tÃ©st-user; octet-password=" +
        marker +
        "; caller=/caller/input",
    );
  });

  it("preserves exact Latin-1 octets without inventing lossy UTF-8 replacement credentials", () => {
    const bytes = Buffer.from("latin-user:pässword", "latin1");
    const redactor = redactorFor("Basic " + bytes.toString("base64"));
    expect(
      redactor.text(
        "latin-user:pässword / latin-user / pässword / p\ufffdssword /caller/input",
      ),
    ).toBe(
      marker + " / latin-user / " + marker + " / p\ufffdssword /caller/input",
    );
  });

  it("preserves a UTF-8 BOM as credential data rather than dropping it", () => {
    const pair = "\ufefffixture-user:fixture-password";
    const encoded = Buffer.from(pair, "utf8").toString("base64");
    expect(
      redactorFor("Basic " + encoded).text(pair + " / \ufefffixture-user"),
    ).toBe(marker + " / \ufefffixture-user");
  });

  it("keeps decoded Basic values opaque without URL decoding", () => {
    const encoded = Buffer.from("fixture-user:p%2Fsecret", "utf8").toString(
      "base64",
    );
    expect(redactorFor("Basic " + encoded).text("p%2Fsecret / p/secret")).toBe(
      marker + " / p/secret",
    );
  });

  const canonical = Buffer.from(
    "fixture-user:fixture-password",
    "utf8",
  ).toString("base64");
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const nonzeroPadBits = canonical.replace(
    /(.)(=)$/u,
    (_match, symbol: string, padding: string) =>
      (alphabet[alphabet.indexOf(symbol) + 1] ?? "!") + padding,
  );
  it.each([
    { name: "unpadded", payload: canonical.slice(0, -1) },
    { name: "at most two padding characters", payload: canonical + "=" },
  ])(
    "accepts the supported normalized Basic Base64 spelling: $name",
    ({ payload }) => {
      const redactor = redactorFor("Basic " + payload);
      expect(
        redactor.text(
          "fixture-user:fixture-password / fixture-password / fixture-user",
        ),
      ).toBe(marker + " / " + marker + " / fixture-user");
    },
  );

  it.each([
    {
      name: "non-alphabet character",
      payload: canonical.slice(0, 4) + "!" + canonical.slice(4),
    },
    {
      name: "embedded whitespace",
      payload: canonical.slice(0, 4) + " " + canonical.slice(4),
    },
    { name: "more than two pad characters", payload: canonical + "==" },
    { name: "nonzero pad bits", payload: nonzeroPadBits },
    {
      name: "missing colon separator",
      payload: Buffer.from("fixture-user", "utf8").toString("base64"),
    },
    {
      name: "ASCII control in user-pass",
      payload: Buffer.from("fixture-user:fixture-password\n", "utf8").toString(
        "base64",
      ),
    },
    {
      name: "auth-param-shaped malformed Basic data",
      payload: "credential=fixture-password",
    },
  ])("retains only opaque configured Basic data for $name", ({ payload }) => {
    const header = "Basic " + payload;
    const redactor = redactorFor(header);
    expect(redactor.text(header + " / " + payload)).toBe(
      marker + " / " + marker,
    );
    expect(redactor.text("fixture-user / fixture-password /caller/input")).toBe(
      "fixture-user / fixture-password /caller/input",
    );
  });

  it("does not decode another scheme's base64-shaped opaque payload", () => {
    const encoded = Buffer.from(
      "fixture-user:fixture-password",
      "utf8",
    ).toString("base64");
    const redactor = redactorFor("Custom " + encoded);
    expect(redactor.text(encoded + " / fixture-user / fixture-password")).toBe(
      marker + " / fixture-user / fixture-password",
    );
  });
});

it("redacts protocol-decoded Basic credentials and password without treating ordinary names as secrets", () => {
  const redactor = createIdaDiagnosticRedactor({
    url: "http://127.0.0.1:12345/mcp",
    mode: "attached",
    timeoutMs: 1000,
    headers: {
      Authorization: `Basic ${Buffer.from("user:secret").toString("base64")}`,
    },
  });
  expect(redactor.text("user:secret / secret / user")).toBe(
    "[redacted transport credential] / [redacted transport credential] / user",
  );
  expect(redactor.json('"\\u0073ecret"')).toBe(
    '"[redacted transport credential]"',
  );
});

it.each(["text", "json"] as const)(
  "bounds short-secret diagnostic expansion before %s redaction",
  (format) => {
    const redactor = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      mode: "attached",
      timeoutMs: 1000,
      headers: { Cookie: "a=Q" },
    });
    const result = redactor[format]("Q".repeat(2 * 1024 * 1024));
    expect(result).toBe("[IDA diagnostic omitted: exceeds 65536 UTF-8 bytes]");
  },
);

it.each(["text", "json"] as const)(
  "applies the UTF-8 source-byte budget before %s processing even without credentials",
  (format) => {
    const atBudget = "£".repeat(IDA_DIAGNOSTIC_SOURCE_BYTES / 2);
    const overBudget = atBudget + "£";
    const configuredHeaders: readonly Readonly<Record<string, string>>[] = [
      {},
      { Cookie: "a=Q" },
    ];
    for (const headers of configuredHeaders) {
      const redactor = createIdaDiagnosticRedactor({
        url: "http://127.0.0.1:12345/mcp",
        mode: "attached",
        timeoutMs: 1000,
        headers,
      });
      expect(redactor[format](atBudget)).toBe(atBudget);
      expect(redactor[format](overBudget)).toBe(
        "[IDA diagnostic omitted: exceeds 65536 UTF-8 bytes]",
      );
    }
  },
);

it.each(["dXNlcjpzZWNyZXQ=", "dXNlcjpzZWNyZXQ", "dXNlcjpzZWNyZXQ=="])(
  "redacts accepted canonical Basic spellings for %s",
  (payload) => {
    const redactor = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      mode: "attached",
      timeoutMs: 1000,
      headers: { Authorization: `Basic ${payload}` },
    });
    const marker = "[redacted transport credential]";
    expect(
      redactor.text(
        "dXNlcjpzZWNyZXQ= / dXNlcjpzZWNyZXQ / user:secret / secret",
      ),
    ).toBe(`${marker} / ${marker} / ${marker} / ${marker}`);
  },
);

describe("overlapping IDA credential source spans", () => {
  it.each([false, true])(
    "unions all overlapping plain credentials before writing (reversed: %s)",
    (reversed) => {
      const entries = [
        ["Authorization", "Custom X]"],
        ["Cookie", "a=]SECRET"],
      ];
      const redactor = createIdaDiagnosticRedactor({
        url: "http://127.0.0.1:12345/mcp",
        headers: Object.fromEntries(reversed ? entries.reverse() : entries),
        mode: "attached",
        timeoutMs: 1000,
      });
      const result = redactor.text(
        "Rejected X]SECRET at /caller/input?cursor=visible",
      );
      expect(result).toBe("Rejected ␟ at /caller/input?cursor=visible");
      expect(result).not.toContain("]SECRET");
    },
  );

  it("unions a chain of different overlapping credentials", () => {
    const redactor = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      headers: { Authorization: "Custom abc", Cookie: "a=cde; b=def" },
      mode: "attached",
      timeoutMs: 1000,
    });
    expect(redactor.text("prefix abcdefg suffix")).toBe(
      "prefix " + marker + "g suffix",
    );
  });

  it("merges dense same-credential overlaps without retaining a per-match collection", () => {
    const redactor = redactorFor("Custom AA");
    const result = redactor.text("A".repeat(IDA_DIAGNOSTIC_SOURCE_BYTES));
    expect(result.length).toBe(marker.length);
    expect(result).toBe(marker);
  });

  it("retains adjacent disjoint credential occurrences", () => {
    expect(redactorFor("Custom AA").text("AA-AA")).toBe(marker + "-" + marker);
  });
});

describe("credential-safe redaction markers", () => {
  it.each([
    { secret: "]SECRET", source: "XSECRET", expected: "␟SECRET" },
    { secret: "SECRET[", source: "SECRETX", expected: "SECRET␟" },
    {
      secret: "a[redacted transport credential]b",
      source: "aXb",
      expected: "a␟b",
    },
    { secret: "redacted", source: "redacted", expected: "␟" },
  ])(
    "does not create $secret from replacement text or boundaries",
    ({ secret, source, expected }) => {
      const redactor = createIdaDiagnosticRedactor({
        url: "http://127.0.0.1:12345/mcp",
        mode: "attached",
        timeoutMs: 1000,
        headers: { Authorization: "Custom " + secret, Cookie: "a=X" },
      });
      expect(redactor.text(source)).toBe(expected);
      expect(
        redactor.json(
          JSON.stringify({ reason: source, context: "/caller/input" }),
        ),
      ).toBe(JSON.stringify({ reason: expected, context: "/caller/input" }));
      expect(redactor.json('"' + source + '",x')).toBe('"' + expected + '",x');
    },
  );
  it("chooses a different graphic scalar when a decoded Basic credential contains the first marker", () => {
    const redactor = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      mode: "attached",
      timeoutMs: 1000,
      headers: {
        Authorization:
          "Basic " + Buffer.from("user:␟", "utf8").toString("base64"),
        Cookie: "a=]SECRET",
      },
    });
    expect(redactor.text("␟ at /caller/input")).toBe("␠ at /caller/input");
    expect(redactor.json(String.raw`{"reason":"␟","context":"kept"}`)).toBe(
      '{"reason":"␠","context":"kept"}',
    );
  });
});

describe("unclassified diagnostic blocks and message ownership", () => {
  it.each<Readonly<Record<string, string>>>([{}, { Cookie: "a=Q" }])(
    "budgets the entire source block list before redaction: %s",
    (headers) => {
      const redactor = createIdaDiagnosticRedactor({
        url: "http://127.0.0.1:12345/mcp",
        mode: "attached",
        timeoutMs: 1000,
        headers,
      });
      const first = "£".repeat(IDA_DIAGNOSTIC_SOURCE_BYTES / 4);
      expect(redactor.blocks([first, first])).toBe(
        "[IDA diagnostic omitted: exceeds 65536 UTF-8 bytes]",
      );
      expect(redactor.blocks([first, first.slice(1)])).toBe(
        first + "\n" + first.slice(1),
      );
    },
  );
  it("keeps complete quoted plain credentials while preserving explicit JSON semantics", () => {
    const redactor = redactorFor(String.raw`Custom folder\tmp`);
    const source = String.raw`"folder\tmp at /caller/input"`;
    expect(redactor.blocks([source])).toBe(
      '"[redacted transport credential] at /caller/input"',
    );
    expect(redactor.json(source)).toBe(source);
  });
  it("sanitizes the omission notice as diagnostic text", () => {
    const redactor = redactorFor("Custom omitted");
    expect(
      redactor.blocks(["Q".repeat(IDA_DIAGNOSTIC_SOURCE_BYTES + 1)]),
    ).toContain("[redacted transport credential]");
    expect(
      redactor.text("Q".repeat(IDA_DIAGNOSTIC_SOURCE_BYTES + 1)),
    ).not.toContain("omitted");
  });
});

it("redacts explicitly marked registration values without guessing from environment names", () => {
  const environment = createIdaDiagnosticRedactor({
    command: "fixture",
    args: [],
    env: { PRIVATE_VALUE: "marked-secret", IDADIR: "/caller/ida" },
    sensitive: { env: ["PRIVATE_VALUE"], headers: [] },
    mode: "attached",
    timeoutMs: 1000,
  });
  expect(environment.text("marked-secret /caller/ida")).toBe(
    "[redacted transport credential] /caller/ida",
  );
  const headers = createIdaDiagnosticRedactor({
    url: "http://localhost:8745/mcp",
    headers: { "X-Custom": "marked-header", "X-Input": "retained" },
    sensitive: { headers: ["x-custom"], env: [] },
    mode: "attached",
    timeoutMs: 1000,
  });
  expect(headers.text("marked-header retained")).toBe(
    "[redacted transport credential] retained",
  );
});
