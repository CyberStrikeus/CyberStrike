import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import { z } from "zod";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { goBinarySchema } from "../../../src/domain/go/goBinary.js";
import { rustBinarySchema } from "../../../src/domain/rust/rustBinary.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createGoBinaryFixture } from "../../fixtures/go/image.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createRustImage } from "../../fixtures/rust/image.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  CPU_ARM64,
  CPU_X86_64,
  universalMacho,
} from "../../fixtures/universalMacho.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

const sliceTest = mcpTest.extend<{
  slices: {
    client: Client;
    session: ReturnType<typeof createTestBinarySession>;
    write: (name: string, bytes: Buffer) => Promise<string>;
  };
}>({
  slices: async ({ mcp }, use) => {
    const session = createTestBinarySession(() => {
      throw new Error("Static metadata must not start a deep provider");
    });
    const root = await createTestTempDirectory("rea-universal-slice-");
    try {
      const client = await mcp.connect(
        createServer({ kind: "session", session }),
      );
      await use({
        client,
        session,
        write: async (name, bytes) => {
          const path = join(root, name);
          await writeFile(path, bytes);
          return path;
        },
      });
    } finally {
      await session.close();
    }
  },
});

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const goSlices = () => {
  const intel = createGoBinaryFixture({
    format: "macho",
    goVersion: "go1.25.0",
  });
  const arm = createGoBinaryFixture({ format: "macho", goVersion: "go1.26.1" });
  return {
    arm,
    universal: universalMacho([
      { bytes: intel.bytes, cpuType: CPU_X86_64, cpuSubtype: 3 },
      { bytes: arm.bytes, cpuType: CPU_ARM64, cpuSubtype: 0 },
    ]),
  };
};

const issues = (response: unknown) =>
  z
    .object({
      error: z.object({
        code: z.string(),
        details: z.object({
          issues: z.array(
            z.object({ path: z.array(z.string()), message: z.string() }),
          ),
        }),
      }),
    })
    .parse(parseMcpToolError(response as never)).error;

