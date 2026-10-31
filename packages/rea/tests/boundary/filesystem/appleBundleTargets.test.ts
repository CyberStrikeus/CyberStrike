import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findAppBundleResourceRoot } from "../../../src/application/AppBundleExecutable.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const program = () => thinMach(0xfeedfacf, 0x0100000c);
const infoPlist = (executable?: string) =>
  `<plist><dict><key>CFBundleIdentifier</key><string>com.example.fixture</string>${
    executable === undefined
      ? ""
      : `<key>CFBundleExecutable</key><string>${executable}</string>`
  }</dict></plist>`;

/** A bundle with Contents/Info.plist and Contents/MacOS/<name>. */
const contentsBundle = async (
  root: string,
  name: string,
  executable = "Fixture",
): Promise<{ bundle: string; program: string }> => {
  const bundle = join(root, name);
  const programs = join(bundle, "Contents", "MacOS");
  await mkdir(programs, { recursive: true });
  await writeFile(
    join(bundle, "Contents", "Info.plist"),
    infoPlist(executable),
  );
  await writeFile(join(programs, executable), program());
  return { bundle, program: join(programs, executable) };
};

/** The documented macOS framework layout, with its root symbolic links. */
const versionedFramework = async (
  root: string,
  options: { readonly declared?: string; readonly file?: string } = {},
): Promise<string> => {
  const framework = join(root, "Demo.framework");
  const version = join(framework, "Versions", "A");
  await mkdir(join(version, "Resources"), { recursive: true });
  await writeFile(
    join(version, "Resources", "Info.plist"),
    infoPlist(options.declared ?? "Demo"),
  );
  await writeFile(join(version, options.file ?? "Demo"), program());
  await symlink("A", join(framework, "Versions", "Current"));
  await symlink("Versions/Current/Demo", join(framework, "Demo"));
  await symlink("Versions/Current/Resources", join(framework, "Resources"));
  return framework;
};

const open = (path: string, cwd: string) =>
  parseBinaryTarget(path, { cwd, hostArchitecture: "arm64" });

// Throw the typed admission error so a failed open reports its cause.
const opened = async (path: string, cwd: string) => {
  const result = await open(path, cwd);
  if (!result.ok) throw result.error;
  return result.value;
};

const failure = async (path: string, cwd: string) => {
  const result = await open(path, cwd);
  if (result.ok) throw new Error(`${path} was admitted`);
  return projectAnalysisError(result.error);
};

