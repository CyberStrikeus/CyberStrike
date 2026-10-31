import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect } from "vitest";

import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe.skipIf(process.platform !== "darwin")(
  "native plist CLI selection",
  () => {
    // Targets are app-relative: the bundle, its program file, or a plist file.
    cliTest.for([
      ["default", "", undefined, "default"],
      ["alternate", "", "Contents/Alternate.plist", "alternate"],
      ["missing", "", "Contents/Missing.plist", undefined],
      ["program default", "Contents/MacOS/App", undefined, "default"],
      [
        "program alternate",
        "Contents/MacOS/App",
        "Contents/Alternate.plist",
        "alternate",
      ],
      ["plist file", "Contents/Alternate.plist", undefined, "alternate"],
    ] as const)(
      "honors the $0 plist selection",
      async ([, target, selected, identifier], { cli }) => {
        const directory = await createTestTempDirectory("rea-plist-cli-");
        const app = join(directory, "Example.app");
        const contents = join(app, "Contents");
        await mkdir(join(contents, "MacOS"), { recursive: true });
        await writeFile(
          join(contents, "MacOS/App"),
          thinMach(0xfeedfacf, 0x0100000c),
        );
        for (const [name, value] of [
          ["Info", "default"],
          ["Alternate", "alternate"],
        ]) {
          await writeFile(
            join(contents, `${name}.plist`),
            `<plist><dict><key>CFBundleExecutable</key><string>App</string><key>CFBundleIdentifier</key><string>${value}</string></dict></plist>`,
          );
        }
        const result = await cli.run({
          arguments: [
            "inspect-plist",
            join(app, target),
            ...(selected === undefined ? [] : ["--relative-path", selected]),
            "--json",
          ],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: "auto",
          },
        });
        if (identifier === undefined) {
          expect(result.exitCode).toBe(1);
          expect(result.json).toMatchObject({ error: "Analysis failed" });
        } else {
          expect(result.exitCode).toBe(0);
          expect(result.json).toMatchObject({
            normalized_result: {
              source_path: join(
                app,
                selected ??
                  (target.endsWith(".plist") ? target : "Contents/Info.plist"),
              ),
              value: { CFBundleIdentifier: identifier },
            },
          });
        }
      },
    );
  },
);

describe.skipIf(process.platform !== "darwin")(
  "native plist CLI source formats",
  () => {
    cliTest(
      "retains non-finite values from original XML bytes",
      async ({ cli }) => {
        const directory = await createTestTempDirectory("rea-plist-reals-");
        const path = join(directory, "selected.plist");
        const source = Buffer.from(`<plist version="1.0"><dict>
<key>positive</key><real>+infinity</real>
<key>negative</key><real>-INFINITY</real>
<key>nan</key><real>nan</real><key>control</key><real>1.25</real>
</dict></plist>`);
        await writeFile(path, source);
        const result = await cli.run({
          arguments: ["inspect-plist", path, "--json"],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: "auto",
          },
        });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.json).toMatchObject({
          normalized_result: {
            value: {
              positive: { $plist_type: "real", value: "+infinity" },
              negative: { $plist_type: "real", value: "-infinity" },
              nan: { $plist_type: "real", value: "nan" },
              control: 1.25,
            },
            limitations: expect.arrayContaining([
              expect.stringContaining("3 non-finite real value(s)"),
            ]),
          },
        });
        expect(Buffer.compare(await readFile(path), source)).toBe(0);
      },
    );

    cliTest.for([
      ["openstep", "unknown"],
      ["openstep-data", "unknown"],
      ["openstep-data-root", "unknown"],
      ["openstep-empty-data", "unknown"],
      ["xml", "xml"],
      ["xml16", "xml"],
      ["binary", "binary"],
    ] as const)(
      "reports the original $0 plist format through the compiled CLI",
      async ([encoding, format], { cli }) => {
        const directory = await createTestTempDirectory("rea-plist-format-");
        const target = join(directory, "target");
        const plist = join(directory, "selected.plist");
        const withData = encoding === "openstep-data";
        const dataRoot = encoding === "openstep-data-root";
        const emptyData = encoding === "openstep-empty-data";
        await writeFile(target, thinMach(0xfeedfacf, 0x0100000c));
        await writeFile(
          plist,
          dataRoot
            ? "<deadbeef>\n"
            : emptyData
              ? "<>\n"
              : `{ Name = Example; Items = (a, b); ${withData ? "Blob = <deadbeef>;" : ""} }\n`,
        );
        if (encoding === "binary" || encoding.startsWith("xml")) {
          await promisify(execFile)("/usr/bin/plutil", [
            "-convert",
            encoding === "binary" ? "binary1" : "xml1",
            "--",
            plist,
          ]);
          if (encoding === "xml16") {
            const { stdout } = await promisify(execFile)("/usr/bin/plutil", [
              "-convert",
              "xml1",
              "-o",
              "-",
              "--",
              plist,
            ]);
            await writeFile(
              plist,
              Buffer.concat([
                Buffer.from([0xfe, 0xff]),
                Buffer.from(
                  stdout.replace("UTF-8", "UTF-16"),
                  "utf16le",
                ).swap16(),
              ]),
            );
          }
        }
        const result = await cli.run({
          arguments: [
            "inspect-plist",
            target,
            "--relative-path",
            plist,
            "--json",
          ],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: "auto",
          },
        });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.json).toMatchObject({
          normalized_result: {
            format,
            source_path: plist,
            value:
              dataRoot || emptyData
                ? { $plist_type: "data", base64: emptyData ? "" : "3q2+7w==" }
                : {
                    Name: "Example",
                    Items: ["a", "b"],
                    ...(withData
                      ? { Blob: { $plist_type: "data", base64: "3q2+7w==" } }
                      : {}),
                  },
          },
        });
      },
    );
  },
);

