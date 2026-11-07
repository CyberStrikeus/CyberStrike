import { goBinarySchema } from "../../src/domain/go/goBinary.js";
import { evidenceResultOf } from "../../src/contracts/toolOutputSchemaPrimitives.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect } from "vitest";
import { machoImageWithUnknownCommand } from "../../src/artifacts/apple/MachoImage.fixture.js";
import {
  createGoBinaryByteStringFixture,
  createGoBinaryDiagnosticFixtures,
  createGoBinaryFixture,
  createGoSplitElfFixture,
  createGoOverlappingElfFixture,
  createGoBinaryPathFailureFixture,
  createGoInlineAggregateFixture,
  setGoPeVirtualSize,
  setGoElfLoadFileSize,
  setGoMachOSectionSize,
  setGoMachOSegmentFileSize,
  GO_MODULE_TEXT,
} from "../fixtures/go/image.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../support/cli/cliFixture.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { expectCliMcpEvidenceParity } from "../fixtures/cliMcpEvidenceParity.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";

cliTest(
  "reads Mach-O inline Go strings beyond a header-only discovery section through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-macho-inline-range-");
    const { client, call } = await connectLocalToolsMcp();
    const complete = createGoBinaryFixture({ format: "macho" });
    setGoMachOSectionSize(complete.bytes, 32);
    const truncated = createGoBinaryFixture({ format: "macho" });
    setGoMachOSectionSize(truncated.bytes, 32);
    setGoMachOSegmentFileSize(
      truncated.bytes,
      truncated.moduleOffset + truncated.moduleBytes.length - 1,
    );

    for (const item of [
      { name: "header-only", bytes: complete.bytes, expected: "success" },
      { name: "truncated", bytes: truncated.bytes, expected: "malformed" },
    ] as const) {
      const path = join(root, `${item.name}.macho`);
      await writeFile(path, item.bytes);
      const result = await runFileCli(cli, {
        arguments: ["inspect-go-binary", path, "--json"],
      });
      const response = await call("inspect_go_binary", { path });
      if (item.expected === "success") {
        expect(result.exitCode, result.stderr).toBe(0);
        const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
        expect(evidence.normalized_result).toMatchObject({
          format: "macho",
          build_info: {
            header_offset: complete.headerOffset,
            go_version: "go1.26.0",
            module: { path: "example.com/tool/cmd/tool" },
          },
        });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
      } else {
        const expected = {
          code: "invalid_request",
          details: {
            operation: "inspect_go_binary",
            issues: [{ path: ["path"], reason: "invalid_format" }],
          },
        };
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject(expected);
        expect(parseMcpToolError(response).error).toMatchObject(expected);
      }
    }
    await client.ping();
  },
  60000,
);

cliTest(
  "counts inline Go string contents separately from varint framing through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-inline-budget-");
    const { client, call } = await connectLocalToolsMcp();
    const maximum = 1024 * 1024;
    const cases = [
      {
        name: "exact",
        fixture: createGoInlineAggregateFixture(maximum),
        outcome: "success",
      },
      {
        name: "over",
        fixture: createGoInlineAggregateFixture(maximum + 1),
        outcome: "resource",
      },
      {
        name: "truncated",
        fixture: createGoInlineAggregateFixture(512),
        outcome: "malformed",
      },
    ] as const;

    for (const item of cases) {
      if (item.name === "truncated")
        setGoElfLoadFileSize(
          item.fixture.bytes,
          item.fixture.moduleOffset + item.fixture.moduleBytes.length - 1,
        );
      const path = join(root, `${item.name}.elf`);
      await writeFile(path, item.fixture.bytes);
      const result = await runFileCli(cli, {
        arguments: ["inspect-go-binary", path, "--json"],
      });
      const response = await call("inspect_go_binary", { path });

      if (item.outcome === "success") {
        expect(result.exitCode, result.stderr).toBe(0);
        const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
        const buildInfo = evidence.normalized_result.build_info;
        expect(buildInfo).not.toBeNull();
        expect(
          buildInfo!.version_location.bytes + buildInfo!.module_location.bytes,
        ).toBe(maximum);
        expect(
          item.fixture.moduleOffset +
            item.fixture.moduleBytes.length -
            item.fixture.headerOffset,
        ).toBeGreaterThan(maximum + 32);
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
      } else {
        const code =
          item.outcome === "resource"
            ? "resource_constraint"
            : "invalid_request";
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject({
          code,
          details: {
            operation: "inspect_go_binary",
            ...(item.outcome === "resource"
              ? {
                  resource: "memory",
                  reported_limits: {
                    boundary: "build-info",
                    maximum_bytes: maximum,
                  },
                }
              : { issues: [{ path: ["path"], reason: "invalid_format" }] }),
          },
        });
        expect(parseMcpToolError(response).error).toMatchObject({
          code,
          details: {
            operation: "inspect_go_binary",
            ...(item.outcome === "resource"
              ? {
                  resource: "memory",
                  reported_limits: {
                    boundary: "build-info",
                    maximum_bytes: maximum,
                  },
                }
              : { issues: [{ path: ["path"], reason: "invalid_format" }] }),
          },
        });
      }
    }
    await client.ping();
  },
  60000,
);

