import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished } from "vitest";
import { buildBinary } from "plist";

import { inspectPlistSchema } from "../../../../src/domain/native/nativeInspection.js";
import { err, ok, type Result } from "../../../../src/domain/result.js";
import { AnalysisOutputError } from "../../../../src/domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../../../src/domain/providerAdapterError.js";
import {
  NativeCommandFailure,
  type NativeCommandOptions,
  type NativeCommandRunner,
} from "../../../../src/native/CommandRunner.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const VALUE = { Name: "Example", Items: ["a", "b"] };
const XML =
  "<plist><dict><key>Name</key><string>Example</string><key>Items</key><array><string>a</string><string>b</string></array><key>Blob</key><data>3q2+7w==</data></dict></plist>";
const DATA = { $plist_type: "data", base64: "3q2+7w==" };

class PlistSourceRunner extends NativeFixtureRunner {
  constructor(
    private readonly path: string,
    description: string,
    private readonly xmlFallback: boolean,
    private readonly convertedXml: string = XML,
  ) {
    super({ file: description, plutil: JSON.stringify(VALUE) });
  }

  override async run(tool: string, arguments_: readonly string[]) {
    const result = await super.run(tool, arguments_);
    if (!result.ok || tool !== "plutil") return result;
    if (arguments_[0] === "-lint") {
      expect(arguments_).toEqual(["-lint", "--", this.path]);
      return ok({ ...result.value, stdout: "", stdoutBytes: 0 });
    }
    const format = arguments_[1];
    expect(["json", "xml1"]).toContain(format);
    expect(arguments_).toEqual([
      "-convert",
      format,
      "-o",
      "-",
      "--",
      this.path,
    ]);
    if (!this.xmlFallback) return result;
    const json = format === "json";
    const stdout = json ? "" : this.convertedXml;
    return ok({
      ...result.value,
      stdout,
      stdoutBytes: Buffer.byteLength(stdout),
      exitCode: json ? 1 : 0,
    });
  }
}

const OPENSTEP = "{ Name = Example; Items = (a, b); }\n";

interface PlistSourceCase {
  readonly description: string;
  readonly contents?: string | Buffer;
  readonly expected: string;
  readonly xmlFallback: boolean;
  readonly convertedXml?: string;
  readonly expectedValue?: unknown;
  readonly expectedTools?: readonly string[];
  readonly expectedLimitations?: readonly unknown[];
}

