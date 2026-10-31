import { rustBinarySchema } from "../../src/domain/rust/rustBinary.js";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { machoImageWithUnknownCommand } from "../../src/artifacts/apple/MachoImage.fixture.js";
import {
  compressRustElfSectionNames,
  createRustImage,
  createRustImageWithGoSection,
  RUSTC_HASH,
  rustDependencyPayload,
} from "../fixtures/rust/image.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { expectCliMcpEvidenceParity } from "../fixtures/cliMcpEvidenceParity.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";

cliTest(
  "rejects misaligned 64-bit Mach-O through Rust CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-macho-alignment-");
    const { client, call } = await connectLocalToolsMcp();
    const expectedFailure = {
      code: "invalid_request",
      details: {
        operation: "inspect_rust_binary",
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
      const result = await cli.run({
        arguments: ["inspect-rust-binary", path, "--json"],
      });
      const response = await call("inspect_rust_binary", { path });

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
      const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
        result.json,
      );
      expect(evidence.normalized_result).toMatchObject({
        format: "macho",
        bits: fixture.bits,
        auditable_metadata: null,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
    }
    await client.ping();
  },
  30000,
);

cliTest(
  "reports cargo-auditable packages through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-cli-");
    const path = join(root, "sample");
    await writeFile(path, createRustImage({ format: "macho" }));
    const result = await cli.run({
      arguments: ["inspect-rust-binary", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
      result.json,
    );
    expect(
      rustBinarySchema.parse(evidence.normalized_result).auditable_metadata,
    ).toMatchObject({
      section_name: "__DATA,.dep-v0",
      format_version: 1,
      root_package_index: 1,
      packages: [
        { name: "itoa", version: "1.0.18" },
        { name: "sample", version: "0.1.0", root: true },
      ],
    });
  },
);

cliTest(
  "preserves historical cargo-auditable features through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-features-legacy-");
    const { client, call } = await connectLocalToolsMcp();
    const validCases = [
      {
        name: "features",
        document: {
          packages: [
            {
              name: "legacy_dep",
              version: "1.2.3",
              source: "crates.io",
              features: ["default", "serde"],
            },
            {
              name: "app",
              version: "0.1.0",
              source: "local",
              dependencies: [0],
              root: true,
            },
          ],
        },
        features: ["default", "serde"],
      },
      {
        name: "omitted-features-unknown",
        document: {
          packages: [
            {
              name: "legacy_dep",
              version: "1.2.3",
              source: "crates.io",
            },
          ],
        },
        features: null,
      },
      {
        name: "explicit-empty-features",
        document: {
          packages: [
            {
              name: "legacy_dep",
              version: "1.2.3",
              source: "crates.io",
              features: [],
            },
          ],
        },
        features: [],
      },
    ];
    const malformedPath = join(root, "invalid-features.elf");
    await writeFile(
      malformedPath,
      createRustImage({
        format: "elf",
        payload: rustDependencyPayload({
          packages: [
            {
              name: "legacy_dep",
              version: "1.2.3",
              source: "crates.io",
              features: ["default", 7],
            },
          ],
        }),
      }),
    );

    for (const surface of ["cli", "mcp"] as const) {
      for (const fixture of validCases) {
        const path = join(root, `${fixture.name}.elf`);
        await writeFile(
          path,
          createRustImage({
            format: "elf",
            payload: rustDependencyPayload(fixture.document),
          }),
        );
        if (surface === "cli") {
          const response = await cli.run({
            arguments: ["inspect-rust-binary", path, "--json"],
          });
          expect(response.exitCode, response.stderr).toBe(0);
          const evidence = toolContract(
            "inspect_rust_binary",
          ).outputSchema.parse(response.json);
          expect(
            rustBinarySchema.parse(evidence.normalized_result)
              .auditable_metadata?.packages[0]?.features,
          ).toEqual(fixture.features);
        } else {
          const response = await call("inspect_rust_binary", { path });
          expect(response.isError, JSON.stringify(response)).not.toBe(true);
          const evidence = toolContract(
            "inspect_rust_binary",
          ).outputSchema.parse(response.structuredContent);
          expect(
            rustBinarySchema.parse(evidence.normalized_result)
              .auditable_metadata?.packages[0]?.features,
          ).toEqual(fixture.features);
        }
      }

      if (surface === "cli") {
        const response = await cli.run({
          arguments: ["inspect-rust-binary", malformedPath, "--json"],
        });
        expect(response.exitCode).toBe(1);
        expect(response.json).toMatchObject({
          code: "invalid_request",
          details: {
            operation: "inspect_rust_binary",
            issues: [{ path: ["path"], reason: "invalid_format" }],
          },
        });
      } else {
        const response = await call("inspect_rust_binary", {
          path: malformedPath,
        });
        expect(response.isError).toBe(true);
        expect(parseMcpToolError(response).error).toMatchObject({
          code: "invalid_request",
          details: {
            operation: "inspect_rust_binary",
            issues: [{ path: ["path"], reason: "invalid_format" }],
          },
        });
      }
    }
    await client.ping();
  },
  30000,
);

