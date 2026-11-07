import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build, buildBinary } from "plist";
import { expect } from "vitest";

import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  cliTest,
  runFileCli,
  type TestCli,
} from "../../support/cli/cliFixture.js";

const unknownMixedInteger = {
  $plist_type: "unknown",
  element: "integer",
  literal: "9007199254740992<!-- split -->3",
  reason: "unsupported-markup",
};

const scenarios = [
  "XML",
  "binary",
  "integer collision",
  "integer-real collision",
  "real",
  "CDATA real",
  "hexadecimal",
  "mixed XML",
  "segmented keys",
] as const;

const inspectArchive = (cli: TestCli, app: string, fresh: boolean) => {
  const invocation = {
    arguments: ["decode-interface-builder", app, "--json"],
    environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
  };
  return fresh ? cli.run(invocation) : runFileCli(cli, invocation);
};

cliTest.for(scenarios)(
  "preserves numeric meaning and graph identity for %s Interface Builder attributes",
  async (scenario, { cli }) => {
    const root = await createTestTempDirectory("rea-ib-plist-numbers-");
    const app = join(root, "Numbers.app");
    const contents = join(app, "Contents");
    const resources = join(contents, "Resources");
    await mkdir(resources, { recursive: true });
    await mkdir(join(contents, "MacOS"));
    await writeFile(
      join(contents, "MacOS", "Fixture"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      scenario === "segmented keys"
        ? "<plist><dict><key>CFBundle<![CDATA[Executable]]></key><string>Fixture</string></dict></plist>"
        : build({ CFBundleExecutable: "Fixture" }),
    );
    const uid = (value: number) =>
      scenario === "binary" ? { UID: value } : { CF$UID: value };
    const source = {
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $top: { root: uid(1) },
      $objects: [
        "$null",
        {
          $class: uid(3),
          large: scenario === "binary" ? 9007199254740992 : "__INTEGER__",
          safe: 42,
          children: [uid(2)],
          ...(scenario.includes("collision") ? { other: "__OTHER__" } : {}),
        },
        { $class: uid(3), label: "Child" },
        { $classname: "UIView", $classes: ["UIView", "NSObject"] },
      ],
    };
    let bytes =
      scenario === "binary"
        ? Buffer.from(buildBinary(source))
        : Buffer.from(
            build(source)
              .replace(
                "<string>__INTEGER__</string>",
                scenario === "real"
                  ? "<real>9007199254740992</real>"
                  : scenario === "CDATA real"
                    ? "<real>9007199254<![CDATA[740992]]></real>"
                    : scenario === "hexadecimal"
                      ? "<integer>0x20000000000001</integer>"
                      : scenario === "mixed XML"
                        ? "<integer>9007199254740992<!-- split -->3</integer>"
                        : "<integer>9007199254740993</integer>",
              )
              .replace(
                "<string>__OTHER__</string>",
                scenario === "integer collision"
                  ? "<integer>9007199254740992</integer>"
                  : "<real>9007199254740992</real>",
              ),
          );
    if (scenario === "binary") {
      // The builder emits an unsafe JS number as a real. Replace that one
      // 8-byte scalar with an exact signed integer of the same byte width.
      const marker = Buffer.alloc(9);
      marker[0] = 0x23;
      marker.writeDoubleBE(9007199254740992, 1);
      const offset = bytes.indexOf(marker);
      expect(offset).toBeGreaterThan(0);
      expect(bytes.indexOf(marker, offset + marker.length)).toBe(-1);
      bytes[offset] = 0x13;
      bytes.writeBigInt64BE(9007199254740993n, offset + 1);
    }
    if (scenario === "segmented keys")
      bytes = Buffer.from(
        bytes
          .toString("utf8")
          .replaceAll("<key>$class</key>", "<key>$cl<![CDATA[ass]]></key>")
          .replaceAll("<key>children</key>", "<key>chil<![CDATA[dren]]></key>")
          .replaceAll("<key>safe</key>", "<key>sa<![CDATA[fe]]></key>"),
      );
    await writeFile(join(resources, "Main.nib"), bytes);
    const output = await inspectArchive(
      cli,
      app,
      scenario === "XML" || scenario === "binary",
    );
    expect(output.exitCode, output.stderr).toBe(0);
    const result = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(result.documents).toEqual([
      expect.objectContaining({
        archive_sha256: createHash("sha256").update(bytes).digest("hex"),
        object_count: 2,
      }),
    ]);
    expect(
      result.graph.nodes.find(
        ({ attributes }) => attributes.interface_builder_object_id === "1",
      ),
    ).toMatchObject({
      id: 'ib:"Contents/Resources/Main.nib":object:["1"]',
      attributes: {
        large:
          scenario === "XML" ||
          scenario === "binary" ||
          scenario === "hexadecimal" ||
          scenario === "segmented keys"
            ? { $plist_type: "integer", decimal: "9007199254740993" }
            : scenario === "mixed XML"
              ? unknownMixedInteger
              : 9007199254740992,
        safe: 42,
        children: [{ archiveUID: 2, className: "UIView" }],
        interface_builder_object_id: "1",
        class_name: "UIView",
      },
    });
    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        from: 'ib:"Contents/Resources/Main.nib":object:["1"]',
        to: 'ib:"Contents/Resources/Main.nib":object:["2"]',
        relation: "contains",
      }),
    );
    if (
      scenario === "XML" ||
      scenario === "binary" ||
      scenario === "hexadecimal" ||
      scenario === "segmented keys"
    )
      expect(result.limitations).toContainEqual(
        expect.stringContaining("1 unambiguous integer value"),
      );
    else if (scenario.includes("collision"))
      expect(result.limitations).toContainEqual(
        expect.stringContaining("integer precision loss remains possible"),
      );
    else if (scenario === "mixed XML")
      expect(result.limitations).toContainEqual(
        expect.stringContaining(
          "1 XML scalar value(s) could not be established",
        ),
      );
    else
      expect(
        result.limitations.some((note) => note.includes("integer precision")),
      ).toBe(false);
    expect(result.graph.truncated).toBe(false);
  },
);