cliTest(
  "delivers a Go CLI summary with its unchanged complete source bundle",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-cli-summary-");
    const path = join(root, "application.elf");
    const output = join(root, "source.json");
    await writeFile(path, createGoBinaryFixture().bytes);
    const complete = await runFileCli(cli, {
      arguments: ["inspect-go-binary", path, "--json"],
    });
    expect(complete.exitCode, complete.stderr).toBe(0);
    const full = evidenceResultOf(goBinarySchema).parse(complete.json);
    const summary = await runFileCli(cli, {
      arguments: [
        "inspect-go-binary",
        path,
        "--detail",
        "summary",
        "--evidence_output",
        output,
        "--json",
      ],
    });
    expect(summary.exitCode, summary.stderr).toBe(0);
    expect(summary.json).toMatchObject({
      summary: {
        normalized_result: {
          kind: "summary",
          parent_evidence_id: full.evidence_id,
          source_coverage: { runtime_dependencies: "unknown" },
        },
      },
    });
    const bundle = JSON.parse(await readFile(output, "utf8")) as {
      records: unknown[];
    };
    expect(
      bundle.records
        .map((record) => parseEvidence(record))
        .find((record) => record.evidence_id === full.evidence_id),
    ).toEqual(full);
    const refused = await runFileCli(cli, {
      arguments: [
        "inspect-go-binary",
        join(root, "missing"),
        "--detail",
        "summary",
        "--json",
      ],
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.json).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["evidence_output"] }] },
    });
  },
  30000,
);

