import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect } from "vitest";

import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

cliTest.for([
  { name: "plain real", element: "<real>1.25</real>", expected: 1.25 },
  {
    name: "mixed real",
    element: "<real>1<![CDATA[.25]]></real>",
    expected: 1.25,
  },
  {
    name: "CDATA real",
    element: "<real><![CDATA[1.25]]></real>",
    expected: 1.25,
  },
  { name: "hexadecimal", element: "<integer>0x2A</integer>", expected: 42 },
  {
    name: "integer between processing instructions",
    element: "<?integer 9007199254740993?><integer>42</integer><?rea ignored?>",
    expected: 42,
  },
  {
    name: "unsafe hexadecimal",
    element: "<integer>0x20000000000001</integer>",
    expected: { $plist_type: "integer", decimal: "9007199254740993" },
  },
  {
    name: "integer beyond finite Number range",
    element: `<integer>1${"0".repeat(400)}</integer>`,
    expected: { $plist_type: "integer", decimal: `1${"0".repeat(400)}` },
  },
  {
    name: "incomplete data quartet",
    element: "<data>AQI</data>",
    expected: { $plist_type: "data", base64: "" },
  },
  {
    name: "data with a non-alphabet character",
    element: "<data>AQ!ID</data>",
    expected: { $plist_type: "data", base64: "AQID" },
  },
  {
    name: "data with a numeric entity spelling",
    element: "<data>&#65;QID</data>",
    expected: { $plist_type: "data", base64: "65QI" },
  },
  {
    name: "data with a predefined entity spelling",
    element: "<data>&amp;AQID</data>",
    expected: { $plist_type: "data", base64: "ampA" },
  },
])(
  "preserves $name XML scalars through CLI and MCP",
  async (scenario, { cli }) => {
    const root = await createTestTempDirectory("rea-keyed-xml-numbers-");
    const bytes = Buffer.from(
      build({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: ["$null", "__VALUE__"],
        $top: { root: { CF$UID: 1 } },
      }).replace("<string>__VALUE__</string>", scenario.element),
    );
    const path = join(root, "archive.plist");
    await writeFile(path, bytes);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Missing file-scoped MCP session");
    const output = await runFileCli(cli, {
      arguments: [
        "inspect-keyed-archive",
        path,
        "--root",
        "root",
        "--offset",
        "1",
        "--limit",
        "1",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = keyedArchiveResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect((await call("open_binary", { path })).isError).not.toBe(true);
    const mcp = await call("inspect_keyed_archive", {
      root: "root",
      offset: 1,
      limit: 1,
    });
    expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
    expect(
      keyedArchiveResultSchema.parse(
        parseEvidence(mcp.structuredContent).normalized_result,
      ),
    ).toEqual(result);
    expect(result.archive_sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(result.objects).toEqual([
      {
        id: 1,
        kind: "scalar",
        class_id: null,
        class_name: null,
        status: "observed",
        value: scenario.expected,
      },
    ]);
    expect(result.references).toEqual([
      expect.objectContaining({
        source: null,
        path: ["root"],
        target: 1,
        status: "resolved",
      }),
    ]);
    expect(
      result.limitations.some((note) =>
        /non-finite|completely observed/u.test(note),
      ),
    ).toBe(false);
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);

cliTest(
  "refuses invalid data without publishing observed bytes through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-data-refusal-");
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Missing file-scoped MCP session");
    for (const [name, element, reason] of [
      ["non-ascii", "<data>AQ\u0085ID</data>", "non-ascii"],
      ["markup", "<data>A<!-- ignored -->QID</data>", "markup"],
      ["self-closing", '<data note=">"/>', "empty-element"],
    ] as const) {
      const path = join(root, `${name}.plist`);
      const bytes = Buffer.from(
        build({
          $archiver: "NSKeyedArchiver",
          $version: 100000,
          $objects: ["$null", "__VALUE__"],
          $top: { root: { CF$UID: 1 } },
        }).replace("<string>__VALUE__</string>", element),
      );
      await writeFile(path, bytes);
      const output = await runFileCli(cli, {
        arguments: ["inspect-keyed-archive", path, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(output.exitCode).toBe(1);
      expect(output.json).toMatchObject({
        code: "artifact_operation_failed",
        details: { reason: "format", detail: expect.stringContaining(reason) },
      });
      expect((await call("open_binary", { path })).isError).not.toBe(true);
      const reply = await call("inspect_keyed_archive", {});
      expect(reply.isError).toBe(true);
      const block = reply.content.find((item) => item.type === "text");
      if (block?.type !== "text") throw new Error("Missing MCP error text");
      expect(JSON.parse(block.text)).toMatchObject({
        error: {
          code: "artifact_operation_failed",
          details: {
            reason: "format",
            detail: expect.stringContaining(reason),
          },
        },
      });
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    }
  },
);
