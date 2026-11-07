import { apkSignatureResultSchema } from "../../src/domain/apkSignature/apkSignatureReport.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, onTestFinished } from "vitest";
import { closeVerifierResources } from "../../scripts/lib/verifier-cleanup.mjs";

import { AnalysisProviderRegistry } from "../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../src/application/binary/BinarySessionComposition.js";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createServer } from "../../src/server/createServer.js";
import {
  APK_SIGNATURE_V2_ID,
  APK_SIGNATURE_V3_ID,
  indefinite,
  LEAF_CERTIFICATE,
  LEAF_SHA256,
  LEAF_SUBJECT,
  OID_ECDSA_SHA256,
  OID_SHA256,
  OPENSSL_BLOCK_ISSUER_SERIAL,
  OPENSSL_BLOCK_KEY_ID,
  ROOT_CERTIFICATE,
  ROOT_SHA256,
  signedDataBlock,
  signerInfo,
  tlv,
  v2SchemeValue,
  v3SchemeValue,
  withSigningBlock,
  zipEntryOffsets,
  zipWith,
} from "../fixtures/apkSignature/v1SignatureBlock.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestMcp } from "../support/mcp/mcpFixture.js";

const completeEvidence = (value: unknown) => {
  const evidence = toolContract("inspect_apk_signature").outputSchema.parse(
    value,
  );
  return {
    ...evidence,
    normalized_result: apkSignatureResultSchema.parse(
      evidence.normalized_result,
    ),
  };
};

const connectSignerMcp = async () => {
  const session = composeBinarySession(new AnalysisProviderRegistry([]));
  const mcp = createTestMcp();
  onTestFinished(() =>
    closeVerifierResources([
      () => mcp.close(),
      async () => {
        const result = await session.close();
        if (!result.ok) throw result.error;
      },
    ]),
  );
  return await mcp.connect(createServer({ kind: "session", session }), {
    name: "apk-v1-signer-parity",
    version: "1",
  });
};

const expectV1Only = (
  report: ReturnType<typeof completeEvidence>["normalized_result"],
) => {
  expect(report.schemes.v1.present).toBe(true);
  expect(report.posture).toMatchObject({
    v1_only: true,
    strongest_scheme: "v1",
    v1_signers_match_block_signers: null,
  });
  expect(report.schemes.v1.signers).toMatchObject([
    {
      signature_file: "META-INF/CERT.SF",
      block_file: "META-INF/CERT.EC",
      certificate: {
        sha256_fingerprint: LEAF_SHA256,
        subject: LEAF_SUBJECT,
        public_key_algorithm: "ec",
      },
      certificates: [
        { sha256_fingerprint: LEAF_SHA256, subject: LEAF_SUBJECT },
        { sha256_fingerprint: ROOT_SHA256 },
      ],
      signer_infos: [
        {
          identified_by: "issuer-and-serial",
          certificate_sha256: LEAF_SHA256,
          digest_algorithm_oid: OID_SHA256,
          signature_algorithm_oid: OID_ECDSA_SHA256,
        },
      ],
      decode_error: null,
    },
  ]);
};

