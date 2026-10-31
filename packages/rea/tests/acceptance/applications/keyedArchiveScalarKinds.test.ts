import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build, buildBinary } from "plist";
import { expect } from "vitest";

import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["xml", "binary"] as const)(
  "distinguishes serialized scalar objects from lookalike dictionaries in a %s keyed archive",
  async (format, { cli }) => {
    const root = await createTestTempDirectory("rea-keyed-scalar-kinds-");
    const uid = (value: number) =>
      format === "binary" ? { UID: value } : { CF$UID: value };
    const archive = {
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $top: { root: uid(12), data: uid(1) },
      $objects: [
        "$null",
        Buffer.from("deadbeef", "hex"),
        new Date("2001-01-01T00:00:00.000Z"),
        9007199254740992,
        "hello",
        42,
        1.5,
        Number.POSITIVE_INFINITY,
        { $plist_type: "data", base64: "3q2+7w==" },
        { $plist_type: "date", iso8601: "2001-01-01T00:00:00.000Z" },
        { $plist_type: "real", value: 0 },
        [uid(1)],
        { $class: uid(13), payload: uid(1) },
        { $classname: "ScalarHolder", $classes: ["ScalarHolder", "NSObject"] },
      ],
    };
    const bytes = Buffer.from(
      format === "binary" ? buildBinary(archive) : build(archive),
    );
    const path = join(root, "archive.plist");
    await writeFile(path, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const run = async (arguments_: readonly string[] = []) => {
      const output = await cli.run({
        arguments: ["inspect-keyed-archive", path, ...arguments_, "--json"],
        environment: {
          HOME: root,
          USERPROFILE: root,
          REA_LOG_LEVEL: "silent",
          REA_ANALYSIS_PROVIDER: "auto",
        },
      });
      expect(output.exitCode, output.stderr).toBe(0);
      return keyedArchiveResultSchema.parse(
        parseEvidence(output.json).normalized_result,
      );
    };
    const result = await run();
    const { call } = await connectLocalToolsMcp({
      HOME: root,
      USERPROFILE: root,
    });
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const mcp = await call("inspect_keyed_archive", {});
    expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
    expect(
      keyedArchiveResultSchema.parse(
        parseEvidence(mcp.structuredContent).normalized_result,
      ),
    ).toEqual(result);
    expect(result.archive_sha256).toBe(digest);
    expect(result.archive_format).toBe(
      format === "binary" ? "binary-plist" : "xml-plist",
    );
    expect(result.objects.map(({ kind }) => kind)).toEqual([
      "nil",
      "scalar",
      "scalar",
      "scalar",
      "scalar",
      "scalar",
      "scalar",
      "scalar",
      "dictionary",
      "dictionary",
      "dictionary",
      "array",
      "archived-object",
      "class-descriptor",
    ]);
    for (const [scalar, dictionary] of [
      [1, 8],
      [2, 9],
    ] as const) {
      expect(result.objects[scalar]?.value).toEqual(
        result.objects[dictionary]?.value,
      );
      expect(result.objects[scalar]?.status).toBe("observed");
    }
    expect(result.objects[1]?.value).toEqual({
      $plist_type: "data",
      base64: "3q2+7w==",
    });
    expect(result.objects[2]?.value).toEqual({
      $plist_type: "date",
      iso8601: "2001-01-01T00:00:00.000Z",
    });
    // XML and binary decoding preserve the same non-finite value identity.
    expect(result.objects[7]?.value).toEqual({
      $plist_type: "real",
      value: "+infinity",
    });
    expect(result.objects[10]?.value).toEqual({
      $plist_type: "real",
      value: 0,
    });
    expect(result.objects[12]).toMatchObject({
      class_id: 13,
      class_name: "ScalarHolder",
      status: "unknown-class",
    });
    expect(result.references).toContainEqual(
      expect.objectContaining({
        source: 12,
        path: ["payload"],
        target: 1,
        status: "resolved",
      }),
    );
    expect(result.limitations).toContainEqual(
      expect.stringContaining("1 non-finite real value(s)"),
    );

    const page = await run(["--root", "data", "--offset", "1", "--limit", "2"]);
    expect(page.objects).toEqual(result.objects.slice(1, 3));
    expect(page).toMatchObject({
      archive_sha256: digest,
      total_objects: 14,
      offset: 1,
      next_offset: 3,
      truncated: true,
    });
    expect(Object.keys(page.roots)).toEqual(["data"]);
    expect(page.references).toEqual([
      expect.objectContaining({
        source: null,
        path: ["data"],
        target: 1,
        status: "resolved",
      }),
    ]);
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);

cliTest.for(["xml", "binary"] as const)(
  "keeps a negative-zero real distinct from positive zero in a %s keyed archive",
  async (format, { cli }) => {
    const root = await createTestTempDirectory("rea-keyed-signed-zero-");
    const uid = (value: number) =>
      format === "binary" ? { UID: value } : { CF$UID: value };
    const archive = {
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $top: {
        negative: uid(1),
        positive: uid(2),
        control: uid(3),
      },
      $objects: ["$null", 1.5, 0.25, 1.25],
    };
    // plist@5 writes -0 and 0 as integers, so encode placeholder reals and
    // patch them to the zeros an archiver serializes.
    let bytes: Buffer;
    if (format === "xml") {
      const xml = build(archive);
      expect(xml).toContain("<real>1.5</real>");
      expect(xml).toContain("<real>0.25</real>");
      bytes = Buffer.from(
        xml
          .replace("<real>1.5</real>", "<real>-0.0</real>")
          .replace("<real>0.25</real>", "<real>0.0</real>"),
      );
    } else {
      bytes = Buffer.from(buildBinary(archive));
      for (const [placeholder, zero] of [
        [1.5, -0],
        [0.25, 0],
      ] as const) {
        const real = Buffer.alloc(9);
        real[0] = 0x23;
        real.writeDoubleBE(placeholder, 1);
        const start = bytes.indexOf(real);
        expect(start).toBeGreaterThanOrEqual(0);
        bytes.writeDoubleBE(zero, start + 1);
      }
    }
    const path = join(root, "archive.plist");
    await writeFile(path, bytes);
    const output = await cli.run({
      arguments: ["inspect-keyed-archive", path, "--json"],
      environment: {
        HOME: root,
        USERPROFILE: root,
        REA_LOG_LEVEL: "silent",
        REA_ANALYSIS_PROVIDER: "auto",
      },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = keyedArchiveResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const { call } = await connectLocalToolsMcp({
      HOME: root,
      USERPROFILE: root,
    });
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const mcp = await call("inspect_keyed_archive", {});
    expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
    expect(
      keyedArchiveResultSchema.parse(
        parseEvidence(mcp.structuredContent).normalized_result,
      ),
    ).toEqual(result);
    const [, negative, positive, control] = result.objects;
    expect(negative).toMatchObject({
      kind: "scalar",
      status: "observed",
      value: { $plist_type: "real", value: "-0" },
    });
    expect(positive).toMatchObject({ kind: "scalar", status: "observed" });
    expect(Object.is(positive?.value, 0)).toBe(true);
    expect(control?.value).toBe(1.25);
    expect(JSON.stringify(result.objects.map(({ value }) => value))).toBe(
      '["$null",{"$plist_type":"real","value":"-0"},0,1.25]',
    );
    expect(result.limitations).toContain(
      '1 negative-zero real value(s) are reported as { "$plist_type": "real", "value": "-0" } because a JSON number cannot carry the sign of zero.',
    );
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);

cliTest(
  "rejects scalar top dictionaries through the public CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-scalar-top-");
    const { call } = await connectLocalToolsMcp({
      HOME: root,
      USERPROFILE: root,
    });
    for (const format of ["xml", "binary"]) {
      const archive = {
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: ["$null"],
        $top: new Uint8Array([0]),
      };
      const path = join(root, format + ".plist");
      await writeFile(
        path,
        Buffer.from(format === "xml" ? build(archive) : buildBinary(archive)),
      );
      const output = await cli.run({
        arguments: ["inspect-keyed-archive", path, "--json"],
        environment: { HOME: root, USERPROFILE: root },
      });
      expect(output.exitCode).toBe(1);
      expect(output.json).toMatchObject({
        code: "artifact_operation_failed",
        details: {
          reason: "format",
          detail: expect.stringContaining("Keyed archive has no $top roots"),
        },
      });
      const opened = await call("open_binary", { path });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      const reply = await call("inspect_keyed_archive", {});
      expect(reply.isError).toBe(true);
      expect(JSON.stringify(reply)).toContain(
        "Keyed archive has no $top roots",
      );
    }
  },
);

cliTest("preserves binary IEEE non-finite scalar identity", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-binary-nonfinite-");
  const path = join(root, "archive.plist");
  const bytes = Buffer.from(
    buildBinary({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $top: {
        positive: { UID: 1 },
        negative: { UID: 2 },
        nan: { UID: 3 },
      },
      $objects: [
        "$null",
        Infinity,
        -Infinity,
        NaN,
        { $plist_type: "real", value: "nan" },
        1.25,
      ],
    }),
  );
  await writeFile(path, bytes);
  const output = await cli.run({
    arguments: ["inspect-keyed-archive", path, "--json"],
    environment: { HOME: root, USERPROFILE: root, REA_LOG_LEVEL: "silent" },
  });
  expect(output.exitCode, output.stderr).toBe(0);
  const result = keyedArchiveResultSchema.parse(
    parseEvidence(output.json).normalized_result,
  );
  expect(
    result.objects.slice(1).map(({ kind, value }) => ({ kind, value })),
  ).toEqual([
    { kind: "scalar", value: { $plist_type: "real", value: "+infinity" } },
    { kind: "scalar", value: { $plist_type: "real", value: "-infinity" } },
    { kind: "scalar", value: { $plist_type: "real", value: "nan" } },
    { kind: "dictionary", value: { $plist_type: "real", value: "nan" } },
    { kind: "scalar", value: 1.25 },
  ]);
  expect(result.archive_sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  const { call } = await connectLocalToolsMcp({
    HOME: root,
    USERPROFILE: root,
  });
  const opened = await call("open_binary", { path });
  expect(opened.isError).not.toBe(true);
  const mcp = await call("inspect_keyed_archive", {});
  expect(mcp.isError).not.toBe(true);
  expect(
    keyedArchiveResultSchema.parse(
      parseEvidence(mcp.structuredContent).normalized_result,
    ),
  ).toEqual(result);
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

cliTest(
  "keeps CFPropertyList's non-finite real spellings in an XML keyed archive",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-keyed-non-finite-");
    const archive = {
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $top: {
        up: { CF$UID: 1 },
        down: { CF$UID: 2 },
        missing: { CF$UID: 3 },
        control: { CF$UID: 4 },
      },
      $objects: ["$null", 1.5, 0.25, 1.75, 1.25],
    };
    // plist@5 writes its own spellings for non-finite reals, so encode
    // placeholder reals and patch them to the text CFPropertyList writes.
    let xml = build(archive);
    for (const [placeholder, spelling] of [
      ["1.5", "+infinity"],
      ["0.25", "-INFINITY"],
      ["1.75", "nan"],
    ] as const) {
      expect(xml).toContain(`<real>${placeholder}</real>`);
      xml = xml.replace(
        `<real>${placeholder}</real>`,
        `<real>${spelling}</real>`,
      );
    }
    const bytes = Buffer.from(xml);
    const path = join(root, "archive.plist");
    await writeFile(path, bytes);
    const output = await cli.run({
      arguments: ["inspect-keyed-archive", path, "--json"],
      environment: {
        HOME: root,
        USERPROFILE: root,
        REA_LOG_LEVEL: "silent",
        REA_ANALYSIS_PROVIDER: "auto",
      },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = keyedArchiveResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const { call } = await connectLocalToolsMcp({
      HOME: root,
      USERPROFILE: root,
    });
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const mcp = await call("inspect_keyed_archive", {});
    expect(mcp.isError, JSON.stringify(mcp)).not.toBe(true);
    expect(
      keyedArchiveResultSchema.parse(
        parseEvidence(mcp.structuredContent).normalized_result,
      ),
    ).toEqual(result);
    for (const object of result.objects.slice(1)) {
      expect(object).toMatchObject({ kind: "scalar", status: "observed" });
    }
    expect(JSON.stringify(result.objects.map(({ value }) => value))).toBe(
      '["$null",{"$plist_type":"real","value":"+infinity"},{"$plist_type":"real","value":"-infinity"},{"$plist_type":"real","value":"nan"},1.25]',
    );
    expect(result.limitations).toContain(
      '3 non-finite real value(s) are reported as { "$plist_type": "real", "value": "<spelling>" } using canonical numeric labels nan, +infinity or -infinity because a JSON number cannot carry them.',
    );
    expect(result.limitations).not.toContainEqual(
      expect.stringContaining('"value": null'),
    );
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);
