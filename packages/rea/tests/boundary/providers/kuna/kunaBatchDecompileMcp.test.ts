import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { AnalysisProviderRegistry } from "../../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../../src/application/binary/BinarySessionComposition.js";
import { ENHANCED_TOOL_CONTRACTS } from "../../../../src/contracts/enhancedToolContracts.js";
import { SESSION_TOOL_CONTRACTS } from "../../../../src/contracts/sessionToolContracts.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import { evidenceBundleSchema } from "../../../../src/domain/evidenceBundle.js";
import { KunaProvider } from "../../../../src/kuna/KunaProvider.js";
import { elfNoteFixture } from "../../../../src/native/elf/ElfNotes.fixture.js";
import { createServer } from "../../../../src/server/createServer.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { mcpTest } from "../../../support/mcp/mcpFixture.js";
import { writeFakeKuna } from "./fakeKuna.js";
import { FUNCTIONS } from "./kunaSessionFixture.js";

const test = mcpTest.skipIf(process.platform === "win32");

const batchDecompile = ENHANCED_TOOL_CONTRACTS.find(
  (
    contract,
  ): contract is Extract<
    (typeof ENHANCED_TOOL_CONTRACTS)[number],
    { readonly name: "batch_decompile" }
  > => contract.name === "batch_decompile",
);
const getEvidenceBundle = SESSION_TOOL_CONTRACTS.find(
  (
    contract,
  ): contract is Extract<
    (typeof SESSION_TOOL_CONTRACTS)[number],
    { readonly name: "get_evidence_bundle" }
  > => contract.name === "get_evidence_bundle",
);

test("keeps each Kuna no-pseudocode observation's limitations on its batch item", async ({
  mcp,
}) => {
  const root = await createTestTempDirectory("rea-kuna-batch-mcp-");
  const kuna = await writeFakeKuna(root, { functions: FUNCTIONS });
  const target = join(root, "program");
  await writeFile(target, elfNoteFixture({ bits: 64, type: 2 }));
  const session = composeBinarySession(
    new AnalysisProviderRegistry(
      [
        new KunaProvider(
          { REA_KUNA_COMMAND: kuna, REA_KUNA_CACHE_DIR: join(root, "cache") },
          { platform: process.platform },
        ),
      ],
      "kuna",
    ),
  );
  try {
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
    );
    const call = async (name: string, arguments_: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: arguments_ });
      if (response.isError === true)
        throw new Error(`${name} failed: ${JSON.stringify(response)}`);
      return response;
    };
    await call("open_binary", { path: target });
    // Waiting for assembly completes the export, so every pseudocode read
    // below comes from its per-function records.
    await call("procedure_assembly", { procedure: "main" });

    const direct = async (procedure: string) =>
      parseEvidence(
        (await call("procedure_pseudo_code", { procedure })).structuredContent,
      );
    const broken = await direct("broken");
    const importSlot = await direct("puts");
    expect(broken.normalized_result).toBeNull();
    expect(broken.limitations).toContain(
      "Kuna could not decompile this function: Flow exceeded maximum instructions",
    );
    expect(importSlot.normalized_result).toBeNull();

    const batch = parseEvidence(
      (
        await call("batch_decompile", {
          addresses: ["main", "broken", "puts", "0xdead"],
        })
      ).structuredContent,
    );
    if (batchDecompile === undefined || getEvidenceBundle === undefined)
      throw new Error(
        "Missing batch_decompile or get_evidence_bundle contract",
      );
    const result = batchDecompile.outputSchema.parse(batch).normalized_result;
    expect(result).toMatchObject({ total: 4, succeeded: 1, failed: 3 });
    const [main, failed, imported, unknown] = result.items;
    expect(main).toMatchObject({ address: "main", status: "ok" });
    expect(main).not.toHaveProperty("limitations");
    const noPseudocode = {
      status: "error",
      error: {
        code: "capability_unavailable",
        retryable: false,
        details: {
          provider_id: "kuna",
          operation: "procedure_pseudo_code",
        },
      },
    };
    // The item keeps exactly the facts the provider reported for its own
    // observation, as the single-function Evidence does.
    expect(failed).toMatchObject({
      address: "broken",
      procedure: { status: "resolved", address: "0x1080", name: "broken" },
      ...noPseudocode,
      limitations: broken.limitations,
    });
    expect(imported).toMatchObject({
      address: "puts",
      procedure: { status: "resolved", address: "0x2000" },
      ...noPseudocode,
      limitations: importSlot.limitations,
    });
    expect(imported).not.toEqual(
      expect.objectContaining({ limitations: broken.limitations }),
    );
    expect(unknown).toMatchObject({
      address: "0xdead",
      procedure: { status: "unknown" },
      status: "error",
      error: { code: "invalid_request" },
    });
    expect(unknown).not.toHaveProperty("limitations");
    // Aggregate caveats remain on the batch Evidence.
    expect(
      batch.limitations.some((limitation) =>
        limitation.endsWith(
          "Kuna could not decompile this function: Flow exceeded maximum instructions",
        ),
      ),
    ).toBe(true);

    // A batch-only bundle keeps the association without another provider read.
    const bundle = evidenceBundleSchema.parse(
      getEvidenceBundle.outputSchema.parse(
        (await call("get_evidence_bundle", {})).structuredContent,
      ).result,
    );
    const retained = bundle.records.find(
      ({ evidence_id }) => evidence_id === batch.evidence_id,
    );
    expect(retained?.normalized_result).toEqual(batch.normalized_result);
  } finally {
    await mcp.close();
    expect(await session.close()).toEqual({ ok: true, value: null });
  }
}, 60_000);
