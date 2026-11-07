import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { windowsNativeArtifactFixture } from "../../tests/fixtures/windowsNativeArtifact.js";
import { inspectWindowsNativeReadiness } from "../process/WindowsAuthority.js";
import {
  loadWindowsNativeAuthority,
  type WindowsNativeLoadHost,
} from "./WindowsNativeLoader.js";

const fixture = (
  capabilities: {
    protocolStdin?: boolean;
    jobMemoryLimit?: unknown;
    privateBridgeDescriptorAccess?: unknown;
  } = {},
) => {
  const { bytes, manifest } = windowsNativeArtifactFixture();
  const identity = {
    requestedPath: "D:\\fixture\\runtime",
    finalPath: "\\\\?\\D:\\fixture\\runtime",
    filesystem: "NTFS",
    volumeSerial: "0123456789abcdef",
    fileId: "0123456789abcdef0123456789abcdef",
    size: 0,
    directory: true,
  };
  let loads = 0;
  const host: WindowsNativeLoadHost = {
    platform: "win32",
    architecture: "x64",
    nodeApiVersion: "8",
    packageVersion: "1.0.0",
    readManifest: () => manifest,
    readArtifact: () => bytes,
    loadArtifact: () => {
      loads++;
      return {
        call: () => ({
          abiVersion: 1,
          nodeApiVersion: 8,
          architecture: "x64",
          filesystem: identity,
          privateDacl: true,
          privateBridgeDescriptorAccess: true,
          atomicJobAssignment: true,
          killOnOwnerClose: true,
          ...capabilities,
        }),
      };
    },
  };
  return { host, manifest, bytes, loads: () => loads };
};

describe("packaged Windows native compatibility", () => {
  it.each([true, false])(
    "preserves protocol stdin capability %s alongside existing job controls",
    (protocolStdin) => {
      const value = fixture({ protocolStdin });
      expect(loadWindowsNativeAuthority(value.host)).toMatchObject({
        available: true,
        authority: {
          inspection: {
            protocolStdin,
            atomicJobAssignment: true,
            killOnOwnerClose: true,
          },
        },
      });
    },
  );
  it("admits the Job Object memory limit control only as an affirmative observation", () => {
    expect(
      loadWindowsNativeAuthority(fixture({ jobMemoryLimit: true }).host),
    ).toMatchObject({
      available: true,
      authority: { inspection: { jobMemoryLimit: true } },
    });
    // Earlier artifacts omit the control; callers must refuse a limit then.
    const earlier = loadWindowsNativeAuthority(fixture().host);
    if (!earlier.available) throw new Error(earlier.reason);
    expect(earlier.authority.inspection.jobMemoryLimit).toBeUndefined();
    expect(
      loadWindowsNativeAuthority(fixture({ jobMemoryLimit: false }).host)
        .available,
    ).toBe(false);
  });
  it("loads only after compatibility and digest checks, preserving producer identity", () => {
    const value = fixture();
    expect(loadWindowsNativeAuthority(value.host)).toMatchObject({
      available: true,
      authority: {
        inspection: { filesystem: { requestedPath: "D:\\fixture\\runtime" } },
      },
    });
    expect(value.loads()).toBe(1);
  });

  it.each([
    [{ platform: "linux" as const }, "host"],
    [{ architecture: "arm64" }, "host"],
    [{ nodeApiVersion: "7" }, "host"],
    [{ nodeApiVersion: undefined }, "host"],
    [{ packageVersion: "2.0.0" }, "artifact"],
  ] as const)(
    "rejects incompatible host metadata before loading: %j",
    (override, failureStage) => {
      const value = fixture();
      expect(
        loadWindowsNativeAuthority({ ...value.host, ...override }),
      ).toMatchObject({ available: false, failureStage });
      expect(value.loads()).toBe(0);
    },
  );

  it("names the absent packaged manifest and matching-version recovery", () => {
    const value = fixture();
    const missing = Object.assign(new Error("file absent"), {
      code: "ENOENT",
    });
    expect(
      loadWindowsNativeAuthority({
        ...value.host,
        readManifest: () => {
          throw missing;
        },
      }),
    ).toMatchObject({
      available: false,
      failureStage: "artifact",
      reason: expect.stringMatching(
        /Missing packaged Windows native file native\/windows\/build\/manifest\.json \(ENOENT\).*native\/windows\/build\/rea-windows-x64\.node.*native\/windows\/README\.md/u,
      ),
    });
    expect(value.loads()).toBe(0);
  });
});

