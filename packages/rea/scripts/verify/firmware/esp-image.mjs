#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withVerifierCleanup } from "../../lib/verifier-cleanup.mjs";
import {
  assertAgrees,
  buildElf,
  checkTools,
  commands,
  elf2image,
  execute,
  exitOutput,
  extract,
  imageInfo,
  inspect,
  options,
  refusal,
  source,
  spell,
  tool,
  xtensa,
} from "./esp-image-tools.mjs";

let workspace;
const path = (name) => join(workspace, name);

await withVerifierCleanup(async () => {
  const { compilerVersion, esptoolVersion, xtensaVersion } = await checkTools();
  workspace = await mkdtemp(join(tmpdir(), "rea-esp-image-proof-"));
  const report = {
    esptool: esptoolVersion,
    compiler: compilerVersion,
    images: [],
    extractions: [],
  };
  const app = await buildElf("app.c", "app.ld", path("app.elf"));
  const boot = await buildElf(
    "bootloader.c",
    "bootloader.ld",
    path("boot.elf"),
  );
  const esp8266 = await buildElf(
    "bootloader.c",
    "esp8266.ld",
    path("esp8266.elf"),
  );
  const appDescriptor = ["--elf-sha256-offset", "0xb0"];
  await elf2image("esp32c3", app, path("app.bin"), appDescriptor);
  await elf2image("esp32c3", app, path("app-nodigest.bin"), [
    ...appDescriptor,
    "--dont-append-digest",
  ]);
  await elf2image("esp32c3", app, path("app-pad.bin"), [
    ...appDescriptor,
    "--secure-pad-v2",
  ]);
  await elf2image("esp32c3", app, path("app-ram.bin"), ["--ram-only-header"]);
  await elf2image("esp32c3", app, path("app-filled.bin"), [
    ...appDescriptor,
    "--pad-to-size",
    "1MB",
  ]);
  await elf2image("esp32c3", boot, path("boot.bin"));
  await tool("esptool", [
    "--chip",
    "esp8266",
    "elf2image",
    "--version",
    "1",
    "-o",
    path("esp8266-"),
    esp8266,
  ]);

  // Producer goldens: REA and esptool image-info agree field by field. Each
  // class follows from the region app.ld or bootloader.ld places a section in;
  // esptool adds the address-0 padding that aligns the flash text.
  const appClasses = ["mapped", "loaded", "loaded", "not-loaded", "mapped"];
  for (const [name, classes] of [
    ["app.bin", appClasses],
    ["app-nodigest.bin", appClasses],
    ["app-pad.bin", [...appClasses, "not-loaded"]],
    ["boot.bin", ["loaded", "loaded"]],
  ]) {
    const [oracle, rea] = await Promise.all([
      imageInfo(path(name)),
      inspect(path(name)),
    ]);
    assertAgrees(name, oracle, rea);
    assert.equal(rea.inventory.coverage.status, "complete", name);
    assert.deepEqual(
      rea.segments.map(
        ({ format_metadata: segment }) => segment.classification,
      ),
      classes,
      `${name} classes`,
    );
    report.images.push({
      name,
      role: rea.root.descriptor?.kind ?? "unknown",
      segments: rea.segments.map(
        ({ format_metadata: segment }) =>
          `${segment.index}:0x${segment.load_addr.toString(16)}:${segment.classification}`,
      ),
      checksum: rea.root.checksum.status,
      sha256: rea.root.appended_sha256.status,
    });
  }
  const padded = await inspect(path("app-pad.bin"));
  // --secure-pad-v2 ends the digest on a 64 KiB boundary with an address-0
  // padding segment, which ESP-IDF neither maps nor loads.
  assert.equal(padded.root.image_end % 0x1_0000, 0);
  assert.equal(padded.segments.at(-1).format_metadata.load_addr, 0);

  // Signed: blocks are observed; espsecure is the oracle for their key digests.
  const generate = spell("generate_signing_key", "generate-signing-key");
  const sign = spell("sign_data", "sign-data");
  await tool("espsecure", [
    generate,
    "--version",
    "2",
    "--scheme",
    "rsa3072",
    path("rsa.pem"),
  ]);
  for (const scheme of ["ecdsa256", "ecdsa384"])
    await tool("espsecure", [
      generate,
      "--version",
      "2",
      "--scheme",
      scheme,
      path(`${scheme}.pem`),
    ]);
  await tool("espsecure", [
    sign,
    "--version",
    "2",
    "--keyfile",
    path("rsa.pem"),
    "--output",
    path("signed-rsa.bin"),
    path("app-pad.bin"),
  ]);
  // Append one ECDSA P-256 and one P-384 block after the RSA block.
  for (const [scheme, input, output] of [
    ["ecdsa256", "signed-rsa.bin", "signed-p256.bin"],
    ["ecdsa384", "signed-p256.bin", "signed.bin"],
  ])
    await tool("espsecure", [
      sign,
      "--version",
      "2",
      spell("--append_signatures", "--append-signatures"),
      "--keyfile",
      path(`${scheme}.pem`),
      "--output",
      path(output),
      path(input),
    ]);
  const signatureInfo = await tool("espsecure", [
    spell("signature_info_v2", "signature-info-v2"),
    path("signed.bin"),
  ]);
  const keyDigests = [
    ...signatureInfo.matchAll(
      /Public key digest for block (\d+): ((?:[0-9a-f]{2} ?){32})/gu,
    ),
  ].map((match) => match[2].replaceAll(" ", ""));
  const signed = await inspect(path("signed.bin"));
  assertAgrees("signed.bin", await imageInfo(path("signed.bin")), signed);
  assert.equal(signed.root.signature_sector_offset, padded.root.image_end);
  assert.deepEqual(signed.root.undescribed_trailing, []);
  assert.equal(signed.inventory.coverage.status, "complete");
  assert.deepEqual(
    signed.signatures.map(({ format_metadata: block }) => [
      block.index,
      block.scheme,
      block.digest_algorithm,
      block.image_digest_matches,
      block.public_key_sha256,
      block.signature_status,
    ]),
    [
      [0, "rsa", "sha256", true, keyDigests[0], "unverified"],
      [1, "ecdsa", "sha256", true, keyDigests[1], "unverified"],
      [2, "ecdsa", "sha384", true, keyDigests[2], "unverified"],
    ],
  );
  report.images.push({
    name: "signed.bin",
    signatures: signed.signatures.map(
      ({ format_metadata: block }) =>
        `${block.scheme}:${block.public_key_sha256}`,
    ),
  });

  // Extraction writes the producer's bytes and leaves the source unchanged.
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  // espsecure appends the signature sector to the --secure-pad-v2 image.
  const sectorOffset = (await readFile(path("app-pad.bin"))).length;
  for (const name of ["app.bin", "signed.bin"]) {
    const bytes = await readFile(path(name));
    const digest = sha256(bytes);
    const expected = new Map(
      (await imageInfo(path(name))).segments.map(
        ({ index, headerOffset, length }) => [
          `segment-${String(index).padStart(2, "0")}.bin`,
          bytes.subarray(headerOffset + 8, headerOffset + 8 + length),
        ],
      ),
    );
    if (name === "signed.bin") {
      assert.equal(bytes.length, sectorOffset + 0x1000, "signature sector");
      for (const slot of [0, 1, 2])
        expected.set(
          `signature-block-${String(slot)}.bin`,
          bytes.subarray(
            sectorOffset + slot * 1216,
            sectorOffset + (slot + 1) * 1216,
          ),
        );
    }
    const extraction = await extract(path(name), workspace);
    assert.equal(extraction.containment_verified, true, name);
    assert.equal(extraction.manifest.root_sha256, digest, `${name} source`);
    assert.deepEqual(
      extraction.artifacts.map(({ relative_path }) => relative_path).sort(),
      [...expected.keys()].sort(),
      `${name} entries`,
    );
    for (const {
      relative_path: entry,
      sha256: written,
    } of extraction.artifacts) {
      const content = await readFile(join(extraction.output_root, entry));
      assert.ok(content.equals(expected.get(entry)), `${name} ${entry}`);
      assert.equal(written, sha256(content), `${name} ${entry} digest`);
    }
    assert.equal(sha256(await readFile(path(name))), digest, `${name} source`);
    report.extractions.push({ name, entries: extraction.artifacts.length });
  }

  // --ram-only-header counts only RAM segments; the rest is coverage.
  const ram = await inspect(path("app-ram.bin"));
  const ramOracle = await imageInfo(path("app-ram.bin"));
  assertAgrees("app-ram.bin", ramOracle, ram);
  const ramBytes = await readFile(path("app-ram.bin"));
  assert.equal(ram.inventory.coverage.status, "unknown");
  assert.deepEqual(ram.root.undescribed_trailing, [
    {
      offset: ram.root.image_end,
      length: ramBytes.length - ram.root.image_end,
    },
  ]);
  report.images.push({
    name: "app-ram.bin",
    undescribed_trailing: ram.root.undescribed_trailing,
  });

  // --pad-to-size fills to the size with 0xFF, which describes erased flash.
  const filled = await inspect(path("app-filled.bin"));
  assertAgrees(
    "app-filled.bin",
    await imageInfo(path("app-filled.bin")),
    filled,
  );
  assert.equal((await readFile(path("app-filled.bin"))).length, 0x10_0000);
  assert.deepEqual(filled.root.undescribed_trailing, []);
  assert.equal(filled.inventory.coverage.status, "complete");
  report.images.push({ name: "app-filled.bin", coverage: "complete" });

  // Malformed cases derived from producer output.
  const image = await readFile(path("app.bin"));
  const noDigest = await readFile(path("app-nodigest.bin"));
  const flipLast = (bytes) => {
    const copy = Buffer.from(bytes);
    copy[copy.length - 1] ^= 0x01;
    return copy;
  };
  await writeFile(path("bad-checksum.bin"), flipLast(noDigest));
  await writeFile(path("bad-sha256.bin"), flipLast(image));
  await writeFile(path("truncated.bin"), image.subarray(0, 0x1000));
  for (const [name, checksum, sha256] of [
    ["bad-checksum.bin", "invalid", "not-appended"],
    ["bad-sha256.bin", "valid", "invalid"],
  ]) {
    const [oracle, rea] = await Promise.all([
      imageInfo(path(name)),
      inspect(path(name)),
    ]);
    assertAgrees(name, oracle, rea);
    assert.equal(rea.root.checksum.status, checksum, name);
    assert.equal(rea.root.appended_sha256.status, sha256, name);
    report.images.push({ name, checksum, sha256 });
  }
  const truncatedOracle = await imageInfo(path("truncated.bin")).then(
    () => "loaded",
    exitOutput,
  );
  assert.match(truncatedOracle, /End of file reading segment/u);
  const truncated = await inspect(path("truncated.bin"));
  assert.equal(truncated.inventory.manifest.root_format, "esp-image");
  assert.equal(truncated.inventory.coverage.status, "unknown");
  assert.equal(truncated.root.checksum.status, "unavailable");
  const truncatedSegment = truncated.segments.at(-1);
  assert.ok(truncatedSegment);
  assert.ok(Number.isSafeInteger(truncatedSegment.declared_size));
  assert.ok(truncatedSegment.source_location);
  assert.equal(
    truncatedSegment.source_location.offset + truncatedSegment.declared_size,
    0x1000,
  );
  assert.ok(
    truncatedSegment.format_metadata.data_len > truncatedSegment.declared_size,
  );
  assert.ok(truncatedSegment.limitations.length > 0);
  report.images.push({ name: "truncated.bin", coverage: "unknown" });

  if (xtensa === undefined)
    report.images.push({
      name: "app-esp32.bin",
      skipped: "REA_XTENSA_ESP32_GCC is unset",
    });
  else {
    await execute(
      xtensa,
      [
        "-nostdlib",
        "-static",
        "-Os",
        "-mlongcalls",
        "-mtext-section-literals",
        `-Wl,-T,${source("esp32-app.ld")}`,
        "-Wl,--build-id=none",
        source("app.c"),
        "-o",
        path("app-esp32.elf"),
      ],
      options,
    );
    await elf2image(
      "esp32",
      path("app-esp32.elf"),
      path("app-esp32.bin"),
      appDescriptor,
    );
    const [oracle, rea] = await Promise.all([
      imageInfo(path("app-esp32.bin")),
      inspect(path("app-esp32.bin")),
    ]);
    assertAgrees("app-esp32.bin", oracle, rea);
    assert.deepEqual(rea.root.chip, {
      target: "esp32",
      isa: "xtensa",
      source: "ESP-IDF v6.1",
    });
    assert.deepEqual(
      rea.segments.map(
        ({ format_metadata: segment }) => segment.classification,
      ),
      ["mapped", "loaded", "loaded", "not-loaded", "mapped"],
    );
    report.images.push({
      name: "app-esp32.bin",
      compiler: xtensaVersion,
      segments: rea.segments.map(
        ({ format_metadata: segment }) =>
          `${segment.index}:0x${segment.load_addr.toString(16)}:${segment.classification}`,
      ),
    });
  }

  // ESP8266 v3 (RTOS SDK) images begin with their IROM segment.
  const esp8266App = await buildElf(
    "app.c",
    "esp8266-app.ld",
    path("esp8266-app.elf"),
  );
  await tool("esptool", [
    "--chip",
    "esp8266",
    "elf2image",
    "--version",
    "3",
    "-o",
    path("esp8266-v3.bin"),
    esp8266App,
  ]);
  const v3Oracle = await imageInfo(path("esp8266-v3.bin"), "esp8266");
  assert.ok((v3Oracle.segments[0]?.address ?? 0) >= 0x4020_0000);
  assert.match(
    await refusal(path("esp8266-v3.bin")),
    /ESP8266 firmware images are not supported/u,
  );
  report.images.push({ name: "esp8266-v3.bin", refused: true });

  // ESP8266 v1: esptool falls back to ESP8266; REA refuses it by name.
  const esp8266Image = path("esp8266-0x00000.bin");
  assert.equal((await imageInfo(esp8266Image)).detected, "ESP8266");
  assert.match(
    await refusal(esp8266Image),
    /ESP8266 firmware images are not supported/u,
  );
  report.images.push({ name: "esp8266-0x00000.bin", refused: true });
  console.log(JSON.stringify(report, null, 2));
}, [
  // Remove outputs only after every owned command tree has stopped; a failed
  // close keeps the workspace for inspection.
  async () => {
    await commands.close();
    if (workspace !== undefined)
      await rm(workspace, { recursive: true, force: true });
  },
]);
