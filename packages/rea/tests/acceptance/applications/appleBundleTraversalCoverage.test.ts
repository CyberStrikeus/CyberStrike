import { createHash } from "node:crypto";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { encodeNibArchiveFixture } from "../../../src/artifacts/apple/NibArchive.fixture.js";
import { machoImage } from "../../../src/artifacts/apple/MachoImage.fixture.js";
import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { dylibResolutionResultSchema } from "../../../src/domain/apple/dylibResolution.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const bundle = async () => {
  const root = await createTestTempDirectory("rea-apple-traversal-");
  const app = join(root, "Fixture.app");
  const resources = join(app, "Contents", "Resources");
  const executables = join(app, "Contents", "MacOS");
  await mkdir(resources, { recursive: true });
  await mkdir(executables);
  await writeFile(
    join(app, "Contents", "Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>main</string></dict></plist>",
  );
  const executable = machoImage({});
  await writeFile(join(executables, "main"), executable);
  const nib = encodeNibArchiveFixture({
    classes: ["NSView"],
    objects: [{ classIndex: 0, values: { title: "Healthy view" } }],
  });
  await writeFile(join(resources, "Healthy.nib"), nib);
  return { app, resources, executables, executable, nib };
};

const interfaceBuilderReports = async (cli: TestCli, app: string) => {
  const output = await cli.run({
    arguments: ["decode-interface-builder", app, "--json"],
  });
  expect(output.exitCode, output.stdout + output.stderr).toBe(0);
  const call = await cli.sharedMcpCall?.();
  if (call === undefined) throw new Error("Expected stdio MCP session");
  const opened = await call("open_bundle_resources", { path: app });
  expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
  const reply = await call("decode_interface_builder", {});
  expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
  return [
    parseEvidence(output.json),
    parseEvidence(reply.structuredContent),
  ].map((evidence) => ({
    evidence,
    report: interfaceBuilderAnalysisSchema.parse(evidence.normalized_result),
  }));
};

cliTest(
  "discloses omitted malformed-archive diagnostics through CLI and MCP",
  async ({ cli }) => {
    const fixture = await bundle();
    for (let index = 0; index < 17; index += 1)
      await writeFile(
        join(fixture.resources, `bad-${String(index).padStart(2, "0")}.nib`),
        "not a plist",
      );
    for (const { evidence, report } of await interfaceBuilderReports(
      cli,
      fixture.app,
    )) {
      expect(report.documents).toHaveLength(1);
      expect(report.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "partial",
          reason: "one_or_more_archives_invalid",
          examined: 18,
          omitted: 0,
        }),
      );
      const omission = report.limitations.find((value) =>
        value.includes("additional archive decode failure diagnostic(s)"),
      );
      expect(omission).toMatch(/\b1 additional\b/u);
      expect(omission).toMatch(/\b16 paths\b/u);
      expect(evidence.limitations).toContain(omission);
      for (const limitations of [report.limitations, evidence.limitations]) {
        const failures = limitations.find((value) =>
          value.startsWith(
            "Some Interface Builder archives could not be decoded:",
          ),
        );
        expect(failures?.match(/bad-\d{2}\.nib/gu)).toHaveLength(16);
      }
    }
  },
);

cliTest.skipIf(process.platform === "win32")(
  "reports symlinked nibs as unexamined while preserving healthy UI documents through CLI and MCP",
  async ({ cli }) => {
    const fixture = await bundle();
    const link = join(fixture.resources, "Panel.nib");
    await writeFile(join(fixture.resources, "Panel.data"), fixture.nib);
    await symlink("Panel.data", link);
    for (const { evidence, report } of await interfaceBuilderReports(
      cli,
      fixture.app,
    )) {
      expect(report.documents).toHaveLength(1);
      expect(report.documents[0]).toMatchObject({
        relative_path: "Contents/Resources/Healthy.nib",
        archive_sha256: createHash("sha256").update(fixture.nib).digest("hex"),
      });
      expect(report.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "partial",
          reason: "archive_symlink_not_followed",
          examined: 1,
          omitted: 1,
        }),
      );
      expect(report.graph.truncated).toBe(true);
      for (const limitations of [report.limitations, evidence.limitations])
        expect(limitations).toContain(
          "Contents/Resources/Panel.nib: Symlink target was not followed or disclosed.",
        );
    }
    expect(Buffer.compare(await readFile(link), fixture.nib)).toBe(0);
  },
);

cliTest.skipIf(process.platform !== "linux")(
  "retains unknown Apple resource and executable filename coverage and same-byte rename controls through CLI and MCP",
  async ({ cli }) => {
    const fixture = await bundle();
    const rawNib = Buffer.concat([
      Buffer.from(join(fixture.resources, "Panel")),
      Buffer.from([0xff]),
      Buffer.from(".nib"),
    ]);
    const rawExecutable = Buffer.concat([
      Buffer.from(join(fixture.executables, "helper")),
      Buffer.from([0xff]),
    ]);
    await writeFile(rawNib, fixture.nib);
    await writeFile(rawExecutable, fixture.executable);
    for (const { evidence, report } of await interfaceBuilderReports(
      cli,
      fixture.app,
    )) {
      expect(report.documents).toHaveLength(1);
      expect(report.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "partial",
          reason: "source_traversal_unknown",
          examined: 1,
          omitted: 0,
        }),
      );
      expect(report.graph.truncated).toBe(true);
      for (const limitations of [report.limitations, evidence.limitations])
        expect(limitations).toContainEqual(
          expect.stringContaining("not valid UTF-8"),
        );
    }
    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected stdio MCP session");
    const opened = await call("open_binary", { path: fixture.app });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const cliTrace = await cli.run({
      arguments: ["trace-dylib-resolution", fixture.app, "--json"],
    });
    expect(cliTrace.exitCode, cliTrace.stdout + cliTrace.stderr).toBe(0);
    const mcpTrace = await call("trace_dylib_resolution", {});
    expect(mcpTrace.isError, JSON.stringify(mcpTrace)).not.toBe(true);
    for (const evidence of [
      parseEvidence(cliTrace.json),
      parseEvidence(mcpTrace.structuredContent),
    ]) {
      const trace = dylibResolutionResultSchema.parse(
        evidence.normalized_result,
      );
      expect(trace.roots).toEqual([
        { image: "Contents/MacOS/main", architecture: "arm64" },
      ]);
      expect(trace.coverage.status).toBe("partial");
      for (const limitations of [trace.limitations, evidence.limitations])
        expect(limitations).toContainEqual(
          expect.stringContaining("not valid UTF-8"),
        );
    }
    await rename(rawNib, join(fixture.resources, "Panel.nib"));
    await rename(rawExecutable, join(fixture.executables, "helper"));
    for (const { report } of await interfaceBuilderReports(cli, fixture.app)) {
      expect(report.documents).toHaveLength(2);
      expect(report.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "complete",
          examined: 2,
          omitted: 0,
        }),
      );
      expect(report.limitations.join(" ")).not.toContain("not valid UTF-8");
    }
    const control = await cli.run({
      arguments: ["trace-dylib-resolution", fixture.app, "--json"],
    });
    expect(control.exitCode, control.stdout + control.stderr).toBe(0);
    const trace = dylibResolutionResultSchema.parse(
      parseEvidence(control.json).normalized_result,
    );
    expect(trace.roots.map(({ image }) => image)).toEqual([
      "Contents/MacOS/helper",
      "Contents/MacOS/main",
    ]);
    expect(trace.coverage.status).toBe("complete");
  },
);
