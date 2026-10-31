import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  artifactCliEvidence,
  artifactMcpResult,
  withArtifactMcp,
} from "../../lib/artifact-e2e.mjs";

const exec = promisify(execFile);

if (process.platform !== "darwin")
  throw new Error(
    "Legacy simulator verification requires a macOS host with full Xcode.",
  );
for (const tool of ["clang", "ld", "vtool", "otool"])
  await exec("/usr/bin/xcrun", ["--find", tool], { timeout: 30_000 });
const { stdout: sdk } = await exec(
  "/usr/bin/xcrun",
  ["--sdk", "iphonesimulator", "--show-sdk-path"],
  { timeout: 30_000 },
);
const sdkPath = sdk.trim();
assert.ok(sdkPath.length > 0, "iPhoneSimulator SDK path is empty");

const root = await mkdtemp(join(tmpdir(), "rea-legacy-simulator-"));
const xcrun = (...args) =>
  exec("/usr/bin/xcrun", args, {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
try {
  // Source-owned fixture, never executed: a legacy deployment target makes
  // the Apple driver emit LC_VERSION_MIN_IPHONEOS (no simulator flag), while
  // the modern dylib carries LC_BUILD_VERSION with an explicit simulator ID.
  await writeFile(join(root, "library.c"), "int fixture(void) { return 7; }\n");
  await writeFile(
    join(root, "main.c"),
    "extern int fixture(void);\nint main(void) { return fixture(); }\n",
  );
  for (const [source, deployment] of [
    ["library", "14.0"],
    ["main", "9.0"],
  ]) {
    await xcrun(
      "clang",
      "-target",
      `x86_64-apple-ios${deployment}-simulator`,
      "-isysroot",
      sdkPath,
      "-c",
      join(root, `${source}.c`),
      "-o",
      join(root, `${source}.o`),
    );
  }
  const common = ["-arch", "x86_64", "-syslibroot", sdkPath, "-lSystem"];
  await xcrun(
    "ld",
    ...common,
    "-dylib",
    "-platform_version",
    "ios-simulator",
    "14.0",
    "14.0",
    "-install_name",
    "@rpath/libFixture.dylib",
    join(root, "library.o"),
    "-o",
    join(root, "libFixture.dylib"),
  );
  await xcrun(
    "clang",
    "-target",
    "x86_64-apple-ios9.0-simulator",
    "-isysroot",
    sdkPath,
    "-e",
    "_main",
    "-rpath",
    "@loader_path",
    join(root, "main.o"),
    join(root, "libFixture.dylib"),
    "-o",
    join(root, "Main"),
  );

  // Apple oracle: the executable really uses the legacy command, the dylib
  // really declares the modern simulator platform.
  const { stdout: legacyBuild } = await xcrun(
    "vtool",
    "-show-build",
    join(root, "Main"),
  );
  assert.match(legacyBuild, /LC_VERSION_MIN_IPHONEOS/u);
  assert.doesNotMatch(legacyBuild, /LC_BUILD_VERSION/u);
  const { stdout: modernBuild } = await xcrun(
    "vtool",
    "-show-build",
    join(root, "libFixture.dylib"),
  );
  assert.match(modernBuild, /IOSSIMULATOR/u);

  // Real CLI over the fixture: the target is the executable file (plain
  // directories are not binary targets); @loader_path resolves against its
  // directory. The legacy x86 image must classify as iOS simulator
  // (platform 7) and resolve against the modern dylib.
  // The fixture is inspected, never executed or loaded into this process.
  const mainPath = join(root, "Main");
  const trace = (await artifactCliEvidence("trace-dylib-resolution", mainPath))
    .normalized_result;
  const main = trace.images.find(({ path }) => path === "Main");
  assert.ok(main, "trace omitted the Main image");
  assert.equal(main.parse_status, "parsed");
  assert.deepEqual(main.slices[0]?.platforms, [7]);
  const edge = trace.edges.find(
    ({ loader, install_name: name }) =>
      loader === "Main" && name === "@rpath/libFixture.dylib",
  );
  assert.ok(edge, "trace omitted the @rpath edge");
  assert.deepEqual(edge.resolution, {
    status: "resolved",
    image: "libFixture.dylib",
  });

  await withArtifactMcp(mainPath, async (client) => {
    assert.deepEqual(
      await artifactMcpResult(client, "trace_dylib_resolution"),
      trace,
    );
  });
  console.log(
    "Legacy simulator verification passed against Apple clang, ld, vtool, and otool.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