it.for<PlistSourceCase>([
  { description: "ASCII text\n", expected: "unknown", xmlFallback: false },
  {
    description: "JSON text data\n",
    contents: JSON.stringify(VALUE),
    expected: "json",
    xmlFallback: false,
    expectedTools: ["file"],
  },
  ...["<deadbeef>\n", "<de ad\nbe ef>\n", "<>\n"].map((contents) => ({
    description: "ASCII text\n",
    contents,
    expected: "unknown",
    xmlFallback: true,
    convertedXml: `<plist><data>${contents.startsWith("<>") ? "" : DATA.base64}</data></plist>`,
    expectedValue: {
      ...DATA,
      base64: contents.startsWith("<>") ? "" : DATA.base64,
    },
  })),
  // `file` reports XML without a declaration as plain text.
  {
    description: "ASCII text, with no line terminators\n",
    contents: `﻿ \n${XML}`,
    expected: "xml",
    xmlFallback: true,
    expectedTools: ["file", "plutil"],
    expectedLimitations: [],
  },
  {
    description: "ASCII text\n",
    contents: `<!-- source plist -->\n${XML}`,
    expected: "xml",
    xmlFallback: true,
    expectedTools: ["file", "plutil"],
    expectedLimitations: [],
  },
  ...[false, true].map((bigEndian) => ({
    description: `Unicode text, UTF-16, ${bigEndian ? "big" : "little"}-endian text\n`,
    contents: bigEndian
      ? Buffer.from(`\uFEFF${XML}`, "utf16le").swap16()
      : Buffer.from(`\uFEFF${XML}`, "utf16le"),
    expected: "xml",
    xmlFallback: true,
    expectedTools: ["file", "plutil"],
    expectedLimitations: [],
  })),
  { description: "ASCII text\n", expected: "unknown", xmlFallback: true },
  {
    description: "Unicode text, UTF-8 text\n",
    expected: "unknown",
    xmlFallback: false,
  },
  {
    description: "XML 1.0 document text, ASCII text\n",
    contents: XML,
    expected: "xml",
    xmlFallback: false,
    expectedValue: { ...VALUE, Blob: DATA },
    expectedTools: ["file", "plutil"],
  },
  {
    description:
      "XML 1.0 document text, Unicode text, UTF-16, big-endian text\n",
    contents: Buffer.from("\uFEFF" + XML, "utf16le").swap16(),
    expected: "xml",
    xmlFallback: true,
    expectedTools: ["file", "plutil"],
    expectedLimitations: [],
  },
  {
    description: "Apple binary property list\n",
    contents: Buffer.from(
      buildBinary({
        nel: "a\u0085b",
        ls: "a\u2028b",
        ps: "a\u2029b",
        lf: "a\nb",
        payload: Buffer.from([0]),
      }),
    ),
    expected: "binary",
    xmlFallback: false,
    expectedTools: ["file"],
    expectedValue: {
      nel: "a\u0085b",
      ls: "a\u2028b",
      ps: "a\u2029b",
      lf: "a\nb",
      payload: { $plist_type: "data", base64: "AA==" },
    },
    expectedLimitations: [],
  },
  {
    description: "XML 1.0 document text, ASCII text\n",
    contents:
      "<plist><dict><key>nel</key><string>a\u0085b</string><key>ls</key><string>a\u2028b</string><key>ps</key><string>a\u2029b</string><key>lf</key><string>a\nb</string><key>payload</key><data>AA==</data></dict></plist>",
    expected: "xml",
    xmlFallback: true,
    convertedXml:
      "<plist><dict><key>nel</key><string>a\u0085b</string><key>ls</key><string>a\u2028b</string><key>ps</key><string>a\u2029b</string><key>lf</key><string>a\nb</string><key>payload</key><data>AA==</data></dict></plist>",
    expectedTools: ["file", "plutil"],
    expectedLimitations: [],
    expectedValue: {
      nel: "a\u0085b",
      ls: "a\u2028b",
      ps: "a\u2029b",
      lf: "a\nb",
      payload: { $plist_type: "data", base64: "AA==" },
    },
  },
])(
  "keeps source format $expected for $description (XML fallback: $xmlFallback)",
  async (
    {
      description,
      contents = OPENSTEP,
      expected,
      xmlFallback,
      convertedXml = XML,
      expectedValue = { ...VALUE, ...(xmlFallback ? { Blob: DATA } : {}) },
      expectedTools,
      expectedLimitations,
    },
    { onTestFinished },
  ) => {
    const root = await createTestTempDirectory("rea-plist-source-format-");
    const path = join(root, "selected.plist");
    await writeFile(path, contents);
    const client = new NativeMacOSProvider(
      {},
      new PlistSourceRunner(path, description, xmlFallback, convertedXml),
      "darwin",
    ).createClient(nativeMachoTarget(join(root, "target")));
    onTestFinished(async () => {
      const closed = await client.close();
      if (!closed.ok) throw closed.error;
    });

    const inspected = await client.execute("inspect_plist", { path });
    if (!inspected.ok) throw inspected.error;
    const result = inspectPlistSchema.parse(inspected.value.result);
    expect(result.format).toBe(expected);
    expect(result.source_path).toBe(path);
    expect(result.value).toEqual(expectedValue);
    expect(result.provenance.map(({ tool }) => tool)).toEqual(
      expectedTools ??
        (xmlFallback ? ["file", "plutil", "plutil"] : ["file", "plutil"]),
    );
    expect(result.limitations).toEqual(
      expectedLimitations ??
        (xmlFallback ? [expect.stringContaining("XML conversion")] : []),
    );
  },
);

