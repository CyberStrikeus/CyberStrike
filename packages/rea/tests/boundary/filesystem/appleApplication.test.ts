import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
  type ZipWriterAddDataOptions,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { fragmentInventoryEvidence } from "../../fixtures/artifactEvidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  createNonApplicationZipInventory,
  requireSuccessfulProjection,
} from "../../support/applicationSessionFixture.js";

import { projectAppleApplicationEvidence } from "../../../src/application/apple/AppleApplicationService.js";
import { createDirectAnalysis } from "../../../src/composition/directAnalysis.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { appleApplicationProjectionResultSchema } from "../../../src/domain/apple/appleApplication.js";
import { parseEvidence } from "../../../src/domain/evidence.js";

const { runProviderAnalysis } = createDirectAnalysis({});

// Real ZIP entries cross the former component and bridge-candidate limits.
const FRAMEWORK_COUNT = 250;
const SCRIPT_COUNT = 40;
const NATIVE_COUNT = 40;

async function createCompleteAppleProjection() {
  const root = await createTestTempDirectory("rea-apple-complete-");
  const path = join(root, "Complete.ipa");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (let index = 0; index < FRAMEWORK_COUNT; index++) {
    const name = String(index).padStart(4, "0");
    await writer.add(
      `Payload/Complete.app/Frameworks/F${name}.framework/Info.plist`,
      new TextReader("<plist><dict/></plist>"),
    );
  }
  for (let index = 0; index < SCRIPT_COUNT; index++) {
    await writer.add(
      `Payload/Complete.app/script-${String(index).padStart(3, "0")}.js`,
      new TextReader("bridge.call();"),
    );
  }
  for (let index = 0; index < NATIVE_COUNT; index++) {
    await writer.add(
      `Payload/Complete.app/Frameworks/Native${String(index).padStart(3, "0")}.dylib`,
      new Uint8ArrayReader(
        Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]),
      ),
    );
  }
  await writeFile(path, await writer.close());

  const inventory = parseEvidence(
    await runProviderAnalysis(path, "inventory_artifact", {}).then(
      projectCliAnalysisResult,
    ),
  );
  const fragments = fragmentInventoryEvidence(inventory, 3);
  const result = projectAppleApplicationEvidence({
    inventory_evidence: fragments,
  });

  if (!result.ok) throw new TypeError("Could not project fixture inventory");
  expect(result.value.sources.map(({ evidence_id }) => evidence_id)).toEqual(
    fragments.map(({ evidence_id }) => evidence_id),
  );
  const projection = appleApplicationProjectionResultSchema.parse(
    result.value.evidence.normalized_result,
  );
  expect([...projection.source_evidence_ids].sort()).toEqual(
    fragments.map(({ evidence_id }) => evidence_id).sort(),
  );
  return projection;
}

