import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  formatCommandForDisplay,
  installLinuxHopper,
  linuxPackageManagerCommands,
  linuxSharedLibrariesAvailable,
  parseLinuxDistribution,
  supportsReaHost,
  LinuxHopperTemporaryCleanupOwner,
  systemLinuxHopperInstallHost,
  type LinuxDistribution,
  type LinuxHopperInstallHost,
  type LinuxHopperLauncherStatus,
  type LinuxPackageInstallFailure,
  type LinuxPackageInstallOutcome,
} from "./LinuxHopper.js";
import type { HopperDownload } from "./HopperDownload.js";
import { err, ok } from "../domain/result.js";
import {
  type LinuxPackageFamily,
  HopperReleaseError,
  type LinuxHopperRelease,
} from "./HopperReleaseFeed.js";
import type { VerifiedLinuxHopperPackage } from "./LinuxHopperPublisher.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import * as nativeCommands from "../process/ExecFileOutput.js";
import * as pythonRuntime from "./LinuxHopperPython.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

describe("Linux package-manager command display", () => {
  it("preserves argument boundaries for paths with spaces and quotes", () => {
    expect(
      formatCommandForDisplay("pkexec", [
        "pacman",
        "-U",
        "/tmp/rea test/hopper.arch",
        "apostrophe'path",
      ]),
    ).toBe('pkexec pacman -U "/tmp/rea test/hopper.arch" "apostrophe\'path"');
  });
});

class RecordingLinuxHost implements LinuxHopperInstallHost {
  distributionValue: LinuxDistribution | undefined = {
    id: "ubuntu",
    versionId: "24.04",
    packageFamily: "deb",
    hopperSetupSupported: true,
  };
  archive = new Uint8Array([1, 2, 3]);
  archiveOk = true;
  installSucceeds = true;
  cleanupFails = false;
  signatureValid = true;
  cacheWritable = true;
  verifiedBeforeInstall = false;
  packageFailure: LinuxPackageInstallFailure = {
    command: "pacman -U --noconfirm /tmp/rea test/hopper.arch",
    exitCode: 1,
    stdout: "",
    stderr: "error: failed to prepare transaction",
    outputTruncated: false,
  };
  launcherStatusValue: LinuxHopperLauncherStatus = "ready";
  downloads: string[] = [];
  installed: Array<{ family: LinuxPackageFamily; archive: string }> = [];
  cleaned: string[] = [];

  distribution = (): Promise<LinuxDistribution | undefined> =>
    Promise.resolve(this.distributionValue);
  release = (family: LinuxPackageFamily) =>
    Promise.resolve(ok(releasesFor(new Uint8Array([1, 2, 3]))[family]));
  download = (url: string): Promise<HopperDownload> => {
    this.downloads.push(url);
    return Promise.resolve({ ok: this.archiveOk, bytes: this.archive });
  };
  createTemporaryDirectory = (): Promise<string> =>
    Promise.resolve("/tmp/rea test");
  writeArchive = (): Promise<void> => Promise.resolve();
  verifyArchive = (family: LinuxPackageFamily, release: LinuxHopperRelease) => {
    if (
      createHash("sha1").update(this.archive).digest("hex") !==
      release.file_hash
    )
      return Promise.resolve(
        err(new HopperReleaseError("integrity", "Fixture byte mismatch")),
      );
    if (!this.signatureValid)
      return Promise.resolve(
        err(
          new HopperReleaseError(
            "publisher_verification_failed",
            "Fixture signature rejection",
          ),
        ),
      );
    this.verifiedBeforeInstall = true;
    return Promise.resolve(
      ok({
        family,
        release,
        packageSha256: createHash("sha256").update(this.archive).digest("hex"),
        publicKey: "fixture",
        primaryFingerprint: "0".repeat(40),
        signingFingerprint: "1".repeat(40),
      }),
    );
  };
  retainVerifiedArchive = (_verified: VerifiedLinuxHopperPackage) =>
    Promise.resolve(
      this.cacheWritable
        ? ok(undefined)
        : err(
            new HopperReleaseError(
              "verification_unavailable",
              "Fixture cache permission rejection",
            ),
          ),
    );
  installPackage = (
    family: LinuxPackageFamily,
    archive: string,
    _options?: { readonly signal?: AbortSignal },
  ): Promise<LinuxPackageInstallOutcome> => {
    if (!this.verifiedBeforeInstall)
      throw new Error("Package manager ran before publisher verification");
    this.installed.push({ family, archive });
    const outcome: LinuxPackageInstallOutcome = this.installSucceeds
      ? { status: "installed" }
      : { status: "failed", failure: this.packageFailure };
    return Promise.resolve(outcome);
  };
  launcherStatus = (): Promise<LinuxHopperLauncherStatus> =>
    Promise.resolve(this.launcherStatusValue);
  cleanup = (path: string): Promise<void> => {
    this.cleaned.push(path);
    return this.cleanupFails
      ? Promise.reject(new Error("temporary path is busy"))
      : Promise.resolve();
  };
}

