import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build, buildBinary, parseBinary } from "plist";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { embedSubmillisecondDateInWideIntegerPayload } from "../../fixtures/binaryPlistScalarAlias.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const MUTATION_SOURCE_SECONDS = 0.2;
const SUBMILLISECOND_SECONDS = 0.1005;

const makeArchiveBytes = (): Buffer =>
  Buffer.from(
    buildBinary({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $top: { root: { UID: 1 } },
      $objects: [
        "$null",
        {
          $class: { UID: 2 },
          wide: Buffer.alloc(16),
          canonicalDate: new Date("2001-01-01T00:00:00.100Z"),
          preciseDate: new Date("2001-01-01T00:00:00.200Z"),
        },
        { $classname: "UIView", $classes: ["UIView", "NSObject"] },
      ],
    }),
  );

const mutateDate = (
  source: Buffer,
  sourceSeconds: number,
  mutation: "fraction" | "marker",
): Buffer => {
  const bytes = Buffer.from(source);
  const date = Buffer.alloc(9);
  date[0] = 0x33;
  date.writeDoubleBE(sourceSeconds, 1);
  const offset = bytes.indexOf(date);
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(bytes.indexOf(date, offset + date.length)).toBe(-1);
  if (mutation === "fraction")
    bytes.writeDoubleBE(SUBMILLISECOND_SECONDS, offset + 1);
  else bytes[offset] = 0x30;
  return bytes;
};

const dateValues = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(dateValues);
  if (value === null || typeof value !== "object") return [];
  if ("$plist_type" in value && value.$plist_type === "date") return [value];
  return Object.values(value).flatMap(dateValues);
};

const makeApp = async (root: string, bytes: Buffer): Promise<string> => {
  const app = join(root, "DateFixture.app");
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
    build({ CFBundleExecutable: "Fixture" }),
  );
  await writeFile(join(resources, "Main.nib"), bytes);
  return app;
};