cliTest("returns null metadata when .dep-v0 is absent", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-rust-cli-missing-");
  const path = join(root, "plain");
  await writeFile(path, createRustImage({ format: "elf", omitSection: true }));
  const result = await cli.run({
    arguments: ["inspect-rust-binary", path, "--json"],
  });
  expect(result.exitCode, result.stderr).toBe(0);
  const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
    result.json,
  );
  const report = rustBinarySchema.parse(evidence.normalized_result);
  expect(report.auditable_metadata).toBeNull();
  expect(report.limitations.join("\n")).toContain(
    "does not mean the binary has no dependencies",
  );
});

cliTest(
  "reads compressed ELF names and keeps unsupported compression unknown",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-rust-elf-compressed-names-",
    );
    for (const fixture of [
      { name: "zlib", type: 1, supported: true },
      { name: "zstd", type: 2, supported: true },
      { name: "unknown", type: 3, supported: false },
    ]) {
      const path = join(root, `${fixture.name}.elf`);
      await writeFile(
        path,
        compressRustElfSectionNames(
          createRustImage({ format: "elf" }),
          fixture.type,
        ),
      );
      const result = await cli.run({
        arguments: ["inspect-rust-binary", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
        result.json,
      );
      const report = rustBinarySchema.parse(evidence.normalized_result);
      if (fixture.supported) {
        expect(report.auditable_metadata).toMatchObject({
          section_name: ".dep-v0",
          packages: [
            { name: "itoa", version: "1.0.18" },
            { name: "sample", version: "0.1.0", root: true },
          ],
          dependency_edges: [{ from_index: 1, to_index: 0 }],
        });
      } else {
        expect(report.auditable_metadata).toBeNull();
        expect(report.limitations.join("\n")).toContain(
          "ELF section names are unavailable because compression type 3 is unsupported",
        );
        expect(report.limitations.join("\n")).toContain(
          "The presence of .dep-v0 could not be determined",
        );
        expect(report.limitations.join("\n")).not.toContain(
          "No .dep-v0 section was found",
        );
      }
    }
  },
);

cliTest(
  "keeps arm64_32 in Rust CLI Evidence when dependency metadata is absent",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-arm64-32-");
    const path = join(root, "watchos-object");
    const bytes = createRustImage({
      format: "macho",
      omitSection: true,
      includeRustc: false,
    });
    bytes.writeUInt32LE(0x0200000c, 4);
    await writeFile(path, bytes);

    const result = await cli.run({
      arguments: ["inspect-rust-binary", path, "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
      result.json,
    );
    expect(evidence.subject).toMatchObject({
      format: "mach-o",
      architecture: "arm64_32",
    });
    expect(rustBinarySchema.parse(evidence.normalized_result)).toMatchObject({
      architecture: "arm64_32",
      bits: 64,
      auditable_metadata: null,
    });
  },
);

cliTest(
  "preserves an unknown cargo-auditable revision and reports its fallback",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-cli-unknown-format-");
    const path = join(root, "sample");
    const payload = rustDependencyPayload({
      format: 4,
      packages: [
        { name: "sample", version: "0.1.0", source: "local", root: true },
      ],
    });
    await writeFile(path, createRustImage({ format: "elf", payload }));
    const result = await cli.run({
      arguments: ["inspect-rust-binary", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
      result.json,
    );
    const report = rustBinarySchema.parse(evidence.normalized_result);
    expect(report.auditable_metadata?.format_version).toBe(4);
    expect(report.limitations.join("\n")).toContain(
      "highest known preceding revision (1)",
    );
    expect(report.limitations.join("\n")).toContain(
      "this specific revision has not been independently verified",
    );
  },
);

cliTest("reports malformed zlib as invalid input", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-rust-cli-zlib-");
  const path = join(root, "broken.elf");
  await writeFile(
    path,
    createRustImage({
      format: "elf",
      payload: deflateSync(Buffer.from("{")),
      includeRustc: false,
    }),
  );
  const result = await cli.run({
    arguments: ["inspect-rust-binary", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    details: { operation: "inspect_rust_binary" },
  });
});

cliTest(
  "rejects duplicate Rust dependency JSON through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-cli-duplicate-json-");
    const { client, call } = await connectLocalToolsMcp();
    const path = join(root, "duplicate.elf");
    await writeFile(
      path,
      createRustImage({
        format: "elf",
        payload: deflateSync(Buffer.from('{"packages":[],"packages":[]}')),
        includeRustc: false,
      }),
    );

    const result = await cli.run({
      arguments: ["inspect-rust-binary", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: { operation: "inspect_rust_binary" },
    });
    const response = await call("inspect_rust_binary", { path });
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "invalid_request",
      details: { operation: "inspect_rust_binary" },
    });
    await client.ping();
  },
  30000,
);

