import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildBinary } from "plist";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  expectKeyedArchivePrototypeKeys,
  keyedArchivePrototypeKeyFixture,
} from "../../fixtures/keyedArchivePrototypeKeys.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";

cliTest(
  "compiled CLI decodes formatted XML prototype keys",
  async ({ cli }) => {
    const fixture = await keyedArchivePrototypeKeyFixture();
    const output = await cli.run({
      arguments: ["inspect-keyed-archive", fixture.path, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    expectKeyedArchivePrototypeKeys(
      parseEvidence(output.json).normalized_result,
      fixture.digest,
    );
  },
);

cliTest(
  "preserves segmented XML root and field identities through inspection and root selection",
  async ({ cli }) => {
    const directory = await createTestTempDirectory(
      "rea-keyed-character-data-",
    );
    const { call } = await connectLocalToolsMcp({
      HOME: directory,
      USERPROFILE: directory,
    });
    const mixed = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist><dict>
<key>$archiver</key><string>NSKeyedArchiver</string>
<key>$version</key><integer>100000</integer>
<key>$objects</key><array><string>$null</string><dict>
<key>user<![CDATA[ID]]></key><integer>42</integer>
</dict></array>
<key>$top</key><dict><key>ma<![CDATA[in]]></key><dict>
<key>CF$UID</key><integer>1</integer>
</dict></dict></dict></plist>`);
    const plain = Buffer.from(
      mixed
        .toString("utf8")
        .replace("user<![CDATA[ID]]>", "userID")
        .replace("ma<![CDATA[in]]>", "main"),
    );
    // Binary encoding is an independent control, not a decode of the XML fixture.
    const binary = Buffer.from(
      buildBinary({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: ["$null", { userID: 42 }],
        $top: { main: { UID: 1 } },
      }),
    );
    for (const [name, bytes] of [
      ["mixed", mixed],
      ["plain", plain],
      ["binary", binary],
    ] as const) {
      const path = join(directory, `${name}.plist`);
      await writeFile(path, bytes);
      for (const rootArguments of [[], ["--root", "main"]]) {
        const invocation = {
          arguments: [
            "inspect-keyed-archive",
            path,
            ...rootArguments,
            "--json",
          ],
          environment: {
            REA_LOG_LEVEL: "silent",
            HOME: directory,
            USERPROFILE: directory,
          },
        };
        const output = await (name !== "plain" && rootArguments.length === 0
          ? cli.run(invocation)
          : runFileCli(cli, invocation));
        expect(output.exitCode, output.stdout).toBe(0);
        const result = keyedArchiveResultSchema.parse(
          parseEvidence(output.json).normalized_result,
        );
        expect(result.archive_sha256).toBe(
          createHash("sha256").update(bytes).digest("hex"),
        );
        expect(Object.keys(result.roots)).toEqual(["main"]);
        expect(result.objects[1]).toMatchObject({
          id: 1,
          kind: "dictionary",
          status: "observed",
          value: { userID: 42 },
        });
        expect(result.references).toMatchObject([
          { source: null, path: ["main"], target: 1, status: "resolved" },
        ]);
        expect(result.truncated).toBe(false);
        const opened = await call("open_binary", { path });
        expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
        const mcp = await call(
          "inspect_keyed_archive",
          rootArguments.length === 0 ? {} : { root: "main" },
        );
        expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
        expect(
          keyedArchiveResultSchema.parse(
            parseEvidence(mcp.structuredContent).normalized_result,
          ),
        ).toEqual(result);
      }
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    }
  },
);
