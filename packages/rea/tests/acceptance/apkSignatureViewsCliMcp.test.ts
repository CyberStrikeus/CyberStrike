import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import type { z } from "zod";
import { parseEvidence } from "../../src/domain/evidence.js";
import {
  apkSignaturePageViewResultSchema,
  apkSignatureSummaryViewResultSchema,
} from "../../src/domain/analysisView/analysisView.js";
import {
  apkDigestRowSchema,
  type apkSignatureViewRequestSchema,
} from "../../src/domain/apkSignature/apkSignatureQuery.js";
import { apkSignatureResultSchema } from "../../src/domain/apkSignature/apkSignatureReport.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";
import {
  APK_SIGNATURE_V2_ID,
  APK_SIGNATURE_V3_ID,
  LEAF_CERTIFICATE,
  LEAF_SHA256,
  ROOT_CERTIFICATE,
  signedDataBlock,
  signerInfo,
  v2SchemeValue,
  v3SchemeValue,
  withSigningBlock,
  zipWith,
} from "../fixtures/apkSignature/v1SignatureBlock.js";

type Call = Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"];
const pageFrom = (value: unknown) =>
  apkSignaturePageViewResultSchema.parse(
    parseEvidence(value).normalized_result,
  );
const readPage = async (
  call: Call,
  parent: string,
  view: z.input<typeof apkSignatureViewRequestSchema>,
) => {
  const reply = await call("inspect_analysis_view", {
    source: { kind: "retained-evidence", evidence_id: parent },
    view,
  });
  expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
  return pageFrom(reply.structuredContent);
};
const signedFixture = async (root: string) => {
  const path = join(root, "selected.apk");
  await writeFile(
    path,
    withSigningBlock(await zipWith([{ name: "classes.dex", data: "opaque" }]), [
      { id: APK_SIGNATURE_V2_ID, value: v2SchemeValue(ROOT_CERTIFICATE) },
      {
        id: APK_SIGNATURE_V3_ID,
        value: v3SchemeValue(LEAF_CERTIFICATE, [
          ROOT_CERTIFICATE,
          LEAF_CERTIFICATE,
        ]),
      },
    ]),
  );
  return path;
};

cliTest(
  "keeps unknown block signer identity through CLI and retained MCP views despite a readable lineage",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-unknown-block-");
    const path = join(root, "unknown-block.apk");
    await writeFile(
      path,
      withSigningBlock(
        await zipWith([
          { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
          {
            name: "META-INF/CERT.EC",
            data: signedDataBlock({
              certificates: [LEAF_CERTIFICATE],
              signerInfos: [signerInfo({ names: LEAF_CERTIFICATE })],
            }),
          },
        ]),
        [
          {
            id: APK_SIGNATURE_V3_ID,
            value: v3SchemeValue(null, [LEAF_CERTIFICATE, ROOT_CERTIFICATE]),
          },
        ],
      ),
    );
    const complete = await cli.run({
      arguments: ["inspect-apk-signature", path, "--json"],
    });
    expect(complete.exitCode, complete.stderr).toBe(0);
    const report = apkSignatureResultSchema.parse(
      parseEvidence(complete.json).normalized_result,
    );
    expect(report.schemes.v1.signers[0]!.certificate?.sha256_fingerprint).toBe(
      LEAF_SHA256,
    );
    expect(report.schemes.v3.signers[0]!.certificate).toBeNull();
    expect(
      report.schemes.v3.signers[0]!.rotation.lineage[0]!.certificate
        ?.sha256_fingerprint,
    ).toBe(LEAF_SHA256);
    expect(report.posture.v1_signers_match_block_signers).toBeNull();
    const { call } = await connectLocalToolsMcp();
    const reply = await call("inspect_apk_signature", { path });
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const summary = apkSignatureSummaryViewResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    expect(summary.summary.posture.v1_signers_match_block_signers).toBeNull();
    expect(summary.summary.source_coverage.signer_identity).toBe("partial");
    await rm(path);
    const page = await readPage(call, summary.parent_evidence_id, {
      kind: "apk-signature",
      collection: "lineage",
    });
    expect(page.items).toHaveLength(2);
    expect(page.source_coverage.signer_identity).toBe("partial");
  },
);

