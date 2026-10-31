import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { expect, onTestFinished } from "vitest";

import { artifactExtractionResultSchema } from "../../src/domain/artifactGraph.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";
import {
  cArchiveExecutable,
  pyzArchive,
  PYTHON_39_MAGIC,
} from "../../src/artifacts/pyinstaller/CArchive.fixture.js";

cliTest.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "extracts readable inventoried files when a child directory is inaccessible",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-extraction-denied-");
    const source = join(root, "Fixture.app");
    const privateDir = join(source, "Contents", "private");
    await mkdir(join(source, "Contents", "MacOS"), { recursive: true });
    await mkdir(privateDir, { recursive: true });
    const macho = Buffer.alloc(32);
    macho.writeUInt32LE(0xfeedfacf, 0);
    macho.writeUInt32LE(0x0100000c, 4);
    macho.writeUInt32LE(2, 12);
    const files = new Map([
      [
        "Contents/Info.plist",
        Buffer.from(
          "<plist><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>fixture</string></dict></plist>",
        ),
      ],
      ["Contents/MacOS/fixture", macho],
      ["Contents/good.txt", Buffer.from("retained bytes\n")],
    ]);
    for (const [path, bytes] of files)
      await writeFile(join(source, path), bytes);
    await writeFile(join(privateDir, "hidden.txt"), "hidden bytes\n");
    await chmod(privateDir, 0);
    onTestFinished(() => chmod(privateDir, 0o755));

    const result = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    const extraction = artifactExtractionResultSchema.parse(
      parseEvidence(result.json).normalized_result,
    );
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected a stdio MCP session");
    const opened = await call("open_binary", { path: source });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const reply = await call("extract_artifact", {});
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const mcpExtraction = artifactExtractionResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    for (const current of [extraction, mcpExtraction]) {
      onTestFinished(() =>
        rm(current.output_root, { recursive: true, force: true }),
      );
      expect(current.coverage.status).toBe("unknown");
      expect(current.limitations).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Contents/private"),
          expect.stringContaining("source traversal coverage is unknown"),
        ]),
      );
      expect(
        current.artifacts.map(({ relative_path }) => relative_path),
      ).toEqual([...files.keys()]);
      for (const [path, bytes] of files)
        expect(
          Buffer.compare(
            await readFile(join(current.output_root, path)),
            bytes,
          ),
        ).toBe(0);
    }

    await chmod(privateDir, 0o755);
    const control = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
    });
    expect(control.exitCode, control.stdout + control.stderr).toBe(0);
    const complete = artifactExtractionResultSchema.parse(
      parseEvidence(control.json).normalized_result,
    );
    onTestFinished(() =>
      rm(complete.output_root, { recursive: true, force: true }),
    );
    expect(complete.coverage.status).toBe("complete");
    expect(
      await readFile(
        join(complete.output_root, "Contents/private/hidden.txt"),
        "utf8",
      ),
    ).toBe("hidden bytes\n");
  },
);

// APFS rejects the raw FF basename with EILSEQ; match the filename-byte lane.
cliTest.skipIf(process.platform !== "linux").for([false, true])(
  "preserves extraction traversal uncertainty through CLI and stdio MCP (opaque name: %s)",
  async (withOpaqueName, { cli }) => {
    const root = await createTestTempDirectory("rea-extraction-coverage-");
    const source = join(root, "Fixture.app");
    await mkdir(join(source, "Contents", "MacOS"), { recursive: true });
    const macho = Buffer.alloc(32);
    macho.writeUInt32LE(0xfeedfacf, 0);
    macho.writeUInt32LE(0x0100000c, 4);
    macho.writeUInt32LE(2, 12);
    const files = new Map([
      [
        "Contents/Info.plist",
        Buffer.from(
          "<plist><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>fixture</string></dict></plist>",
        ),
      ],
      ["Contents/MacOS/fixture", macho],
      ["Contents/good.txt", Buffer.from("retained bytes\n")],
    ]);
    for (const [path, bytes] of files)
      await writeFile(join(source, path), bytes);
    const opaque = Buffer.concat([
      Buffer.from(join(source, "Contents", "opaque-")),
      Buffer.from([0xff]),
      Buffer.from(".txt"),
    ]);
    if (withOpaqueName) await writeFile(opaque, "omitted bytes\n");

    const cliResult = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
    });
    expect(cliResult.exitCode, cliResult.stdout + cliResult.stderr).toBe(0);
    const cliEvidence = parseEvidence(cliResult.json);
    const cliExtraction = artifactExtractionResultSchema.parse(
      cliEvidence.normalized_result,
    );
    onTestFinished(() =>
      rm(cliExtraction.output_root, { recursive: true, force: true }),
    );
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected a stdio MCP session");
    const opened = await call("open_binary", { path: source });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const reply = await call("extract_artifact", {});
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const mcpEvidence = parseEvidence(reply.structuredContent);
    const mcpExtraction = artifactExtractionResultSchema.parse(
      mcpEvidence.normalized_result,
    );
    onTestFinished(() =>
      rm(mcpExtraction.output_root, { recursive: true, force: true }),
    );
    for (const { evidence, result } of [
      { evidence: cliEvidence, result: cliExtraction },
      { evidence: mcpEvidence, result: mcpExtraction },
    ]) {
      expect(
        result.limitations.some((limitation) =>
          limitation.includes("nested archive contents remain"),
        ),
      ).toBe(false);
      expect(
        result.artifacts.map(({ relative_path }) => relative_path),
      ).toEqual([...files.keys()]);
      for (const [path, bytes] of files)
        expect(
          Buffer.compare(await readFile(join(result.output_root, path)), bytes),
        ).toBe(0);
      for (const limitations of [result.limitations, evidence.limitations]) {
        expect(
          limitations.some((value) => value.includes("not valid UTF-8")),
        ).toBe(withOpaqueName);
        expect(
          limitations.some((value) =>
            value.includes("source traversal coverage is unknown"),
          ),
        ).toBe(withOpaqueName);
        expect(
          limitations.some((value) => value.startsWith("All regular files")),
        ).toBe(!withOpaqueName);
      }
    }
    if (withOpaqueName)
      expect(await readFile(opaque, "utf8")).toBe("omitted bytes\n");
  },
);

