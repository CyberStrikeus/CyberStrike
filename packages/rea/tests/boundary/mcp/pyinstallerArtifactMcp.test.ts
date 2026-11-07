import { access, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import { afterAll, expect } from "vitest";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { ownArtifactSession } from "../../support/mcp/artifactSession.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";

import { createArtifactBinarySession } from "../../../src/composition/binary.js";
import {
  PYTHON_39_MAGIC,
  cArchiveExecutable,
  cArchiveBytecodeExecutable,
  pyzArchive,
} from "../../../src/artifacts/pyinstaller/CArchive.fixture.js";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

const assertMetadataQueries = async (
  client: Client,
  parent: Evidence,
  expectedCoverage: "complete" | "unknown",
): Promise<void> => {
  const definition = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_analysis_view",
  );
  expect(definition?.outputSchema).toBeDefined();
  const ajv = schemaValidation.assertions;
  const inputSchema: Record<string, unknown> = definition!.inputSchema;
  const outputSchema: Record<string, unknown> = definition!.outputSchema!;
  const ids: string[] = [];
  const selected: unknown[] = [];
  for (const offset of [0, 1, 2, 3]) {
    const args = {
      source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
      view: {
        kind: "inventory",
        collection: "occurrences",
        entry_kinds: ["metadata"],
        fields: ["format_metadata"],
        offset,
        limit: 1,
      },
    };
    expect(ajv.validate(inputSchema, args), JSON.stringify(ajv.errors)).toBe(
      true,
    );
    const reply = await client.callTool({
      name: "inspect_analysis_view",
      arguments: args,
    });
    expect(reply.isError).not.toBe(true);
    expect(
      ajv.validate(outputSchema, reply.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const evidence = parseEvidence(reply.structuredContent);
    const view = analysisViewResultSchema.parse(evidence.normalized_result);
    if (view.kind !== "inventory") throw new Error("Expected inventory page");
    expect(view.parent_evidence_id).toBe(parent.evidence_id);
    expect(evidence.evidence_links).toContain(parent.evidence_id);
    expect(view.coverage.total).toBe(3);
    expect(view.source_coverage?.status).toBe(expectedCoverage);
    if (offset < 3) {
      expect(view.items).toHaveLength(1);
      expect(view.items[0]).toMatchObject({
        artifact_id: null,
        format_metadata: { kind: "pyinstaller-entry" },
      });
      expect(view.items[0]).not.toHaveProperty("logical_path");
      const row = view.items[0];
      if (row === undefined || !("occurrence_id" in row))
        throw new Error("Expected occurrence identity");
      ids.push(row.occurrence_id);
      selected.push(row);
    } else expect(view.items).toEqual([]);
  }
  expect(new Set(ids).size).toBe(3);
  expect(selected).toEqual(
    expect.arrayContaining([
      ...[0, 1].map((index) =>
        expect.objectContaining({
          format_metadata: expect.objectContaining({
            index,
            type_code: "o",
            source_name: "pyi-contents-directory _internal",
          }),
        }),
      ),
      expect.objectContaining({
        format_metadata: expect.objectContaining({
          type_code: "d",
          source_name: "../shared/app:assets/data.bin",
          dependency_status: "unresolved",
          dependency_archive: "../shared/app",
          dependency_member: "assets/data.bin",
        }),
      }),
    ]),
  );
};

const writeExecutable = async (opaque: boolean): Promise<string> => {
  const directory = await createTestTempDirectory("rea-pyinstaller-mcp-");
  const path = join(directory, "hello");
  await writeFile(
    path,
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 312,
      pythonLibrary: "libpython3.12.so",
      members: [
        {
          name: "pyi-contents-directory _internal",
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "pyi-contents-directory _internal",
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "hello",
          typeCode: "s",
          payload: Buffer.from("print('hi')"),
          compress: false,
        },
        {
          name: "../shared/app:assets/data.bin",
          typeCode: "d",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: opaque ? Buffer.alloc(4) : PYTHON_39_MAGIC,
            modules: [{ name: "app", typeCode: 0, body: Buffer.from("app") }],
          }),
          compress: opaque,
        },
        ...(opaque
          ? [
              {
                name: "pyimod00_crypto_key",
                typeCode: "m",
                payload: Buffer.from("key"),
                compress: false,
              },
            ]
          : []),
      ],
    }),
  );
  return path;
};

