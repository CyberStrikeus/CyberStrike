import { execFile } from "node:child_process";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Commands the macOS bundle fixture needs from Command Line Tools. */
export const MACOS_BUNDLE_FIXTURE_COMMANDS = [
  ["/usr/bin/xcrun", ["--find", "clang"]],
  ["/usr/bin/xcrun", ["--find", "codesign"]],
  ["/usr/bin/ditto", ["-h"]],
  ["/usr/bin/hdiutil", ["help"]],
];

/** Fail with the missing command name before building any fixture. */
export async function preflightMacosBundleFixture() {
  if (process.platform !== "darwin")
    throw new Error(
      "macOS bundle verification requires a macOS host with Command Line Tools",
    );
  for (const [command, arguments_] of MACOS_BUNDLE_FIXTURE_COMMANDS)
    try {
      await exec(command, arguments_);
    } catch (cause) {
      // `ditto -h` and `hdiutil help` exit non-zero while printing usage.
      if (cause?.code === "ENOENT")
        throw new Error(
          `macOS bundle verification requires ${command} ${arguments_.join(" ")}`,
          { cause },
        );
      if (command === "/usr/bin/xcrun")
        throw new Error(
          `macOS bundle verification requires Command Line Tools (${arguments_.join(" ")} failed)`,
          { cause },
        );
    }
}

const plist = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(entries)
  .map(([key, value]) => `  <key>${key}</key>\n  <string>${value}</string>`)
  .join("\n")}
</dict>
</plist>
`;

const bundlePlist = (identifier, executable, packageType = "APPL") =>
  plist({
    CFBundleIdentifier: identifier,
    CFBundleExecutable: executable,
    CFBundlePackageType: packageType,
  });

const write = async (path, text) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
};

/** Compile one C source beneath `root/sources` into `output`. */
const clang = async (root, { name, source, output, flags = [] }) => {
  const sourcePath = join(root, "sources", `${name}.c`);
  await write(sourcePath, source);
  await mkdir(dirname(output), { recursive: true });
  await exec("/usr/bin/xcrun", [
    "clang",
    "-O0",
    sourcePath,
    "-o",
    output,
    ...flags,
  ]);
};

const PROGRAM = `int main(void) { return 0; }\n`;

/** A versioned framework whose own rpath supplies a second `libchain.dylib`. */
const buildCoreFramework = async (root, frameworks) => {
  const core = join(frameworks, "Core.framework");
  const version = join(core, "Versions", "A");
  const chainFlags = ["-dynamiclib", "-install_name", "@rpath/libchain.dylib"];
  await clang(root, {
    name: "chain-app",
    source: `const char *chain_variant(void) { return "app"; }\n`,
    output: join(frameworks, "libchain.dylib"),
    flags: chainFlags,
  });
  await clang(root, {
    name: "chain-framework",
    source: `const char *chain_variant(void) { return "framework"; }\n`,
    output: join(version, "Libraries", "libchain.dylib"),
    flags: chainFlags,
  });
  await clang(root, {
    name: "sibling",
    source: `int sibling_value(void) { return 7; }\n`,
    output: join(version, "libsibling.dylib"),
    flags: ["-dynamiclib", "-install_name", "@loader_path/libsibling.dylib"],
  });
  await clang(root, {
    name: "core",
    source: `const char *chain_variant(void);
int sibling_value(void);
const char *core_chain(void) { return sibling_value() == 7 ? chain_variant() : "broken"; }
`,
    output: join(version, "Core"),
    flags: [
      "-dynamiclib",
      "-install_name",
      "@rpath/Core.framework/Versions/A/Core",
      "-Wl,-rpath,@loader_path/Libraries",
      join(version, "libsibling.dylib"),
      join(version, "Libraries", "libchain.dylib"),
    ],
  });
  await write(
    join(version, "Resources", "Info.plist"),
    bundlePlist("com.example.rea.core", "Core", "FMWK"),
  );
  const service = join(version, "XPCServices", "FwSvc.xpc", "Contents");
  await clang(root, {
    name: "framework-service",
    source: PROGRAM,
    output: join(service, "MacOS", "FwSvc"),
  });
  await write(
    join(service, "Info.plist"),
    bundlePlist("com.example.rea.core.service", "FwSvc", "XPC!"),
  );
  await symlink("A", join(core, "Versions", "Current"));
  await symlink("Versions/Current/Core", join(core, "Core"));
  await symlink("Versions/Current/Resources", join(core, "Resources"));
  await symlink("Versions/Current/XPCServices", join(core, "XPCServices"));
  return join(version, "Core");
};

/**
 * The main executable. It searches a missing `Overrides` rpath before
 * `Frameworks`, weakly links a library deleted after linking, and
 * delay-links a library, which the linker encodes as `dylib_use_command`.
 */
const buildMainExecutable = async (root, contents, coreBinary) => {
  const gone = join(contents, "Frameworks", "libgone.dylib");
  await clang(root, {
    name: "gone",
    source: `int gone_value(void) { return 1; }\n`,
    output: gone,
    flags: ["-dynamiclib", "-install_name", "@rpath/libgone.dylib"],
  });
  const delayed = join(contents, "Frameworks", "libdelay.dylib");
  await clang(root, {
    name: "delay",
    source: `int delay_value(void) { return 3; }\n`,
    output: delayed,
    flags: ["-dynamiclib", "-install_name", "@rpath/libdelay.dylib"],
  });
  const executable = join(contents, "MacOS", "MacFixture");
  await clang(root, {
    name: "main",
    source: `#include <stdio.h>
