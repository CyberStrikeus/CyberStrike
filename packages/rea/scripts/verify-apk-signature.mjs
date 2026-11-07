#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseEvidence } from "../dist/domain/evidence.js";
import { computeApkContentDigest } from "../dist/domain/apkSignature/apkContentDigest.js";
import {
  locateApkSigningBlock,
  parseZipTail,
} from "../dist/domain/apkSignature/apkSigningBlock.js";
import { mcpTextValue, requireMcpOutput } from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

const execute = promisify(execFile);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => typeof v === "string"),
);

const sdkRoots = [
  environment.ANDROID_HOME,
  environment.ANDROID_SDK_ROOT,
  join(homedir(), "Android", "Sdk"),
  join(homedir(), "Library", "Android", "sdk"),
].filter((r) => typeof r === "string" && r.length > 0);

const newestExisting = async (root, sub, name) => {
  try {
    const versions = (await readdir(join(root, sub))).sort().reverse();
    for (const v of versions) {
      const candidate = join(root, sub, v, name);
      try {
        await access(candidate, constants.R_OK);
        return candidate;
      } catch {
        /* next */
      }
    }
  } catch {
    /* missing */
  }
  return undefined;
};
const resolveSdk = async (sub, name) => {
  for (const root of sdkRoots) {
    const found = await newestExisting(root, sub, name);
    if (found !== undefined) return found;
  }
  return undefined;
};
const probe = async (tool, args) => {
  try {
    await execute(tool, args);
    return true;
  } catch {
    return false;
  }
};

const apksigner = await resolveSdk("build-tools", "apksigner");
const aapt2 = await resolveSdk("build-tools", "aapt2");
const androidJar = await resolveSdk("platforms", "android.jar");
const keytool = (await probe("keytool", ["-help"])) ? "keytool" : undefined;
if ([apksigner, aapt2, androidJar, keytool].includes(undefined)) {
  if (process.argv.includes("--require-tools"))
    throw new Error(
      "APK signature lane requires apksigner, aapt2, a platform android.jar and keytool.",
    );
  console.log(
    JSON.stringify({
      status: "skipped",
      reason:
        "APK signature lane requires the Android SDK (apksigner, aapt2, platforms/android.jar) and a JDK keytool.",
    }),
  );
  process.exit(0);
}

const entrypoint =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
  fileURLToPath(new URL("./rea.mjs", import.meta.url));

const run = async (tool, args) =>
  execute(tool, args, {
    env: environment,
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });

const nodeHash = (algorithm) => {
  const hash = createHash(algorithm);
  return {
    update: (data) => {
      hash.update(data);
    },
    digest: () => new Uint8Array(hash.digest()),
  };
};

/** Change one entry byte and replace every declared content digest in the block. */
const forgeDeclaredDigests = async (original) => {
  const bytes = Buffer.from(original);
  const tail = parseZipTail(bytes);
  assert.ok(tail.ok);
  const block = locateApkSigningBlock(bytes, tail.value);
  assert.ok(block.ok && block.value !== null);
  const { blockStart } = block.value;
  const digests = () =>
    ["sha256", "sha512"].map((algorithm) =>
      Buffer.from(
        computeApkContentDigest(
          bytes,
          { tail: tail.value, blockStart, algorithm },
          nodeHash,
        ),
      ),
    );
  const before = digests();
  bytes[40] = (bytes[40] ?? 0) ^ 0xff;
  const after = digests();
  let replaced = 0;
  for (const [index, old] of before.entries())
    for (
      let at = bytes.indexOf(old, blockStart);
      at >= 0 && at < tail.value.centralDirectoryOffset;
      at = bytes.indexOf(old, at + old.length)
    ) {
      after[index].copy(bytes, at);
      replaced += 1;
    }
  assert.ok(replaced > 0, "the signed data must declare a content digest");
  return bytes;
};