cliTest(
  "bounds overlapping ELF scans through CLI and keeps MCP responsive",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-overlap-");
    const path = join(root, "overlapping.elf");
    await writeFile(path, createGoOverlappingElfFixture());
    const result = await runFileCli(cli, {
      arguments: ["inspect-go-binary", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    const expected = {
      code: "resource_constraint",
      details: {
        operation: "inspect_go_binary",
        resource: "cpu",
        reported_limits: {
          boundary: "search",
          maximum_bytes: 256 * 1024 * 1024,
        },
      },
    };
    expect(result.json).toMatchObject(expected);
    const { client, call } = await connectLocalToolsMcp();
    const response = await call("inspect_go_binary", { path });
    expect(parseMcpToolError(response).error).toMatchObject(expected);
    await client.ping();
  },
  30000,
);

cliTest(
  "retains later-load sectionless ELF evidence through public CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-split-elf-");
    const { client, call } = await connectLocalToolsMcp();
    const infos = [];
    for (const sectionless of [false, true]) {
      const fixture = createGoSplitElfFixture({ sectionless });
      const path = join(root, sectionless ? "sectionless.elf" : "original.elf");
      await writeFile(path, fixture.bytes);
      const result = await runFileCli(cli, {
        arguments: ["inspect-go-binary", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
      expect(evidence.normalized_result.build_info).not.toBeNull();
      infos.push(evidence.normalized_result.build_info);
      const response = await call("inspect_go_binary", { path });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
    }
    expect(infos[1]).toEqual(infos[0]);
    await client.ping();
  },
  30000,
);

for (const bits of [32, 64] as const) {
  for (const encoding of ["inline", "pointer"] as const) {
    cliTest(
      `preserves PE ${bits}-bit ${encoding} build info at zero VirtualSize through CLI and stdio MCP`,
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-go-pe-zero-vsize-");
        const fixture = createGoBinaryFixture({ format: "pe", bits, encoding });
        const ordinaryBytes = Buffer.from(fixture.bytes);
        const zeroSizeBytes = Buffer.from(fixture.bytes);
        setGoPeVirtualSize(zeroSizeBytes, 0);
        const { client, call } = await connectLocalToolsMcp();
        const buildInfos = [];

        for (const [label, bytes] of [
          ["ordinary", ordinaryBytes],
          ["zero-vsize", zeroSizeBytes],
        ] as const) {
          const path = join(root, `${label}.exe`);
          await writeFile(path, bytes);
          const result = await runFileCli(cli, {
            arguments: ["inspect-go-binary", path, "--json"],
          });
          expect(result.exitCode, result.stderr).toBe(0);
          const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
          expect(evidence.subject?.digest.sha256).toBe(
            createHash("sha256").update(bytes).digest("hex"),
          );
          expect(evidence.normalized_result.build_info).toMatchObject({
            go_version: "go1.26.0",
            encoding,
            header_offset: fixture.headerOffset,
            module_text: GO_MODULE_TEXT,
          });
          buildInfos.push(evidence.normalized_result.build_info);

          const response = await call("inspect_go_binary", { path });
          expect(response.isError, JSON.stringify(response)).not.toBe(true);
          expectCliMcpEvidenceParity(
            evidence,
            response.structuredContent,
            path,
          );
        }

        expect(buildInfos[1]).toEqual(buildInfos[0]);
        await client.ping();
      },
      30000,
    );
  }
}

cliTest(
  "rejects misaligned 64-bit Mach-O through Go CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-macho-alignment-");
    const { client, call } = await connectLocalToolsMcp();
    const expectedFailure = {
      code: "invalid_request",
      details: {
        operation: "inspect_go_binary",
        issues: [{ path: ["path"], reason: "invalid_format" }],
      },
    };

    for (const fixture of [
      { wide: true, size: 12, bits: 64, malformed: true },
      { wide: true, size: 16, bits: 64, malformed: false },
      { wide: false, size: 12, bits: 32, malformed: false },
    ]) {
      const path = join(root, `image-${fixture.bits}-${fixture.size}.macho`);
      await writeFile(
        path,
        machoImageWithUnknownCommand(fixture.wide, fixture.size),
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-go-binary", path, "--json"],
      });
      const response = await call("inspect_go_binary", { path });

      if (fixture.malformed) {
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject(expectedFailure);
        expect(result.json).not.toHaveProperty("normalized_result");
        expect(parseMcpToolError(response).error).toMatchObject(
          expectedFailure,
        );
        expect(response.structuredContent).toBeUndefined();
        continue;
      }

      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
      expect(evidence.normalized_result).toMatchObject({
        format: "macho",
        bits: fixture.bits,
        build_info: null,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
    }
    await client.ping();
  },
  30000,
);

for (const expectedErrno of ["ELOOP", "ENAMETOOLONG"] as const) {
  cliTest.skipIf(expectedErrno === "ELOOP" && process.platform === "win32")(
    `reports native ${expectedErrno} path failure as invalid selected-path input through the public Go CLI`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-go-cli-path-failure-");
      const { path, errno } = await createGoBinaryPathFailureFixture(
        root,
        expectedErrno,
      );
      const result = await runFileCli(cli, {
        arguments: ["inspect-go-binary", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "inspect_go_binary",
          issues: [
            {
              path: ["path"],
              reason: "invalid_value",
              message: expect.stringContaining(errno),
            },
          ],
        },
      });
      expect(result.json).toMatchObject({
        details: { issues: [{ message: expect.stringContaining(path) }] },
      });
    },
  );
}

cliTest(
  "preserves invalid embedded Go text bytes through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-cli-byte-strings-");
    const path = join(root, "byte-strings.elf");
    const fixture = createGoBinaryByteStringFixture();
    await writeFile(path, fixture.bytes);
    const result = await runFileCli(cli, {
      arguments: ["inspect-go-binary", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
    expect(evidence.normalized_result.build_info).toEqual(
      fixture.expectedBuildInfo,
    );
  },
);

for (const fixture of createGoBinaryDiagnosticFixtures()) {
  cliTest(
    `reports ${fixture.code} for ${fixture.name} through the public Go CLI`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-go-cli-mz-");
      const path = join(root, `${fixture.name}.exe`);
      await writeFile(path, fixture.bytes);
      const result = await runFileCli(cli, {
        arguments: ["inspect-go-binary", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: fixture.code,
        details: {
          ...fixture.details,
          ...(fixture.code === "unsupported_target" ? { path } : {}),
        },
      });
    },
  );
}

cliTest(
  "reports a readable unsupported carrier through the public Go CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-cli-");
    const path = join(root, "text.bin");
    await writeFile(path, "This is not an executable container.");
    const result = await runFileCli(cli, {
      arguments: ["inspect-go-binary", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "unsupported_target",
      details: { operation: "inspect_go_binary", path },
    });
  },
);