const TESTED_DISTRIBUTIONS = [
  ['ID=ubuntu\nVERSION_ID="24.04"\n', "deb"],
  ["ID=fedora\nVERSION_ID=41\n", "rpm"],
  ['ID=nobara\nVERSION_ID="44"\nID_LIKE="rhel centos fedora"\n', "rpm"],
  ["ID=arch\n", "arch"],
  ["ID=cachyos\nID_LIKE=arch\n", "arch"],
  ['ID=omarchy\nID_LIKE=arch\nVERSION_ID="4.0.4"\n', "arch"],
] as const;

describe("Linux Hopper host classification", () => {
  it.each(TESTED_DISTRIBUTIONS)(
    "accepts an explicitly supported distribution",
    (document, family) => {
      expect(parseLinuxDistribution(document, "x64")).toMatchObject({
        packageFamily: family,
        hopperSetupSupported: true,
      });
    },
  );

  it.each(TESTED_DISTRIBUTIONS)(
    "keeps the x86_64-only Hopper package off an arm64 host running %s",
    (document, family) => {
      const distribution = parseLinuxDistribution(document, "arm64");
      expect(distribution).toMatchObject({
        packageFamily: family,
        hopperSetupSupported: false,
      });
      expect(supportsReaHost(distribution)).toBe(true);
    },
  );

  it("detects unresolved or loader-reported shared libraries", () => {
    expect(
      linuxSharedLibrariesAvailable(
        "libQt6Network.so.6 => not found\nlibc.so.6 => /lib/libc.so.6",
      ),
    ).toBe(false);
    expect(
      linuxSharedLibrariesAvailable(
        "error while loading shared libraries: libQt6Gui.so.6",
      ),
    ).toBe(false);
    expect(
      linuxSharedLibrariesAvailable(
        "libQt6Network.so.6 => /usr/lib/libQt6Network.so.6",
      ),
    ).toBe(true);
  });

  it.each([
    'ID=ubuntu\nVERSION_ID="22.04"\n',
    "ID=fedora\nVERSION_ID=40\n",
    'ID=nobara\nVERSION_ID="43"\nID_LIKE="rhel centos fedora"\n',
    'ID=derivative\nVERSION_ID="44"\nID_LIKE="rhel centos fedora"\n',
    'ID=debian\nVERSION_ID="13"\nID_LIKE=debian\n',
    "ID=manjaro\nID_LIKE=arch\n",
    "ID=garuda\nID_LIKE=arch\n",
    "ID=omarchy\n",
    "ID=omarchy\nID_LIKE=debian\n",
  ])(
    "rejects vendor/version combinations without a tested Hopper installer",
    (document) => {
      expect(parseLinuxDistribution(document, "x64").hopperSetupSupported).toBe(
        false,
      );
    },
  );

  it.each([
    'ID=kali\nVERSION_ID="2026.3"\nID_LIKE=debian\n',
    'ID=debian\nVERSION_ID="13"\nID_LIKE=debian\n',
    'ID=linuxmint\nVERSION_ID="22.1"\nID_LIKE="ubuntu debian"\n',
    "ID=manjaro\nID_LIKE=arch\n",
    "ID=derivative\nID_LIKE='debian'\n",
    "ID='debian'\nVERSION_ID='13'\n",
  ])(
    "hosts REA on a distribution Hopper has no tested package for: %s",
    (document) => {
      const distribution = parseLinuxDistribution(document, "x64");
      expect(distribution.hopperSetupSupported).toBe(false);
      expect(supportsReaHost(distribution)).toBe(true);
    },
  );

  it("withholds host support from a distribution with no package family", () => {
    expect(supportsReaHost(parseLinuxDistribution("ID=nixos\n", "x64"))).toBe(
      false,
    );
    expect(supportsReaHost(undefined)).toBe(false);
  });
});