describe.skipIf(process.platform !== "darwin")(
  "native plist CLI typed values",
  () => {
    cliTest.for(["xml", "binary"] as const)(
      "decodes $0 plists that plutil cannot express as JSON",
      async (format, { cli }) => {
        const directory = await createTestTempDirectory("rea-plist-types-");
        const app = join(directory, "Example.app");
        const contents = join(app, "Contents");
        await mkdir(join(contents, "MacOS"), { recursive: true });
        await writeFile(
          join(contents, "MacOS/App"),
          thinMach(0xfeedfacf, 0x0100000c),
        );
        const plist = join(contents, "Info.plist");
        await writeFile(
          plist,
          [
            "<plist><dict>",
            "<key>CFBundleExecutable</key><string>App</string>",
            "<key>CFBundleIdentifier</key><string>com.example.types</string>",
            "<key>Blob</key><data>AAEC</data>",
            "<key>Separators</key><string>a\u0085b\u2028c\u2029d</string>",
            "<key>Built</key><date>2020-01-01T00:00:00Z</date>",
            // Parse the unsigned extended year as a UTC field, without JS string-date inference.
            "<key>Far</key><date>11507-08-17T05:20:00Z</date>",
            "<key>Ratio</key><real>nan</real>",
            "<key>Nested</key><array><dict>",
            "<key>Ratio</key><real>0.5</real>",
            "<key>Unbounded</key><real>-infinity</real>",
            "<key></key><string>empty key</string>",
            "</dict></array>",
            "</dict></plist>",
          ].join(""),
        );
        if (format === "binary")
          await promisify(execFile)("/usr/bin/plutil", [
            "-convert",
            "binary1",
            "--",
            plist,
          ]);
        const result = await cli.run({
          arguments: ["inspect-plist", app, "--json"],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: "auto",
          },
        });
        expect(result.exitCode).toBe(0);
        expect(result.json).toMatchObject({
          normalized_result: {
            format,
            value: {
              CFBundleIdentifier: "com.example.types",
              Blob: { $plist_type: "data", base64: "AAEC" },
              Separators: "a\u0085b\u2028c\u2029d",
              Built: {
                $plist_type: "date",
                iso8601: "2020-01-01T00:00:00.000Z",
              },
              Far: {
                $plist_type: "date",
                iso8601: "+011507-08-17T05:20:00.000Z",
              },
              Ratio: { $plist_type: "real", value: "nan" },
              Nested: [
                {
                  Ratio: 0.5,
                  Unbounded: { $plist_type: "real", value: "-infinity" },
                  "": "empty key",
                },
              ],
            },
            bundle: { identifier: "com.example.types", executable: "App" },
            // An XML source also records its successful native format validation.
            provenance:
              format === "xml"
                ? [
                    { tool: "file" },
                    {
                      tool: "plutil",
                      command: ["/usr/bin/plutil", "-lint", "--", "$PLIST"],
                      exit: { code: 0, signal: null },
                    },
                  ]
                : [{ tool: "file" }],
            limitations: [expect.stringContaining("2 non-finite real")],
          },
        });
      },
    );
  },
);

describe.skipIf(process.platform !== "darwin")(
  "native plist CLI integers",
  () => {
    cliTest.for([false, true])(
      "reports exact plist integers and integral reals beyond the JSON number range (data: %s)",
      async (withData, { cli }) => {
        const directory = await createTestTempDirectory("rea-plist-integers-");
        const app = join(directory, "Example.app");
        const contents = join(app, "Contents");
        await mkdir(join(contents, "MacOS"), { recursive: true });
        await writeFile(
          join(contents, "MacOS/App"),
          thinMach(0xfeedfacf, 0x0100000c),
        );
        await writeFile(
          join(contents, "Info.plist"),
          [
            "<plist><dict>",
            "<key>CFBundleExecutable</key><string>App</string>",
            "<key>Max</key><integer>18446744073709551615</integer>",
            "<key>Min</key><integer>-9223372036854775808</integer>",
            "<key>Count</key><integer>42</integer>",
            "<key>Real</key><real>9007199254740992</real>",
            "<key>Large</key><real>1e20</real>",
            ...(withData ? ["<key>Blob</key><data>AAEC</data>"] : []),
            "</dict></plist>",
          ].join(""),
        );
        const result = await cli.run({
          arguments: ["inspect-plist", app, "--json"],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: "auto",
          },
        });
        expect(result.exitCode).toBe(0);
        expect(result.json).toMatchObject({
          normalized_result: {
            value: {
              Max: { $plist_type: "integer", decimal: "18446744073709551615" },
              Min: { $plist_type: "integer", decimal: "-9223372036854775808" },
              Count: 42,
              Real: 9007199254740992,
              Large: 1e20,
            },
            limitations: [expect.stringContaining("2 integer value(s)")],
          },
        });
      },
    );
  },
);
