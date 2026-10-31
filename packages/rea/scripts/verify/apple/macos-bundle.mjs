import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  artifactCliEvidence,
  artifactMcpResult,
  withArtifactMcp,
} from "../../lib/artifact-e2e.mjs";
import {
  buildMacosBundleFixture,
  preflightMacosBundleFixture,
} from "../../fixtures/apple/macos-bundle.mjs";
import { verifyDyldEnvironment } from "./dyld-environment.mjs";
import { verifyDylibResolution } from "./macos-dylib-e2e.mjs";
import { verifyMachOOccurrences } from "./macho-occurrences.mjs";
import { verifyNativeProvenance } from "./native-provenance.mjs";

const exec = promisify(execFile);

await preflightMacosBundleFixture();
const root = await mkdtemp(join(tmpdir(), "rea-macos-bundle-"));

/** Bundle roles relative to the application root, independent of the container. */
const anatomy = (projection, applicationRoot) => {
  const relative = (path) =>
    applicationRoot === "."
      ? path
      : path === applicationRoot
        ? "."
        : path.slice(applicationRoot.length + 1);
  const paths = (components) =>
    components.map(({ path }) => relative(path)).sort();
  return {
    bundles: projection.bundles.map((bundle) => ({
      path: relative(bundle.path),
      role: bundle.role,
      layout: bundle.layout,
      parent: bundle.parent_path === null ? null : relative(bundle.parent_path),
      info_plist: bundle.info_plist_path && relative(bundle.info_plist_path),
      executables: bundle.executable_candidates.map(relative),
      signing: bundle.signing_paths.map(relative),
    })),
    privileged_helpers: paths(projection.components.privileged_helpers),
    launchd_plists: projection.components.launchd_plists
      .map(({ path, domain }) => `${domain}:${relative(path)}`)
      .sort(),
    helpers: paths(projection.components.helpers),
  };
};

const FRAMEWORK = "Contents/Frameworks/Core.framework";
const EXPECTED_BUNDLES = [
  [".", "application", "macos-deep", null],
  [FRAMEWORK, "framework", "versioned-framework", "."],
  [
    `${FRAMEWORK}/Versions/A/XPCServices/FwSvc.xpc`,
    "xpc-service",
    "macos-deep",
    FRAMEWORK,
  ],
  ["Contents/Library/LoginItems/Login.app", "login-item", "macos-deep", "."],
  ["Contents/PlugIns/Ext.appex", "app-extension", "macos-deep", "."],
  ["Contents/XPCServices/Svc.xpc", "xpc-service", "macos-deep", "."],
];

let report;
try {
  const { app, executable } = await buildMacosBundleFixture(root);
  const nativeProvenance = await verifyNativeProvenance(app, executable);
  const machoOccurrences = await verifyMachOOccurrences(app, executable);
  const zip = join(root, "MacFixture.zip");
  await exec("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, zip]);
  const staging = join(root, "dmg-source");
  await mkdir(staging);
  await exec("/usr/bin/ditto", [app, join(staging, "MacFixture.app")]);
  await symlink("/Applications", join(staging, "Applications"));
  const dmg = join(root, "MacFixture.dmg");
  // The default APFS image attaches as an image disk plus a synthesized
  // container, which exercises detach of devices sharing one image.
  await exec("/usr/bin/hdiutil", [
    "create",
    "-quiet",
    "-srcfolder",
    staging,
    "-volname",
    "ReaFixture",
    "-format",
    "UDZO",
    dmg,
  ]);

  const containers = [
    { target: app, format: "directory", applicationRoot: "." },
    { target: zip, format: "zip", applicationRoot: "MacFixture.app" },
    {
      target: dmg,
      format: "dmg",
      applicationRoot: "MacFixture.dmg/ReaFixture/MacFixture.app",
    },
  ];
  const anatomies = [];
  for (const { target, format, applicationRoot } of containers) {
    const inventory = await artifactCliEvidence("inspect-artifact", target);
    const input = join(root, `${format}-projection.json`);
    await writeFile(input, JSON.stringify({ inventory_evidence: [inventory] }));
    const evidence = await artifactCliEvidence(
      "project-apple-application-graph",
      input,
    );
    const projection = evidence.normalized_result;
    assert.equal(evidence.subject?.format, format);
    assert.equal(projection.root_format, format);
    assert.deepEqual(projection.platforms, ["macos"]);
    assert.deepEqual(projection.application_roots, [applicationRoot]);
    assert.equal(projection.coverage.status, "complete-within-inventory");
    const observed = anatomy(projection, applicationRoot);
    assert.deepEqual(
      observed.bundles.map(({ path, role, layout, parent }) => [
        path,
        role,
        layout,
        parent,
      ]),
      EXPECTED_BUNDLES,
      `${format} bundle roles drifted`,
    );
    assert.deepEqual(observed.privileged_helpers, [
      "Contents/Library/LaunchServices/com.example.rea.helper",
    ]);
    assert.deepEqual(observed.launchd_plists, [
      "agent:Contents/Library/LaunchAgents/com.example.rea.agent.plist",
      "daemon:Contents/Library/LaunchDaemons/com.example.rea.helper.plist",
    ]);
    assert.deepEqual(observed.helpers, ["Contents/Helpers/rea-tool"]);
    assert.ok(
      projection.symlinks.some((path) =>
        path.endsWith(`${FRAMEWORK}/Versions/Current`),
      ),
      "Versions/Current symlink was not reported",
    );
    anatomies.push(observed);
    if (format === "directory")
      await withArtifactMcp(app, async (client) => {
        assert.deepEqual(
          await artifactMcpResult(client, "project_apple_application_graph", {
            inventory_evidence: [inventory],
          }),
          projection,
        );
      });
  }
  assert.deepEqual(anatomies[1], anatomies[0], "ZIP anatomy differs");
  assert.deepEqual(anatomies[2], anatomies[0], "DMG anatomy differs");
  const { stdout: attached } = await exec("/usr/bin/hdiutil", ["info"]);
  assert.ok(!attached.includes(dmg), "DMG remained attached after inventory");
  const dylibs = await verifyDylibResolution(app);
  const dyldEnvironment = await verifyDyldEnvironment(root);

  report = {
    ok: true,
    mocked: false,
    cli: true,
    stdio_mcp: true,
    containers: containers.map(({ format }) => format),
    bundles: EXPECTED_BUNDLES.length,
    dmg_detached: true,
    native_provenance: nativeProvenance,
    macho_occurrences: machoOccurrences,
    dylib_resolution: dylibs,
    dyld_environment: dyldEnvironment,
  };
} finally {
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report)}\n`);