cliTest(
  "reads PE cargo-auditable data padded to FileAlignment through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-cli-pe-padding-");
    const { client, call } = await connectLocalToolsMcp();
    const path = join(root, "padded.exe");
    const bytes = createRustImage({ format: "pe", includeRustc: false });
    const compressedBytes = rustDependencyPayload().length;
    const alignedSize = 512;
    expect(compressedBytes).toBeLessThan(alignedSize);
    bytes.writeUInt32LE(alignedSize, 152 + 36); // OptionalHeader.FileAlignment
    bytes.writeUInt32LE(0, 264 + 8); // .dep-v0 VirtualSize
    bytes.writeUInt32LE(alignedSize, 264 + 16); // .dep-v0 SizeOfRawData
    await writeFile(path, bytes);

    const result = await cli.run({
      arguments: ["inspect-rust-binary", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
      result.json,
    );
    const metadata = rustBinarySchema.parse(
      evidence.normalized_result,
    ).auditable_metadata;
    expect(metadata).toMatchObject({
      section_bytes: alignedSize,
      compressed_bytes: compressedBytes,
      packages: [
        { name: "itoa", version: "1.0.18" },
        { name: "sample", version: "0.1.0", root: true },
      ],
    });
    expect(metadata?.uncompressed_bytes).toBeLessThanOrEqual(
      (metadata?.compressed_bytes ?? 0) * 64,
    );
    expect(evidence.locations).toContainEqual({
      kind: "file-offset-range",
      start: metadata?.file_offset,
      end: (metadata?.file_offset ?? 0) + alignedSize,
    });
    const response = await call("inspect_rust_binary", { path });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
    await client.ping();
  },
  30000,
);