cliTest(
  "delivers identical selected signing facts through CLI and SDK with complete historical Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-view-");
    const path = await signedFixture(root),
      bundlePath = join(root, "evidence.json");
    const fullCli = await cli.run({
      arguments: ["inspect-apk-signature", path, "--json"],
    });
    expect(fullCli.exitCode, fullCli.stderr).toBe(0);
    const complete = parseEvidence(fullCli.json),
      report = apkSignatureResultSchema.parse(complete.normalized_result);
    expect(report.schemes.v3.signers[0]!.signatures[0]).toMatchObject({
      signature_algorithm_id: 0x0103,
      signature_bytes: 1,
    });
    const selection = { collection: "signers" as const, fields: [], limit: 1 };
    const { call } = await connectLocalToolsMcp();
    const selected = await call("inspect_apk_signature", {
      path,
      view: selection,
    });
    expect(selected.isError, JSON.stringify(selected)).not.toBe(true);
    const first = pageFrom(selected.structuredContent);
    expect(first.parent_evidence_id).toBe(complete.evidence_id);
    expect(first.coverage).toMatchObject({
      total: 2,
      next_offset: 1,
      exhausted: false,
    });
    const cliSelected = await cli.run({
      arguments: [
        "inspect-apk-signature",
        path,
        "--detail",
        "summary",
        "--view",
        JSON.stringify(selection),
        "--evidence_output",
        bundlePath,
        "--json",
      ],
    });
    expect(cliSelected.exitCode, cliSelected.stderr).toBe(0);
    expect(
      pageFrom((cliSelected.json as { summary: unknown }).summary),
    ).toEqual(first);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as {
      records: unknown[];
    };
    const parent = bundle.records
      .map(parseEvidence)
      .find((x) => x.evidence_id === first.parent_evidence_id);
    expect(parent?.normalized_result).toEqual(complete.normalized_result);
    await rm(path);
    const evidencePath = join(root, "parent.json");
    await writeFile(evidencePath, JSON.stringify(parent));
    const historical = await cli.run({
      arguments: [
        "inspect-analysis-view",
        JSON.stringify({
          source: { kind: "evidence-file", path: evidencePath },
          view: {
            kind: "apk-signature",
            collection: "signers",
            ids: [first.items[0]!.id],
            fields: [],
          },
        }),
        "--json",
      ],
    });
    expect(historical.exitCode, historical.stderr).toBe(0);
    expect(pageFrom(historical.json).items).toEqual(first.items);
  },
);

cliTest(
  "composes signer, digest and lineage pages after source deletion without implying verification",
  async () => {
    const root = await createTestTempDirectory("rea-apk-retained-");
    const path = await signedFixture(root),
      { call } = await connectLocalToolsMcp();
    const reply = await call("inspect_apk_signature", { path });
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const summary = apkSignatureSummaryViewResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    const parent = summary.parent_evidence_id;
    expect(summary.summary.counts).toEqual({
      signers: 2,
      digests: 2,
      lineage: 2,
    });
    expect(summary.summary.source_coverage).toMatchObject({
      authenticity: "unknown",
      signature_verification: "not-performed",
      v1_entry_coverage: "unknown",
    });
    const v3 = summary.summary.signers.find((x) => x.scheme === "v3")!;
    await rm(path);
    const first = await readPage(call, parent, {
      kind: "apk-signature",
      collection: "digests",
      fields: ["signature_algorithm_id"],
      limit: 1,
    });
    expect(first.items[0]).toMatchObject({
      signature_algorithm_id: 0x0103,
      scheme: "v2",
    });
    expect(first.items[0]).not.toHaveProperty("declared_digest_hex");
    expect(first.coverage).toMatchObject({ total: 2, next_offset: 1 });
    const second = await readPage(call, parent, {
      kind: "apk-signature",
      collection: "digests",
      offset: 1,
      limit: 1,
      fields: ["signature_algorithm_id", "declared_digest_hex"],
    });
    const digest = apkDigestRowSchema
      .pick({
        id: true,
        signer_id: true,
        scheme: true,
        index: true,
        signer_index: true,
        signature_algorithm_id: true,
        declared_digest_hex: true,
      })
      .parse(second.items[0]);
    expect(digest.signer_id).toBe(v3.id);
    expect(digest.declared_digest_hex).toBe("00".repeat(32));
    expect(second.coverage).toMatchObject({
      total: 2,
      next_offset: null,
      exhausted: true,
    });
    const identities = await readPage(call, parent, {
      kind: "apk-signature",
      collection: "signers",
      ids: summary.summary.signers.map((x) => x.id),
      schemes: ["v3"],
      fields: [],
    });
    expect(identities.items).toEqual([
      { id: v3.id, scheme: "v3", index: 0, certificate_sha256: LEAF_SHA256 },
    ]);
    const lineage = await readPage(call, parent, {
      kind: "apk-signature",
      collection: "lineage",
      signer_ids: [v3.id],
      fields: ["previous_id", "capabilities"],
    });
    expect(lineage.items).toHaveLength(2);
    expect(lineage.items[1]).toMatchObject({
      signer_id: v3.id,
      previous_id: lineage.items[0]!.id,
      certificate_sha256: LEAF_SHA256,
      capabilities: { installed_data: true, permission: true },
    });
    const empty = await readPage(call, parent, {
      kind: "apk-signature",
      collection: "signers",
      ids: [],
      fields: [],
    });
    expect(empty.items).toEqual([]);
    expect(empty.coverage).toMatchObject({ total: 0, exhausted: true });
  },
);

