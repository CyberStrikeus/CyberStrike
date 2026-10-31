import { describe, expect, it } from "vitest";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import {
  clientServerPath,
  parseClientConfiguration,
  serializeClientConfiguration,
  withClientServers,
  type ClientConfigurationEditOptions,
  type ClientConfigurationFormat,
} from "./ClientConfigurationDocument.js";

const owned = { command: "rea", args: ["mcp"] };
const foreign = { command: "/usr/bin/false" };

const removeRea = (
  text: string,
  format: ClientConfigurationFormat,
  options?: ClientConfigurationEditOptions,
) => {
  const parsed = parseClientConfiguration(text, format);
  const { rea: _removed, ...remaining } = parsed.servers;
  return serializeClientConfiguration(
    withClientServers(parsed, remaining),
    format,
    text,
    [clientServerPath(parsed, "rea")],
    options,
  );
};

const parseStrictJson = (text: string): Record<string, unknown> =>
  JSON.parse(text.replace(/^\uFEFF/u, "")) as Record<string, unknown>;

describe("JSON client configuration repeated-member edits", () => {
  it("keeps the default refusal for repeated deletions", () => {
    const text =
      `{"mcpServers":{"rea":${JSON.stringify(foreign)},` +
      `"rea":${JSON.stringify(owned)}}}`;
    expect(removeRea(text, "claude_code")).toEqual({
      ok: false,
      error: {
        kind: "shadowed_member",
        path: ["mcpServers", "rea"],
      },
    });
  });

  it("removes all authorized repeats and preserves peer values in strict JSON", () => {
    const text =
      `{"mcpServers":{"rea":${JSON.stringify(foreign)},` +
      `"peer":{"command":"peer"},` +
      `"rea":${JSON.stringify(owned)},` +
      `"other":{"args":[1,2]},` +
      `"rea":${JSON.stringify(owned)}}}`;
    const parsed = parseClientConfiguration(text, "claude_code");
    const path = clientServerPath(parsed, "rea");
    const result = removeRea(text, "claude_code", {
      removeShadowedMembersAt: [path],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("authorized repeats were refused");
    expect(parseStrictJson(result.value)).toEqual({
      mcpServers: {
        peer: { command: "peer" },
        other: { args: [1, 2] },
      },
    });
    expect(result.value).not.toContain('"rea"');
  });

  it("does not apply repeat-removal authority to a different path", () => {
    const text = `{"mcpServers":{"rea":1,"rea":2,"peer":3,"peer":4}}`;
    const parsed = parseClientConfiguration(text, "json");
    const document = withClientServers(parsed, {});
    const result = serializeClientConfiguration(
      document,
      "json",
      text,
      [clientServerPath(parsed, "rea"), clientServerPath(parsed, "peer")],
      { removeShadowedMembersAt: [clientServerPath(parsed, "rea")] },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "shadowed_member",
        path: ["mcpServers", "peer"],
      },
    });
  });

  it.each([
    ["no registration", `{"mcpServers":{"peer":1}}`, { peer: 1 }, undefined],
    [
      "one registration",
      `{"mcpServers":{"rea":1,"peer":2}}`,
      { peer: 2 },
      undefined,
    ],
    [
      "multiple registrations",
      `{"mcpServers":{"rea":1,"peer":2,"rea":3,"other":4,"rea":5}}`,
      { peer: 2, other: 4 },
      { removeShadowedMembersAt: [["mcpServers", "rea"]] },
    ],
  ] as const)(
    "handles %s without losing peers",
    (_label, text, expectedServers, authority) => {
      const result = removeRea(text, "json", authority);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("non-shadowed removal was refused");
      expect(parseStrictJson(result.value)).toEqual({
        mcpServers: expectedServers,
      });
    },
  );

  it("matches escaped keys and retains a repeated inactive parent byte for byte", () => {
    const inactive = `{"rea":${JSON.stringify(foreign)}}`;
    const text =
      `{"mcpServers":${inactive},` +
      `"mcpServers":{"r\\u0065a":${JSON.stringify(foreign)},` +
      `"peer":2,"rea":${JSON.stringify(owned)}}}`;
    const result = removeRea(text, "claude_code", {
      removeShadowedMembersAt: [["mcpServers", "rea"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("authorized escaped repeat was refused");
    expect(result.value).toContain(`"mcpServers":${inactive}`);
    expect(parseStrictJson(result.value)).toEqual({
      mcpServers: { peer: 2 },
    });
  });

  it("preserves JSONC comments and parses BOM/CRLF output independently", () => {
    const text =
      `\uFEFF{\r\n  // top comment\r\n  "mcp": {\r\n` +
      `    "r\\u0065a": ${JSON.stringify(foreign)}, // first\r\n` +
      `    "peer": { "command": "peer" },\r\n` +
      `    /* second */ "rea": ${JSON.stringify(owned)},\r\n` +
      `  },\r\n}\r\n`;
    const result = removeRea(text, "opencode", {
      removeShadowedMembersAt: [["mcp", "rea"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("authorized JSONC repeats were refused");
    expect(result.value).toContain("// top comment");
    expect(result.value).toContain("// first");
    expect(result.value).toContain("/* second */");
    expect(result.value.startsWith("\uFEFF")).toBe(true);
    const errors: ParseError[] = [];
    const document = parseJsonc(result.value.replace(/^\uFEFF/u, " "), errors, {
      allowTrailingComma: true,
    });
    expect(errors).toEqual([]);
    expect(result.value.replaceAll("\r\n", "")).not.toContain("\n");
    expect(document).toEqual({
      mcp: { peer: { command: "peer" } },
    });
  });
});