const writeSurrogateNamespaceExecutable = async (): Promise<string> => {
  const directory = await createTestTempDirectory(
    "rea-pyinstaller-mcp-surrogate-",
  );
  const path = join(directory, "surrogate-name");
  const namespace = Buffer.concat([
    Buffer.from("node_"),
    Buffer.from("edb3bf", "hex"),
  ]);
  await writeFile(
    path,
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 39,
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [
              { name: namespace, typeCode: 3, body: Buffer.alloc(0) },
              { name: "healthy", typeCode: 0, body: Buffer.from("healthy") },
            ],
          }),
          compress: false,
        },
      ],
    }),
  );
  return path;
};

mcpTest.for([false, true])(
  "inventories a PyInstaller executable through inspect_artifact (opaque: %s)",
  async (opaque, { mcp, onTestFinished }) => {
    const path = await writeExecutable(opaque);
    const session = await createArtifactBinarySession(process.env);
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
      { name: "pyinstaller-mcp-test", version: "1" },
      schemaValidation,
    );

    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError).not.toBe(true);
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
    );
    expect(inspection.subject.root_format).toBe("pyinstaller");
    if (!opaque) expect(inspection.next_probes).toEqual([]);
    expect(
      inspection.substeps[0]?.evidence.normalized_result.coverage.status,
    ).toBe(opaque ? "unknown" : "complete");
    if (opaque)
      expect(
        inspection.substeps[0]?.evidence.normalized_result.occurrences.find(
          (row) => row.logical_path === "PYZ.pyz",
        ),
      ).toMatchObject({
        encrypted: false,
        hash_status: "verified",
        artifact_id: expect.any(String),
        format_metadata: { encryption_source: "carchive-marker" },
      });
    expect(
      inspection.substeps[0]?.evidence.normalized_result.occurrences.map(
        (occurrence) => occurrence.logical_path,
      ),
    ).toEqual(
      expect.arrayContaining(["hello", ...(opaque ? [] : ["PYZ.pyz/app.pyc"])]),
    );
    if (!opaque)
      expect(
        inspection.substeps[0]?.evidence.normalized_result.occurrences.find(
          (row) => row.logical_path === "PYZ.pyz/app.pyc",
        ),
      ).toMatchObject({
        source_path: "app",
        format_metadata: {
          container_name: "PYZ.pyz",
          source_name: "app",
        },
      });
    const parent = parseEvidence(inspected.structuredContent);
    const compact = await client.callTool({
      name: "inspect_artifact",
      arguments: { detail: "summary" },
    });
    expect(compact.isError).not.toBe(true);
    const summary = parseEvidence(compact.structuredContent).normalized_result;
    expect(summary).toMatchObject({
      kind: "summary",
      summary: {
        root_format_metadata: {
          kind: "pyinstaller",
          python_version_raw: 312,
          external_dependency_count: 1,
        },
        observed_entry_kind_counts: { metadata: 3 },
        source_coverage: { status: opaque ? "unknown" : "complete" },
      },
    });
    await assertMetadataQueries(
      client,
      parent,
      opaque ? "unknown" : "complete",
    );
    if (opaque) {
      const missing = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: parent.evidence_id,
          },
          view: {
            kind: "inventory",
            collection: "occurrences",
            logical_paths: ["PYZ.pyz/app.pyc"],
            entry_kinds: ["file"],
            fields: [],
            offset: 0,
            limit: 1,
          },
        },
      });
      expect(missing.isError).not.toBe(true);
      const page = analysisViewResultSchema.parse(
        parseEvidence(missing.structuredContent).normalized_result,
      );
      expect(page).toMatchObject({
        kind: "inventory",
        items: [],
        source_coverage: { status: "unknown" },
      });
      expect(page.unknowns).toContain(
        "Producer traversal coverage is unknown; missing matches do not prove source absence.",
      );
    }
  },
);

mcpTest(
  "preserves legacy CArchive identities and modern bytecode derivation through inspect_artifact",
  async ({ mcp, onTestFinished }) => {
    const fixture = cArchiveBytecodeExecutable();
    const directory = await createTestTempDirectory(
      "rea-pyinstaller-mcp-bytecode-",
    );
    const path = join(directory, "bytecode-layouts");
    await writeFile(path, fixture.archive);
    const session = await createArtifactBinarySession(process.env);
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
      { name: "pyinstaller-bytecode-mcp-test", version: "1" },
      schemaValidation,
    );

    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError).not.toBe(true);
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const inventory = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
    ).substeps[0]?.evidence.normalized_result;
    expect(inventory?.coverage.status).toBe("complete");
    for (const module of fixture.modules) {
      const occurrence = inventory?.occurrences.find(
        (row) => row.logical_path === module.name,
      );
      expect(occurrence).toMatchObject({
        hash_status: "verified",
        format_metadata: {
          bytecode_header: module.derived ? "derived" : "unknown",
        },
      });
      expect(
        inventory?.nodes.find(
          (node) => node.artifact_id === occurrence?.artifact_id,
        ),
      ).toMatchObject({
        sha256: createHash("sha256").update(module.bytes).digest("hex"),
        size: module.bytes.length,
      });
      expect(
        inventory?.edges.find(
          (edge) => edge.occurrence_id === occurrence?.occurrence_id,
        )?.relation,
      ).toBe(module.derived ? "derived-from" : "contains");
    }
  },
);

