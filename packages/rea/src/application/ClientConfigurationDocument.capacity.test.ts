import { describe, expect, it } from "vitest";

import {
  parseClientConfiguration,
  serializeClientConfiguration,
  withClientServers,
} from "./ClientConfigurationDocument.js";

const registration = { command: "rea", args: ["mcp"] };

const serializedText = (
  ...input: Parameters<typeof serializeClientConfiguration>
): string => {
  const serialized = serializeClientConfiguration(...input);
  if (!serialized.ok) throw new Error("TOML serialization was refused");
  return serialized.value;
};

describe("TOML configuration source capacity", () => {
  it.each(["\n", "\r\n"])(
    "retains adjacent assignments and multiline values with %j breaks",
    (newline) => {
      const prefix = Array.from(
        { length: 128 },
        (_, index) =>
          `[foreign.entry_${index}]\nvalue = ${index}\nnote = """first\n# [mcp_servers.rea]\nlast"""\nitems = [\n${index},\n]\n`,
      ).join("");
      // Include a BOM, an empty value, and a final statement without a newline.
      const original =
        "\uFEFF" +
        `${prefix}[mcp_servers.rea]\ncommand = "previous"\n[tail]\nempty = ""\nlast = 7`.replaceAll(
          "\n",
          newline,
        );
      const parsed = parseClientConfiguration(original, "toml");
      const desired = withClientServers(parsed, {
        ...parsed.servers,
        rea: registration,
      });
      const configured = serializedText(desired, "toml", original);
      expect(
        configured.startsWith("\uFEFF" + prefix.replaceAll("\n", newline)),
      ).toBe(true);
      expect(parseClientConfiguration(configured, "toml").document).toEqual(
        desired,
      );
      const removed = serializedText(
        withClientServers(parsed, {}),
        "toml",
        configured,
      );
      const expectedForeignDocument = { ...parsed.document };
      delete expectedForeignDocument.mcp_servers;
      expect(parseClientConfiguration(removed, "toml").document).toEqual(
        expectedForeignDocument,
      );
    },
  );

  it("retains a large multiline foreign value inside an inline server table", () => {
    const note = `first\n${"x\n".repeat(500_000)}last`;
    const original = `mcp_servers = { other = {command="other",env={NOTE="""${note}"""}}}\n`;
    const parsed = parseClientConfiguration(original, "toml");
    const desired = withClientServers(parsed, {
      ...parsed.servers,
      rea: registration,
    });
    const configured = serializedText(desired, "toml", original);
    expect(configured).toContain(`NOTE="""${note}"""`);
    expect(parseClientConfiguration(configured, "toml").document).toEqual(
      desired,
    );
    const removed = serializedText(parsed.document, "toml", configured);
    expect(removed).toContain(`NOTE="""${note}"""`);
    expect(parseClientConfiguration(removed, "toml").document).toEqual(
      parsed.document,
    );
  });

  it("removes only REA from a large multiline Grok disabled-server list", () => {
    const otherNames = '"other",\n'.repeat(500_000);
    const original =
      `disabled_mcp_servers = [\n"rea",\n${otherNames}]\n` +
      '[mcp_servers.other]\ncommand = "other"\n';
    const parsed = parseClientConfiguration(original, "grok");
    const desired = withClientServers(parsed, {
      ...parsed.servers,
      rea: registration,
    });
    const configured = serializedText(desired, "grok", original);
    const result = parseClientConfiguration(configured, "grok");
    expect(result.document.disabled_mcp_servers).toEqual(
      Array<string>(500_000).fill("other"),
    );
    expect(result.servers).toEqual({
      other: { command: "other" },
      rea: registration,
    });
  });
});
