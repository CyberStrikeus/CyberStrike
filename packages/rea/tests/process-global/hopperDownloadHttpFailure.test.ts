import { afterEach, expect, it, vi } from "vitest";

import { createDoctorHostFixture } from "../../src/application/Doctor.fixture.js";
import { downloadHopperPackage } from "../../src/application/HopperDownload.js";
import {
  systemLinuxHopperInstallHost,
  type LinuxHopperInstallHost,
} from "../../src/application/LinuxHopper.js";
import { systemSetupHost } from "../../src/application/SetupHost.js";
import { ok } from "../../src/domain/result.js";

vi.mock("../../src/application/LinuxHopper.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/application/LinuxHopper.js")
  >()),
  systemLinuxHopperInstallHost: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const url =
  "https://www.hopperapp.com/downloader/public/Hopper-fixture-Linux-demo.deb";
const generic =
  "REA could not download or unpack the official Hopper package. Check network and filesystem access, then retry setup.";

const installHost = (): LinuxHopperInstallHost => {
  const unexpected = vi.fn((): never => {
    throw new Error("Unexpected installation effect");
  });
  return {
    distribution: async () => ({
      id: "ubuntu",
      versionId: "24.04",
      packageFamily: "deb",
      hopperSetupSupported: true,
    }),
    release: async () =>
      ok({
        version: "fixture",
        filename: url,
        file_length: "1",
        file_hash: "0".repeat(40),
        main_exe_hash: "0".repeat(64),
        signature: "AA==",
        public: "1",
        beta: "0",
      }),
    download: downloadHopperPackage,
    createTemporaryDirectory: unexpected,
    writeArchive: unexpected,
    installPackage: unexpected,
    verifyArchive: unexpected,
    retainVerifiedArchive: unexpected,
    launcherStatus: unexpected,
    cleanup: unexpected,
  };
};

const setupFailure = async () => {
  vi.mocked(systemLinuxHopperInstallHost).mockReturnValue(installHost());
  const host = systemSetupHost(
    createDoctorHostFixture({ platform: "linux" }),
    {},
  );
  try {
    return await host.installHopper(false);
  } finally {
    expect(await host.close?.()).toBeUndefined();
  }
};

it.each([404, 503])(
  "preserves HTTP %i from download through Linux setup diagnostics",
  async (status) => {
    const cancel = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () => new Response(new ReadableStream({ cancel }), { status }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await downloadHopperPackage(url)).toEqual({
      ok: false,
      bytes: new Uint8Array(),
      httpStatus: status,
    });
    expect(await setupFailure()).toEqual({
      status: "failed",
      code: "download_failed",
      remediation: `download: Package download returned HTTP ${status}. ${generic}`,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(2);
  },
);

it.each([undefined, null, 0, 200, 600, 503.5, "503", Number.NaN])(
  "keeps generic diagnostics when the failed response status is %s",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
        const response = new Response(null, { status: 503 });
        Object.defineProperty(response, "status", { value: status });
        return response;
      }),
    );
    expect(await downloadHopperPackage(url)).toEqual({
      ok: false,
      bytes: new Uint8Array(),
    });
    expect(await setupFailure()).toEqual({
      status: "failed",
      code: "download_failed",
      remediation: generic,
    });
  },
);

it("keeps a successful download unchanged", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("package")),
  );
  expect(await downloadHopperPackage(url)).toEqual({
    ok: true,
    bytes: Buffer.from("package"),
  });
});