/** The SDK's own verdict, parsed from `apksigner verify -v --print-certs`. */
const oracleVerify = async (apk) => {
  try {
    const { stdout } = await run(apksigner, [
      "verify",
      "-v",
      "--print-certs",
      apk,
    ]);
    const scheme = (label) =>
      new RegExp(`Verified using ${label}[^:]*: true`).test(stdout);
    return {
      verifies: true,
      v1: scheme("v1 scheme"),
      v2: scheme("v2 scheme"),
      v3: scheme("v3 scheme"),
      signerSha256:
        stdout.match(
          /Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})/,
        )?.[1] ?? null,
    };
  } catch {
    return { verifies: false };
  }
};
/** The JDK's view of the v1 (JAR) signer certificates, leaf first per signer. */
const oracleJarSigners = async (apk) => {
  const { stdout } = await run(keytool, ["-printcert", "-jarfile", apk]);
  return [...stdout.matchAll(/SHA256: ([0-9A-F:]{95})/g)].map((m) =>
    m[1].replaceAll(":", "").toLowerCase(),
  );
};
const oracleLineage = async (apk) => {
  const { stdout } = await run(apksigner, [
    "lineage",
    "--in",
    apk,
    "--print-certs",
  ]);
  return [
    ...stdout.matchAll(
      /in lineage certificate SHA-256 digest: ([0-9a-f]{64})/g,
    ),
  ].map((m) => m[1]);
};

const inspectCli = async (path) => {
  try {
    return JSON.parse(
      (
        await run(process.execPath, [
          entrypoint,
          "inspect-apk-signature",
          path,
          "--format",
          "json",
        ])
      ).stdout,
    );
  } catch (cause) {
    if (typeof cause.stdout === "string" && cause.stdout.length > 0)
      return JSON.parse(cause.stdout);
    throw cause;
  }
};

