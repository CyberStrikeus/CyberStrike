import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  installMacHopper,
  type MacHopperBundleVerification,
  type MacHopperBundleInstallResult,
  type MacHopperInstallHost,
} from "./MacHopper.js";

class FakeMacHopperHost implements MacHopperInstallHost {
  readonly archive = new TextEncoder().encode("hopper-dmg");
  archiveOk = true;
  feedBytes: Uint8Array | undefined;
  packageDownloads = 0;
  mounts = 0;
  verification: MacHopperBundleVerification = "verified";
  existing = false;
  mountSucceeds = true;
  copySucceeds = true;
  mountFailure: Error | undefined;
  verificationFailure: Error | undefined;
  badHash = false;
  unmounts = 0;
  cleanups = 0;
  installs = 0;
  opens = 0;
  replaces = false;

  download = (url: string) => {
    if (!url.includes("files-api")) this.packageDownloads += 1;
    return Promise.resolve(
      url.includes("files-api")
        ? {
            ok: true,
            bytes:
              this.feedBytes ??
              new TextEncoder().encode(
                JSON.stringify({
                  "OS X": {
                    filename:
                      "https://www.hopperapp.com:443/downloader/public/Hopper-demo.dmg",
                    file_length: String(this.archive.byteLength),
                    file_hash: this.badHash
                      ? "0".repeat(40)
                      : createHash("sha1").update(this.archive).digest("hex"),
                  },
                }),
              ),
          }
        : { ok: this.archiveOk, bytes: this.archive },
    );
  };
  createTemporaryDirectory = () => Promise.resolve("/tmp/rea-hopper-test");
  createMountDirectory = () => Promise.resolve();
  writePackage = () => Promise.resolve();
  mount = () => {
    this.mounts += 1;
    return this.mountFailure === undefined
      ? Promise.resolve(this.mountSucceeds)
      : Promise.reject(this.mountFailure);
  };
  unmount = () => {
    this.unmounts += 1;
    return Promise.resolve();
  };
  appBundle = () => Promise.resolve("/mounted/Hopper Disassembler.app");
  validBundle = () =>
    this.verificationFailure === undefined
      ? Promise.resolve(this.verification)
      : Promise.reject(this.verificationFailure);
  destinationExists = () => Promise.resolve(this.existing);
  installBundle = (
    _source: string,
    _destination: string,
    replaceExisting: boolean,
  ) => {
    this.installs += 1;
    this.replaces = replaceExisting;
    return Promise.resolve<MacHopperBundleInstallResult>(
      this.copySucceeds
        ? { status: "installed" }
        : {
            status: "failed",
            reason: "copy",
            diagnostic: "ditto: destination is read-only",
          },
    );
  };
  openApplication = () => {
    this.opens += 1;
    return Promise.resolve();
  };
  cleanup = () => {
    this.cleanups += 1;
    return Promise.resolve();
  };
  destination = () => "/home/user/Applications/Hopper Disassembler.app";
}

describe("macOS Hopper installation", () => {
  it("installs, verifies, opens, and cleans the official package", async () => {
    const host = new FakeMacHopperHost();
    await expect(installMacHopper({}, host)).resolves.toEqual({
      status: "installed",
      launcherPath:
        "/home/user/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
    });
    expect(host.opens).toBe(1);
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });

  it("preserves installation when macOS cannot open the installed app", async () => {
    const host = new FakeMacHopperHost();
    host.openApplication = () =>
      Promise.reject(new Error("LaunchServices refused"));

    await expect(installMacHopper({}, host)).resolves.toEqual({
      status: "installed",
      launcherPath:
        "/home/user/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
      openFailure: "LaunchServices refused",
    });
    expect(host.installs).toBe(1);
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });

  it("rejects an integrity mismatch before mounting", async () => {
    const host = new FakeMacHopperHost();
    host.badHash = true;
    await expect(installMacHopper({}, host)).resolves.toEqual({
      status: "failed",
      reason: "integrity",
    });
    expect(host.unmounts).toBe(0);
    expect(host.cleanups).toBe(0);
  });

  it("refuses to overwrite an existing application", async () => {
    const host = new FakeMacHopperHost();
    host.existing = true;
    await expect(installMacHopper({}, host)).resolves.toEqual({
      status: "failed",
      reason: "destination_exists",
    });
  });

  it("replaces the managed application when explicitly requested", async () => {
    const host = new FakeMacHopperHost();
    host.existing = true;

    await expect(
      installMacHopper({ replaceExisting: true }, host),
    ).resolves.toMatchObject({ status: "installed" });
    expect(host.replaces).toBe(true);
  });

  it("cleans and detaches after bundle validation fails", async () => {
    const host = new FakeMacHopperHost();
    host.verification = "invalid_signature";
    await expect(installMacHopper({}, host)).resolves.toEqual({
      status: "failed",
      reason: "bundle",
    });
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });

  it("preserves a thrown mount-stage diagnostic and cleans the temporary image", async () => {
    const host = new FakeMacHopperHost();
    host.mountFailure = new Error("hdiutil attach: resource busy");

    await expect(installMacHopper({}, host)).resolves.toMatchObject({
      status: "failed",
      reason: "mount",
      diagnostic: "hdiutil attach: resource busy",
    });
    expect(host.unmounts).toBe(0);
    expect(host.cleanups).toBe(1);
  });

  it("preserves the copy diagnostic from the owned install operation", async () => {
    const host = new FakeMacHopperHost();
    host.copySucceeds = false;

    await expect(installMacHopper({}, host)).resolves.toMatchObject({
      status: "failed",
      reason: "copy",
      diagnostic: "ditto: destination is read-only",
    });
    expect(host.installs).toBe(1);
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });

  it("reports a publisher mismatch without copying or launching the bundle", async () => {
    const host = new FakeMacHopperHost();
    host.verification = "unverified_publisher";
    await expect(installMacHopper({}, host)).resolves.toEqual({
      status: "failed",
      reason: "publisher_verification_failed",
    });
    expect(host.installs).toBe(0);
    expect(host.opens).toBe(0);
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });

  it("preserves a thrown signature-check diagnostic as a bundle failure", async () => {
    const host = new FakeMacHopperHost();
    host.verificationFailure = new Error("codesign: helper unavailable");

    await expect(installMacHopper({}, host)).resolves.toMatchObject({
      status: "failed",
      reason: "bundle",
      diagnostic: "codesign: helper unavailable",
    });
    expect(host.installs).toBe(0);
    expect(host.unmounts).toBe(1);
    expect(host.cleanups).toBe(1);
  });
});