interface PlistConversionCommand {
  readonly format: "json" | "xml1";
  readonly output: Result<string, NativeCommandFailure>;
}

/** Exercise conversion decisions with a closed command script and caller-selected deadline. */
const inspectConvertedPlist = async (
  conversions: readonly PlistConversionCommand[],
) => {
  const root = await createTestTempDirectory("rea-plist-conversion-");
  const path = join(root, "selected numbers.plist");
  await writeFile(path, OPENSTEP);
  const signal = new AbortController().signal;
  const commands = [
    {
      tool: "file",
      arguments: ["-b", path],
      acceptNonZero: false,
      output: ok("ASCII text\n"),
    },
    ...conversions.map(({ format, output }) => ({
      tool: "plutil",
      arguments: ["-convert", format, "-o", "-", "--", path],
      acceptNonZero: format === "json",
      output,
    })),
  ];
  const observed: {
    tool: string;
    arguments: readonly string[];
    options: NativeCommandOptions;
  }[] = [];
  const runner: NativeCommandRunner = {
    async run(tool, arguments_, options) {
      const command = commands[observed.length];
      observed.push({ tool, arguments: [...arguments_], options });
      if (command === undefined) throw new Error("Unexpected native command");
      if (!command.output.ok) return command.output;
      const stdout = command.output.value;
      return ok({
        tool,
        executable: `/usr/bin/${tool}`,
        executableSha256: "a".repeat(64),
        toolVersion: null,
        versionReason: "fixture",
        arguments: [...arguments_],
        stdout,
        stderr: "",
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: 0,
        exitCode: 0,
        signal: null,
      });
    },
  };
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    nativeMachoTarget(join(root, "target")),
  );
  onTestFinished(async () => {
    const closed = await client.close();
    if (!closed.ok) throw closed.error;
  });
  const inspected = await client.execute(
    "inspect_plist",
    { path, native_command_timeout_ms: 1234 },
    { signal },
  );
  expect(observed).toEqual(
    commands.map((command) => ({
      tool: command.tool,
      arguments: command.arguments,
      options: {
        signal,
        timeoutMs: 1234,
        acceptNonZero: command.acceptNonZero,
      },
    })),
  );
  return { inspected, path };
};

it("skips XML conversion for safe integers, signed zero, exponential reals and numeric strings", async () => {
  const { inspected, path } = await inspectConvertedPlist([
    {
      format: "json",
      output: ok(
        '\uFEFF{"Safe":9007199254740991,"Negative":-0.0,"Spelled":-0,"Positive":0.0,"Real":1e21,"Text":"9007199254740993"}',
      ),
    },
  ]);
  if (!inspected.ok) throw inspected.error;
  const result = inspectPlistSchema.parse(inspected.value.result);
  expect(result.source_path).toBe(path);
  expect(result.value).toEqual({
    Safe: 9007199254740991,
    Negative: { $plist_type: "real", value: "-0" },
    Spelled: { $plist_type: "real", value: "-0" },
    Positive: 0,
    Real: 1e21,
    Text: "9007199254740993",
  });
  expect(result.limitations).toEqual([
    '2 negative-zero real value(s) are reported as { "$plist_type": "real", "value": "-0" } because a JSON number cannot carry the sign of zero.',
  ]);
  expect(result.provenance.map(({ command }) => command)).toEqual([
    ["/usr/bin/file", "-b", "$PLIST"],
    ["/usr/bin/plutil", "-convert", "json", "-o", "-", "--", "$PLIST"],
  ]);
});

