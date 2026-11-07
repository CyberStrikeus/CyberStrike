import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  buildNodeSeaBlob,
  nodeSeaElf,
  nodeSeaMachO,
  nodeSeaPe,
} from "../../src/artifacts/nodeSea/NodeSea.fixture.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";

cliTest.for(["elf", "mach-o", "pe"] as const)(
  "inventories and extracts %s SEA through the compiled CLI",
  async (carrier, { cli }) => {
    const root = await createTestTempDirectory("rea-sea-cli-");
    const source = join(root, "application");
    const build = { elf: nodeSeaElf, "mach-o": nodeSeaMachO, pe: nodeSeaPe }[
      carrier
    ];
    const script = 'throw new Error("must not execute");\n';
    await writeFile(
      source,
      build({
        codePath: "main.js",
        main: script,
        fuse: "unset",
        assets: [{ name: "data/hello.txt", body: "hello" }],
      }),
    );
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const graph = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    expect(graph.manifest.root_format).toBe("node-sea");
    expect(graph.coverage.status).toBe("complete");
    expect(
      graph.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject({
      kind: "node-sea",
      carrier,
      fuse_state: "unset",
      include_assets: true,
    });
    expect(graph.limitations.join(" ")).toContain("sentinel is unset");
    expect(
      graph.occurrences.find((row) => row.logical_path === "main.js"),
    ).toMatchObject({
      artifact_format: "javascript-bundle",
      hash_status: "verified",
    });
    expect(inspection.next_probes.map((probe) => probe.operation)).toContain(
      "analyze_javascript_application",
    );
    const extracted = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: root, TMP: root, TEMP: root },
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    expect(result.containment_verified).toBe(true);
    expect(await readFile(join(result.output_root, "main.js"), "utf8")).toBe(
      script,
    );
    expect(
      await readFile(join(result.output_root, "data/hello.txt"), "utf8"),
    ).toBe("hello");
  },
);

cliTest(
  "reads a real Node-produced SEA blob with an absolute main and empty asset key",
  async ({ cli, processes }) => {
    const root = await createTestTempDirectory("rea-sea-node-producer-");
    const mainPath = join(root, "main.cjs");
    const assetPath = join(root, "asset.txt");
    const blobPath = join(root, "preparation.blob");
    const configPath = join(root, "sea-config.json");
    const main = 'throw new Error("must not execute");\n';
    await writeFile(mainPath, main);
    await writeFile(assetPath, "empty-key asset");
    await writeFile(
      configPath,
      JSON.stringify({
        main: mainPath,
        output: blobPath,
        useSnapshot: false,
        useCodeCache: false,
        assets: { "": assetPath },
      }),
    );
    const generated = await processes.run(process.execPath, [
      "--experimental-sea-config",
      configPath,
    ]);
    expect(generated.exitCode, generated.stdout + generated.stderr).toBe(0);
    const source = join(root, "application");
    // Node produces the blob; only its ELF carrier is synthetic.
    await writeFile(source, nodeSeaElf({ blob: await readFile(blobPath) }));
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const graph = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    expect(graph.coverage.status).toBe("complete");
    expect(
      graph.occurrences.find(
        (row) => row.logical_path === "__node_sea__/main.cjs",
      ),
    ).toMatchObject({
      source_path: mainPath,
      artifact_format: "javascript-bundle",
    });
    expect(
      graph.occurrences.find(
        (row) => row.logical_path === "__node_sea__/assets/0",
      ),
    ).toMatchObject({ source_path: "", format_metadata: { source_path: "" } });
  },
);

