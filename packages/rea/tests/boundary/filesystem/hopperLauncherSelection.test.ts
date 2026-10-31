import { accessSync, constants, statSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect, it } from "vitest";

import {
  runDoctor,
  systemDoctorHost,
} from "../../../src/application/Doctor.js";
import { defaultHopperLauncherPath } from "../../../src/config/parseConfig.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// A real system installation legitimately precedes this isolated user fixture.
const installedSystemHopper = (home: string): boolean => {
  try {
    const launcher = defaultHopperLauncherPath("darwin", home);
    accessSync(launcher, constants.X_OK);
    return statSync(launcher).isFile();
  } catch {
    return false;
  }
};

it.for(["Hopper Disassembler.app", "Hopper A.app"])(
  "skips a directory launcher in %s and selects a real file",
  async (name, context) => {
    const home = await createTestTempDirectory("rea-hopper-selection-");
    if (installedSystemHopper(home)) context.skip();
    const invalid = join(home, "Applications", name, "Contents/MacOS/hopper");
    const valid = join(home, "Applications/Hopper Z.app/Contents/MacOS/hopper");
    await mkdir(invalid, { recursive: true });
    await mkdir(dirname(valid), { recursive: true });
    await writeFile(valid, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    expect(defaultHopperLauncherPath("darwin", home)).toBe(valid);
  },
);

it.skipIf(process.platform === "win32")(
  "runtime and doctor discover linked renamed app bundles in order without executing them",
  async () => {
    const home = await createTestTempDirectory("rea-hopper-linked-app-");
    const applications = join(home, "Applications");
    const marker = join(home, "launched");
    await mkdir(applications);
    await writeFile(marker, "unexecuted");
    const physical = join(home, "external/Preview.app");
    const executable = join(physical, "Contents/MacOS/hopper");
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(
      executable,
      `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\n`,
      { mode: 0o700 },
    );
    const plainFile = join(home, "not-an-app");
    await writeFile(plainFile, "");
    await symlink(physical, join(applications, "Other.app"));
    await symlink(join(home, "absent"), join(applications, "Hopper A.app"));
    await symlink(plainFile, join(applications, "Hopper B.app"));
    await symlink(physical, join(applications, "Hopper M.app"));
    await symlink(physical, join(applications, "Hopper Z.app"));
    const selected = join(applications, "Hopper M.app/Contents/MacOS/hopper");
    const host = systemDoctorHost({
      platform: "darwin",
      environment: { HOME: home, PATH: "/usr/bin:/bin" },
    });
    // Scope executable probes to this real fixture tree, so an installed system
    // Hopper cannot mask user application discovery on a developer machine.
    const isLocalExecutable = (path: string): boolean => {
      if (!path.startsWith(`${home}/`)) return false;
      try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
      } catch {
        return false;
      }
    };
    try {
      expect(defaultHopperLauncherPath("darwin", home, isLocalExecutable)).toBe(
        selected,
      );
      const report = await runDoctor(undefined, {
        ...host,
        executable: async (path) =>
          path.startsWith(`${home}/`) && (await host.executable(path)),
        brewHopperPath: async () => undefined,
      });
      expect(report.hopperPath).toBe(selected);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "hopper",
            ok: true,
            detail: selected,
          }),
        ]),
      );
      expect(await readFile(marker, "utf8")).toBe("unexecuted");
    } finally {
      await host.close?.();
    }
  },
);