it("uses XML element types for unsafe JSON digits without confusing integral reals or ambiguous values", async () => {
  const { inspected, path } = await inspectConvertedPlist([
    {
      format: "json",
      output: ok(
        '{"Max":18446744073709551615,"Near":9007199254740993,"Edge":9007199254740992,"Real":100000000000000000000,"AmbiguousInteger":9007199254740994,"AmbiguousReal":9007199254740994}',
      ),
    },
    {
      format: "xml1",
      output: ok(
        "<plist><dict><key>Max</key><integer>18446744073709551615</integer><key>Near</key><integer>9007199254740993</integer><key>Edge</key><integer>9007199254740992</integer><key>Real</key><real>1e20</real><key>AmbiguousInteger</key><integer>9007199254740994</integer><key>AmbiguousReal</key><real>9007199254740994</real></dict></plist>",
      ),
    },
  ]);
  if (!inspected.ok) throw inspected.error;
  const result = inspectPlistSchema.parse(inspected.value.result);
  expect(result.source_path).toBe(path);
  expect(result.value).toEqual({
    Max: { $plist_type: "integer", decimal: "18446744073709551615" },
    Near: { $plist_type: "integer", decimal: "9007199254740993" },
    Edge: { $plist_type: "integer", decimal: "9007199254740992" },
    Real: 1e20,
    AmbiguousInteger: 9007199254740994,
    AmbiguousReal: 9007199254740994,
  });
  expect(result.limitations).toEqual([
    expect.stringContaining("3 integer value(s)"),
    expect.stringContaining("2 number(s)"),
  ]);
  expect(
    result.provenance.map(({ command, exit }) => ({ command, exit })),
  ).toEqual([
    {
      command: ["/usr/bin/file", "-b", "$PLIST"],
      exit: { code: 0, signal: null },
    },
    {
      command: [
        "/usr/bin/plutil",
        "-convert",
        "json",
        "-o",
        "-",
        "--",
        "$PLIST",
      ],
      exit: { code: 0, signal: null },
    },
    {
      command: [
        "/usr/bin/plutil",
        "-convert",
        "xml1",
        "-o",
        "-",
        "--",
        "$PLIST",
      ],
      exit: { code: 0, signal: null },
    },
  ]);
});

it("rejects malformed JSON after an unsafe token without requesting XML", async () => {
  const { inspected } = await inspectConvertedPlist([
    { format: "json", output: ok('{"Wide":9007199254740993,"Broken":') },
  ]);
  if (inspected.ok) throw new Error("Expected malformed conversion output");
  expect(inspected.error).toBeInstanceOf(AnalysisOutputError);
  expect(inspected.error.cause).toBeInstanceOf(SyntaxError);
});

it("rejects malformed XML requested to classify valid unsafe JSON", async () => {
  const { inspected } = await inspectConvertedPlist([
    { format: "json", output: ok('{"Wide":9007199254740993}') },
    { format: "xml1", output: ok("<not-plist/>") },
  ]);
  if (inspected.ok) throw new Error("Expected malformed XML conversion output");
  expect(inspected.error).toBeInstanceOf(AnalysisOutputError);
  expect(inspected.error.cause).toBeInstanceOf(TypeError);
  expect(inspected.error.message).toContain("First element should be <plist>");
});

it("preserves the XML command failure before interpreting its malformed output", async () => {
  const stdout = "<not-plist/>";
  const stderr = "fixture plutil refused XML";
  const failure = new NativeCommandFailure(
    "plutil",
    "nonzero-exit",
    7,
    undefined,
    {
      stdout,
      stderr,
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: Buffer.byteLength(stderr),
      exitCode: 7,
      signal: null,
      truncated: false,
    },
  );
  const { inspected } = await inspectConvertedPlist([
    { format: "json", output: ok('{"Wide":9007199254740993}') },
    { format: "xml1", output: err(failure) },
  ]);
  if (inspected.ok) throw new Error("Expected XML command refusal");
  expect(inspected.error).toBeInstanceOf(ProviderAdapterError);
  expect(inspected.error.cause).toBe(failure);
  expect(inspected.error.capturedOutput).toEqual({
    stdout,
    stderr,
    stdout_bytes: Buffer.byteLength(stdout),
    stderr_bytes: Buffer.byteLength(stderr),
    exit_code: 7,
    signal: null,
    truncated: false,
  });
});