cliTest(
  "keeps unknown v1 identity visible and rejects invalid delivery before reading",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-unknown-view-");
    const path = join(root, "malformed-block.apk");
    await writeFile(
      path,
      await zipWith([
        { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
        { name: "META-INF/CERT.EC", data: Uint8Array.of(0x30, 0) },
      ]),
    );
    const { call } = await connectLocalToolsMcp();
    const reply = await call("inspect_apk_signature", { path });
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const summary = apkSignatureSummaryViewResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    expect(summary.summary.counts.signers).toBe(1);
    expect(summary.summary.signers[0]!.certificate_sha256).toBeNull();
    expect(summary.summary.source_coverage.signer_identity).toBe("partial");
    expect(summary.summary.posture.v1_signers_match_block_signers).toBeNull();
    const badLineage = Buffer.from(
      v3SchemeValue(LEAF_CERTIFICATE, [ROOT_CERTIFICATE, LEAF_CERTIFICATE]),
    );
    const attribute = badLineage.indexOf(Buffer.from([0x8c, 0x6f, 0xa0, 0x3b]));
    expect(attribute).toBeGreaterThan(0);
    badLineage.writeUInt32LE(0xffffffff, attribute + 8);
    const brokenPath = join(root, "broken-lineage.apk");
    await writeFile(
      brokenPath,
      withSigningBlock(
        await zipWith([{ name: "classes.dex", data: "opaque" }]),
        [{ id: APK_SIGNATURE_V3_ID, value: badLineage }],
      ),
    );
    const broken = await call("inspect_apk_signature", { path: brokenPath });
    expect(broken.isError, JSON.stringify(broken)).not.toBe(true);
    const brokenSummary = apkSignatureSummaryViewResultSchema.parse(
      parseEvidence(broken.structuredContent).normalized_result,
    );
    expect(brokenSummary.summary.posture.rotation_present).toBe(true);
    expect(brokenSummary.summary.source_coverage.lineage_decoding).toBe(
      "partial",
    );
    await rm(brokenPath);
    const unknown = await readPage(call, brokenSummary.parent_evidence_id, {
      kind: "apk-signature",
      collection: "lineage",
    });
    expect(unknown.items).toEqual([]);
    expect(unknown.source_coverage.lineage_decoding).toBe("partial");
    expect(unknown.unknowns.join(" ")).toContain("lineage node truncated");
    const invalid = await cli.run({
      arguments: [
        "inspect-apk-signature",
        join(root, "missing.apk"),
        "--detail",
        "summary",
        "--json",
      ],
    });
    expect(invalid.exitCode).toBe(1);
    expect(invalid.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "inspect_apk_signature",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ["evidence_output"],
            reason: "invalid_value",
          }),
        ]),
      },
    });
    const ambiguous = await call("inspect_apk_signature", {
      path: join(root, "missing.apk"),
      detail: "complete",
      view: { collection: "signers" },
    });
    expect(parseMcpToolError(ambiguous).error).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "inspect_apk_signature",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["view"], reason: "invalid_value" }),
        ]),
      },
    });
  },
);
