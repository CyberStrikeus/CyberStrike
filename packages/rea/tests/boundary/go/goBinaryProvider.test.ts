import { writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { GoBinaryProvider } from "../../../src/go/GoBinaryProvider.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  createGoBinaryDiagnosticFixtures,
  createGoBinaryFixture,
  createGoOverlappingElfFixture,
} from "../../fixtures/go/image.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("distinguishes unsupported MZ carriers from damaged PE declarations", async () => {
  const root = await createTestTempDirectory("rea-go-mz-");
  for (const fixture of createGoBinaryDiagnosticFixtures()) {
    const path = join(root, `${fixture.name}.exe`);
    await writeFile(path, fixture.bytes);
    const result = await new GoBinaryProvider().inspect({ path });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBeInstanceOf(
        fixture.code === "unsupported_target"
          ? AnalysisUnsupportedTargetError
          : AnalysisInputError,
      );
  }
});

it.each([32, 64] as const)(
  "rejects advertised PE%d data directories outside the optional header",
  async (bits) => {
    const root = await createTestTempDirectory("rea-go-pe-directories-");
    const fixture = createGoBinaryFixture({ format: "pe", bits });
    fixture.bytes.writeUInt32LE(1, 152 + (bits === 64 ? 108 : 92));
    const path = join(root, `truncated-pe${String(bits)}.exe`);
    await writeFile(path, fixture.bytes);
    const result = await new GoBinaryProvider().inspect({ path });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AnalysisInputError);
      if (!(result.error instanceof AnalysisInputError)) throw result.error;
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ reason: "invalid_format" }),
      );
    }
  },
);

it("preserves the actual build-info byte guard as a resource failure", async () => {
  const fixture = createGoBinaryFixture();
  fixture.bytes.set([0x81, 0x80, 0x40], fixture.headerOffset + 32);
  const root = await createTestTempDirectory("rea-go-resource-");
  const path = join(root, "oversized-metadata.elf");
  await writeFile(path, fixture.bytes);
  const result = await new GoBinaryProvider().inspect({ path });
  expect(result.ok).toBe(false);
  if (result.ok)
    throw new Error("Oversized embedded metadata must not succeed");
  expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
  if (!(result.error instanceof AnalysisResourceConstraintError))
    throw result.error;
  expect(result.error.reason).toContain(path);
  expect(result.error.reportedLimits).toEqual({
    boundary: "build-info",
    maximum_bytes: 1024 * 1024,
  });
  const projected = projectAnalysisError(result.error);
  expect(projected.retryable).toBe(false);
  expect(projected.remediation.action).toContain(
    "Go build-info string allowance",
  );
  expect(projected.remediation.action).not.toMatch(/available host memory/u);
});

it("keeps the header-search budget distinct from a worker CPU limit", async () => {
  const root = await createTestTempDirectory("rea-go-search-");
  const path = join(root, "overlapping.elf");
  await writeFile(path, createGoOverlappingElfFixture());
  const result = await new GoBinaryProvider().inspect({ path });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Overlapping header search must be refused");
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    retryable: false,
    details: {
      resource: "cpu",
      reported_limits: {
        boundary: "search",
        maximum_bytes: 256 * 1024 * 1024,
      },
    },
  });
  expect(projected.remediation.action).toContain("header-search allowance");
  expect(projected.remediation.action).not.toMatch(/observed signal/u);
});

it("reports unreadable ELF names alongside the no-record limitation", async () => {
  const bytes = createGoBinaryFixture({ omitBuildInfo: true }).bytes;
  const nameTableHeader = 256 + 64;
  bytes.writeBigUInt64LE(0x800n, nameTableHeader + 8);
  bytes.writeBigUInt64LE(24n, nameTableHeader + 32);
  bytes.writeUInt32LE(3, 768);
  const root = await createTestTempDirectory("rea-go-unknown-section-names-");
  const path = join(root, "unknown-names.elf");
  await writeFile(path, bytes);

  const result = await new GoBinaryProvider().inspect({ path });
  if (!result.ok) throw result.error;
  expect(result.value.build_info).toBeNull();
  expect(result.value.limitations).toContain(
    "No recognized Go build-info record was found in the inspected image; absent metadata does not establish that the binary is not Go.",
  );
  expect(result.value.limitations).toContain(
    "ELF section names are unavailable because compression type 3 is unsupported",
  );
  expect(result.value).not.toHaveProperty("section_names_limitation");
});

it.skipIf(process.platform === "win32")(
  "rejects a symlink without replacing its selected file identity",
  async () => {
    const root = await createTestTempDirectory("rea-go-symlink-");
    const selected = join(root, "selected");
    const original = join(root, "original.elf");
    await writeFile(original, createGoBinaryFixture().bytes);
    await symlink(original, selected);
    const result = await new GoBinaryProvider().inspect({ path: selected });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisInputError);
  },
);

it("reports a parse-complete GOPATH module text as unknown dependency coverage", async () => {
  const moduleText =
    "path\texample.com/tool/cmd/tool\n" +
    "build\t-compiler=gc\n" +
    "build\tGOOS=linux\n";
  const root = await createTestTempDirectory("rea-go-gopath-metadata-");
  const path = join(root, "application.elf");
  await writeFile(path, createGoBinaryFixture({ moduleText }).bytes);
  const result = await new GoBinaryProvider().inspect({ path });
  if (!result.ok) throw result.error;
  expect(result.value.build_info?.module_text).toBe(moduleText);
  expect(result.value.build_info?.module).toMatchObject({
    path: "example.com/tool/cmd/tool",
    main: null,
    dependencies: [],
    complete: true,
    unparsed_lines: [],
  });
  expect(result.value.limitations.join(" ")).toContain(
    "Dependency coverage is unknown",
  );
});

it("keeps a module-mode build with no dependency records as an observed empty list", async () => {
  const moduleText =
    "path\texample.com/tool\n" +
    "mod\texample.com/tool\t(devel)\t\n" +
    "build\tGOOS=linux\n";
  const root = await createTestTempDirectory("rea-go-empty-module-deps-");
  const path = join(root, "application.elf");
  await writeFile(path, createGoBinaryFixture({ moduleText }).bytes);
  const result = await new GoBinaryProvider().inspect({ path });
  if (!result.ok) throw result.error;
  expect(result.value.build_info?.module_text).toBe(moduleText);
  expect(result.value.build_info?.module).toMatchObject({
    main: { path: "example.com/tool", version: "(devel)" },
    dependencies: [],
    complete: true,
  });
  expect(result.value.limitations.join(" ")).not.toContain(
    "Dependency coverage is unknown",
  );
});