for (const format of ["elf", "pe", "macho"] as const) {
  for (const encoding of ["inline", "pointer"] as const) {
    cliTest(
      `inspects authored ${format} ${encoding} build metadata through the compiled CLI`,
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-go-cli-");
        const fixture = createGoBinaryFixture({ format, encoding });
        const path = join(root, "application.bin");
        await writeFile(path, fixture.bytes);
        const result = await runFileCli(cli, {
          arguments: ["inspect-go-binary", "application.bin", "--json"],
          cwd: root,
        });
        expect(result.exitCode, result.stderr).toBe(0);
        const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
        expect(evidence.raw_result).toBeNull();
        expect(evidence.subject?.local_path).toBe(path);
        expect(evidence.subject?.digest.sha256).toBe(
          createHash("sha256").update(fixture.bytes).digest("hex"),
        );
        const report = evidence.normalized_result;
        expect(report).toMatchObject({
          format,
          bits: 64,
          byte_order: "little",
          artifact: { path, bytes: fixture.bytes.length },
        });
        expect(report.build_info).toMatchObject({
          header_offset: fixture.headerOffset,
          encoding,
          go_version: "go1.26.0",
          module_text: GO_MODULE_TEXT,
          module_bytes_base64: fixture.moduleBytes.toString("base64"),
          module: {
            path: "example.com/tool/cmd/tool",
            main: {
              path: "example.com/tool",
              version: "(devel)",
              sum: "",
              replacement: null,
            },
            dependencies: [
              {
                path: "example.com/dependency",
                version: "v1.2.3",
                sum: "h1:sample",
                replacement: { path: "../dependency", version: "", sum: "" },
              },
            ],
            complete: true,
            unparsed_lines: [],
          },
        });
        expect(report.build_info?.module.settings).toContainEqual({
          key: "-ldflags",
          value: "-s -w",
        });
        if (report.build_info === null)
          throw new Error("Fixture build metadata must be present");
        const version = report.build_info.version_location;
        const module = report.build_info.module_location;
        expect(
          fixture.bytes
            .subarray(version.offset, version.offset + version.bytes)
            .toString("utf8"),
        ).toBe(report.build_info.go_version);
        expect(
          Buffer.compare(
            fixture.bytes.subarray(module.offset, module.offset + module.bytes),
            Buffer.from(report.build_info.module_bytes_base64, "base64"),
          ),
        ).toBe(0);
      },
    );
  }
}

cliTest("preserves MIPS identity in Go CLI Evidence", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-go-cli-mips-");
  const fixture = createGoBinaryFixture();
  fixture.bytes.writeUInt16LE(8, 18); // ELF EM_MIPS.
  const path = join(root, "application.elf");
  await writeFile(path, fixture.bytes);
  const result = await runFileCli(cli, {
    arguments: ["inspect-go-binary", path, "--json"],
  });
  expect(result.exitCode, result.stderr).toBe(0);
  const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
  expect(evidence.subject?.architecture).toBe("mips");
  expect(evidence.normalized_result).toMatchObject({
    architecture: "mips",
    bits: 64,
    byte_order: "little",
  });
});

cliTest(
  "reports missing build information as unknown and preserves unsupported carriers distinctly",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-go-cli-");
    const path = join(root, "metadata-free.elf");
    await writeFile(path, createGoBinaryFixture({ omitBuildInfo: true }).bytes);
    const result = await runFileCli(cli, {
      arguments: ["inspect-go-binary", path, "--json"],
    });
    expect(result.exitCode).toBe(0);
    const report = evidenceResultOf(goBinarySchema).parse(
      result.json,
    ).normalized_result;
    expect(report.build_info).toBeNull();
    expect(report.limitations.join(" ")).toContain(
      "does not establish that the binary is not Go",
    );
  },
);

cliTest(
  "returns unknown dependency coverage for parse-complete GOPATH metadata in CLI Evidence",
  async ({ cli }) => {
    const moduleText =
      "path\texample.com/tool/cmd/tool\n" +
      "build\t-compiler=gc\n" +
      "build\tGOOS=linux\n";
    const root = await createTestTempDirectory("rea-go-gopath-cli-");
    const path = join(root, "application.elf");
    await writeFile(path, createGoBinaryFixture({ moduleText }).bytes);
    const result = await runFileCli(cli, {
      arguments: ["inspect-go-binary", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = evidenceResultOf(goBinarySchema).parse(result.json);
    expect(evidence.normalized_result.build_info?.module).toMatchObject({
      path: "example.com/tool/cmd/tool",
      main: null,
      dependencies: [],
      complete: true,
      unparsed_lines: [],
    });
    expect(evidence.limitations.join(" ")).toContain(
      "Dependency coverage is unknown",
    );
  },
);
