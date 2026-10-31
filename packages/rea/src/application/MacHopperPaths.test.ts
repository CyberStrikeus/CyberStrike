import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, relative } from "node:path";
import { installMacHopperBundle } from "./MacHopper.js";
import { linuxHopperLauncherPath } from "./LinuxHopper.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { describe, expect, it } from "vitest";

import {
  localMacHopperRenamedLauncherCandidates,
  macHopperCanonicalLauncherCandidates,
  macHopperUserApplicationPath,
  macHopperRenamedLauncherCandidates,
  readMacHopperRenamedLauncherCandidates,
} from "./MacHopperPaths.js";

describe("macOS Hopper launcher paths", () => {
  const home = "/fixture/home";

  it("keeps canonical system and user candidates ahead of renamed bundles", () => {
    expect(macHopperCanonicalLauncherCandidates(home)).toEqual([
      "/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
      "/fixture/home/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
    ]);
    expect(
      macHopperRenamedLauncherCandidates(
        home,
        new Map([
          [
            "/Applications",
            ["Hopper z.app", "Hopper a.app", "Hopper Disassembler.app"],
          ],
          ["/fixture/home/Applications", ["Hopper User.app"]],
        ]),
      ),
    ).toEqual([
      "/Applications/Hopper a.app/Contents/MacOS/hopper",
      "/Applications/Hopper z.app/Contents/MacOS/hopper",
      "/fixture/home/Applications/Hopper User.app/Contents/MacOS/hopper",
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "preserves a selected home through symlink parent traversal",
    async () => {
      const temporary = await mkdtemp(join(tmpdir(), "rea-hopper-home-"));
      try {
        await mkdir(join(temporary, "actual", "nested"), { recursive: true });
        await symlink(
          join(temporary, "actual", "nested"),
          join(temporary, "alias"),
        );
        const home = homeDirectoryFromEnvironment(
          { HOME: `${temporary}/alias/..` },
          "darwin",
        );
        await mkdir(
          join(temporary, "actual", "Applications", "Hopper Preview.app"),
          { recursive: true },
        );
        const expected = `${home}/Applications/Hopper Preview.app/Contents/MacOS/hopper`;
        expect(
          [...localMacHopperRenamedLauncherCandidates(home)].filter((path) =>
            path.startsWith(home),
          ),
        ).toEqual([expected]);
        expect(
          (await readMacHopperRenamedLauncherCandidates(home)).filter((path) =>
            path.startsWith(home),
          ),
        ).toEqual([expected]);
        expect(macHopperUserApplicationPath(home)).toBe(
          `${home}/Applications/Hopper Disassembler.app`,
        );
        expect(macHopperCanonicalLauncherCandidates(home)[1]).toBe(
          `${home}/Applications/Hopper Disassembler.app/Contents/MacOS/hopper`,
        );
        expect(linuxHopperLauncherPath(home)).toBe(
          `${home}/.local/share/rea/hopper/bin/Hopper`,
        );
        const source = join(temporary, "source.app");
        await mkdir(join(source, "Contents/MacOS"), { recursive: true });
        await writeFile(
          join(source, "Contents/MacOS/hopper"),
          "inert launcher",
        );
        const result = await installMacHopperBundle(
          source,
          macHopperUserApplicationPath(home),
          false,
          {
            createStagingRoot: (parent) =>
              mkdtemp(`${parent}/.rea-hopper-stage-`),
            copyBundle: async (from, to) => {
              await mkdir(`${to}/Contents/MacOS`, { recursive: true });
              await writeFile(
                `${to}/Contents/MacOS/hopper`,
                await readFile(`${from}/Contents/MacOS/hopper`),
              );
            },
            requireLauncher: (path) => access(path),
            pathExists: async (path) =>
              access(path).then(
                () => true,
                () => false,
              ),
            rename,
            removeStagingRoot: (path) => rm(path, { recursive: true }),
          },
          () => {
            throw new Error("Unexpected retained cleanup");
          },
        );
        expect(result).toMatchObject({ status: "installed" });
        expect(
          await readFile(
            join(
              temporary,
              "actual/Applications/Hopper Disassembler.app/Contents/MacOS/hopper",
            ),
            "utf8",
          ),
        ).toBe("inert launcher");
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );

  it("finds the same renamed user bundles through runtime and doctor scans", async () => {
    // Keep native ownership for all I/O, including UNC temporary directories.
    // On Windows, a checkout-relative home models POSIX separators without
    // discarding the drive/share or normalizing a UNC prefix through posix.join.
    const root =
      process.platform === "win32" ? join(process.cwd(), "build") : tmpdir();
    await mkdir(root, { recursive: true });
    const temporary = await mkdtemp(join(root, "rea-hopper-paths-"));
    const home =
      process.platform === "win32"
        ? relative(process.cwd(), temporary).replaceAll("\\", "/")
        : temporary;
    const applications = join(temporary, "Applications");
    try {
      await mkdir(join(applications, "Hopper Preview.app"), {
        recursive: true,
      });
      await mkdir(join(applications, "Hopper Disassembler.app"));
      await writeFile(join(applications, "Hopper File.app"), "");
      const runtime = [...localMacHopperRenamedLauncherCandidates(home)];
      expect(runtime.filter((path) => path.startsWith(home))).toEqual([
        posix.join(
          home,
          "Applications/Hopper Preview.app/Contents/MacOS/hopper",
        ),
      ]);
      expect(await readMacHopperRenamedLauncherCandidates(home)).toEqual(
        runtime,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
