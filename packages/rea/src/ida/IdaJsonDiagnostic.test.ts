import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  IdaDiagnosticResourceError,
  writeIdaDiagnostic,
} from "./IdaDiagnosticWriter.js";
import { createIdaDiagnosticRedactor } from "./IdaDiagnosticRedactor.js";
import { redactIdaJsonDiagnostic } from "./IdaJsonDiagnostic.js";

const runtime = vi.hoisted(() => ({ limit: undefined as number | undefined }));
vi.mock("node:buffer", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:buffer")>();
  return {
    ...original,
    constants: {
      ...original.constants,
      get MAX_STRING_LENGTH() {
        return runtime.limit ?? original.constants.MAX_STRING_LENGTH;
      },
    },
  };
});
afterEach(() => {
  runtime.limit = undefined;
});

const marker = "[redacted transport credential]";
const forCredential = (credential: string) =>
  createIdaDiagnosticRedactor({
    url: "http://127.0.0.1:12345/mcp",
    headers: { Authorization: `Custom ${credential}` },
    mode: "attached",
    timeoutMs: 1000,
  });

describe("IDA JSON diagnostic source preservation", () => {
  it("matches equivalent JSON encodings without enumerating credential spellings", () => {
    const redactor = forCredential("<s/>");
    const encodings = [
      ["<", String.raw`\u003c`, String.raw`\u003C`],
      ["s", String.raw`\u0073`],
      ["/", String.raw`\/`, String.raw`\u002f`, String.raw`\u002F`],
      [">", String.raw`\u003e`, String.raw`\u003E`],
    ].reduce<string[]>(
      (prefixes, units) =>
        prefixes.flatMap((prefix) => units.map((unit) => prefix + unit)),
      [""],
    );
    for (const encoded of encodings)
      expect(redactor.json(`{"reason":"${encoded}"}`)).toBe(
        `{"reason":"${marker}"}`,
      );
  });

  it("preserves unrelated spelling inside a matching string", () => {
    const source = String.raw`{"reason":"\u003cpublic\u003e\/asset \u003csecret\u003e \ud83d\uDE00"}`;
    expect(forCredential("<secret>").json(source)).toBe(
      String.raw`{"reason":"\u003cpublic\u003e\/asset ` +
        marker +
        String.raw` \ud83d\uDE00"}`,
    );
  });

  it("retains duplicate fields, whitespace and exact numeric lexemes", () => {
    const source =
      '{\n  "\\u003csecret\\u003e": 9007199254740993, "n": -0, "n": 1.00e+03, "value": "<secret>"\n}';
    expect(forCredential("<secret>").json(source)).toBe(
      `{\n  "${marker}": 9007199254740993, "n": -0, "n": 1.00e+03, "value": "${marker}"\n}`,
    );
  });

  it.each([
    { credential: "a😀b", encoded: String.raw`a\ud83d\uDE00b` },
    { credential: "a\ud800b", encoded: String.raw`a\uD800b` },
    { credential: "a\nb", encoded: String.raw`a\nb` },
    { credential: 'a"b', encoded: String.raw`a\u0022b` },
  ])("maps UTF-16 source spans for $encoded", ({ credential, encoded }) => {
    expect(forCredential(credential).json(`"before ${encoded} after"`)).toBe(
      `"before ${marker} after"`,
    );
  });

  it.each([
    {
      source: String.raw`{broken: "\u003csecret\u003e",`,
      expected: `{broken: "${marker}",`,
    },
    {
      source: String.raw`{"x":"\u003csecret\u003e`,
      expected: `{"x":"${marker}`,
    },
    {
      source: String.raw`{"x":"\u003csecret\u003e\q"}`,
      expected: `{"x":"${marker}\\q"}`,
    },
  ])(
    "preserves malformed source around known complete characters: $source",
    ({ source, expected }) => {
      expect(forCredential("<secret>").json(source)).toBe(expected);
    },
  );

  it("does not join decoded fragments across invalid escapes", () => {
    const source = String.raw`{"x":"<sec\qret>"}`;
    expect(forCredential("<secret>").json(source)).toBe(source);
  });

  it("retains literal matches crossing invalid JSON units", () => {
    expect(
      forCredential(String.raw`foo\qbar`).json(String.raw`{"x":"foo\qbar"}`),
    ).toBe(`{"x":"${marker}"}`);
  });

  it.each(
    ["b", "f", "n", "r", "t", "/", '"', "\\", "u0061"].map(
      (escape) => "folder\\" + escape + "tmp",
    ),
  )(
    "retains literal credentials in ambiguous malformed fragments: %s",
    (credential) => {
      const redactor = forCredential(credential);
      for (const [before, after] of [
        ["Rejected ", ""],
        ['Rejected "', '"'],
        ['{"reason":"Rejected ', ""],
        ['{"reason":"Rejected ', String.raw`\q"}`],
      ])
        expect(redactor.json(before + credential + after)).toBe(
          before + marker + after,
        );
      expect(redactor.json('"' + credential + '"')).toBe(
        '"' + credential + '"',
      );
      expect(redactor.json(JSON.stringify("Rejected " + credential))).toBe(
        JSON.stringify("Rejected " + marker),
      );
    },
  );

  it("uses decoded values instead of matching unrelated escape syntax", () => {
    const source = String.raw`{"x":"\u003cpublic\u003e","y":"u003c"}`;
    expect(forCredential("u003c").json(source)).toBe(
      String.raw`{"x":"\u003cpublic\u003e","y":"` + marker + '"}',
    );
  });

  it("retains literal opaque matches spanning quoted fragments in plain bodies", () => {
    const credential = 'prefix"quoted"suffix';
    expect(
      forCredential(credential).json(
        `Auth Custom ${credential}; payload ${credential}; path /caller/input`,
      ),
    ).toBe(`Auth ${marker}; payload ${marker}; path /caller/input`);
  });

  it("replaces adjacent matches once without rescanning the marker", () => {
    expect(
      forCredential("redacted").json(String.raw`"redacted\u0072edacted"`),
    ).toBe('"␟␟"');
  });

  it("handles unquoted JSON fragments while retaining ordinary text semantics", () => {
    const source = String.raw`\u003csecret\u003e`;
    const redactor = forCredential("<secret>");
    expect(redactor.text(source)).toBe(source);
    expect(redactor.json(source)).toBe(marker);
    const invalid = String.raw`<sec\qret>`;
    expect(redactor.json(invalid)).toBe(invalid);
    const unrelated = String.raw`"\u003cpublic\u003e"`;
    expect(forCredential("u003c").json(unrelated)).toBe(unrelated);
    expect(forCredential("u003c").json(unrelated.slice(1, -1))).toBe(
      "\\" + marker + String.raw`public\u003e`,
    );
  });
  it("leaves ordinary text diagnostics and credential-free configurations unchanged", () => {
    const source = String.raw`{"x":"\u003csecret\u003e"}`;
    expect(forCredential("<secret>").text(source)).toBe(source);
    const redactor = createIdaDiagnosticRedactor({
      headers: {},
      url: "http://127.0.0.1:12345/mcp",
      mode: "attached",
      timeoutMs: 1000,
    });
    expect(redactor.json(source)).toBe(source);
  });
});

