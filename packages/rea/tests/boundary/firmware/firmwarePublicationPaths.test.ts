import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { FIRMWARE_TOOL_CONTRACTS } from "../../../src/contracts/firmware/firmwareToolContracts.js";
import { toolOutputSchemaWithMetadata } from "../../../src/contracts/toolSchemaMetadata.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { RequestTrackingMcpServer } from "../../../src/server/RequestTrackingMcpServer.js";
import { FirmwareProvider } from "../../../src/firmware/FirmwareProvider.js";
import { FirmwareAnalysisService } from "../../../src/application/firmware/FirmwareAnalysisService.js";
import {
  FirmwareFileAccess,
  inventoryFirmwareOutput,
} from "../../../src/firmware/FirmwareFiles.js";
import { publishFirmwareExtraction } from "../../../src/firmware/FirmwarePublication.js";
import { normalizeUnblobReport } from "../../../src/firmware/FirmwareReports.js";
import { startFirmwareDeadline } from "../../../src/firmware/FirmwareDeadline.js";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const validateAdvertisedFirmwareOutput = async (
  result: Awaited<ReturnType<typeof publishFirmwareExtraction>>,
): Promise<void> => {
  const contract = FIRMWARE_TOOL_CONTRACTS.find(
    (item) => item.name === "extract_firmware",
  );
  if (contract === undefined)
    throw new Error("Missing extract_firmware contract");
  const server = new RequestTrackingMcpServer({
    name: "schema",
    version: "1",
  });
  const client = new Client({ name: "schema-client", version: "1" });
  server.registerTool(
    contract.name,
    { outputSchema: toolOutputSchemaWithMetadata(contract) },
    () => ({ content: [] }),
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const schema = (await client.listTools()).tools.find(
      (tool) => tool.name === contract.name,
    )?.outputSchema;
    if (schema === undefined) throw new Error("Missing firmware output schema");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(schema as AnySchema)).toBe(true);
    const validate = ajv.compile(schema as AnySchema);
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "fixture", version: null },
      {
        operation: "extract_firmware",
        parameters: {},
        result,
        confidence: "observed",
      },
    );
    expect(validate(evidence), JSON.stringify(validate.errors)).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
};

it.each(["existing", "missing-parent", "relative"] as const)(
  "refuses %s destinations before selecting or launching a firmware engine",
  async (kind) => {
    const root = await createTestTempDirectory("rea-firmware-destination-");
    const output =
      kind === "existing"
        ? join(root, "exists")
        : kind === "missing-parent"
          ? join(root, "missing", "output")
          : "relative-output";
    if (kind === "existing") await mkdir(output);
    const launcher = vi.fn(async () => {
      throw new Error("Must not launch");
    });
    const provider = new FirmwareProvider({}, launcher);
    try {
      const result = await new FirmwareAnalysisService(provider).execute(
        "extract_firmware",
        { path: join(root, "absent-input"), output_directory: output },
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisInputError",
          issues: [
            {
              path: ["output_directory"],
              reason: kind === "relative" ? "invalid_format" : "invalid_value",
            },
          ],
        },
      });
      expect(launcher).not.toHaveBeenCalled();
    } finally {
      await provider.close();
    }
  },
);

it("early destination admission creates nothing and publication still acquires exclusively", async () => {
  const root = await createTestTempDirectory("rea-firmware-preflight-");
  const output = join(root, "output");
  await SafeOutputTree.checkDestination(output);
  await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  await mkdir(output);
  await expect(SafeOutputTree.create(output)).rejects.toMatchObject({
    name: "SafeOutputTreeDestinationRefusal",
  });
  expect(await access(output)).toBeUndefined();
});

it("publishes the writer's normalized path while retaining source spelling and unclassified input coverage", async () => {
  const root = await createTestTempDirectory("rea-firmware-published-name-");
  const staging = join(root, "staging");
  await mkdir(staging);
  const name = "cafe\u0301.bin";
  const bytes = Buffer.from("child");
  const path = join(staging, name);
  await writeFile(path, bytes);
  if (process.platform !== "win32") {
    await symlink(
      Buffer.from([0x73, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0xff]),
      join(staging, "raw-link"),
    );
    await symlink("sample\ufffd", join(staging, "unicode-link"));
    await symlink("sample", join(staging, "control-link"));
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const inputPath = join(root, "input");
  const inputHash = "a".repeat(64);
  const normalized = normalizeUnblobReport(
    [
      {
        task: { path: inputPath, depth: 0, blob_id: "", is_multi_file: false },
        reports: [
          {
            __typename__: "StatReport",
            path: inputPath,
            size: 1,
            is_file: true,
            is_dir: false,
            is_link: false,
            link_target: null,
          },
          { __typename__: "HashReport", sha256: inputHash },
        ],
        subtasks: [],
      },
    ],
    {
      inputPath,
      outputRoot: staging,
      sha256: inputHash,
      length: 1,
      offset: 7,
      maxDepth: 3,
    },
  );
  const files = new FirmwareFileAccess();
  const output = join(root, "published");
  const retainCleanup = vi.fn();
  try {
    const result = await publishFirmwareExtraction({
      files,
      workspacePath: root,
      deadline: startFirmwareDeadline("publication", 120_000),
      analysisTimeoutMs: 120_000,
      outputDirectory: output,
      entries: await inventoryFirmwareOutput(
        staging,
        1024,
        10,
        "extract_firmware",
      ),
      normalized,
      selection: { offset: 7, length: 1, sha256: inputHash },
      maxDepth: 3,
      engine: {
        name: "unblob",
        version: "26.6.4",
        executable_path: "/synthetic/unblob",
        executable_sha256: inputHash,
        source_revision: null,
        worker_count: 1,
      },
      signal: new AbortController().signal,
      retainCleanup,
    });
    expect(result.files).toMatchObject([
      {
        relative_path: name,
        path: join(output, name.normalize("NFC")),
        sha256,
      },
    ]);
    const published = result.files[0];
    if (published === undefined) throw new Error("Expected published child");
    expect(Buffer.compare(await readFile(published.path), bytes)).toBe(0);
    if (process.platform !== "win32") {
      expect(result.unpublished_entries).toEqual([
        {
          relative_path: "control-link",
          kind: "symlink",
          link_target: "sample",
          link_target_hex: "73616d706c65",
        },
        {
          relative_path: "raw-link",
          kind: "symlink",
          link_target: null,
          link_target_hex: "73616d706c65ff",
        },
        {
          relative_path: "unicode-link",
          kind: "symlink",
          link_target: "sample\ufffd",
          link_target_hex: "73616d706c65efbfbd",
        },
      ]);
      const rawLink = join(output, "raw-link");
      await expect(lstat(rawLink)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readlink(rawLink)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await validateAdvertisedFirmwareOutput(result);
    }
    expect(result).toMatchObject({
      coverage: "partial",
      extraction_gaps: expect.arrayContaining([
        expect.objectContaining({
          kind: "unclassified-range",
          input_path: "$input",
          provider_id: null,
          handler: null,
          range: { offset: 0, length: 1 },
          root_file_range: { offset: 7, length: 1 },
        }),
      ]),
    });
    expect(retainCleanup).not.toHaveBeenCalled();
  } finally {
    await files.close();
  }
});