describe("packaged Windows native artifact validation", () => {
  it("rejects tampering even when the original file was a valid PE image", () => {
    const value = fixture();
    value.bytes[127] = 1;
    expect(loadWindowsNativeAuthority(value.host)).toMatchObject({
      available: false,
      failureStage: "artifact",
      reason: expect.stringContaining("SHA-256"),
    });
    expect(value.loads()).toBe(0);
  });

  it.each(["abiVersion", "nodeApiVersion", "architecture", "artifact"])(
    "rejects invalid manifest %s",
    (key) => {
      const value = fixture();
      expect(
        loadWindowsNativeAuthority({
          ...value.host,
          readManifest: () => ({ ...value.manifest, [key]: "invalid" }),
        }).available,
      ).toBe(false);
      expect(value.loads()).toBe(0);
    },
  );

  it.each([
    { signature: "MZ", offset: 0 },
    { signature: "PE", offset: 64 },
  ])(
    "rejects digest-valid high-bit $signature lookalikes before loading",
    ({ offset }) => {
      const value = fixture();
      value.bytes[offset] = (value.bytes[offset] ?? 0) | 0x80;
      value.manifest.artifactSha256 = createHash("sha256")
        .update(value.bytes)
        .digest("hex");
      expect(loadWindowsNativeAuthority(value.host).available).toBe(false);
      expect(value.loads()).toBe(0);
    },
  );

  it("rejects a digest-valid artifact for another machine", () => {
    const value = fixture();
    value.bytes.writeUInt16LE(0xaa64, 68);
    value.manifest.artifactSha256 = createHash("sha256")
      .update(value.bytes)
      .digest("hex");
    expect(loadWindowsNativeAuthority(value.host)).toMatchObject({
      available: false,
      reason: expect.stringContaining("PE32+"),
    });
    expect(value.loads()).toBe(0);
  });

  it("preserves host permission failure rather than promoting a partial probe", () => {
    const value = fixture();
    expect(
      loadWindowsNativeAuthority({
        ...value.host,
        loadArtifact: () => ({
          call: () => {
            throw new Error("private DACL: access denied");
          },
        }),
      }),
    ).toMatchObject({
      available: false,
      failureStage: "self-test",
      retryable: true,
      reason: expect.stringContaining("private DACL: access denied"),
    });
  });

  it("explains an OS policy refusal of the verified artifact without file-restore advice", () => {
    const value = fixture();
    const loaded = loadWindowsNativeAuthority({
      ...value.host,
      loadArtifact: () => {
        throw new Error(
          "An Application Control policy has blocked this file.\r\n\\\\?\\C:\\rea\\rea-windows-x64.node",
        );
      },
    });
    expect(loaded).toMatchObject({
      available: false,
      failureStage: "load",
      reason: expect.stringContaining(
        "An Application Control policy has blocked this file.",
      ),
    });
    expect(loaded).not.toHaveProperty("retryable");
    const readiness = inspectWindowsNativeReadiness("win32", loaded);
    expect(readiness).toMatchObject({
      code: "runtime_missing",
      remediation: expect.stringContaining("Smart App Control"),
    });
    expect(readiness).not.toMatchObject({
      remediation: expect.stringContaining("restore native/windows/build"),
    });
  });

  it("requires every inspected native fact", () => {
    const value = fixture();
    const loaded = loadWindowsNativeAuthority({
      ...value.host,
      loadArtifact: () => ({ call: () => ({ privateDacl: true }) }),
    });
    expect(loaded.available).toBe(false);
    expect(loaded).toMatchObject({ failureStage: "inspection" });
    expect(loaded).not.toHaveProperty("retryable");
  });

  it("rejects Windows controls without handle-bound Cutter descriptor access", () => {
    const value = fixture({ privateBridgeDescriptorAccess: undefined });
    expect(loadWindowsNativeAuthority(value.host)).toMatchObject({
      available: false,
      reason: expect.stringContaining("privateBridgeDescriptorAccess"),
    });
  });
});
