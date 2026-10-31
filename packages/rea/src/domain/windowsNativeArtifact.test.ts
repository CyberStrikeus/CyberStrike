import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { windowsNativeArtifactFixture } from "../../tests/fixtures/windowsNativeArtifact.js";
import {
  createWindowsNativeManifest,
  parseWindowsNativeManifest,
  validateWindowsNativeArtifact,
} from "./windowsNativeArtifact.js";

it("produces and admits the exact manifest/byte identity", () => {
  const { bytes, manifest } = windowsNativeArtifactFixture();
  const created = createWindowsNativeManifest("1.0.0", bytes);
  expect(created).toEqual({ ok: true, value: manifest });
  const parsed = parseWindowsNativeManifest(manifest, "1.0.0");
  expect(parsed).toEqual(created);
  if (!parsed.ok) throw parsed.error;
  expect(validateWindowsNativeArtifact(parsed.value, bytes)).toEqual({
    ok: true,
    value: undefined,
  });
  expect(parseWindowsNativeManifest(manifest, "2.0.0")).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining("another REA version") },
  });
  expect(
    validateWindowsNativeArtifact(parsed.value, Buffer.alloc(128)),
  ).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining("SHA-256") },
  });
});

it.each([null, [], {}, "manifest"])(
  "rejects malformed manifest %j",
  (value) => {
    expect(parseWindowsNativeManifest(value, "1.0.0")).toMatchObject({
      ok: false,
      error: { _tag: "WindowsNativeArtifactError" },
    });
  },
);

it("rejects missing and unknown manifest fields", () => {
  const { manifest } = windowsNativeArtifactFixture();
  expect(
    parseWindowsNativeManifest({ ...manifest, extra: true }, "1.0.0"),
  ).toMatchObject({ ok: false });
  for (const key of Object.keys(manifest)) {
    const incomplete: Record<string, unknown> = { ...manifest };
    delete incomplete[key];
    expect(parseWindowsNativeManifest(incomplete, "1.0.0")).toMatchObject({
      ok: false,
    });
    expect(
      parseWindowsNativeManifest({ ...manifest, [key]: null }, "1.0.0"),
    ).toMatchObject({ ok: false });
  }
});

it.each([
  "platform",
  "architecture",
  "abiVersion",
  "nodeApiVersion",
  "artifact",
  "artifactSha256",
])("rejects unsupported %s", (key) => {
  const { manifest } = windowsNativeArtifactFixture();
  expect(
    parseWindowsNativeManifest({ ...manifest, [key]: "unsupported" }, "1.0.0"),
  ).toMatchObject({ ok: false });
});

it.each([0, 63, 64, 89, 128])(
  "rejects invalid PE content in %i bytes",
  (length) => {
    expect(
      createWindowsNativeManifest("1.0.0", Buffer.alloc(length)),
    ).toMatchObject({ ok: false });
  },
);

it.each(["offset", "signature", "machine", "optional magic"])(
  "rejects invalid PE %s with a matching digest",
  (field) => {
    const { bytes } = windowsNativeArtifactFixture();
    if (field === "offset") bytes.writeUInt32LE(0xffff_ffff, 0x3c);
    if (field === "signature") bytes.write("BAD!", 64, "ascii");
    if (field === "machine") bytes.writeUInt16LE(0x14c, 68);
    if (field === "optional magic") bytes.writeUInt16LE(0x10b, 88);
    const { manifest } = windowsNativeArtifactFixture();
    manifest.artifactSha256 = createHash("sha256").update(bytes).digest("hex");
    const parsed = parseWindowsNativeManifest(manifest, "1.0.0");
    if (!parsed.ok) throw parsed.error;
    expect(validateWindowsNativeArtifact(parsed.value, bytes)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("PE32+") },
    });
  },
);

it.each([0, 1, 65, 0xffff])(
  "rejects an unavailable declared optional header of %i bytes",
  (length) => {
    const { bytes } = windowsNativeArtifactFixture();
    bytes.writeUInt16LE(length, 84);
    expect(createWindowsNativeManifest("1.0.0", bytes)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("PE32+") },
    });
  },
);

it.each([2, 32, 63, 64])(
  "admits PE32+ identity in a present declared header of %i bytes",
  (length) => {
    const { bytes } = windowsNativeArtifactFixture();
    bytes.writeUInt16LE(length, 84);
    expect(createWindowsNativeManifest("1.0.0", bytes)).toMatchObject({
      ok: true,
    });
  },
);