cliTest(
  "preserves opaque SEA source keys through CLI and MCP inventory and extraction",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sea-opaque-public-");
    const source = join(root, "application");
    const main = Buffer.from("void 0;\n");
    const assets = [
      { name: "", body: "empty key" },
      { name: "../outside.txt", body: "parent key" },
      { name: "safe/data.txt", body: "safe key" },
      { name: "__node_sea__/main.cjs", body: "reserved key" },
      { name: "data/café.txt", body: "composed key" },
      { name: "data/cafe\u0301.txt", body: "decomposed key" },
    ];
    // The SEA blob follows Node's format; nodeSeaElf supplies a synthetic carrier.
    await writeFile(
      source,
      nodeSeaElf({
        blob: buildNodeSeaBlob({
          codePath: "/generated/main.cjs",
          main,
          assets,
        }),
      }),
    );

    const expected = [
      {
        path: "__node_sea__/main.cjs",
        source: "/generated/main.cjs",
        body: main,
      },
      {
        path: "__node_sea__/assets/0",
        source: "",
        body: Buffer.from("empty key"),
      },
      {
        path: "__node_sea__/assets/1",
        source: "../outside.txt",
        body: Buffer.from("parent key"),
      },
      {
        path: "safe/data.txt",
        source: "safe/data.txt",
        body: Buffer.from("safe key"),
      },
      {
        path: "__node_sea__/assets/3",
        source: "__node_sea__/main.cjs",
        body: Buffer.from("reserved key"),
      },
      {
        path: "data/café.txt",
        source: "data/café.txt",
        body: Buffer.from("composed key"),
      },
      {
        path: "__node_sea__/assets/5",
        source: "data/cafe\u0301.txt",
        body: Buffer.from("decomposed key"),
      },
    ];
    const checkInventory = (inspection: unknown): void => {
      const parsed = artifactInspectionResultSchema.parse(inspection);
      const graph = artifactInventoryResultSchema.parse(
        parsed.substeps[0]?.evidence.normalized_result,
      );
      expect(graph.manifest.root_format).toBe("node-sea");
      expect(graph.coverage.status).toBe("complete");
      for (const { path, source: raw } of expected) {
        const row = graph.occurrences.find(
          (item) => item.logical_path === path,
        );
        expect(row?.source_path).toBe(raw);
        expect(row?.format_metadata).toMatchObject({ source_path: raw });
        expect(row?.hash_status).toBe("verified");
      }
    };
    const checkExtraction = async (extraction: unknown): Promise<void> => {
      const result = artifactExtractionResultSchema.parse(extraction);
      onTestFinished(() =>
        rm(result.output_root, { recursive: true, force: true }),
      );
      expect(result.containment_verified).toBe(true);
      expect(result.artifacts.map((item) => item.relative_path).sort()).toEqual(
        expected.map((item) => item.path).sort(),
      );
      for (const { path, body } of expected)
        expect(
          Buffer.compare(await readFile(join(result.output_root, path)), body),
        ).toBe(0);
    };

    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    checkInventory(parseEvidence(inspected.json).normalized_result);
    const extracted = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: root, TMP: root, TEMP: root },
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    await checkExtraction(parseEvidence(extracted.json).normalized_result);

    const call = await cli.sharedMcpCall?.();
    if (call === undefined) throw new Error("Expected a stdio MCP session");
    const opened = await call("open_binary", { path: source });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const mcpInspected = await call("inspect_artifact", {});
    expect(mcpInspected.isError, JSON.stringify(mcpInspected)).not.toBe(true);
    checkInventory(
      parseEvidence(mcpInspected.structuredContent).normalized_result,
    );
    const mcpExtracted = await call("extract_artifact", {});
    expect(mcpExtracted.isError, JSON.stringify(mcpExtracted)).not.toBe(true);
    await checkExtraction(
      parseEvidence(mcpExtracted.structuredContent).normalized_result,
    );
  },
);

cliTest(
  "offers no JavaScript probe for a main script without a source suffix",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sea-plain-cli-");
    const source = join(root, "application");
    await writeFile(
      source,
      nodeSeaElf({ codePath: "main", main: "void 0;\n", fuse: "set" }),
    );
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    expect(
      inspection.next_probes.map((probe) => probe.operation),
    ).not.toContain("analyze_javascript_application");
  },
);

cliTest("rejects a malformed SEA blob through the CLI", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-sea-invalid-cli-");
  const source = join(root, "application");
  await writeFile(source, nodeSeaElf({ blob: Buffer.alloc(16) }));
  const result = await cli.run({
    arguments: ["inspect-artifact", source, "--json"],
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("Node SEA blob magic");
});

cliTest(
  "refuses an empty-body SEA asset table over its record bound",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sea-limit-cli-");
    const source = join(root, "application");
    await writeFile(
      source,
      nodeSeaElf({
        blob: buildNodeSeaBlob({
          assets: Array.from({ length: 100_001 }, (_, index) => ({
            name: `a${String(index)}`,
            body: "",
          })),
        }),
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(
      "Node SEA asset count exceeds",
    );
  },
);