cliTest.for([false, true])(
  "retains PYZ traversal coverage through CLI and stdio MCP extraction (opaque: %s)",
  async (opaque, { cli }) => {
    const root = await createTestTempDirectory("rea-extraction-pyz-coverage-");
    const source = join(root, "fixture.exe");
    const pyz = pyzArchive({
      magic: opaque ? Buffer.alloc(4) : PYTHON_39_MAGIC,
      modules: [],
    });
    const healthy = Buffer.from("retained sibling bytes\n");
    await writeFile(
      source,
      cArchiveExecutable({
        carrier: "pe",
        layout: "2.1",
        pythonVersion: 309,
        members: [
          { name: "PYZ.pyz", typeCode: "z", payload: pyz, compress: true },
          {
            name: "good.txt",
            typeCode: "x",
            payload: healthy,
            compress: false,
          },
        ],
      }),
    );
    const cliResult = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
    });
    expect(cliResult.exitCode, cliResult.stdout + cliResult.stderr).toBe(0);
    const cliEvidence = parseEvidence(cliResult.json);
    const cliExtraction = artifactExtractionResultSchema.parse(
      cliEvidence.normalized_result,
    );
    onTestFinished(() =>
      rm(cliExtraction.output_root, { recursive: true, force: true }),
    );
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected a stdio MCP session");
    const opened = await call("open_binary", { path: source });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const reply = await call("extract_artifact", {});
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const mcpEvidence = parseEvidence(reply.structuredContent);
    const mcpExtraction = artifactExtractionResultSchema.parse(
      mcpEvidence.normalized_result,
    );
    onTestFinished(() =>
      rm(mcpExtraction.output_root, { recursive: true, force: true }),
    );
    const files = opaque
      ? ([
          ["PYZ.pyz", pyz],
          ["good.txt", healthy],
        ] as const)
      : ([["good.txt", healthy]] as const);
    for (const { evidence, result } of [
      { evidence: cliEvidence, result: cliExtraction },
      { evidence: mcpEvidence, result: mcpExtraction },
    ]) {
      expect(
        result.limitations.some((limitation) =>
          limitation.includes("nested archive contents remain"),
        ),
      ).toBe(false);
      expect(
        result.artifacts.map(({ relative_path }) => relative_path),
      ).toEqual(files.map(([path]) => path));
      for (const [path, bytes] of files) {
        expect(
          Buffer.compare(await readFile(join(result.output_root, path)), bytes),
        ).toBe(0);
        expect(
          result.artifacts.find((file) => file.relative_path === path),
        ).toMatchObject({
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes_written: bytes.length,
        });
      }
      for (const limitations of [result.limitations, evidence.limitations]) {
        expect(
          limitations.some((value) =>
            value.includes("PYZ archives remain opaque"),
          ),
        ).toBe(opaque);
        expect(
          limitations.some((value) =>
            value.includes("source traversal coverage is unknown"),
          ),
        ).toBe(opaque);
        expect(
          limitations.some((value) => value.startsWith("All regular files")),
        ).toBe(!opaque);
      }
    }
  },
);