mcpTest(
  "preserves surrogatepass PYZ module names through inspect_artifact",
  async ({ mcp, onTestFinished }) => {
    const path = await writeSurrogateNamespaceExecutable();
    const session = await createArtifactBinarySession(process.env);
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
      { name: "pyinstaller-surrogate-mcp-test", version: "1" },
      schemaValidation,
    );

    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError).not.toBe(true);
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
    );
    const inventory = inspection.substeps[0]?.evidence.normalized_result;
    expect(inventory?.coverage.status).toBe("complete");
    expect(
      inventory?.occurrences.find(
        (row) => row.logical_path === "PYZ.pyz/node_\udcff",
      ),
    ).toMatchObject({
      entry_kind: "metadata",
      format_metadata: { source_name: "node_\udcff", type_code: 3 },
    });
    expect(
      inventory?.occurrences.find(
        (row) => row.logical_path === "PYZ.pyz/healthy.pyc",
      ),
    ).toMatchObject({
      entry_kind: "file",
      format_metadata: { source_name: "healthy" },
    });
  },
);

mcpTest.for([
  {
    name: "recognized opaque magic agrees with cookie",
    cookie: 309,
    magic: PYTHON_39_MAGIC,
    version: "3.9",
    conflict: false,
    derived: true,
  },
  {
    name: "recognized opaque magic disagrees with cookie",
    cookie: 312,
    magic: PYTHON_39_MAGIC,
    version: "3.9",
    conflict: false,
    derived: false,
  },
  {
    name: "unknown opaque magic with invalid TOC",
    cookie: 309,
    magic: Buffer.alloc(4),
    version: null,
    conflict: false,
    derived: false,
  },
  {
    name: "recognized opaque siblings disagree",
    cookie: 309,
    magic: PYTHON_39_MAGIC,
    version: "3.9",
    conflict: true,
    derived: false,
  },
])(
  "retains PYZ header evidence through inspect_artifact: $name",
  async (
    { cookie, magic, version, conflict, derived },
    { mcp, onTestFinished },
  ) => {
    const payload = pyzArchive({
      magic,
      modules: [],
      toc: Buffer.from([0x4e]),
    });
    if (version === null) payload.writeUInt32BE(0xffffffff, 8);
    const directory = await createTestTempDirectory("rea-opaque-pyz-metadata-");
    const path = join(directory, "opaque-header");
    await writeFile(
      path,
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: cookie,
        members: [
          {
            name: "hello",
            typeCode: "s",
            payload: Buffer.from("entry script"),
            compress: false,
          },
          { name: "PYZ.pyz", typeCode: "z", payload, compress: true },
          ...(conflict
            ? [
                {
                  name: "other.pyz",
                  typeCode: "z",
                  payload: pyzArchive({
                    magic: Buffer.from("f30d0d0a", "hex"),
                    modules: [],
                    toc: Buffer.from([0x4e]),
                  }),
                  compress: false,
                },
              ]
            : []),
        ],
      }),
    );
    const session = await createArtifactBinarySession(process.env);
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
      { name: "opaque-pyz-metadata-test", version: "1" },
      schemaValidation,
    );

    expect(
      (await client.callTool({ name: "open_binary", arguments: { path } }))
        .isError,
    ).not.toBe(true);
    const reply = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(reply.isError).not.toBe(true);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    const inventory = inspection.substeps[0]?.evidence.normalized_result;
    expect(inventory?.coverage.status).toBe("unknown");
    expect(
      inventory?.occurrences.find((row) => row.logical_path === "PYZ.pyz"),
    ).toMatchObject({
      entry_kind: "file",
      hash_status: "verified",
      format_metadata: {
        pyz_status: "opaque",
        pyz_sha256: createHash("sha256").update(payload).digest("hex"),
        pyz_python_magic: magic.toString("hex"),
        pyz_python_version: version,
        pyz_entry_count: null,
      },
    });
    expect(
      inventory?.occurrences.find((row) => row.logical_path === "hello")
        ?.format_metadata,
    ).toMatchObject({
      bytecode_header: derived ? "derived" : "unknown",
      bytecode_magic: derived ? magic.toString("hex") : null,
    });
    if (conflict)
      expect(
        inventory?.occurrences.find((row) => row.logical_path === "other.pyz")
          ?.format_metadata,
      ).toMatchObject({
        pyz_status: "opaque",
        pyz_python_version: "3.13",
        pyz_python_magic: "f30d0d0a",
      });
  },
);