cliTest(
  "names the v1 signer certificate and a v1/v2 signer mismatch identically through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-v1-signer-");
    const v1Zip = await zipWith([
      { name: "classes.dex", data: "dex" },
      { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0" },
      { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
      { name: "META-INF/CERT.EC", data: OPENSSL_BLOCK_ISSUER_SERIAL },
    ]);
    const v1Only = join(root, "v1-only.apk");
    await writeFile(v1Only, v1Zip);
    const v1Stored = join(root, "v1-stored.apk");
    await writeFile(
      v1Stored,
      await zipWith([
        { name: "classes.dex", data: "dex" },
        { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0" },
        { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
        {
          name: "META-INF/CERT.EC",
          data: OPENSSL_BLOCK_ISSUER_SERIAL,
          stored: true,
        },
      ]),
    );
    // The v2 block names a different certificate than the JAR signature.
    const mixed = join(root, "v1-v2-mismatch.apk");
    await writeFile(
      mixed,
      withSigningBlock(v1Zip, [
        { id: APK_SIGNATURE_V2_ID, value: v2SchemeValue(ROOT_CERTIFICATE) },
      ]),
    );

    // Rotated v1 + v3 without v2: v1 keeps the original key (the lineage's
    // first node), v3 signs with the newest. That is the expected layout.
    const rotated = join(root, "v1-v3-rotated.apk");
    await writeFile(
      rotated,
      withSigningBlock(v1Zip, [
        {
          id: APK_SIGNATURE_V3_ID,
          value: v3SchemeValue(ROOT_CERTIFICATE, [
            LEAF_CERTIFICATE,
            ROOT_CERTIFICATE,
          ]),
        },
      ]),
    );
    const rotatedWithV2 = join(root, "v1-v2-v3-rotated.apk");
    await writeFile(
      rotatedWithV2,
      withSigningBlock(v1Zip, [
        { id: APK_SIGNATURE_V2_ID, value: v2SchemeValue(LEAF_CERTIFICATE) },
        {
          id: APK_SIGNATURE_V3_ID,
          value: v3SchemeValue(ROOT_CERTIFICATE, [
            LEAF_CERTIFICATE,
            ROOT_CERTIFICATE,
          ]),
        },
      ]),
    );
    // A lineage that does not start at the v1 key is still a mismatch.
    const misrotated = join(root, "v1-v3-misrotated.apk");
    await writeFile(
      misrotated,
      withSigningBlock(v1Zip, [
        {
          id: APK_SIGNATURE_V3_ID,
          value: v3SchemeValue(LEAF_CERTIFICATE, [
            ROOT_CERTIFICATE,
            LEAF_CERTIFICATE,
          ]),
        },
      ]),
    );

    const viaCli = async (path: string) => {
      const result = await cli.run({
        arguments: ["inspect-apk-signature", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      return completeEvidence(result.json);
    };
    const cliV1 = await viaCli(v1Only);
    const cliStored = await viaCli(v1Stored);
    const cliMixed = await viaCli(mixed);
    const cliRotated = await viaCli(rotated);
    const cliRotatedWithV2 = await viaCli(rotatedWithV2);
    const cliMisrotated = await viaCli(misrotated);

    expectV1Only(cliV1.normalized_result);
    expectV1Only(cliStored.normalized_result);
    expect(cliMixed.normalized_result.posture).toMatchObject({
      v1_only: false,
      v1_signers_match_block_signers: false,
    });
    expect(cliRotated.normalized_result.posture).toMatchObject({
      v1_only: false,
      rotation_present: true,
      schemes_agree_on_signer: true,
      signer_change_declared_by_rotation: false,
      v1_signers_match_block_signers: true,
    });
    expect(cliRotatedWithV2.normalized_result.posture).toMatchObject({
      rotation_present: true,
      schemes_agree_on_signer: false,
      signer_change_declared_by_rotation: true,
      v1_signers_match_block_signers: true,
    });
    expect(
      cliMisrotated.normalized_result.posture.v1_signers_match_block_signers,
    ).toBe(false);
    expect(cliV1.limitations.join(" ")).toContain("NOT verified");

    const client = await connectSignerMcp();
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "inspect_apk_signature",
    );
    const outputSchema: Record<string, unknown> | undefined =
      tool?.outputSchema;
    if (tool === undefined || outputSchema === undefined)
      throw new Error("inspect_apk_signature must advertise an output schema");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const [path, fromCli] of [
      [v1Only, cliV1],
      [mixed, cliMixed],
      [rotated, cliRotated],
      [rotatedWithV2, cliRotatedWithV2],
    ] as const) {
      const reply = await client.callTool(
        { name: tool.name, arguments: { path, detail: "complete" } },
        { toolDefinition: tool },
      );
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      expect(
        ajv.validate(outputSchema, reply.structuredContent),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      const evidence = parseEvidence(reply.structuredContent);
      expect(evidence.normalized_result).toEqual(fromCli.normalized_result);
      expect(evidence.evidence_id).toBe(fromCli.evidence_id);
    }
  },
);

cliTest(
  "retains v1 signer identity when the CMS signature OCTET STRING is constructed BER",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-v1-ber-signature-");
    const encodings = [
      [
        "definite",
        tlv(0x24, tlv(0x04, Uint8Array.of(1)), tlv(0x04, Uint8Array.of(2, 3))),
      ],
      [
        "indefinite",
        indefinite(
          0x24,
          tlv(0x04, Uint8Array.of(1)),
          tlv(0x04, Uint8Array.of(2, 3)),
        ),
      ],
    ] as const;
    for (const [form, signature] of encodings) {
      const path = join(root, `${form}.apk`);
      await writeFile(
        path,
        await zipWith([
          { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0" },
          { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
          {
            name: "META-INF/CERT.RSA",
            data: signedDataBlock({
              certificates: [LEAF_CERTIFICATE],
              signerInfos: [signerInfo({ names: LEAF_CERTIFICATE, signature })],
            }),
          },
        ]),
      );
      const result = await cli.run({
        arguments: ["inspect-apk-signature", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = completeEvidence(result.json);
      expect(evidence.normalized_result.schemes.v1.signers).toMatchObject([
        {
          certificate: {
            sha256_fingerprint: LEAF_SHA256,
            subject: LEAF_SUBJECT,
          },
          decode_error: null,
        },
      ]);
    }
  },
);

cliTest(
  "explains an unreadable v1 signer comparison through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-v1-unknown-");
    const path = join(root, "unreadable-v1.apk");
    await writeFile(
      path,
      withSigningBlock(
        await zipWith([
          { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
          { name: "META-INF/CERT.RSA", data: "not pkcs7" },
        ]),
        [{ id: APK_SIGNATURE_V2_ID, value: v2SchemeValue(LEAF_CERTIFICATE) }],
      ),
    );
    const run = await cli.run({
      arguments: ["inspect-apk-signature", path, "--json"],
    });
    expect(run.exitCode, run.stderr).toBe(0);
    const call = await cli.sharedMcpCall!();
    const mcp = await call("inspect_apk_signature", {
      path,
      detail: "complete",
    });
    expect(mcp.isError).not.toBe(true);
    for (const evidence of [
      completeEvidence(run.json),
      completeEvidence(mcp.structuredContent),
    ]) {
      expect(
        evidence.normalized_result.posture.v1_signers_match_block_signers,
      ).toBeNull();
      expect(
        evidence.normalized_result.schemes.v1.signers[0]?.decode_error,
      ).toContain("malformed PKCS#7");
      const comparisonLimitation = evidence.limitations.find((limitation) =>
        limitation.includes("v1_signers_match_block_signers"),
      );
      expect(comparisonLimitation).toContain("v1 signer identit");
      expect(comparisonLimitation).toContain("unknown");
    }
  },
);

cliTest(
  "keeps a subjectKeyIdentifier v1 signer out of the posture match, as apksig cannot resolve it",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-v1-ski-");
    // The same key in v1 and v2, but the JAR block names it by
    // subjectKeyIdentifier, which apksig cannot resolve.
    const keyIdentified = join(root, "v1-ski-v2.apk");
    await writeFile(
      keyIdentified,
      withSigningBlock(
        await zipWith([
          { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0" },
          { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
          { name: "META-INF/CERT.EC", data: OPENSSL_BLOCK_KEY_ID },
        ]),
        [{ id: APK_SIGNATURE_V2_ID, value: v2SchemeValue(LEAF_CERTIFICATE) }],
      ),
    );

    const run = await cli.run({
      arguments: ["inspect-apk-signature", keyIdentified, "--json"],
    });
    expect(run.exitCode, run.stderr).toBe(0);
    const cliKeyIdentified = completeEvidence(run.json);

    expect(cliKeyIdentified.normalized_result.schemes.v1.signers).toMatchObject(
      [
        {
          certificate: { sha256_fingerprint: LEAF_SHA256 },
          signer_infos: [
            {
              identified_by: "subject-key-identifier",
              certificate_sha256: LEAF_SHA256,
            },
          ],
          decode_error: null,
        },
      ],
    );
    expect(
      cliKeyIdentified.normalized_result.posture.v1_signers_match_block_signers,
    ).toBeNull();
    expect(cliKeyIdentified.limitations.join(" ")).toContain(
      "META-INF/CERT.EC: a SignerInfo names its certificate by subjectKeyIdentifier, which apksig does not resolve",
    );
  },
);

cliTest(
  "keeps a v1 signer unknown where apksig refuses its signature block entry",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-v1-entry-");
    const block = "META-INF/CERT.EC";
    // apksigner writes local headers with sizes, not data descriptors.
    const signed = await zipWith(
      [
        { name: "classes.dex", data: "dex" },
        { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0" },
        { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
        { name: block, data: OPENSSL_BLOCK_ISSUER_SERIAL },
      ],
      { dataDescriptor: false },
    );
    const padded = await zipWith(
      [
        { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
        {
          name: block,
          data: Uint8Array.from([...OPENSSL_BLOCK_ISSUER_SERIAL, 0, 0]),
        },
      ],
      { dataDescriptor: false },
    );
    const mutated = async (
      name: string,
      mutate: (bytes: Buffer, at: { central: number; local: number }) => void,
    ) => {
      const bytes = Buffer.from(signed);
      mutate(bytes, zipEntryOffsets(signed, block));
      const path = join(root, name);
      await writeFile(path, bytes);
      return path;
    };
    const flagEncrypted = (bytes: Buffer, central: number, local: number) => {
      bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
      bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) | 1, local + 6);
    };
    // apksig ignores the encryption flag: plain bytes still decode, and
    // bytes that really are scrambled fail to decode.
    const flagged = await mutated(
      "encrypted-flag.apk",
      (bytes, { central, local }) => {
        flagEncrypted(bytes, central, local);
      },
    );
    const cases = [
      [await mutated("intact.apk", () => undefined), null],
      [flagged, null],
      [
        await mutated("encrypted-bytes.apk", (bytes, { central, local }) => {
          flagEncrypted(bytes, central, local);
          const start =
            local +
            30 +
            bytes.readUInt16LE(local + 26) +
            bytes.readUInt16LE(local + 28);
          for (let i = 0; i < bytes.readUInt32LE(local + 18); i += 1)
            bytes.writeUInt8(
              (bytes.readUInt8(start + i) ^ 0x5a) & 0xff,
              start + i,
            );
        }),
        /^(malformed PKCS#7: |signature block deflate stream is damaged)/,
      ],
      [
        await mutated("local-size-plus1.apk", (bytes, { local }) => {
          bytes.writeUInt32LE(bytes.readUInt32LE(local + 18) + 1, local + 18);
        }),
        /^local header compressed size \d+ differs from the central directory's \d+$/,
      ],
      [
        await mutated("local-name-differs.apk", (bytes, { local }) => {
          bytes.write("META-INF/CERT.XY", local + 30, "latin1");
        }),
        "local header name differs from the central directory's",
      ],
      [
        await mutated("zip64-sentinel.apk", (bytes, { central }) => {
          bytes.writeUInt32LE(0xffffffff, central + 24);
        }),
        "Zip64 entry sizes are not read",
      ],
    ] as const;
    // Bytes after the ContentInfo are ignored, as apksig ignores them, and
    // reported as a limitation rather than refusing the block.
    const paddedPath = join(root, "trailing-bytes.apk");
    await writeFile(paddedPath, padded);
    const paddedResult = await cli.run({
      arguments: ["inspect-apk-signature", paddedPath, "--json"],
    });
    expect(paddedResult.exitCode, paddedResult.stderr).toBe(0);
    const paddedEvidence = completeEvidence(paddedResult.json);
    expect(paddedEvidence.normalized_result.schemes.v1.signers).toMatchObject([
      { certificate: { sha256_fingerprint: LEAF_SHA256 }, decode_error: null },
    ]);
    expect(paddedEvidence.limitations).toContain(
      `${block}: 2 bytes follow the PKCS#7 ContentInfo and were ignored, as apksig ignores them.`,
    );

    const flaggedResult = await cli.run({
      arguments: ["inspect-apk-signature", flagged, "--json"],
    });
    expect(flaggedResult.exitCode, flaggedResult.stderr).toBe(0);
    expect(completeEvidence(flaggedResult.json).limitations).toContain(
      `${block}: the entry declares encryption (general-purpose flag bit 0); apksig ignores the flag, so its bytes were read as stored and the PKCS#7 decoding decides.`,
    );

    const { call } = await connectLocalToolsMcp();
    for (const [path, decodeError] of cases) {
      const result = await call("inspect_apk_signature", {
        path,
        detail: "complete",
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const report = completeEvidence(
        result.structuredContent,
      ).normalized_result;
      const [signer, ...rest] = report.schemes.v1.signers;
      expect(rest, path).toEqual([]);
      if (decodeError === null) {
        expect(signer?.decode_error, path).toBeNull();
        expect(signer?.certificate?.sha256_fingerprint, path).toBe(LEAF_SHA256);
        continue;
      }
      // Unknown, not absent: the signer stays listed without a certificate.
      expect(report.schemes.v1.present, path).toBe(true);
      expect(signer?.certificate, path).toBeNull();
      if (typeof decodeError === "string")
        expect(signer?.decode_error, path).toBe(decodeError);
      else expect(signer?.decode_error, path).toMatch(decodeError);
    }
  },
);

cliTest(
  "flags any duplicate central-directory name as apksig rejects it",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-v1-duplicate-");
    const block = "META-INF/CERT.EC";
    // Two blocks with one name: apksig rejects the v1 signature
    // ("Duplicate entry"); REA keeps one signer for the name, unknown.
    const duplicated = join(root, "duplicate-names.apk");
    const twoBlocks = Buffer.from(
      await zipWith(
        [
          { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
          { name: block, data: OPENSSL_BLOCK_ISSUER_SERIAL },
          { name: "META-INF/CERU.EC", data: OPENSSL_BLOCK_KEY_ID },
        ],
        { dataDescriptor: false },
      ),
    );
    const second = zipEntryOffsets(twoBlocks, "META-INF/CERU.EC");
    twoBlocks.write(block, second.central + 46, "latin1");
    twoBlocks.write(block, second.local + 30, "latin1");
    await writeFile(duplicated, twoBlocks);
    const duplicatedResult = await cli.run({
      arguments: ["inspect-apk-signature", duplicated, "--json"],
    });
    expect(duplicatedResult.exitCode, duplicatedResult.stderr).toBe(0);
    const duplicatedEvidence = completeEvidence(duplicatedResult.json);
    expect(duplicatedEvidence.normalized_result.schemes.v1).toMatchObject({
      present: true,
      block_files: [block, block],
      signers: [
        {
          block_file: block,
          certificate: null,
          decode_error: `duplicate entry: ${block}`,
        },
      ],
    });
    expect(duplicatedEvidence.limitations.join(" ")).toContain(
      `holds 1 name more than once ("${block}")`,
    );

    // apksig rejects the v1 signature for any duplicate name: a duplicated
    // manifest makes every signer unknown, and a duplicate outside the signing
    // names is reported while the signers stay as declared.
    const renamed = async (name: string, from: string, to: string) => {
      const archive = Buffer.from(
        await zipWith(
          [
            { name: "classes.dex", data: "dex" },
            { name: "classes.dey", data: "dex2" },
            { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0" },
            { name: "META-INF/MANIFEST.MX", data: "Manifest-Version: 1.0" },
            { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
            { name: block, data: OPENSSL_BLOCK_ISSUER_SERIAL },
          ],
          { dataDescriptor: false },
        ),
      );
      const at = zipEntryOffsets(archive, from);
      archive.write(to, at.central + 46, "latin1");
      archive.write(to, at.local + 30, "latin1");
      const path = join(root, name);
      await writeFile(path, archive);
      const run = await cli.run({
        arguments: ["inspect-apk-signature", path, "--json"],
      });
      expect(run.exitCode, run.stderr).toBe(0);
      return completeEvidence(run.json);
    };
    const manifestTwice = await renamed(
      "duplicate-manifest.apk",
      "META-INF/MANIFEST.MX",
      "META-INF/MANIFEST.MF",
    );
    expect(manifestTwice.normalized_result.schemes.v1.signers).toMatchObject([
      {
        certificate: null,
        decode_error: "duplicate entry: META-INF/MANIFEST.MF",
      },
    ]);
    expect(manifestTwice.limitations.join(" ")).toContain(
      'holds 1 name more than once ("META-INF/MANIFEST.MF")',
    );
    const dexTwice = await renamed(
      "duplicate-dex.apk",
      "classes.dey",
      "classes.dex",
    );
    expect(dexTwice.normalized_result.schemes.v1.signers).toMatchObject([
      { certificate: { sha256_fingerprint: LEAF_SHA256 }, decode_error: null },
    ]);
    expect(dexTwice.limitations.join(" ")).toContain(
      'holds 1 name more than once ("classes.dex"); apksig rejects the v1 signature of an archive with any duplicate entry ("Duplicate entry")',
    );
  },
);

/** A central directory with no entry data, ended by a classic or Zip64 EOCD. */
const directoryOnly = (names: readonly Buffer[]): Buffer => {
  const cd = Buffer.concat(
    names.flatMap((name) => {
      const fixed = Buffer.alloc(46);
      fixed.writeUInt32LE(0x02014b50, 0);
      fixed.writeUInt16LE(name.length, 28);
      return [fixed, name];
    }),
  );
  const zip64 = names.length > 0xfffe;
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeBigUInt64LE(BigInt(names.length), 24);
    record.writeBigUInt64LE(BigInt(names.length), 32);
    record.writeBigUInt64LE(BigInt(cd.length), 40);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(cd.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Math.min(names.length, 0xffff), 8);
  eocd.writeUInt16LE(Math.min(names.length, 0xffff), 10);
  eocd.writeUInt32LE(cd.length, 12);
  return Buffer.concat([cd, ...tail, eocd]);
};

cliTest(
  "names duplicates as apksig decodes and counts them, quoted and bounded",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-duplicate-names-");
    const limitationsOf = async (name: string, names: readonly Buffer[]) => {
      const path = join(root, name);
      await writeFile(path, directoryOnly(names));
      const run = await cli.run({
        arguments: ["inspect-apk-signature", path, "--json"],
      });
      expect(run.exitCode, run.stderr).toBe(0);
      const { limitations } = completeEvidence(run.json);
      for (const note of limitations) expect(note.length).toBeLessThan(4096);
      return limitations.filter(
        (note) => note.includes("records") || note.includes("more than once"),
      );
    };
    const latin1 = (text: string) => Buffer.from(text, "latin1");

    // apksigner: "Duplicate entry: dup\uFFFD" (Java decodes both as dup + U+FFFD).
    expect(
      await limitationsOf("malformed.apk", [
        latin1("dup\xff"),
        latin1("dup\xfe"),
      ]),
    ).toEqual([
      expect.stringContaining('holds 1 name more than once ("dup\uFFFD")'),
    ]);
    // apksigner: "Duplicate entry: " (the empty name).
    expect(
      await limitationsOf("empty.apk", [Buffer.alloc(0), Buffer.alloc(0)]),
    ).toEqual([expect.stringContaining('holds 1 name more than once ("");')]);

    // Long names are cut at 256 bytes with their stored length; the count stays exact.
    const long = [
      "L".repeat(0xffff),
      ...[..."ABCDEF"].map((c) => c.repeat(60_000)),
    ].flatMap((name) => [latin1(name), latin1(name)]);
    const [longNote] = await limitationsOf("long.apk", long);
    expect(longNote).toContain(
      `holds 7 names more than once ("${"L".repeat(256)}"… (65535-byte name), "${"A".repeat(256)}"… (60000-byte name),`,
    );
    expect(longNote).toContain(
      "… (60000-byte name) and 2 more); apksig rejects",
    );

    // apksig reads only the classic EOCD's 65,535 records of a Zip64 directory.
    const many = Array.from({ length: 70_000 }, (_, i) =>
      latin1(`f${String(i)}`),
    );
    const zip64 = await limitationsOf("zip64.apk", [
      ...many,
      latin1("f0"),
      latin1("f0"),
      latin1("f1"),
      latin1("f69999"),
    ]);
    expect(zip64).toEqual([
      'apksig reads only the first 65535 of the 70004 central-directory records (it takes the count from the classic end-of-central-directory record\'s 16-bit field and ignores the Zip64 count). 3 names ("f0", "f1", "f69999") are duplicated only by records past those, which apksig does not read.',
    ]);
  },
);

cliTest(
  "reads a v1 block whose local and central names differ only in malformed bytes Java decodes alike",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apk-v1-malformed-name-");
    // apksig compares the decoded names: CERT\xff and CERT\xfe are both
    // CERT + U+FFFD, which also pairs the block with CERT�.SF.
    const archive = Buffer.from(
      await zipWith(
        [
          { name: "META-INF/CERT�.SF", data: "Signature-Version: 1.0" },
          { name: "META-INF/CERTX.EC", data: OPENSSL_BLOCK_ISSUER_SERIAL },
        ],
        { dataDescriptor: false },
      ),
    );
    const at = zipEntryOffsets(archive, "META-INF/CERTX.EC");
    archive.write("META-INF/CERT\xff.EC", at.central + 46, "latin1");
    archive.write("META-INF/CERT\xfe.EC", at.local + 30, "latin1");
    const path = join(root, "malformed-name.apk");
    await writeFile(path, archive);
    const run = await cli.run({
      arguments: ["inspect-apk-signature", path, "--json"],
    });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(
      completeEvidence(run.json).normalized_result.schemes.v1.signers,
    ).toMatchObject([
      {
        signature_file: "META-INF/CERT�.SF",
        block_file: "META-INF/CERT�.EC",
        certificate: { sha256_fingerprint: LEAF_SHA256 },
        decode_error: null,
      },
    ]);
  },
);