const char *core_chain(void);
int delay_value(void);
extern int gone_value(void) __attribute__((weak_import));
int main(void) {
  if (delay_value() != 3) return 1;
  printf("chain=%s weak=%s\\n", core_chain(), gone_value ? "present" : "absent");
  return 0;
}
`,
    output: executable,
    flags: [
      "-Wl,-rpath,@executable_path/../Overrides",
      "-Wl,-rpath,@executable_path/../Frameworks",
      coreBinary,
      `-Wl,-weak_library,${gone}`,
      `-Wl,-delay_library,${delayed}`,
    ],
  });
  await rm(gone);
  await write(
    join(contents, "Info.plist"),
    bundlePlist("com.example.rea.fixture", "MacFixture"),
  );
  return executable;
};

/** One `Contents/`-layout bundle with a trivial executable. */
const buildNestedBundle = async (root, { bundle, executable, plist }) => {
  await clang(root, {
    name: executable,
    source: PROGRAM,
    output: join(bundle, "Contents", "MacOS", executable),
  });
  await write(join(bundle, "Contents", "Info.plist"), plist);
};

const buildNestedBundles = async (root, contents, coreBinary) => {
  const service = join(contents, "XPCServices", "Svc.xpc", "Contents");
  await clang(root, {
    name: "service",
    source: `const char *core_chain(void);
int main(void) { return core_chain()[0] == 'b'; }
`,
    output: join(service, "MacOS", "Svc"),
    // An absolute rpath outside the bundle precedes the bundled framework.
    flags: [
      "-Wl,-rpath,/opt/rea-fixture-absent/lib",
      "-Wl,-rpath,@executable_path/../../../../Frameworks",
      coreBinary,
    ],
  });
  await write(
    join(service, "Info.plist"),
    bundlePlist("com.example.rea.fixture.service", "Svc", "XPC!"),
  );
  await buildNestedBundle(root, {
    bundle: join(contents, "PlugIns", "Ext.appex"),
    executable: "Ext",
    plist: bundlePlist("com.example.rea.fixture.extension", "Ext", "XPC!"),
  });
  await buildNestedBundle(root, {
    bundle: join(contents, "Library", "LoginItems", "Login.app"),
    executable: "Login",
    plist: bundlePlist("com.example.rea.fixture.login", "Login"),
  });
};

/** A privileged helper, its launchd plists, and a non-bundle helper tool. */
const buildLaunchItems = async (root, contents) => {
  await clang(root, {
    name: "privileged-helper",
    source: PROGRAM,
    output: join(
      contents,
      "Library",
      "LaunchServices",
      "com.example.rea.helper",
    ),
  });
  await write(
    join(contents, "Library", "LaunchDaemons", "com.example.rea.helper.plist"),
    plist({
      Label: "com.example.rea.helper",
      BundleProgram: "Contents/Library/LaunchServices/com.example.rea.helper",
    }),
  );
  await write(
    join(contents, "Library", "LaunchAgents", "com.example.rea.agent.plist"),
    plist({
      Label: "com.example.rea.agent",
      BundleProgram: "Contents/Helpers/rea-tool",
    }),
  );
  await clang(root, {
    name: "tool",
    source: PROGRAM,
    output: join(contents, "Helpers", "rea-tool"),
  });
};

/**
 * Build `MacFixture.app` with every bundle role and dylib-loading shape REA
 * projects. The main executable prints which `libchain.dylib` copy dyld
 * selected, so callers can compare static resolution with a real load.
 */
export async function buildMacosBundleFixture(root) {
  const app = join(root, "MacFixture.app");
  const contents = join(app, "Contents");
  const coreBinary = await buildCoreFramework(
    root,
    join(contents, "Frameworks"),
  );
  const executable = await buildMainExecutable(root, contents, coreBinary);
  await buildNestedBundles(root, contents, coreBinary);
  await buildLaunchItems(root, contents);
  await exec("/usr/bin/xcrun", [
    "codesign",
    "--force",
    "--deep",
    "--sign",
    "-",
    app,
  ]);
  return { app, executable };
}