describe("Apple application projection", () => {
  it("retains complete traversal and case-collision limits for a real IPA", async () => {
    const root = await createTestTempDirectory("rea-apple-case-collision-");
    const path = join(root, "CaseCollision.ipa");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(
      "Payload/Example.app/Contents/Info.plist",
      new TextReader("upper"),
    );
    await writer.add(
      "Payload/Example.app/contents/Info.plist",
      new TextReader("lower"),
    );
    await writeFile(path, await writer.close());

    const inventory = parseEvidence(
      await runProviderAnalysis(path, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    expect(inventory.normalized_result).toMatchObject({
      coverage: { scope: "container-entries", status: "complete" },
    });
    const result = projectAppleApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const projection = appleApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(result).normalized_result,
    );

    expect(projection.coverage).toEqual({
      status: "complete-within-inventory",
      inventory_complete: true,
    });
    expect(projection.limitations.join(" ")).toContain(
      "case-insensitive destination",
    );
  });

  it("projects deterministic IPA components and bridge hypotheses from exact inventory Evidence", async () => {
    const root = await createTestTempDirectory("rea-apple-");
    const path = join(root, "Fixture.ipa");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("Payload/Fixture.app/", undefined, { directory: true });
    await writer.add(
      "Payload/Fixture.app/Info.plist",
      new TextReader("<plist><dict/></plist>"),
    );
    await writer.add(
      "Payload/Fixture.app/Fixture",
      new Uint8ArrayReader(
        Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]),
      ),
    );
    await writer.add(
      "Payload/Fixture.app/Frameworks/React.framework/React",
      new Uint8ArrayReader(
        Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]),
      ),
    );
    await writer.add(
      "Payload/Fixture.app/main.js",
      new TextReader("bridge.call();"),
    );
    await writer.add(
      "Payload/Fixture.app/embedded.mobileprovision",
      new TextReader("opaque signing bytes"),
    );
    await writeFile(path, await writer.close());

    const inventory = parseEvidence(
      await runProviderAnalysis(path, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    const first = projectAppleApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const second = projectAppleApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const left = appleApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(first).normalized_result,
    );
    const right = appleApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(second).normalized_result,
    );
    expect(left).toEqual(right);
    expect(left).toMatchObject({
      root_format: "ipa",
      application_roots: ["Payload/Fixture.app"],
      coverage: {
        status: "complete-within-inventory",
        inventory_complete: true,
      },
    });
    expect(left.components.bundle_metadata).toHaveLength(1);
    expect(left.components.executables.length).toBeGreaterThanOrEqual(2);
    expect(left.components.frameworks).toHaveLength(1);
    expect(left.components.javascript).toHaveLength(1);
    expect(left.components.signing).toHaveLength(1);
    expect(left.runtime_families).toEqual(
      expect.arrayContaining(["javascript", "native", "react-native"]),
    );
    expect(left.bridge_candidates).toEqual([
      expect.objectContaining({
        basis: "javascript-and-native-content",
        native_path: "Payload/Fixture.app/Fixture",
      }),
      expect.objectContaining({
        basis: "react-native-convention",
        native_path: "Payload/Fixture.app/Frameworks/React.framework/React",
      }),
    ]);
    expect(JSON.stringify(left)).not.toContain("opaque signing bytes");
  });

  it("reports a ZIP without an application bundle instead of guessing one", async () => {
    const inventory =
      await createNonApplicationZipInventory("rea-apple-empty-");
    const projection = appleApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(
        projectAppleApplicationEvidence({ inventory_evidence: [inventory] }),
      ).normalized_result,
    );
    expect(projection).toMatchObject({
      root_format: "zip",
      application_roots: [],
      bundles: [],
    });
    expect(projection.limitations).toContain(
      "No application bundle (Payload/*.app or *.app/Contents) was present in the supplied inventory pages.",
    );
  });

  it("rejects inventories of non-Apple package formats", async () => {
    const root = await createTestTempDirectory("rea-apple-invalid-");
    const path = join(root, "fixture.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("AndroidManifest.xml", new TextReader("<manifest/>"));
    await writeFile(path, await writer.close());
    const inventory = parseEvidence(
      await runProviderAnalysis(path, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    expect(
      projectAppleApplicationEvidence({ inventory_evidence: [inventory] }),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  });
});

const ENCRYPTED = { password: "fixture-only" };
// A Unix symlink entry, which ZIP inventory reports without content identity.
const SYMLINK = {
  msDosCompatible: false,
  versionMadeBy: 0x0314,
  externalFileAttributes: 0o120777 * 0x10000,
};

async function projectArchive(
  name: string,
  members: readonly (readonly [string, ZipWriterAddDataOptions?])[],
) {
  const root = await createTestTempDirectory("rea-apple-unread-");
  const path = join(root, name);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [member, options = {}] of members)
    await writer.add(
      member,
      options.directory ? undefined : new TextReader("fixture"),
      options,
    );
  await writeFile(path, await writer.close());
  const inventory = parseEvidence(
    await runProviderAnalysis(path, "inventory_artifact", {}).then(
      projectCliAnalysisResult,
    ),
  );
  return appleApplicationProjectionResultSchema.parse(
    requireSuccessfulProjection(
      projectAppleApplicationEvidence({ inventory_evidence: [inventory] }),
    ).normalized_result,
  );
}

it("retains an encrypted IPA native library as unknown component evidence", async () => {
  const projection = await projectArchive("Encrypted.ipa", [
    ["Payload/Fixture.app/Info.plist"],
    ["Payload/Fixture.app/libentry.dylib", ENCRYPTED],
  ]);

  expect(projection.components.native_libraries).toEqual([]);
  expect(projection.unavailable_components).toEqual([
    expect.objectContaining({
      path: "Payload/Fixture.app/libentry.dylib",
      artifact_id: null,
      sha256: null,
      encrypted: true,
    }),
  ]);
  expect(projection.coverage).toEqual({
    status: "partial",
    inventory_complete: true,
  });
  expect(projection.limitations).toContainEqual(
    expect.stringContaining("component absence is unknown"),
  );
});

it("keeps symlinks out of unavailable components", async () => {
  const projection = await projectArchive("Linked.zip", [
    ["Fixture.app/Contents/Info.plist"],
    [
      "Fixture.app/Contents/Frameworks/Core.framework/Versions/Current",
      SYMLINK,
    ],
  ]);

  expect(projection.symlinks).toEqual([
    "Fixture.app/Contents/Frameworks/Core.framework/Versions/Current",
  ]);
  expect(projection.unavailable_components).toEqual([]);
  expect(projection.coverage.status).toBe("complete-within-inventory");
});

it("applies application-root and sidecar rules to unread entries", async () => {
  const projection = await projectArchive("Unread.zip", [
    ["Fixture.app/Contents/Info.plist"],
    ["Fixture.app/Contents/MacOS/Fixture", ENCRYPTED],
    ["Fixture.app/Contents/._Info.plist", ENCRYPTED],
    ["Installer/setup.pkg", ENCRYPTED],
  ]);

  expect(projection.application_roots).toEqual(["Fixture.app"]);
  expect(projection.unavailable_components.map(({ path }) => path)).toEqual([
    "Fixture.app/Contents/MacOS/Fixture",
  ]);
  expect(projection.limitations).toContain(
    "1 inventoried entries outside every application root are not attributed to the application.",
  );
  expect(projection.coverage).toEqual({
    status: "partial",
    inventory_complete: true,
  });
});

describe("macOS application projection", () => {
  it("classifies launchd plists by their owning directory instead of unrelated ancestors", async () => {
    const root = await createTestTempDirectory("rea-apple-launchd-domain-");
    const path = join(root, "Launchd.zip");
    const expected = [
      [
        "LaunchDaemons/Sample.app/Contents/Library/LaunchAgents/agent.plist",
        "agent",
      ],
      [
        "LaunchDaemons/Sample.app/Contents/Resources/LaunchDaemons/Nested.app/Contents/Library/LaunchAgents/nested.plist",
        "agent",
      ],
      [
        "LaunchAgents/Other.app/Contents/Library/LaunchDaemons/daemon.plist",
        "daemon",
      ],
      [
        "launchdaemons/Case.app/contents/library/launchagents/mixed.plist",
        "agent",
      ],
    ] as const;
    const writer = new ZipWriter(new Uint8ArrayWriter());
    for (const [entry] of expected)
      await writer.add(entry, new TextReader("<plist><dict/></plist>"));
    await writer.add(
      "LaunchDaemons/Sample.app/Contents/Library/LaunchAgents/nested/ignored.plist",
      new TextReader("<plist><dict/></plist>"),
    );
    await writeFile(path, await writer.close());

    const inventory = parseEvidence(
      await runProviderAnalysis(path, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    const projection = appleApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(
        projectAppleApplicationEvidence({ inventory_evidence: [inventory] }),
      ).normalized_result,
    );
    expect(
      projection.components.launchd_plists.map(({ path, domain }) => [
        path,
        domain,
      ]),
    ).toEqual(expect.arrayContaining([...expected]));
    expect(projection.components.launchd_plists).toHaveLength(expected.length);
    expect(projection.coverage).toEqual({
      status: "complete-within-inventory",
      inventory_complete: true,
    });
  });

  it("projects a macOS .app directory inventory with nested bundle roles", async () => {
    const root = await createTestTempDirectory("rea-apple-macos-");
    const app = join(root, "Fixture.app");
    // A complete thin arm64 header, as target admission requires.
    const machO = thinMach(0xcffaedfe, 0x0100000c);
    const files: [string, string | Uint8Array][] = [
      [
        "Contents/Info.plist",
        "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
      ],
      ["Contents/MacOS/Fixture", machO],
      ["Contents/XPCServices/Fetch.xpc/Contents/MacOS/Fetch", machO],
      ["Contents/PlugIns/Share.appex/Contents/MacOS/Share", machO],
      ["Contents/Library/LoginItems/Login.app/Contents/MacOS/Login", machO],
      ["Contents/Library/LaunchServices/com.example.helper", machO],
      [
        "Contents/Library/LaunchDaemons/com.example.helper.plist",
        "<plist><dict/></plist>",
      ],
      ["Contents/Frameworks/Core.framework/Versions/A/Core", machO],
    ];
    for (const [relative, content] of files) {
      await mkdir(dirname(join(app, relative)), { recursive: true });
      await writeFile(join(app, relative), content);
    }
    await symlink(
      "A",
      join(app, "Contents/Frameworks/Core.framework/Versions/Current"),
    );

    const inventory = parseEvidence(
      await runProviderAnalysis(app, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    const result = projectAppleApplicationEvidence({
      inventory_evidence: [inventory],
    });
    const projection = appleApplicationProjectionResultSchema.parse(
      requireSuccessfulProjection(result).normalized_result,
    );
    expect(requireSuccessfulProjection(result).subject?.format).toBe(
      "directory",
    );
    expect(projection).toMatchObject({
      root_format: "directory",
      platforms: ["macos"],
      application_roots: ["."],
      symlinks: ["Contents/Frameworks/Core.framework/Versions/Current"],
      coverage: { status: "complete-within-inventory" },
    });
    expect(projection.bundles.map(({ path, role }) => [path, role])).toEqual([
      [".", "application"],
      ["Contents/Frameworks/Core.framework", "framework"],
      ["Contents/Library/LoginItems/Login.app", "login-item"],
      ["Contents/PlugIns/Share.appex", "app-extension"],
      ["Contents/XPCServices/Fetch.xpc", "xpc-service"],
    ]);
    expect(
      projection.components.privileged_helpers.map(({ path }) => path),
    ).toEqual(["Contents/Library/LaunchServices/com.example.helper"]);
    expect(projection.components.launchd_plists).toEqual([
      expect.objectContaining({
        path: "Contents/Library/LaunchDaemons/com.example.helper.plist",
        domain: "daemon",
      }),
    ]);
  });
});

describe("Apple application projection completeness", () => {
  it("returns every component and bridge hypothesis from fragments of a real ZIP inventory", async () => {
    const projection = await createCompleteAppleProjection();
    expect(projection.components.frameworks).toHaveLength(FRAMEWORK_COUNT);
    expect(projection.components.bundle_metadata).toHaveLength(FRAMEWORK_COUNT);
    expect(projection.components.javascript).toHaveLength(SCRIPT_COUNT);
    expect(projection.components.native_libraries).toHaveLength(NATIVE_COUNT);
    expect(projection.source_evidence_ids).toHaveLength(3);
    expect(new Set(projection.source_evidence_ids).size).toBe(3);
    // One candidate per script/native pair. Deriving this catches a pairing
    // regression, which the previous literal 10_201 could not.
    expect(projection.bridge_candidates).toHaveLength(
      SCRIPT_COUNT * NATIVE_COUNT,
    );
    expect(projection.coverage).toEqual({
      status: "complete-within-inventory",
      inventory_complete: true,
    });
    expect(projection).not.toHaveProperty("omitted_components");
    expect(projection).not.toHaveProperty("omitted_bridge_candidates");
  });

  it("retains long ZIP application roots when the IPA omits directory entries", async () => {
    const root = await createTestTempDirectory("rea-apple-root-");
    const path = join(root, "Fixture.ipa");
    const applicationRoot = `Payload/${"LongApp".repeat(750)}.app`;
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(
      `${applicationRoot}/Fixture`,
      new Uint8ArrayReader(
        Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]),
      ),
    );
    await writeFile(path, await writer.close());

    const inventory = parseEvidence(
      await runProviderAnalysis(path, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    const result = projectAppleApplicationEvidence({
      inventory_evidence: [inventory],
    });
    if (!result.ok) throw result.error;
    expect(
      appleApplicationProjectionResultSchema.parse(
        result.value.evidence.normalized_result,
      ),
    ).toMatchObject({
      application_roots: [applicationRoot],
      components: { executables: [expect.any(Object)] },
    });
  });
});

it("keeps explicit directories out of unavailable file components", async () => {
  const projection = await projectArchive("Directories.ipa", [
    ["Payload/Fixture.app/", { directory: true }],
    ["Payload/Fixture.app/Info.plist"],
  ]);
  expect(projection.unavailable_components).toEqual([]);
  expect(projection.coverage).toEqual({
    status: "complete-within-inventory",
    inventory_complete: true,
  });
});
