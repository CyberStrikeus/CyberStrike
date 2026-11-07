import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves malformed XML scalars as explicit unknowns through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-xml-scalars-");
    const invalid = [
      ["integer", " 42 "],
      ["integer", "42abc"],
      ["integer", "\u202f42"],
      ["integer", "4.2"],
      ["integer", "1e3"],
      ["integer", "&#52;2"],
      ["integer", "4<!-- </integer> -->2"],
      ["integer", "<![CDATA[42]]>"],
      ["real", " 1.5 "],
      ["real", "1.5abc"],
      ["real", "1,5"],
      ["real", "\u202f1.5"],
      ["real", "\u205f1.5"],
      ["real", "0x1p3"],
      ["real", '1<real note=">">2</real>.5'],
      ["date", "2026-10-17T12:00:00+02:00"],
      ["date", "2026-10-17T12:00:00.5Z"],
      ["date", "2026-10-17T12:00:00"],
      ["true", "x"],
      ["false", " "],
    ] as const;
    const controls =
      "<integer>+ 42</integer><real>1<![CDATA[.5]]></real><date>2026-10-17T12:00:00Z</date><true/><false></false><integer>9007199254740993</integer>";
    const bytes = Buffer.from(
      `<?xml version="1.0"?><plist><dict><key>$archiver</key><string>NSKeyedArchiver</string><key>$version</key><integer>100000</integer><key>$objects</key><array><string>$null</string>${invalid.map(([tag, literal]) => `<${tag}>${literal}</${tag}>`).join("")}${controls}</array><key>$top</key><dict><key>root</key><dict><key>CF$UID</key><integer>1</integer></dict></dict></dict></plist>`,
    );
    const path = join(root, "archive.plist");
    await writeFile(path, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const run = async (TZ: string) => {
      const output = await cli.run({
        arguments: ["inspect-keyed-archive", path, "--json"],
        environment: {
          HOME: root,
          USERPROFILE: root,
          TZ,
          REA_LOG_LEVEL: "silent",
        },
      });
      expect(output.exitCode, output.stderr).toBe(0);
      return keyedArchiveResultSchema.parse(
        parseEvidence(output.json).normalized_result,
      );
    };
    const result = await run("UTC");
    expect(await run("Etc/GMT-2")).toEqual(result);
    expect(result.archive_sha256).toBe(digest);
    expect(
      result.objects
        .slice(1, invalid.length + 1)
        .map(({ kind, value }) => ({ kind, value })),
    ).toEqual(
      invalid.map(([element, literal]) => ({
        kind: "scalar",
        value: {
          $plist_type: "unknown",
          element,
          literal,
          reason: literal.includes("<")
            ? "unsupported-markup"
            : "invalid-literal",
        },
      })),
    );
    expect(
      result.objects.slice(invalid.length + 1).map(({ value }) => value),
    ).toEqual([
      42,
      1.5,
      { $plist_type: "date", iso8601: "2026-10-17T12:00:00.000Z" },
      true,
      false,
      { $plist_type: "integer", decimal: "9007199254740993" },
    ]);
    expect(result.limitations).toContainEqual(
      expect.stringContaining(`${String(invalid.length)} XML scalar value(s)`),
    );
    expect(result.references).toHaveLength(1);
    const { call } = await connectLocalToolsMcp({
      HOME: root,
      USERPROFILE: root,
    });
    expect((await call("open_binary", { path })).isError).not.toBe(true);
    const reply = await call("inspect_keyed_archive", {});
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    expect(
      keyedArchiveResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      ),
    ).toEqual(result);
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);