it("reports an unresolved destination probe without claiming an existing installation", async () => {
  const host = new FakeMacHopperHost();
  host.destinationExists = async () => {
    throw Object.assign(new Error("destination inspection denied"), {
      code: "EACCES",
    });
  };
  expect(await installMacHopper({ replaceExisting: true }, host)).toMatchObject(
    {
      status: "failed",
      reason: "destination_inspection",
      diagnostic: "destination inspection denied",
    },
  );
  expect(host.installs).toBe(0);
  expect(host.unmounts).toBe(0);
});

it("retains the exact DMG temporary root with its retry capability", async () => {
  const host = new FakeMacHopperHost();
  const retained: {
    close: () => Promise<void>;
    resources: readonly string[];
  }[] = [];
  let allowCleanup = false;
  const result = await installMacHopper(
    {},
    {
      ...host,
      cleanup: async () => {
        if (!allowCleanup) throw new Error("DMG root busy");
      },
      retainCleanup: (close, resources) => {
        retained.push({ close, resources });
      },
    },
  );
  expect(result).toMatchObject({
    status: "installed",
    cleanupFailure: expect.stringContaining("DMG root busy"),
  });
  expect(retained).toHaveLength(1);
  expect(retained[0]?.resources).toEqual(["/tmp/rea-hopper-test"]);
  allowCleanup = true;
  await expect(retained[0]!.close()).resolves.toBeUndefined();
});

it("refuses malformed UTF-8 release metadata before downloading or mounting the package", async () => {
  const host = new FakeMacHopperHost();
  const feed = await host.download("files-api");
  const text = new TextDecoder().decode(feed.bytes);
  // Replacement decoding would produce valid JSON and hide the malformed transport byte.
  host.feedBytes = new Uint8Array([
    ...new TextEncoder().encode('{"vendor_note":"'),
    0xff,
    ...new TextEncoder().encode('",' + text.slice(1)),
  ]);
  expect(await installMacHopper({}, host)).toMatchObject({
    status: "failed",
    reason: "release_metadata",
  });
  expect(host.packageDownloads).toBe(0);
  expect(host.mounts).toBe(0);
  expect(host.installs).toBe(0);
});

it.each([false, true])(
  "accepts a genuine replacement character in release metadata (BOM=%s)",
  async (bom) => {
    const host = new FakeMacHopperHost();
    const feed = await host.download("files-api");
    const text = new TextDecoder()
      .decode(feed.bytes)
      .replace('{"OS X":{', '{"OS X":{"vendor_note":"雪�",');
    host.feedBytes = new TextEncoder().encode((bom ? "\uFEFF" : "") + text);
    expect(await installMacHopper({}, host)).toMatchObject({
      status: "installed",
    });
    expect(host.packageDownloads).toBe(1);
    expect(host.mounts).toBe(1);
    expect(host.installs).toBe(1);
  },
);

it("refuses release URLs that normalize outside the public channel before package download", async () => {
  const host = new FakeMacHopperHost();
  const feed = await host.download("files-api");
  const row = JSON.parse(new TextDecoder().decode(feed.bytes));
  row["OS X"].filename =
    "https://www.hopperapp.com:443/downloader/public/%2e%2e/private/Hopper-demo.dmg";
  host.feedBytes = new TextEncoder().encode(JSON.stringify(row));

  expect(await installMacHopper({}, host)).toMatchObject({
    status: "failed",
    reason: "release_metadata",
  });
  expect(host.packageDownloads).toBe(0);
  expect(host.mounts).toBe(0);
});