sliceTest(
  "reads the selected Go slice of a universal Mach-O with file-relative provenance",
  async ({ slices: { client, session, write } }) => {
    const { arm, universal } = goSlices();
    const path = await write("universal-go", universal.bytes);
    const advertised = (await client.listTools()).tools.find(
      ({ name }) => name === "inspect_go_binary",
    );
    if (advertised?.outputSchema === undefined)
      throw new Error("Missing advertised Go output schema");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(
      ajv.compile(advertised.inputSchema)({ path, architecture: "arm64" }),
    ).toBe(true);
    const validateOutput = ajv.compile(
      z.record(z.string(), z.unknown()).parse(advertised.outputSchema),
    );

    const response = await client.callTool({
      name: "inspect_go_binary",
      arguments: { path, architecture: "arm64" },
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    expect(
      validateOutput(response.structuredContent),
      JSON.stringify(validateOutput.errors),
    ).toBe(true);
    const evidence = toolContract("inspect_go_binary").outputSchema.parse(
      response.structuredContent,
    );
    const report = goBinarySchema.parse(evidence.normalized_result);
    const [, armSlice] = universal.slices;
    if (armSlice === undefined) throw new Error("Fixture lacks a slice");
    expect(report.artifact).toEqual({
      path,
      sha256: sha256(universal.bytes),
      bytes: universal.bytes.length,
    });
    expect(report.selected_slice).toEqual({
      kind: "macho-selected-image-v1",
      container: "fat",
      offset: armSlice.offset,
      byte_length: armSlice.size,
      cpu_type: CPU_ARM64,
      cpu_subtype: 0,
      container_table_sha256: sha256(
        universal.bytes.subarray(0, universal.tableBytes),
      ),
    });
    expect(report.build_info).toMatchObject({
      go_version: "go1.26.1",
      header_offset: armSlice.offset + arm.headerOffset,
      version_location: { offset: armSlice.offset + arm.versionOffset },
      module_location: { offset: armSlice.offset + arm.moduleOffset },
    });
    // File-relative ranges address the selected slice's bytes in the universal file.
    const version = report.build_info?.version_location;
    expect(
      universal.bytes
        .subarray(
          version?.offset,
          (version?.offset ?? 0) + (version?.bytes ?? 0),
        )
        .toString(),
    ).toBe("go1.26.1");
    expect(evidence.subject).toMatchObject({
      format: "mach-o-universal",
      architecture: "arm64",
      digest: { sha256: sha256(universal.bytes) },
    });
    expect(evidence.parameters).toEqual({ path, architecture: "arm64" });
    // A retained report cannot claim a slice its own container or CPU contradicts.
    for (const contradiction of [
      { architecture: "amd64" },
      { format: "elf" as const },
    ])
      expect(
        goBinarySchema.safeParse({ ...report, ...contradiction }).success,
      ).toBe(false);
    expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);

    const summary = await client.callTool({
      name: "inspect_go_binary",
      arguments: { path, architecture: "x86_64", detail: "summary" },
    });
    expect(summary.isError, JSON.stringify(summary.content)).not.toBe(true);
    expect(summary.structuredContent).toMatchObject({
      normalized_result: {
        kind: "summary",
        summary: {
          selected_slice: { cpu_type: CPU_X86_64, cpu_subtype: 3 },
          build_info: { go_version: "go1.25.0" },
        },
      },
    });
  },
);

sliceTest(
  "names the slices present when a universal selection is missing or does not match",
  async ({ slices: { client, write } }) => {
    const { universal } = goSlices();
    const path = await write("universal-go", universal.bytes);
    const available = "x86_64 (subtype 0x3), arm64 (subtype 0x0)";
    for (const [architecture, message] of [
      [
        undefined,
        `Universal Mach-O holds ${available}; select one architecture.`,
      ],
      ["x86", `Universal Mach-O holds ${available}, not x86.`],
    ] as const) {
      const response = await client.callTool({
        name: "inspect_go_binary",
        arguments: {
          path,
          ...(architecture === undefined ? {} : { architecture }),
        },
      });
      expect(issues(response)).toMatchObject({
        code: "invalid_request",
        details: { issues: [{ path: ["architecture"], message }] },
      });
    }

    const thin = await write(
      "thin-go",
      createGoBinaryFixture({ format: "macho" }).bytes,
    );
    expect(
      issues(
        await client.callTool({
          name: "inspect_go_binary",
          arguments: { path: thin, architecture: "arm64" },
        }),
      ),
    ).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["architecture"],
            message:
              "architecture arm64 was selected, but the file is not a universal Mach-O; omit architecture.",
          },
        ],
      },
    });

    const duplicate = await write(
      "duplicate-arm64",
      universalMacho([
        {
          bytes: createGoBinaryFixture({ format: "macho" }).bytes,
          cpuType: CPU_ARM64,
          cpuSubtype: 0,
        },
        {
          bytes: createGoBinaryFixture({ format: "macho" }).bytes,
          cpuType: CPU_ARM64,
          cpuSubtype: 2,
        },
      ]).bytes,
    );
    expect(
      issues(
        await client.callTool({
          name: "inspect_go_binary",
          arguments: { path: duplicate, architecture: "arm64" },
        }),
      ).details.issues[0]?.message,
    ).toBe(
      "Universal Mach-O holds several arm64 slices (arm64 (subtype 0x0), arm64 (subtype 0x2)); no slice was selected.",
    );

    // A slice that runs past the file is damaged, not a selection to correct.
    const truncated = universalMacho([
      {
        bytes: createGoBinaryFixture({ format: "macho" }).bytes,
        cpuType: CPU_ARM64,
        cpuSubtype: 0,
      },
    ]).bytes;
    truncated.writeUInt32BE(truncated.length, 8 + 12);
    const damaged = await write("damaged", truncated);
    for (const architecture of [undefined, "arm64"] as const)
      expect(
        issues(
          await client.callTool({
            name: "inspect_go_binary",
            arguments: {
              path: damaged,
              ...(architecture === undefined ? {} : { architecture }),
            },
          }),
        ).details.issues[0],
      ).toMatchObject({
        path: ["path"],
        message: expect.stringContaining(`Selected artifact ${damaged}: FAT`),
      });

    // The FAT table and the slice header must agree before the slice is read.
    const disagreeing = await write(
      "disagreeing",
      universalMacho([
        {
          bytes: createGoBinaryFixture({ format: "macho" }).bytes,
          cpuType: CPU_X86_64,
          cpuSubtype: 3,
          tableCpuType: CPU_ARM64,
        },
      ]).bytes,
    );
    expect(
      issues(
        await client.callTool({
          name: "inspect_go_binary",
          arguments: { path: disagreeing, architecture: "arm64" },
        }),
      ),
    ).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["path"],
            message: `Selected artifact ${disagreeing}: FAT architecture 0 CPU type/subtype disagrees with its Mach-O header`,
          },
        ],
      },
    });
  },
);

sliceTest(
  "reads the selected Rust slice and keeps section and rustc offsets in the universal file",
  async ({ slices: { client, write } }) => {
    const thin = createRustImage({ format: "macho", includeRustc: true });
    const universal = universalMacho([
      { bytes: thin, cpuType: CPU_X86_64, cpuSubtype: 3 },
      { bytes: thin, cpuType: CPU_ARM64, cpuSubtype: 0 },
    ]);
    const thinPath = await write("thin-rust", thin);
    const path = await write("universal-rust", universal.bytes);
    const thinResponse = await client.callTool({
      name: "inspect_rust_binary",
      arguments: { path: thinPath },
    });
    const response = await client.callTool({
      name: "inspect_rust_binary",
      arguments: { path, architecture: "arm64" },
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const contract = toolContract("inspect_rust_binary");
    const thinReport = rustBinarySchema.parse(
      contract.outputSchema.parse(thinResponse.structuredContent)
        .normalized_result,
    );
    const report = rustBinarySchema.parse(
      contract.outputSchema.parse(response.structuredContent).normalized_result,
    );
    const offset = universal.slices[1]?.offset ?? 0;
    expect(report.selected_slice).toMatchObject({
      offset,
      cpu_type: CPU_ARM64,
    });
    expect(report.auditable_metadata).toEqual({
      ...thinReport.auditable_metadata,
      file_offset: (thinReport.auditable_metadata?.file_offset ?? 0) + offset,
    });
    expect(report.rustc_commit?.hashes).toEqual(
      thinReport.rustc_commit?.hashes.map((entry) => ({
        ...entry,
        file_offset: entry.file_offset + offset,
      })),
    );
    expect(
      issues(
        await client.callTool({
          name: "inspect_rust_binary",
          arguments: { path },
        }),
      ).details.issues[0]?.path,
    ).toEqual(["architecture"]);
  },
);