describe("Linux Hopper installation", () => {
  it.each([
    ["deb", "apt-get", ["xvfb", "xauth", "python3", "libx11-6", "libxtst6"]],
    [
      "rpm",
      "dnf",
      [
        "xorg-x11-server-Xvfb",
        "xorg-x11-xauth",
        "python3",
        "libX11",
        "libXtst",
      ],
    ],
    [
      "arch",
      "pacman",
      ["xorg-server-xvfb", "xorg-xauth", "python", "libx11", "libxtst"],
    ],
  ] as const)(
    "selects the %s native package manager and dependencies",
    (family, executable, packages) => {
      expect(
        linuxPackageManagerCommands(family, "/tmp/Hopper package", true),
      ).toContainEqual(
        expect.objectContaining({
          executable,
          args: expect.arrayContaining([...packages]),
        }),
      );
      expect(
        linuxPackageManagerCommands(family, "/tmp/Hopper package", false),
      ).toContainEqual(
        expect.objectContaining({
          executable: "pkexec",
          args: expect.arrayContaining([executable, "/tmp/Hopper package"]),
        }),
      );
    },
  );

  it.each([true, false])(
    "keeps installed apt dependencies at their versions while Hopper may upgrade (root: %s)",
    (isRoot) => {
      const prefix = isRoot ? [] : ["pkexec"];
      expect(
        linuxPackageManagerCommands("deb", "/tmp/Hopper package", isRoot).map(
          ({ executable, args }) => [executable, ...args],
        ),
      ).toEqual([
        [
          ...prefix,
          "apt-get",
          "install",
          "-y",
          "--no-upgrade",
          "xvfb",
          "xauth",
          "python3",
          "libx11-6",
          "libxtst6",
        ],
        [...prefix, "apt-get", "install", "-y", "/tmp/Hopper package"],
      ]);
    },
  );
});

describe("Linux Hopper package installation", () => {
  it("keeps runtime inspection failure distinct from package-manager failure and cleans the archive", async () => {
    const host = new RecordingLinuxHost();
    const failure = new pythonRuntime.LinuxHopperPythonError(
      "configuration_unknown",
      "Fixture unknown runtime",
    );
    host.installPackage = async () => ({
      status: "runtime_unavailable",
      failure,
    });
    expect(await installLinuxHopper(host)).toMatchObject({
      status: "failed",
      reason: "runtime_dependencies",
      pythonRuntimeFailure: failure,
    });
    expect(host.cleaned).toEqual(["/tmp/rea test"]);
  });

  it.each(["deb", "rpm", "arch"] as const)(
    "downloads, verifies, installs, reads back, and cleans a %s package",
    async (family) => {
      const host = new RecordingLinuxHost();
      host.distributionValue = {
        id: family,
        packageFamily: family,
        hopperSetupSupported: true,
      };
      const result = await installFixture(host);
      expect(result).toEqual({
        status: "installed",
        launcherPath: "/opt/hopper/bin/Hopper",
      });
      expect(host.installed).toEqual([
        { family, archive: `/tmp/rea test/hopper.${family}` },
      ]);
      expect(host.cleaned).toEqual(["/tmp/rea test"]);
    },
  );
});