describe("IDA diagnostic output resource bounds", () => {
  it.each(["text", "json"] as const)(
    "bounds %s expansion using the runtime string limit",
    (format) => {
      runtime.limit = 64;
      const redactor = forCredential("Q");
      const prefix = format === "json" ? '"' : "";
      const suffix = prefix;
      expect(redactor[format](prefix + "QQ" + suffix)).toBe(
        prefix + marker + marker + suffix,
      );
      let failure: unknown;
      try {
        redactor[format](prefix + "QQQ" + suffix);
      } catch (cause: unknown) {
        failure = cause;
      }
      expect(failure).toBeInstanceOf(IdaDiagnosticResourceError);
      if (!(failure instanceof IdaDiagnosticResourceError))
        throw new Error("Expected an owned diagnostic resource failure");
      expect(failure.reportedLimits).toMatchObject({
        boundary: "ida-diagnostic-redaction",
        max_string_code_units: 64,
      });
      expect(projectAnalysisError(failure)).toMatchObject({
        code: "resource_constraint",
        details: { resource: "memory" },
      });
    },
  );

  it("bounds temporary JSON character decoding before wrapping an oversized run", () => {
    runtime.limit = 64;
    const redactor = forCredential("Z");
    expect(redactor.json("Q".repeat(62))).toBe("Q".repeat(62));
    let failure: unknown;
    try {
      redactor.json("Q".repeat(63));
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(IdaDiagnosticResourceError);
    if (!(failure instanceof IdaDiagnosticResourceError))
      throw new Error("Expected a temporary decoding resource failure");
    expect(failure.message).toContain("Temporary");
    expect(failure.reportedLimits).toEqual({
      boundary: "ida-diagnostic-redaction",
      representation: "json-character-run",
      input_code_units: 63,
      json_decoding_code_units_at_least: 65,
      max_string_code_units: 64,
    });
  });

  it("closes the first match stream if priming the second stream fails", () => {
    runtime.limit = 64;
    const source = "Q".repeat(63);
    let closed = false;
    function* matches() {
      try {
        yield { start: 0, end: 1 };
      } finally {
        closed = true;
      }
    }
    expect(() => redactIdaJsonDiagnostic(source, matches)).toThrow(
      IdaDiagnosticResourceError,
    );
    expect(closed).toBe(true);
  });

  it("stops consuming a lazy match stream before oversized output is allocated", () => {
    runtime.limit = 32;
    let consumed = 0;
    function* matches() {
      for (let index = 0; index < 10000; index++) {
        consumed++;
        yield { start: index, end: index + 1 };
      }
    }
    expect(() => writeIdaDiagnostic("Q".repeat(10000), matches())).toThrow(
      IdaDiagnosticResourceError,
    );
    expect(consumed).toBeLessThan(10);
  });
});

describe("overlapping raw and decoded JSON credential spans", () => {
  const overlappingMarker = "␟";
  const overlappingRedactor = () =>
    createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      headers: { Authorization: "Custom X]", Cookie: "a=]SECRET" },
      mode: "attached",
      timeoutMs: 1000,
    });
  it.each([
    String.raw`{"reason":"X]SECRET","n":1.00e+03}`,
    String.raw`{"reason":"X\u005dSECRET","n":1.00e+03}`,
  ])("unions decoded overlaps before monotone source mapping: %s", (source) => {
    expect(overlappingRedactor().json(source)).toBe(
      '{"reason":"' + overlappingMarker + '","n":1.00e+03}',
    );
  });
  it.each(["X]SECRET", String.raw`X\u005dSECRET`])(
    "unions raw/recovered overlaps in a malformed document: %s",
    (source) => {
      expect(
        overlappingRedactor().json("Rejected " + source + " at /caller/input"),
      ).toBe("Rejected " + overlappingMarker + " at /caller/input");
    },
  );
  it("maps a merged overlap containing an escaped surrogate pair", () => {
    const encoded = Buffer.from("fixture-user:😀X]", "utf8").toString("base64");
    const redactor = createIdaDiagnosticRedactor({
      url: "http://127.0.0.1:12345/mcp",
      headers: { Authorization: "Basic " + encoded, Cookie: "a=]SECRET" },
      mode: "attached",
      timeoutMs: 1000,
    });
    expect(
      redactor.json(
        String.raw`{"reason":"\ud83d\ude00X\u005dSECRET","context":"kept"}`,
      ),
    ).toBe('{"reason":"' + overlappingMarker + '","context":"kept"}');
  });
  it("unions dense escaped decoded overlaps lazily", () => {
    const source = '"' + String.raw`\u0041`.repeat(4096) + '"';
    const result = forCredential("AA").json(source);
    expect(result.length).toBe(marker.length + 2);
    expect(result).toBe('"' + marker + '"');
  });
});

it("bounds the final multi-block diagnostic representation", () => {
  runtime.limit = 64;
  const redactor = forCredential("Q");
  expect(() => redactor.blocks(["QQ", "QQ"])).toThrow(
    IdaDiagnosticResourceError,
  );
});

it("bounds context plus the already-owned diagnostic body before joining", () => {
  runtime.limit = 64;
  const redactor = forCredential("Q");
  const body = redactor.text("QQ");
  expect(() => redactor.message("ctx", body)).toThrow(
    IdaDiagnosticResourceError,
  );
});