cliTest(
  "preserves binary plist date precision through keyed archive and Interface Builder CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-binary-plist-dates-");
    const sourceBytes = makeArchiveBytes();
    const parsedFixture = parseBinary(sourceBytes) as {
      $top: { root: { UID: number } };
    };
    expect(parsedFixture.$top.root).toEqual({ UID: 1 });
    const bytes = mutateDate(sourceBytes, MUTATION_SOURCE_SECONDS, "fraction");
    const malformedBytes = mutateDate(
      sourceBytes,
      MUTATION_SOURCE_SECONDS,
      "marker",
    );
    const archivePath = join(root, "archive.plist");
    const malformedArchivePath = join(root, "malformed.plist");
    await Promise.all([
      writeFile(archivePath, bytes),
      writeFile(malformedArchivePath, malformedBytes),
    ]);

    const archiveOutput = await cli.run({
      arguments: ["inspect-keyed-archive", archivePath, "--json"],
      environment: { HOME: root, USERPROFILE: root, REA_LOG_LEVEL: "silent" },
    });
    expect(archiveOutput.exitCode, archiveOutput.stderr).toBe(0);
    const archiveResult = keyedArchiveResultSchema.parse(
      parseEvidence(archiveOutput.json).normalized_result,
    );
    expect(dateValues(archiveResult.objects)).toEqual(
      expect.arrayContaining([
        { $plist_type: "date", iso8601: "2001-01-01T00:00:00.100Z" },
        { $plist_type: "date", iso8601: null },
      ]),
    );
    expect(archiveResult.limitations).toContain(
      '1 date value(s) are reported as { "$plist_type": "date", "iso8601": null } because the decoder could not represent their timestamps.',
    );

    const malformedOutput = await cli.run({
      arguments: ["inspect-keyed-archive", malformedArchivePath, "--json"],
      environment: { HOME: root, USERPROFILE: root, REA_LOG_LEVEL: "silent" },
    });
    expect(malformedOutput.exitCode).not.toBe(0);

    const malformedApp = await makeApp(root, bytes);
    const malformedNib = join(malformedApp, "Contents/Resources/Broken.nib");
    await writeFile(malformedNib, malformedBytes);
    const ibOutput = await cli.run({
      arguments: ["decode-interface-builder", malformedApp, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(ibOutput.exitCode, ibOutput.stderr).toBe(0);
    const ibResult = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(ibOutput.json).normalized_result,
    );
    const view = ibResult.graph.nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === "1",
    );
    expect(view).toBeDefined();
    expect(dateValues(view?.attributes)).toEqual(
      expect.arrayContaining([
        { $plist_type: "date", iso8601: "2001-01-01T00:00:00.100Z" },
        { $plist_type: "date", iso8601: null },
      ]),
    );
    expect(
      ibResult.documents.map(({ relative_path }) => relative_path),
    ).toEqual(["Contents/Resources/Main.nib"]);
    expect(ibResult.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        reason: "one_or_more_archives_invalid",
      }),
    );
    expect(ibResult.limitations).toContain(
      'Contents/Resources/Main.nib: 1 date value(s) are reported as { "$plist_type": "date", "iso8601": null } because the decoder could not represent their timestamps.',
    );
    expect(ibResult.limitations).toContainEqual(
      expect.stringContaining(
        "Contents/Resources/Broken.nib: binary plist date marker 0x30 is invalid",
      ),
    );

    const { call } = await connectLocalToolsMcp({
      HOME: root,
      USERPROFILE: root,
      REA_LOG_LEVEL: "silent",
      REA_ANALYSIS_PROVIDER: "auto",
    });
    expect((await call("open_binary", { path: archivePath })).isError).not.toBe(
      true,
    );
    const archiveMcp = await call("inspect_keyed_archive", {});
    expect(archiveMcp.isError, JSON.stringify(archiveMcp)).not.toBe(true);
    const validatedArchive = toolContract(
      "inspect_keyed_archive",
    ).outputSchema.parse(archiveMcp.structuredContent);
    expect(
      keyedArchiveResultSchema.parse(
        parseEvidence(validatedArchive).normalized_result,
      ),
    ).toEqual(archiveResult);

    const openedBundle = await call("open_bundle_resources", {
      path: malformedApp,
    });
    expect(openedBundle.isError, JSON.stringify(openedBundle)).not.toBe(true);
    toolContract("open_bundle_resources").outputSchema.parse(
      openedBundle.structuredContent,
    );
    const ibMcp = await call("decode_interface_builder", {});
    expect(ibMcp.isError, JSON.stringify(ibMcp)).not.toBe(true);
    const validatedIb = toolContract(
      "decode_interface_builder",
    ).outputSchema.parse(ibMcp.structuredContent);
    expect(
      interfaceBuilderAnalysisSchema.parse(
        parseEvidence(validatedIb).normalized_result,
      ),
    ).toEqual(ibResult);

    expect(Buffer.compare(await readFile(archivePath), bytes)).toBe(0);
    expect(
      Buffer.compare(await readFile(malformedArchivePath), malformedBytes),
    ).toBe(0);
    expect(
      Buffer.compare(
        await readFile(join(malformedApp, "Contents/Resources/Main.nib")),
        bytes,
      ),
    ).toBe(0);
    expect(Buffer.compare(await readFile(malformedNib), malformedBytes)).toBe(
      0,
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      ibResult.documents[0]?.archive_sha256,
    );
  },
  60_000,
);

cliTest(
  "preserves aliased wide-integer and unknown-date values through keyed archive CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-binary-plist-scalar-alias-",
    );
    const { bytes, integerDecimal } =
      embedSubmillisecondDateInWideIntegerPayload(makeArchiveBytes(), 0.2);
    const archivePath = join(root, "aliased-archive.plist");
    await writeFile(archivePath, bytes);
    const environment = {
      HOME: root,
      USERPROFILE: root,
      REA_LOG_LEVEL: "silent",
      REA_ANALYSIS_PROVIDER: "auto",
    };

    const cliOutput = await cli.run({
      arguments: ["inspect-keyed-archive", archivePath, "--json"],
      environment,
    });
    expect(cliOutput.exitCode, cliOutput.stderr).toBe(0);
    const cliResult = keyedArchiveResultSchema.parse(
      parseEvidence(cliOutput.json).normalized_result,
    );
    const archivedValues = cliResult.objects.find(({ id }) => id === 1)?.value;
    expect(archivedValues).toMatchObject({
      wide: { $plist_type: "integer", decimal: integerDecimal },
      canonicalDate: {
        $plist_type: "date",
        iso8601: "2001-01-01T00:00:00.100Z",
      },
      preciseDate: { $plist_type: "date", iso8601: null },
    });

    const { call } = await connectLocalToolsMcp(environment);
    expect((await call("open_binary", { path: archivePath })).isError).not.toBe(
      true,
    );
    const response = await call("inspect_keyed_archive", {});
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const validated = toolContract("inspect_keyed_archive").outputSchema.parse(
      response.structuredContent,
    );
    const mcpResult = keyedArchiveResultSchema.parse(
      parseEvidence(validated).normalized_result,
    );
    expect(mcpResult).toEqual(cliResult);
    expect(Buffer.compare(await readFile(archivePath), bytes)).toBe(0);
  },
  60_000,
);