describe("Linux Hopper installation failure classification", () => {
  it.each([
    ["signatureValid", "publisher_verification_failed"],
    ["cacheWritable", "verification_unavailable"],
  ] as const)(
    "stops before privileged installation when %s fails",
    async (field, reason) => {
      const host = new RecordingLinuxHost();
      host[field] = false;
      expect(await installFixture(host)).toMatchObject({
        status: "failed",
        reason,
        verificationFailure: { reason, message: expect.any(String) },
      });
      expect(host.installed).toEqual([]);
      expect(host.cleaned).toEqual(["/tmp/rea test"]);
    },
  );
  it.each([
    ["unsupported host", "unsupported_host"],
    ["package request failure", "download"],
    ["checksum mismatch", "integrity"],
    ["package manager failure", "authorization_or_package_manager"],
    ["missing launcher", "launcher_missing"],
    ["missing runtime", "runtime_dependencies"],
    ["unsupported build", "unsupported_hopper_build"],
  ] as const)("classifies %s", async (scenario, reason) => {
    const host = new RecordingLinuxHost();
    if (scenario === "unsupported host")
      host.distributionValue = {
        id: "debian",
        packageFamily: "deb",
        hopperSetupSupported: false,
      };
    if (scenario === "package request failure") host.archiveOk = false;
    if (scenario === "checksum mismatch") host.archive = new Uint8Array([9]);
    if (scenario === "package manager failure") host.installSucceeds = false;
    if (scenario === "missing launcher") host.launcherStatusValue = "missing";
    if (scenario === "missing runtime")
      host.launcherStatusValue = "runtime_dependencies";
    if (scenario === "unsupported build")
      host.launcherStatusValue = "unsupported_hopper_build";
    expect(await installFixture(host)).toMatchObject({
      status: "failed",
      reason,
      ...(scenario === "package manager failure"
        ? { packageFailure: host.packageFailure }
        : {}),
    });
    if (host.installed.length > 0)
      expect(host.cleaned).toEqual(["/tmp/rea test"]);
  });
});

describe("Linux Hopper cleanup and failure details", () => {
  it("preserves a publisher descriptor cleanup failure during launcher status inspection", async () => {
    const directory = await createTestTempDirectory("rea-hopper-status-");
    const launcher = join(directory, "Hopper");
    await writeFile(launcher, "fixture launcher");
    const host = systemLinuxHopperInstallHost(
      {
        ...process.env,
        HOME: directory,
        XDG_CACHE_HOME: join(directory, "cache"),
      },
      async () => undefined,
    );
    const command = vi
      .spyOn(nativeCommands, "execFileOutput")
      .mockResolvedValue({
        stdout: "libc.so.6 => /lib/libc.so.6",
        stderr: "",
        stdoutBytes: Buffer.byteLength("libc.so.6 => /lib/libc.so.6"),
        stderrBytes: 0,
      });
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockRejectedValue(new Error("Fixture descriptor close unavailable"));
    try {
      await expect(host.launcherStatus(launcher, "0".repeat(64))).resolves.toBe(
        "cleanup_failed",
      );
    } finally {
      close.mockRestore();
      command.mockRestore();
      await host.close?.();
    }
  });

  it("preserves the failing package-manager command and its output", async () => {
    const host = new RecordingLinuxHost();
    host.installSucceeds = false;
    host.packageFailure = {
      command: "pkexec pacman -U --noconfirm /tmp/rea test/hopper.arch",
      exitCode: 1,
      stdout: "loading packages...",
      stderr:
        "\u001b[31merror: unresolvable package conflicts detected\u001b[0m",
      outputTruncated: false,
    };
    expect(await installFixture(host)).toEqual({
      status: "failed",
      reason: "authorization_or_package_manager",
      packageFailure: host.packageFailure,
    });
    expect(host.cleaned).toEqual(["/tmp/rea test"]);
  });

  it("preserves a successful install result when temporary cleanup fails", async () => {
    const host = new RecordingLinuxHost();
    host.cleanupFails = true;
    expect(await installFixture(host)).toEqual({
      status: "installed",
      launcherPath: "/opt/hopper/bin/Hopper",
      cleanupFailure: {
        path: "/tmp/rea test",
        reason: "temporary path is busy",
      },
    });
  });

  it("preserves an install failure when temporary cleanup also fails", async () => {
    const host = new RecordingLinuxHost();
    host.installSucceeds = false;
    host.cleanupFails = true;
    expect(await installFixture(host)).toMatchObject({
      status: "failed",
      reason: "authorization_or_package_manager",
      packageFailure: host.packageFailure,
      cleanupFailure: {
        path: "/tmp/rea test",
        reason: "temporary path is busy",
      },
    });
  });
});