describe("Apple bundle directory admission", () => {
  it.each([
    "Ext.appex",
    "Svc.xpc",
    "Plug.bundle",
    "Plug.plugin",
    "Ext.systemextension",
    "Upper.FRAMEWORK",
  ])("opens %s through Contents/Info.plist", async (name) => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const { bundle, program: path } = await contentsBundle(root, name);
    expect(await opened(bundle, root)).toMatchObject({
      path: await realpath(path),
      format: "mach-o",
      bundleInfoPlist: join(bundle, "Contents", "Info.plist"),
    });
  });

  it("opens a flat framework through its root Info.plist", async () => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const framework = join(root, "Flat.framework");
    await mkdir(framework);
    await writeFile(join(framework, "Info.plist"), infoPlist("Flat"));
    await writeFile(join(framework, "Flat"), program());
    expect(await opened(framework, root)).toMatchObject({
      path: await realpath(join(framework, "Flat")),
      bundleInfoPlist: join(framework, "Info.plist"),
    });
  });

  it("opens a flattened framework through Resources/Info.plist", async () => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const framework = join(root, "Electron Framework.framework");
    await mkdir(join(framework, "Resources"), { recursive: true });
    await writeFile(
      join(framework, "Resources", "Info.plist"),
      infoPlist("Electron Framework"),
    );
    await writeFile(join(framework, "Electron Framework"), program());
    expect(await opened(framework, root)).toMatchObject({
      path: await realpath(join(framework, "Electron Framework")),
      bundleInfoPlist: join(framework, "Resources", "Info.plist"),
    });
    expect(await findAppBundleResourceRoot(framework)).toEqual({
      ok: true,
      value: expect.objectContaining({
        layout: "flattened-framework",
        infoPlistPath: join(
          await realpath(framework),
          "Resources",
          "Info.plist",
        ),
      }),
    });
    // A root Info.plist as well leaves two declarations to choose between.
    await writeFile(
      join(framework, "Info.plist"),
      infoPlist("Electron Framework"),
    );
    expect((await failure(framework, root)).details).toMatchObject({
      constraint: "bundle_layout_ambiguous",
    });
  });

  it.skipIf(process.platform === "win32")(
    "opens a versioned framework through Versions/Current",
    async () => {
      const root = await createTestTempDirectory("rea-bundle-target-");
      const framework = await versionedFramework(root);
      expect(await opened(framework, root)).toMatchObject({
        path: await realpath(join(framework, "Versions", "A", "Demo")),
        bundleInfoPlist: join(
          framework,
          "Versions",
          "Current",
          "Resources",
          "Info.plist",
        ),
      });
      expect(await findAppBundleResourceRoot(framework)).toEqual({
        ok: true,
        value: expect.objectContaining({
          layout: "versioned-framework",
          infoPlistPath: join(
            await realpath(framework),
            "Versions",
            "Current",
            "Resources",
            "Info.plist",
          ),
        }),
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "follows CFBundleExecutable when it differs from the framework name",
    async () => {
      const root = await createTestTempDirectory("rea-bundle-target-");
      const framework = await versionedFramework(root, {
        declared: "Other",
        file: "Other",
      });
      expect(await opened(framework, root)).toMatchObject({
        path: await realpath(join(framework, "Versions", "A", "Other")),
      });
    },
  );
});

describe("Apple bundle directories that fail closed", () => {
  it("reports every probed layout when no Info.plist is present", async () => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const framework = join(root, "Empty.framework");
    await mkdir(framework);
    const projected = await failure(framework, root);
    const canonical = await realpath(framework);
    expect(projected).toMatchObject({
      code: "target_unavailable",
      details: {
        constraint: "bundle_info_plist_missing",
        probed_paths: [
          join(canonical, "Contents", "Info.plist"),
          join(canonical, "Info.plist"),
          // Without Versions/, a framework is read as flattened.
          join(canonical, "Resources", "Info.plist"),
        ],
      },
    });
    // A bundle type without Info.plist must reach this typed native failure
    // instead of a route for application directories.
    expect(await findAppBundleResourceRoot(framework)).toMatchObject({
      ok: false,
      error: { constraint: "bundle_info_plist_missing" },
    });
  });

  it("refuses a bundle whose Info.plist appears in two layouts", async () => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const { bundle } = await contentsBundle(root, "Twice.appex");
    await writeFile(join(bundle, "Info.plist"), infoPlist("Fixture"));
    const projected = await failure(bundle, root);
    const canonical = await realpath(bundle);
    expect(projected.details).toMatchObject({
      constraint: "bundle_layout_ambiguous",
      probed_paths: [
        join(canonical, "Contents", "Info.plist"),
        join(canonical, "Info.plist"),
      ],
    });
  });

  it("does not guess a program file when CFBundleExecutable is absent", async () => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const { bundle } = await contentsBundle(root, "Codeless.bundle");
    await writeFile(join(bundle, "Contents", "Info.plist"), infoPlist());
    const projected = await failure(bundle, root);
    const plist = join(await realpath(bundle), "Contents", "Info.plist");
    expect(projected.details).toMatchObject({
      constraint: "bundle_executable_undeclared",
      info_plist: plist,
    });
    expect(projected.remediation.action).toContain(plist);
    expect(projected.remediation.action).toContain("inspect_plist");
  });

  it("names the Info.plist when the declared program file is absent", async () => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const bundle = join(root, "Missing.xpc");
    await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
    await writeFile(join(bundle, "Contents", "Info.plist"), infoPlist("Gone"));
    const projected = await failure(bundle, root);
    const canonical = await realpath(bundle);
    expect(projected.details).toMatchObject({
      constraint: "bundle_program_missing",
      info_plist: join(canonical, "Contents", "Info.plist"),
      probed_paths: [join(canonical, "Contents", "MacOS", "Gone")],
    });
    expect(projected.remediation.action).toContain(
      join(canonical, "Contents", "Info.plist"),
    );
  });

  it.skipIf(process.platform === "win32")(
    "requires Versions/Current when a framework has Versions",
    async () => {
      const root = await createTestTempDirectory("rea-bundle-target-");
      const framework = join(root, "NoCurrent.framework");
      await mkdir(join(framework, "Versions", "A", "Resources"), {
        recursive: true,
      });
      const projected = await failure(framework, root);
      expect(projected.details).toMatchObject({
        constraint: "bundle_current_version_missing",
        probed_paths: [join(await realpath(framework), "Versions", "Current")],
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a Versions/Current link that leaves the framework",
    async () => {
      const root = await createTestTempDirectory("rea-bundle-target-");
      const outside = join(root, "outside");
      await mkdir(join(outside, "Resources"), { recursive: true });
      await writeFile(
        join(outside, "Resources", "Info.plist"),
        infoPlist("Demo"),
      );
      await writeFile(join(outside, "Demo"), program());
      const framework = join(root, "Escaping.framework");
      await mkdir(join(framework, "Versions"), { recursive: true });
      await symlink(outside, join(framework, "Versions", "Current"));
      const projected = await failure(framework, root);
      expect(projected.details).toMatchObject({
        constraint: "bundle_path_escapes",
      });
    },
  );

  it("keeps the file-format refusal for a script program file", async () => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const bundle = join(root, "Script.bundle");
    await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
    await writeFile(join(bundle, "Contents", "Info.plist"), infoPlist("run"));
    await writeFile(
      join(bundle, "Contents", "MacOS", "run"),
      "#!/bin/sh\necho inert\n",
    );
    expect((await failure(bundle, root)).details).toMatchObject({
      constraint: "file_format_rejected",
    });
  });
});

describe("directories this route does not open", () => {
  it.each([".dext", ".kext"])(
    "names a %s directory as an unsupported Apple bundle without the JavaScript route",
    async (extension) => {
      const root = await createTestTempDirectory("rea-bundle-target-");
      const driver = join(root, `com.example.Driver${extension}`);
      await mkdir(join(driver, "Contents", "MacOS"), { recursive: true });
      await writeFile(
        join(driver, "Contents", "Info.plist"),
        infoPlist("Driver"),
      );
      await writeFile(join(driver, "Contents", "MacOS", "Driver"), program());
      const projected = await failure(driver, root);
      expect(projected).toMatchObject({
        category: "unsupported_target",
        details: { constraint: "bundle_type_unsupported" },
      });
      expect(projected.message).toContain(extension);
      expect(projected.message).toContain(".framework");
      expect(JSON.stringify(projected)).not.toContain(
        "analyze_javascript_application",
      );
    },
  );

  it("lists the accepted bundle types for any other directory", async () => {
    const root = await createTestTempDirectory("rea-bundle-target-");
    const directory = join(root, "web");
    await mkdir(directory);
    const projected = await failure(directory, root);
    expect(projected.details).toMatchObject({
      constraint: "directory_requires_file",
    });
    expect(projected.message).toContain("analyze_javascript_application");
    expect(projected.message).toContain(".appex");
    expect(projected.remediation.action).toContain(".framework");
  });
});