cliTest(
  "limits PE inflate ratio by consumed zlib bytes through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-cli-pe-ratio-");
    const { client, call } = await connectLocalToolsMcp();
    const path = join(root, "over-ratio.exe");
    const document = Buffer.concat([
      Buffer.from(JSON.stringify({ packages: [] })),
      Buffer.alloc(24 * 1024, 0x20),
    ]);
    const compressed = deflateSync(document);
    const alignedSize = 512;
    expect(compressed.length).toBeLessThan(alignedSize);
    expect(document.length).toBeGreaterThan(compressed.length * 64);
    expect(document.length).toBeLessThanOrEqual(alignedSize * 64);

    const bytes = createRustImage({
      format: "pe",
      payload: compressed,
      includeRustc: false,
    });
    bytes.writeUInt32LE(alignedSize, 152 + 36); // OptionalHeader.FileAlignment
    bytes.writeUInt32LE(0, 264 + 8); // .dep-v0 VirtualSize
    bytes.writeUInt32LE(alignedSize, 264 + 16); // .dep-v0 SizeOfRawData
    await writeFile(path, bytes);

    const expectedFailure = {
      code: "resource_constraint",
      retryable: false,
      details: {
        operation: "inspect_rust_binary",
        resource: "memory",
        reported_limits: { maximum_bytes: compressed.length * 64 },
      },
    };
    const result = await cli.run({
      arguments: ["inspect-rust-binary", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject(expectedFailure);
    const response = await call("inspect_rust_binary", { path });
    expect(parseMcpToolError(response).error).toMatchObject(expectedFailure);
    await client.ping();
  },
  30000,
);

cliTest(
  "releases a failed Rust descriptor close before projecting the CLI failure",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-cli-close-");
    const path = join(root, "sample.elf");
    const marker = join(root, "close-events.json");
    const preload = join(root, "deny-first-close.mjs");
    const bytes = createRustImage({ format: "elf" });
    await writeFile(path, bytes);
    await writeFile(
      preload,
      `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const open = fs.promises.open;
    const events = [];
    let denied = false;
    let opened = 0;
    fs.promises.open = async (...args) => {
      const file = await open(...args);
      if (String(args[0]) !== process.env.REA_TEST_SELECTED_FILE) return file;
      const handleId = opened++;
      events.push({ stage: 'opened', handleId });
      const close = file.close.bind(file);
      let releaseObserved = false;
      file.close = async () => {
        if (!denied) {
          denied = true;
          events.push({ stage: 'denied', handleId, open: file.fd >= 0 });
          fs.writeFileSync(process.env.REA_TEST_CLOSE_EVENTS, JSON.stringify(events));
          throw new Error('controlled Rust descriptor close failure');
        }
        await close();
        // Node can re-enter close while notifying its attached read stream.
        // Record the descriptor's completed transition once per exact handle.
        if (!releaseObserved) {
          releaseObserved = true;
          events.push({ stage: 'released', handleId, fd: file.fd });
          fs.writeFileSync(process.env.REA_TEST_CLOSE_EVENTS, JSON.stringify(events));
        }
      };
      return file;
    };
    syncBuiltinESMExports();
  `,
    );
    const result = await cli.run({
      arguments: ["inspect-rust-binary", path, "--json"],
      environment: {
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        REA_TEST_SELECTED_FILE: path,
        REA_TEST_CLOSE_EVENTS: marker,
      },
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(result.json).toHaveProperty("code");
    expect(result.json).not.toMatchObject({ code: "cleanup_incomplete" });
    expect(JSON.parse(await readFile(marker, "utf8"))).toEqual([
      { stage: "opened", handleId: 0 },
      { stage: "denied", handleId: 0, open: true },
      { stage: "released", handleId: 0, fd: -1 },
    ]);
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);

cliTest(
  "keeps Rust evidence independent of Go section errors through public CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rust-cli-go-section-");
    const { client, call } = await connectLocalToolsMcp();
    for (const [format, fault, code] of [
      ["elf", "compressed", "unsupported_target"],
      ["elf", "zero-address", "invalid_request"],
      ["macho", "zero-fill", "invalid_request"],
    ] as const) {
      const bytes = createRustImageWithGoSection(format, fault);
      if (fault === "zero-address") {
        const sectionHeader = 512;
        expect(bytes.readUInt32LE(sectionHeader + 4)).toBe(1);
        expect(bytes.readBigUInt64LE(sectionHeader + 8)).toBe(0n);
        expect(bytes.readBigUInt64LE(sectionHeader + 16)).toBe(0n);
        expect(bytes.readBigUInt64LE(sectionHeader + 24)).toBe(3072n);
        expect(bytes.readBigUInt64LE(sectionHeader + 32)).toBe(16n);
        const nameOffset = bytes.readUInt32LE(sectionHeader);
        expect(
          bytes.toString(
            "ascii",
            768 + nameOffset,
            768 + nameOffset + ".go.buildinfo".length,
          ),
        ).toBe(".go.buildinfo");
      }
      const path = join(root, `mixed.${format}`);
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-rust-binary", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
        result.json,
      );
      expect(evidence.normalized_result).toMatchObject({
        artifact: {
          path,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        },
        format,
        auditable_metadata: {
          file_offset: 1024,
          root_package_index: 1,
          packages: [
            { name: "itoa", version: "1.0.18" },
            { name: "sample", version: "0.1.0", root: true },
          ],
          dependency_edges: [{ from_index: 1, to_index: 0 }],
        },
        rustc_commit: {
          evidence_kind: "inferred",
          hashes: [{ hash: RUSTC_HASH, file_offset: 2048 }],
        },
      });
      const response = await call("inspect_rust_binary", { path });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
      const go = await cli.run({
        arguments: ["inspect-go-binary", path, "--json"],
      });
      expect(go.exitCode).toBe(1);
      expect(go.json).toMatchObject({
        code,
        details: { operation: "inspect_go_binary" },
      });
      if (fault === "zero-address")
        expect(go.json).toMatchObject({
          details: {
            issues: [{ path: ["path"], reason: "invalid_format" }],
          },
        });
      const goResponse = await call("inspect_go_binary", { path });
      expect(parseMcpToolError(goResponse).error).toMatchObject({
        code,
        details: { operation: "inspect_go_binary" },
      });
      if (fault === "zero-address")
        expect(parseMcpToolError(goResponse).error).toMatchObject({
          details: {
            issues: [{ path: ["path"], reason: "invalid_format" }],
          },
        });
    }
    await client.ping();
  },
  30000,
);