describe("Linux Hopper cancellation", () => {
  it("cancels before network or mutation", async () => {
    const host = new RecordingLinuxHost();
    const controller = new AbortController();
    controller.abort();
    expect(
      await installLinuxHopper(host, { signal: controller.signal }),
    ).toEqual({
      status: "failed",
      reason: "cancelled",
      cancellationReason: controller.signal.reason,
    });
    expect(host.downloads).toEqual([]);
    expect(host.installed).toEqual([]);
  });

  it("forwards cancellation to package stages and retains its original cause through cleanup", async () => {
    const host = new RecordingLinuxHost();
    const controller = new AbortController();
    const cause = new Error("caller cancelled between package transactions");
    host.installPackage = async (_family, _archive, options) => {
      expect(options?.signal).toBe(controller.signal);
      expect(host.verifiedBeforeInstall).toBe(true);
      controller.abort(cause);
      return { status: "cancelled", cause };
    };
    const result = await installLinuxHopper(host, {
      signal: controller.signal,
    });
    expect(result).toMatchObject({ status: "failed", reason: "cancelled" });
    if (result.status === "failed")
      expect(result.cancellationReason).toBe(cause);
    expect(host.cleaned).toEqual(["/tmp/rea test"]);
  });
});

describe("Linux Hopper temporary cleanup ownership", () => {
  it("retains a failed cleanup for a later successful retry", async () => {
    const owner = new LinuxHopperTemporaryCleanupOwner();
    owner.retain({ path: "/tmp/rea-hopper", reason: "busy" });
    let attempts = 0;

    expect(
      await owner.retry(async () => {
        attempts += 1;
        throw new Error("still busy");
      }),
    ).toMatchObject({
      reason: expect.stringContaining("/tmp/rea-hopper"),
      resources: ["/tmp/rea-hopper"],
    });
    expect(
      await owner.retry(async () => {
        attempts += 1;
      }),
    ).toBeUndefined();
    expect(attempts).toBe(2);
  });
});

function releasesFor(
  bytes: Uint8Array,
): Record<LinuxPackageFamily, LinuxHopperRelease> {
  const release = (extension: string) => ({
    version: "future-fixture",
    filename: `https://www.hopperapp.com:443/downloader/public/Hopper-future-fixture-Linux-demo.${extension}`,
    file_length: String(bytes.byteLength),
    file_hash: createHash("sha1").update(bytes).digest("hex"),
    main_exe_hash: "0".repeat(64),
    signature: "AQ==",
    public: "1" as const,
    beta: "0" as const,
  });
  return {
    deb: release("deb"),
    rpm: release("rpm"),
    arch: release("pkg.tar.xz"),
  };
}

const installFixture = (host: RecordingLinuxHost) => installLinuxHopper(host);

it("retains archive staging failure after download and cleans the owned temporary directory", async () => {
  const host = new RecordingLinuxHost();
  host.writeArchive = async () => {
    throw Object.assign(new Error("archive write denied"), { code: "EACCES" });
  };
  expect(await installLinuxHopper(host)).toMatchObject({
    status: "failed",
    reason: "archive_write",
    operationFailure: {
      operation: "archive_write",
      path: "/tmp/rea test/hopper.deb",
      systemCode: "EACCES",
      detail: "archive write denied",
    },
  });
  expect(host.downloads).toHaveLength(1);
  expect(host.installed).toEqual([]);
  expect(host.cleaned).toEqual(["/tmp/rea test"]);
});

it("keeps an installed launcher inspection failure distinct from confirmed absence", async () => {
  const host = new RecordingLinuxHost();
  host.launcherStatusValue = {
    status: "inspection_failed",
    operation: "hash",
    path: "/opt/hopper/bin/Hopper",
    detail: "read denied",
    systemCode: "EACCES",
  };
  expect(await installLinuxHopper(host)).toMatchObject({
    status: "failed",
    reason: "launcher_inspection",
    operationFailure: { operation: "hash", systemCode: "EACCES" },
  });
  host.launcherStatusValue = "missing";
  expect(await installLinuxHopper(host)).toMatchObject({
    status: "failed",
    reason: "launcher_missing",
  });
});

it("reports missing ldd as unresolved launcher inspection while retaining actual absence", async () => {
  const root = await createTestTempDirectory(
    "rea-hopper-inspection-diagnostic-",
  );
  const launcher = join(root, "inert-launcher");
  await writeFile(launcher, "inert fixture; never executed");
  const host = systemLinuxHopperInstallHost(
    { PATH: root },
    async () => undefined,
  );
  try {
    expect(await host.launcherStatus(launcher, "0".repeat(64))).toMatchObject({
      status: "inspection_failed",
      operation: "dependencies",
      path: launcher,
      systemCode: "ENOENT",
    });
    expect(
      await host.launcherStatus(join(root, "absent"), "0".repeat(64)),
    ).toBe("missing");
  } finally {
    await host.close?.();
  }
});