const verifierRun = createVerifierRun();
const workspace = await mkdtemp(join(tmpdir(), "rea-apk-signature-verifier-"));
const client = new Client({ name: "apk-signature-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
let cases = 0;
const failures = [];

try {
  await client.connect(transport);
  const advertised = (await client.listTools()).tools.find(
    ({ name }) => name === "inspect_apk_signature",
  );
  assert.ok(advertised?.outputSchema, "tool must advertise an output schema");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  assert.ok(ajv.validateSchema(advertised.inputSchema), "input schema invalid");
  assert.ok(
    ajv.validateSchema(advertised.outputSchema),
    "output schema invalid",
  );

  /** CLI and MCP share schema-valid Evidence, with CLI-only caller spelling. */
  const inspectBoth = async (path) => {
    const cliValue = await inspectCli(path);
    assert.equal(
      cliValue.category,
      undefined,
      JSON.stringify(cliValue).slice(0, 300),
    );
    const cli = parseEvidence(cliValue);
    const reply = await client.callTool(
      {
        name: "inspect_apk_signature",
        arguments: { path, detail: "complete" },
      },
      { timeout: 120000, toolDefinition: advertised },
    );
    assert.notEqual(reply.isError, true, mcpTextValue(reply));
    assert.ok(
      ajv.validate(advertised.outputSchema, reply.structuredContent),
      JSON.stringify(ajv.errors),
    );
    const mcp = parseEvidence(requireMcpOutput(reply, "inspect_apk_signature"));
    const { caller_input_path: callerInputPath, ...cliShared } = cli;
    assert.equal(callerInputPath, path);
    assert.equal(Object.hasOwn(mcp, "caller_input_path"), false);
    assert.deepEqual(cliShared, mcp, "CLI and MCP evidence differ");
    cases += 2;
    return mcp.normalized_result;
  };

  // A real minimal APK (binary manifest via aapt2) so apksigner can verify it.
  await writeFile(
    join(workspace, "AndroidManifest.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="tools.rea.fixture">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34"/>
  <application android:label="rea"/>
</manifest>
`,
  );
  const base = join(workspace, "base.apk");
  await run(aapt2, [
    "link",
    "-o",
    base,
    "--manifest",
    join(workspace, "AndroidManifest.xml"),
    "-I",
    androidJar,
  ]);
  const key = async (name, args) =>
    run(keytool, [
      "-genkeypair",
      "-keystore",
      join(workspace, `${name}.jks`),
      "-storepass",
      "pass123",
      "-keypass",
      "pass123",
      "-alias",
      name,
      "-validity",
      "3650",
      ...args,
    ]);
  await key("k1", [
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-dname",
    "CN=REA Lane One",
  ]);
  await key("k2", [
    "-keyalg",
    "EC",
    "-groupname",
    "secp256r1",
    "-dname",
    "CN=REA Lane Two",
  ]);
  const ks = (name) => [
    "--ks",
    join(workspace, `${name}.jks`),
    "--ks-pass",
    "pass:pass123",
  ];

  // 1) Default v2+v3 signing: schemes, signer fingerprint and self-consistency.
  const full = join(workspace, "full.apk");
  await run(apksigner, ["sign", ...ks("k1"), "--out", full, base]);
  const fullOracle = await oracleVerify(full);
  const fullReport = await inspectBoth(full);
  assert.equal(fullReport.schemes.v2.present, fullOracle.v2);
  assert.equal(fullReport.schemes.v3.present, fullOracle.v3);
  for (const scheme of ["v2", "v3"])
    assert.equal(
      fullReport.schemes[scheme].signers[0].certificate.sha256_fingerprint,
      fullOracle.signerSha256,
      `${scheme} signer fingerprint must equal apksigner's`,
    );
  assert.equal(fullReport.posture.schemes_agree_on_signer, true);
  assert.equal(
    fullReport.posture.self_consistent,
    true,
    "a freshly signed APK must be self-consistent",
  );
  assert.equal(fullReport.posture.v1_only, false);

  // 2) v1-only signing (X-Android-APK-Signed is not read, so this cannot be
  //    told apart from a v2/v3 block that was removed). Android requires v2+
  //    for targetSdk >= 30, so this case uses a legacy-target base APK. REA's
  //    v1.present is structural; apksigner's "verified using v1" is platform
  //    applicability and is false for minSdk >= 24 even when CERT.SF exists.
  await writeFile(
    join(workspace, "LegacyManifest.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="tools.rea.legacy">
  <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="29"/>
  <application android:label="rea"/>
</manifest>
`,
  );
  const legacyBase = join(workspace, "legacy-base.apk");
  await run(aapt2, [
    "link",
    "-o",
    legacyBase,
    "--manifest",
    join(workspace, "LegacyManifest.xml"),
    "-I",
    androidJar,
  ]);
  const v1only = join(workspace, "v1only.apk");
  await run(apksigner, [
    "sign",
    ...ks("k1"),
    "--v1-signing-enabled",
    "true",
    "--v2-signing-enabled",
    "false",
    "--v3-signing-enabled",
    "false",
    "--out",
    v1only,
    legacyBase,
  ]);
  const v1Oracle = await oracleVerify(v1only);
  assert.equal(v1Oracle.v1, true, "oracle should see v1");
  const v1Report = await inspectBoth(v1only);
  assert.equal(v1Report.schemes.v1.present, true);
  assert.equal(v1Report.schemes.v2.present, false);
  assert.equal(v1Report.posture.v1_only, true);
  assert.equal(v1Report.posture.strongest_scheme, "v1");
  /** REA's declared v1 signer must be the certificate apksigner and keytool name. */
  const assertV1Signer = async (apk, report, expected) => {
    const [signer, ...rest] = report.schemes.v1.signers;
    assert.equal(rest.length, 0, "one v1 signer");
    assert.equal(signer.decode_error, null, signer.decode_error ?? "");
    assert.equal(signer.certificate?.sha256_fingerprint, expected);
    assert.deepEqual(
      signer.certificates.map((c) => c.sha256_fingerprint),
      await oracleJarSigners(apk),
      "REA v1 certificates must equal keytool -printcert -jarfile",
    );
    assert.equal(signer.signer_infos[0]?.certificate_sha256, expected);
    assert.ok(signer.certificate?.subject, "v1 signer subject");
  };
  await assertV1Signer(v1only, v1Report, v1Oracle.signerSha256);
  assert.equal(v1Report.posture.v1_signers_match_block_signers, null);

  // 2b) v1 with an EC key: the block is CERT.EC (or the alias-named .EC).
  const v1ec = join(workspace, "v1ec.apk");
  await run(apksigner, [
    "sign",
    ...ks("k2"),
    "--v2-signing-enabled",
    "false",
    "--v3-signing-enabled",
    "false",
    "--out",
    v1ec,
    legacyBase,
  ]);
  const v1ecOracle = await oracleVerify(v1ec);
  const v1ecReport = await inspectBoth(v1ec);
  assert.ok(v1ecReport.schemes.v1.signers[0].block_file.endsWith(".EC"));
  await assertV1Signer(v1ec, v1ecReport, v1ecOracle.signerSha256);

  // 2c) Default signing of a legacy-target APK carries v1, v2 and v3 with one
  //     key: the v1 signer equals the block signers.
  const legacyFull = join(workspace, "legacy-full.apk");
  await run(apksigner, ["sign", ...ks("k1"), "--out", legacyFull, legacyBase]);
  const legacyOracle = await oracleVerify(legacyFull);
  assert.equal(legacyOracle.v1, true, "oracle should verify v1 too");
  const legacyReport = await inspectBoth(legacyFull);
  await assertV1Signer(legacyFull, legacyReport, legacyOracle.signerSha256);
  assert.equal(legacyReport.posture.v1_signers_match_block_signers, true);

  // 3) Key rotation: lineage certificates and a signer change the APK declares.
  const lineage = join(workspace, "lineage.bin");
  await run(apksigner, [
    "rotate",
    "--out",
    lineage,
    "--old-signer",
    ...ks("k1"),
    "--new-signer",
    ...ks("k2"),
  ]);
  const rotated = join(workspace, "rotated.apk");
  await run(apksigner, [
    "sign",
    ...ks("k1"),
    "--next-signer",
    ...ks("k2"),
    "--lineage",
    lineage,
    "--rotation-min-sdk-version",
    "28",
    "--out",
    rotated,
    base,
  ]);
  const lineageOracle = await oracleLineage(rotated);
  const rotatedReport = await inspectBoth(rotated);
  const reaLineage = rotatedReport.schemes.v3.signers[0].rotation.lineage.map(
    (n) => n.certificate.sha256_fingerprint,
  );
  assert.deepEqual(
    reaLineage,
    lineageOracle,
    "REA lineage must equal apksigner lineage (order + digests)",
  );
  // Observed: v2 (old key) and v3 (new key) differ. Declared: the lineage
  // covers both. The two facts stay separate.
  assert.equal(rotatedReport.posture.schemes_agree_on_signer, false);
  assert.equal(rotatedReport.posture.signer_change_declared_by_rotation, true);
  assert.deepEqual(
    rotatedReport.schemes.v3.signers[0].rotation.lineage.map(
      (n) => n.capabilities.installed_data,
    ),
    [true, true],
  );

  // 3a) Rotation on a legacy-target APK: v1 and v2 keep the old key, v3 the
  //     new one. v1 is compared with v2 (the lowest block scheme), so the
  //     rotation does not read as a JAR-signer mismatch.
  const rotatedLegacy = join(workspace, "rotated-legacy.apk");
  await run(apksigner, [
    "sign",
    ...ks("k1"),
    "--next-signer",
    ...ks("k2"),
    "--lineage",
    lineage,
    "--rotation-min-sdk-version",
    "28",
    "--out",
    rotatedLegacy,
    legacyBase,
  ]);
  const rotatedLegacyReport = await inspectBoth(rotatedLegacy);
  await assertV1Signer(
    rotatedLegacy,
    rotatedLegacyReport,
    fullOracle.signerSha256,
  );
  assert.equal(rotatedLegacyReport.posture.schemes_agree_on_signer, false);
  assert.equal(
    rotatedLegacyReport.posture.v1_signers_match_block_signers,
    true,
  );

  // 3a') The same rotation without v2: v1 keeps the original key and v3 signs
  //      with the new one. apksig requires the v1 signer to be the lineage's
  //      first node, so v1 is compared with that node, not the v3 signer.
  const rotatedNoV2 = join(workspace, "rotated-legacy-no-v2.apk");
  await run(apksigner, [
    "sign",
    ...ks("k1"),
    "--next-signer",
    ...ks("k2"),
    "--lineage",
    lineage,
    "--rotation-min-sdk-version",
    "28",
    "--v2-signing-enabled",
    "false",
    "--out",
    rotatedNoV2,
    legacyBase,
  ]);
  const noV2Oracle = await oracleVerify(rotatedNoV2);
  assert.equal(noV2Oracle.verifies, true, "oracle must accept v1 + rotated v3");
  assert.equal(noV2Oracle.v1, true);
  assert.equal(noV2Oracle.v2, false);
  const noV2Report = await inspectBoth(rotatedNoV2);
  assert.equal(noV2Report.schemes.v2.present, false);
  await assertV1Signer(rotatedNoV2, noV2Report, fullOracle.signerSha256);
  assert.deepEqual(
    noV2Report.schemes.v3.signers[0].rotation.lineage.map(
      (n) => n.certificate.sha256_fingerprint,
    ),
    await oracleLineage(rotatedNoV2),
  );
  assert.equal(
    noV2Report.posture.v1_signers_match_block_signers,
    true,
    "a v1 signer equal to the lineage origin is the expected rotation layout",
  );

  // 3b) Rotation targeting SDK 33 is carried by v3.1; v3 keeps the original signer.
  const rotated31 = join(workspace, "rotated31.apk");
  await run(apksigner, [
    "sign",
    ...ks("k1"),
    "--next-signer",
    ...ks("k2"),
    "--lineage",
    lineage,
    "--rotation-min-sdk-version",
    "33",
    "--out",
    rotated31,
    base,
  ]);
  assert.equal((await oracleVerify(rotated31)).verifies, true);
  const rotated31Report = await inspectBoth(rotated31);
  assert.equal(rotated31Report.schemes["v3.1"].present, true);
  assert.equal(rotated31Report.posture.strongest_scheme, "v3.1");
  const v31Signer = rotated31Report.schemes["v3.1"].signers[0];
  assert.equal(v31Signer.min_sdk, 33);
  assert.deepEqual(
    v31Signer.rotation.lineage.map((n) => n.certificate.sha256_fingerprint),
    lineageOracle,
    "v3.1 lineage must equal the apksigner lineage",
  );
  assert.equal(
    rotated31Report.schemes.v3.signers[0].certificate.sha256_fingerprint,
    fullOracle.signerSha256,
    "v3 keeps the original signer below the v3.1 SDK range",
  );
  assert.equal(rotated31Report.posture.self_consistent, true);
  assert.equal(rotated31Report.posture.schemes_agree_on_signer, false);
  assert.equal(
    rotated31Report.posture.signer_change_declared_by_rotation,
    true,
  );

  // 3c) Source stamp (apksigner requires an RSA stamp key).
  const stamped = join(workspace, "stamped.apk");
  await run(apksigner, [
    "sign",
    ...ks("k1"),
    "--stamp-signer",
    ...ks("k1"),
    "--out",
    stamped,
    base,
  ]);
  const stampedReport = await inspectBoth(stamped);
  assert.equal(stampedReport.source_stamp.present, true);
  assert.equal(stampedReport.posture.source_stamp_present, true);
  assert.equal(stampedReport.posture.self_consistent, true);
  assert.equal(stampedReport.source_stamp.decode_error, null);
  assert.equal(
    stampedReport.source_stamp.certificate?.sha256_fingerprint,
    fullOracle.signerSha256,
    "REA must read the declared stamp certificate (k1)",
  );

  // 4) One changed entry byte with the declared digest left alone: apksigner
  //    rejects it and the declared digest no longer matches the bytes.
  const tampered = join(workspace, "tampered.apk");
  await copyFile(full, tampered);
  const handle = await open(tampered, "r+");
  const byte = Buffer.alloc(1);
  await handle.read(byte, 0, 1, 40);
  byte[0] = (byte[0] ?? 0) ^ 0xff;
  await handle.write(byte, 0, 1, 40);
  await handle.close();
  assert.equal(
    (await oracleVerify(tampered)).verifies,
    false,
    "oracle must reject the tampered APK",
  );
  const tamperedReport = await inspectBoth(tampered);
  assert.equal(
    tamperedReport.posture.self_consistent,
    false,
    "REA must report the tampered APK as not self-consistent",
  );

  // 4b) The same byte change with the declared digests recomputed and written
  //     back: apksigner still rejects it (the signature no longer verifies),
  //     while the declared digests match the bytes. self_consistent is a
  //     digest comparison, not a signature verification.
  const forged = join(workspace, "forged-digest.apk");
  await writeFile(forged, await forgeDeclaredDigests(await readFile(full)));
  assert.equal(
    (await oracleVerify(forged)).verifies,
    false,
    "oracle must reject the APK with recomputed declared digests",
  );
  const forgedReport = await inspectBoth(forged);
  assert.equal(
    forgedReport.posture.self_consistent,
    true,
    "a recomputed declared digest matches the bytes without a valid signature",
  );

  // 5) Error surface: a non-ZIP file is an unsupported target, not a crash.
  const notZip = join(workspace, "not-a-zip.apk");
  await writeFile(notZip, "definitely not a zip archive");
  const refused = await inspectCli(notZip);
  assert.equal(
    refused.category,
    "unsupported_target",
    JSON.stringify(refused).slice(0, 300),
  );
  cases += 1;
} catch (cause) {
  failures.push(cause);
}

for (const close of [
  () => client.close(),
  () => transport.close(),
  () => rm(workspace, { recursive: true, force: true }),
]) {
  try {
    await close();
  } catch (cause) {
    failures.push(cause);
  }
}

if (failures.length > 0)
  throw new AggregateError(failures, "APK signature verification failed.");
console.log(
  JSON.stringify(
    {
      status: "passed",
      cases,
      toolchain: "android-apksigner-aapt2",
      entrypoint,
      verifier: await completeVerifierRun(verifierRun),
    },
    null,
    2,
  ),
);
