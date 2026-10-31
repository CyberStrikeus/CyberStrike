import {
  gnuBuildIdNote,
  compressedElfNoteSectionFixture,
} from "../../src/native/elf/ElfNotes.fixture.js";
import { createHash } from "node:crypto";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { flutterResultSchemas } from "../../src/domain/flutter/flutterBuildAnalysis.js";
import {
  aotFixtureImage,
  strippedAotFixtureImage,
  engineFixtureImage,
  REFERENCE_HASH,
  appendElfRanges,
} from "../../src/flutter/FlutterBuild.fixture.js";
import {
  createFlutterApk,
  createDuplicateFlutterApk,
} from "../fixtures/flutterApk.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { expectCliMcpEvidenceParity } from "../fixtures/cliMcpEvidenceParity.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "CLI and stdio MCP preserve AOT facts and exact artifact identity across ignored DT_BIND_NOW values",
  async ({ cli }) => {
    const { call } = await connectLocalToolsMcp();
    const reports = [];
    const digests = [];
    for (const ignoredValue of [0n, 0xffffffffffffffffn]) {
      const image = strippedAotFixtureImage([[24, ignoredValue]]);
      const path = await createFlutterApk(
        `bind-now-${String(ignoredValue)}.apk`,
        [{ path: "lib/x86_64/libapp.so", bytes: image }],
      );
      const result = await cli.run({
        arguments: ["inspect-dart-aot", path, "--abi", "x86_64", "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = toolContract("inspect_dart_aot").outputSchema.parse(
        result.json,
      );
      const report = flutterResultSchemas.inspect_dart_aot.parse(
        evidence.normalized_result,
      );
      const response = await call("inspect_dart_aot", { path, abi: "x86_64" });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(evidence, response.structuredContent, path);
      const digest = createHash("sha256").update(image).digest("hex");
      expect(report).toMatchObject({
        coverage: "complete",
        libapp: {
          sha256: digest,
          coverage: "complete",
          snapshot_hash: REFERENCE_HASH,
          snapshot_hash_sources: 2,
        },
        string_pool: {
          coverage: "complete",
          package_uris: ["package:example/main.dart"],
        },
      });
      expect(report.libapp.sections).toHaveLength(4);
      expect(evidence.subject).toMatchObject({
        local_path: path,
        digest: { sha256: report.target.sha256 },
      });
      reports.push({
        sections: report.libapp.sections,
        string_pool: report.string_pool,
      });
      digests.push(digest);
    }
    expect(reports[1]).toEqual(reports[0]);
    expect(digests[1]).not.toBe(digests[0]);
  },
);

cliTest(
  "CLI and stdio MCP retain Flutter identity, selected ABI and duplicate-member refusals",
  async ({ cli }) => {
    const image = aotFixtureImage();
    Buffer.from("Login\0").copy(image, 0x2300);
    const engine = engineFixtureImage({
      notes: Buffer.from(
        "040000000800000003000000474e55000123456789abcdef",
        "hex",
      ),
      prefix: Buffer.from(
        "040000000800000003000000474e55001111111111111111",
        "hex",
      ),
      labels: ["Android (test) clang version 9.0.8"],
    });
    const path = await createFlutterApk("selected target.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: image },
      {
        path: "lib/arm64-v8a/libflutter.so",
        bytes: engine,
      },
      { path: "lib/x86_64/libapp.so", bytes: image },
      {
        path: "lib/x86_64/libflutter.so",
        bytes: engine,
      },
    ]);
    const { call } = await connectLocalToolsMcp();
    for (const [name, abi] of [
      ["identify_flutter_build", undefined],
      ["inspect_dart_aot", undefined],
      ["inspect_dart_aot", "x86_64"],
    ] as const) {
      const result = await cli.run({
        arguments: [
          name.replaceAll("_", "-"),
          path,
          "--json",
          ...(abi === undefined ? [] : ["--abi", abi]),
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = toolContract(name).outputSchema.parse(result.json);
      const complete = flutterResultSchemas[name].parse(
        evidence.normalized_result,
      );
      const response = await call(name, {
        path,
        ...(abi === undefined ? {} : { abi }),
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const mcp = parseEvidence(response.structuredContent);
      expect(mcp.normalized_result).toEqual(evidence.normalized_result);
      expect(mcp.subject).toEqual(evidence.subject);
      expect(mcp.subject).toMatchObject({
        local_path: path,
        format: "apk",
        digest: { sha256: complete.target.sha256 },
      });
      expect(mcp.evidence_id).toBe(evidence.evidence_id);
      if (name === "inspect_dart_aot") {
        expect(evidence.normalized_result).toMatchObject({
          abi: abi ?? "arm64-v8a",
          libapp: {
            coverage: "complete",
            snapshot_hash: REFERENCE_HASH,
            sha256: createHash("sha256").update(image).digest("hex"),
          },
          string_pool: {
            coverage: "complete",
            class_like_tokens: expect.arrayContaining(["Login"]),
          },
        });
      } else {
        const identified = toolContract(
          "identify_flutter_build",
        ).outputSchema.parse(result.json).normalized_result;
        expect(identified.coverage).toBe("complete");
        expect(identified.abis.map(({ abi }) => abi).sort()).toEqual([
          "arm64-v8a",
          "x86_64",
        ]);
        for (const abi of identified.abis) {
          expect(abi.libflutter).toMatchObject({
            build_id: "0123456789abcdef",
            build_id_candidates: ["0123456789abcdef"],
          });
        }
      }
    }
    const duplicate = await createDuplicateFlutterApk();
    for (const name of [
      "identify_flutter_build",
      "inspect_dart_aot",
    ] as const) {
      const result = await cli.run({
        arguments: [name.replaceAll("_", "-"), duplicate, "--json"],
      });
      expect(result.exitCode).toBe(1);
      const mcp = parseMcpToolError(await call(name, { path: duplicate }));
      expect(mcp.error).toEqual(result.json);
      expect(mcp.error).toMatchObject({
        code: "invalid_request",
        details: { issues: [{ message: expect.stringContaining(duplicate) }] },
      });
    }
  },
);

cliTest(
  "CLI and MCP retain unsupported snapshot kinds as partial evidence",
  async ({ cli }) => {
    const image = aotFixtureImage();
    for (const offset of [0x1000, 0x2000])
      image.writeBigUInt64LE(4n, offset + 12);
    const path = await createFlutterApk("unsupported-kind.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: image },
    ]);
    const result = await cli.run({
      arguments: ["inspect-dart-aot", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_dart_aot").outputSchema.parse(
      result.json,
    );
    const complete = flutterResultSchemas.inspect_dart_aot.parse(
      evidence.normalized_result,
    );
    const { call } = await connectLocalToolsMcp();
    const response = await call("inspect_dart_aot", { path });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(parseEvidence(response.structuredContent).normalized_result).toEqual(
      evidence.normalized_result,
    );
    expect(evidence.normalized_result).toMatchObject({
      coverage: "partial",
      libapp: { coverage: "partial", snapshot_hash: REFERENCE_HASH },
      string_pool: { coverage: "complete" },
    });
    expect(
      complete.libapp.sections
        .filter((section) => section.name.endsWith("Data"))
        .map((section) => section.kind),
    ).toEqual([4, 4]);
  },
);

cliTest(
  "CLI and MCP qualify conflicting load mappings and bounded ELF notes",
  async ({ cli }) => {
    const note = Buffer.from(
      "040000000800000003000000474e55000123456789abcdef",
      "hex",
    );
    const engine = engineFixtureImage({
      notes: Buffer.concat([note, Buffer.alloc(2000)]),
    });
    const denseEngine = appendElfRanges(
      engine,
      "program",
      Array.from({ length: 2000 }, (_, index) => ({
        type: 4,
        offset: 0x400 + note.length + index,
        size: 1,
      })),
    );
    const { call } = await connectLocalToolsMcp();
    for (const conflict of [false, true]) {
      const image = appendElfRanges(aotFixtureImage(), "program", [
        {
          type: 1,
          address: 0x2010,
          offset: conflict ? 0x1010 : 0x2010,
          size: 4,
        },
      ]);
      const path = await createFlutterApk(`load-${String(conflict)}.apk`, [
        { path: "lib/x86_64/libapp.so", bytes: image },
        {
          path: "lib/x86_64/libflutter.so",
          bytes: conflict ? denseEngine : engine,
        },
      ]);
      for (const name of [
        "inspect_dart_aot",
        "identify_flutter_build",
      ] as const) {
        const result = await cli.run({
          arguments: [name.replaceAll("_", "-"), path, "--json"],
        });
        expect(result.exitCode, result.stderr).toBe(0);
        const evidence = toolContract(name).outputSchema.parse(result.json);
        const response = await call(name, { path });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        const mcp = parseEvidence(response.structuredContent);
        expect(mcp.normalized_result).toEqual(evidence.normalized_result);
        expect(mcp.evidence_id).toBe(evidence.evidence_id);
        expect(mcp.subject).toEqual(evidence.subject);
        expect(mcp.limitations).toEqual(evidence.limitations);
        expect(evidence.normalized_result.coverage).toBe(
          conflict ? "partial" : "complete",
        );
        if (name === "inspect_dart_aot") {
          const facts = flutterResultSchemas[name].parse(
            evidence.normalized_result,
          );
          expect(facts.libapp.sections).toHaveLength(conflict ? 3 : 4);
          expect(facts.string_pool.coverage).toBe(
            conflict ? "partial" : "complete",
          );
          if (conflict) {
            expect(facts.string_pool.package_uris).toEqual([]);
            expect(evidence.limitations.join("\n")).toContain(
              "conflicting PT_LOAD",
            );
          }
        } else {
          const facts = flutterResultSchemas[name].parse(
            evidence.normalized_result,
          );
          expect(facts.abis[0]?.libflutter).toMatchObject({
            build_id: conflict ? null : "0123456789abcdef",
            build_id_candidates: ["0123456789abcdef"],
          });
          if (conflict)
            expect(evidence.limitations.join("\n")).toContain("note-range");
        }
      }
    }
  },
);

cliTest(
  "CLI and stdio MCP preserve byte-sized GNU build IDs and descriptor coverage",
  async ({ cli }) => {
    const { call } = await connectLocalToolsMcp();
    for (const bytes of [0, 1, 2, 3, 64, 65]) {
      const hex = "ab".repeat(bytes);
      const path = await createFlutterApk(`engine-${bytes}.apk`, [
        { path: "lib/arm64-v8a/libapp.so", bytes: aotFixtureImage() },
        {
          path: "lib/arm64-v8a/libflutter.so",
          bytes: engineFixtureImage({ notes: gnuBuildIdNote(hex) }),
        },
      ]);
      const output = await cli.run({
        arguments: ["identify-flutter-build", path, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const cliEvidence = parseEvidence(output.json);
      const response = await call("identify_flutter_build", { path });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const mcpEvidence = parseEvidence(response.structuredContent);
      expect(mcpEvidence.normalized_result).toEqual(
        cliEvidence.normalized_result,
      );
      const result = flutterResultSchemas.identify_flutter_build.parse(
        cliEvidence.normalized_result,
      );
      const admitted = bytes > 0 && bytes <= 64;
      expect(result.abis[0]?.libflutter).toMatchObject({
        build_id: admitted ? hex : null,
        build_id_candidates: admitted ? [hex] : [],
      });
      expect(result.coverage).toBe(admitted ? "complete" : "partial");
      if (!admitted)
        expect(cliEvidence.limitations.join("\n")).toContain(
          "1–64 byte projection",
        );
    }
  },
);

cliTest(
  "CLI and stdio MCP retain Flutter build-ID candidates with unsupported compressed notes",
  async ({ cli }) => {
    const compressed = appendElfRanges(
      compressedElfNoteSectionFixture(),
      "program",
      [{ type: 1, offset: 0, size: 0 }],
    );
    const note = gnuBuildIdNote("0123456789abcdef");
    const engine = appendElfRanges(
      Buffer.concat([compressed, note]),
      "section",
      [{ type: 7, offset: compressed.length, size: note.length }],
    );
    const path = await createFlutterApk("compressed-notes.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotFixtureImage() },
      { path: "lib/arm64-v8a/libflutter.so", bytes: engine },
    ]);
    const output = await cli.run({
      arguments: ["identify-flutter-build", path, "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const cliEvidence = parseEvidence(output.json);
    const { call } = await connectLocalToolsMcp();
    const response = await call("identify_flutter_build", { path });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const mcpEvidence = parseEvidence(response.structuredContent);
    expect(mcpEvidence.normalized_result).toEqual(
      cliEvidence.normalized_result,
    );
    const result = flutterResultSchemas.identify_flutter_build.parse(
      cliEvidence.normalized_result,
    );
    expect(result).toMatchObject({
      coverage: "partial",
      abis: [
        {
          libflutter: {
            sha256: createHash("sha256").update(engine).digest("hex"),
            build_id: null,
            build_id_candidates: ["0123456789abcdef"],
          },
        },
      ],
    });
    for (const evidence of [cliEvidence, mcpEvidence])
      expect(evidence.limitations.join("\n")).toContain(
        "Compressed ELF note sections are unsupported",
      );
  },
);
