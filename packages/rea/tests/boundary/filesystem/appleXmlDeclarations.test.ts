import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { build } from "plist";
import { expect, it } from "vitest";

import { analyzeInterfaceBuilderBundle } from "../../../src/artifacts/apple/InterfaceBuilderAnalysis.js";
import { inspectBundleKeyedArchive } from "../../../src/artifacts/apple/KeyedArchiveReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const archive = build({
  $archiver: "NSKeyedArchiver",
  $objects: ["$null", "Café"],
  $top: { root: { CF$UID: 1 } },
});

it("preflights repeated unterminated quoted declarations without suffix rescans", async () => {
  const preflightUrl = new URL(
    "../../../dist/artifacts/apple/PropertyListDecodeBudget.js",
    import.meta.url,
  ).href;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import { preflightPropertyListDecode } from ${JSON.stringify(preflightUrl)};
      const xml = '<!DOCTYPE "x>x" '.repeat(70000);
      const observed = preflightPropertyListDecode(Buffer.from(xml), 16 * 1024 * 1024);
      process.stdout.write(JSON.stringify({ observed, expected: xml.length * 4 }));
    `,
    ],
    { timeout: 5000 },
  );
  const result = JSON.parse(stdout) as {
    observed: { estimatedBytes: number };
    expected: number;
  };
  expect(result.observed.estimatedBytes).toBe(result.expected);
}, 10000);

const fixture = async (declaration: string) => {
  const bundlePath = await createTestTempDirectory("rea-xml-declaration-");
  await writeFile(
    join(bundlePath, "Panel.nib"),
    Buffer.from(archive.replace("UTF-8", declaration), "utf8"),
  );
  return { bundlePath, targetSha256: "a".repeat(64) };
};

it.each(["UTF-8", "utf-8"])(
  "retains UTF-8 characters with the supported declaration %s",
  async (declaration) => {
    const input = await fixture(declaration);
    const archiveResult = await inspectBundleKeyedArchive({
      ...input,
      parameters: { path: "Panel.nib" },
    });
    expect(archiveResult.objects).toContainEqual(
      expect.objectContaining({ value: "Café" }),
    );
    const interfaceBuilderResult = await analyzeInterfaceBuilderBundle(input);
    expect(interfaceBuilderResult.documents).toHaveLength(1);
    expect(interfaceBuilderResult.documents[0]?.relative_path).toBe(
      "Panel.nib",
    );
  },
);

it.each(["REA-UNSUPPORTED", "ISO-8859-1"])(
  "reports unsupported keyed archive encoding %s instead of substituting UTF-8 text",
  async (declaration) => {
    const input = await fixture(declaration);
    await expect(
      inspectBundleKeyedArchive({
        ...input,
        parameters: { path: "Panel.nib" },
      }),
    ).rejects.toMatchObject({
      reason: "format",
      message: expect.stringContaining(declaration),
    });
  },
);

it.each(["REA-UNSUPPORTED", "ISO-8859-1"])(
  "reports unsupported Interface Builder encoding %s without graph substitution",
  async (declaration) => {
    const result = await analyzeInterfaceBuilderBundle(
      await fixture(declaration),
    );
    expect(result.documents).toEqual([]);
    expect(result.graph.nodes).toEqual([]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        reason: "one_or_more_archives_invalid",
      }),
    );
    expect(result.graph.truncated).toBe(true);
  },
);