const PYZ_ROLE_FILES = [
  {
    name: "mod.child",
    typeCode: 0,
    path: "mod/child.pyc",
    body: Buffer.from("module-body"),
    bytecode: true,
  },
  {
    name: "pkg.inner",
    typeCode: 1,
    path: "pkg/inner/__init__.pyc",
    body: Buffer.from("package-body"),
    bytecode: true,
  },
  {
    name: "assets/config.json",
    typeCode: 2,
    path: "assets/config.json",
    body: Buffer.from('{"enabled":true}'),
    bytecode: false,
  },
];

mcpTest.for([false, true])(
  "preserves PYZ member roles through MCP inventory and extraction (encryption marker=%s)",
  async (encrypted, { mcp, onTestFinished }) => {
    const files = encrypted ? [] : PYZ_ROLE_FILES;
    const directory = await createTestTempDirectory("rea-pyz-roles-mcp-");
    const path = join(directory, "roles");
    await writeFile(
      path,
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          ...(encrypted
            ? [
                {
                  name: "pyimod00_crypto_key",
                  typeCode: "m",
                  payload: Buffer.from("key module"),
                  compress: false,
                },
              ]
            : []),
          {
            name: "PYZ.pyz",
            typeCode: "z",
            compress: false,
            payload: pyzArchive({
              magic: PYTHON_39_MAGIC,
              modules: [
                ...files,
                {
                  name: "ns.branch",
                  typeCode: 3,
                  body: Buffer.from("legacy namespace payload"),
                  legacyNamespacePayload: true,
                },
                { name: "empty.branch", typeCode: 3, body: Buffer.alloc(0) },
              ],
            }),
          },
        ],
      }),
    );
    const session = await createArtifactBinarySession(process.env);
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
      { name: "pyz-role-test", version: "1" },
      schemaValidation,
    );
    let outputRoot: string | undefined;
    try {
      expect(
        (await client.callTool({ name: "open_binary", arguments: { path } }))
          .isError,
      ).not.toBe(true);
      const reply = await client.callTool({
        name: "inspect_artifact",
        arguments: {},
      });
      expect(reply.isError).not.toBe(true);
      const inventory = artifactInspectionResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      ).substeps[0]?.evidence.normalized_result;
      for (const [name, payload] of [
        ["ns/branch", true],
        ["empty/branch", false],
      ] as const) {
        expect(
          inventory?.occurrences.find(
            (row) => row.logical_path === `PYZ.pyz/${name}`,
          ),
        ).toMatchObject({
          entry_kind: "metadata",
          artifact_kind: "package-metadata",
          artifact_id: null,
          encrypted: encrypted && payload,
          format_metadata: {
            type_code: 3,
            bytecode_header: "not-bytecode",
            bytecode_magic: null,
            encryption_source: encrypted && payload ? "carchive-marker" : null,
          },
        });
      }
      const extracted = await client.callTool({
        name: "extract_artifact",
        arguments: {},
      });
      expect(extracted.isError).not.toBe(true);
      const result = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.structuredContent).normalized_result,
      );
      outputRoot = result.output_root;
      for (const file of files) {
        const logicalPath = `PYZ.pyz/${file.path}`;
        expect(
          inventory?.occurrences.find(
            (row) => row.logical_path === logicalPath,
          ),
        ).toMatchObject({
          entry_kind: "file",
          format_metadata: {
            type_code: file.typeCode,
            source_name: file.name,
            bytecode_header: file.bytecode ? "derived" : "not-bytecode",
          },
        });
        const expected = file.bytecode
          ? Buffer.concat([PYTHON_39_MAGIC, Buffer.alloc(12), file.body])
          : file.body;
        expect(
          (await readFile(join(outputRoot, logicalPath))).equals(expected),
        ).toBe(true);
        expect(
          result.artifacts.find((item) => item.relative_path === logicalPath)
            ?.sha256,
        ).toBe(createHash("sha256").update(expected).digest("hex"));
      }
      for (const namespace of ["ns/branch", "empty/branch"]) {
        expect(
          result.artifacts.some(
            (item) => item.relative_path === `PYZ.pyz/${namespace}`,
          ),
        ).toBe(false);
        await expect(
          access(join(outputRoot, "PYZ.pyz", namespace)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  },
);
