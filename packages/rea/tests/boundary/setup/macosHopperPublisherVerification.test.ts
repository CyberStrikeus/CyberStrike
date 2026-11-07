import { execFile } from "node:child_process";
import { appendFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  macHopperInstallDisclosure,
  systemMacHopperInstallHost,
} from "../../../src/application/MacHopper.js";
import { verifyMacHopperNativeHelper } from "../../../src/hopper/HopperMacPublisher.js";
import { HOPPER_PUBLISHER } from "../../../src/domain/hopperPublisher.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const run = promisify(execFile);
const itDarwin = it.skipIf(process.platform !== "darwin");
const executableSegments = ["Contents", "MacOS", "hopper"];

const infoPlist = (identifier: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${identifier}</string>
  <key>CFBundleExecutable</key>
  <string>hopper</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
`;

/** Build a minimal `.app` whose launcher is a real signed Mach-O copy. */
const buildBundle = async (
  root: string,
  identifier: string,
  options: { readonly sign?: boolean } = {},
): Promise<string> => {
  const app = join(root, "Hopper Disassembler.app");
  const executable = join(app, ...executableSegments);
  await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
  await copyFile("/usr/bin/true", executable);
  await writeFile(join(app, "Contents", "Info.plist"), infoPlist(identifier));
  if (options.sign !== false)
    await run("/usr/bin/codesign", [
      "--sign",
      "-",
      "--force",
      "--deep",
      "--identifier",
      identifier,
      app,
    ]);
  return app;
};

const host = () =>
  systemMacHopperInstallHost("/home/rea-test", { ...process.env });

describe("macOS Hopper publisher verification", () => {
  itDarwin(
    "rejects an ad-hoc signed bundle carrying the pinned bundle identifier",
    async () => {
      const root = await createTestTempDirectory("rea-hopper-publisher-");
      const app = await buildBundle(root, HOPPER_PUBLISHER.bundleIdentifier);
      // The pre-pinned checks accept this bundle: `codesign --verify` succeeds
      // for ad-hoc signatures and the identifier clause alone also matches.
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
      await expect(host().validBundle(app)).resolves.toBe(
        "unverified_publisher",
      );
    },
  );

  itDarwin("rejects an unsigned bundle before any copy", async () => {
    const root = await createTestTempDirectory("rea-hopper-unsigned-");
    const app = await buildBundle(root, HOPPER_PUBLISHER.bundleIdentifier, {
      sign: false,
    });
    await expect(host().validBundle(app)).resolves.toBe("invalid_signature");
  });

  itDarwin("rejects a bundle modified after it was signed", async () => {
    const root = await createTestTempDirectory("rea-hopper-tampered-");
    const app = await buildBundle(root, HOPPER_PUBLISHER.bundleIdentifier);
    await appendFile(join(app, ...executableSegments), "appended\n");
    await expect(host().validBundle(app)).resolves.toBe("invalid_signature");
  });

  it("discloses the exact code requirement the installer enforces", () => {
    expect(macHopperInstallDisclosure.commands).toContain(
      `codesign --verify --strict '-R= identifier "${HOPPER_PUBLISHER.bundleIdentifier}" and anchor apple generic and certificate leaf[subject.OU] = "${HOPPER_PUBLISHER.teamIdentifier}"' <mounted-hopper.app>`,
    );
  });

  itDarwin(
    "withholds native-helper provenance from custom signed or modified executables",
    async () => {
      const root = await createTestTempDirectory(
        "rea-hopper-helper-publisher-",
      );
      const app = await buildBundle(root, "hopper");
      const executable = join(app, ...executableSegments);
      await expect(
        verifyMacHopperNativeHelper(executable, process.env),
      ).resolves.toBe("unknown");
      await appendFile(executable, "modified\n");
      await expect(
        verifyMacHopperNativeHelper(executable, process.env),
      ).resolves.toBe("unknown");
    },
  );

  // Opt-in positive control: point this at a mounted official Hopper bundle,
  // for example `hdiutil attach -readonly -nobrowse Hopper-6.6.0-demo.dmg`.
  // It proves the pinned requirement is satisfiable by the real publisher, so
  // a quoting or argument mistake cannot hide behind the rejection arms.
  const realApp = process.env.REA_HOPPER_MACOS_APP;
  it.skipIf(realApp === undefined)(
    "accepts the officially signed Hopper application",
    async () => {
      await expect(host().validBundle(realApp ?? "")).resolves.toBe("verified");
      await expect(
        verifyMacHopperNativeHelper(
          join(realApp ?? "", ...executableSegments),
          process.env,
        ),
      ).resolves.toBe("verified");
    },
  );
});
