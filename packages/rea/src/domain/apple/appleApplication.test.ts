import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ArtifactOccurrence } from "../artifactGraph.js";

import { parseArtifactInventoryEvidence } from "../artifactInventoryEvidence.js";
import { projectAppleInventory } from "./appleApplication.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { createEvidence, type Evidence } from "../evidence.js";

type EntryKind = "file" | "directory" | "symlink" | "slice";
type RootFormat = "ipa" | "zip" | "dmg" | "directory" | "asar";

interface FixtureEntry {
  readonly path: string;
  readonly kind?: EntryKind;
  readonly format?: ArtifactOccurrence["artifact_format"];
  readonly unavailable?: boolean;
}

const sha = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
const artifactId = (sha256: string): string =>
  `art_${digestCanonicalValue({ sha256 }, "Artifact inventory")}`;

/** Build one complete, content-addressed inventory page for pure projection tests. */
const inventoryEvidence = (
  rootFormat: RootFormat,
  subjectName: string,
  entries: readonly FixtureEntry[],
): Evidence => {
  const rootSha = sha(`${rootFormat}:${subjectName}`);
  const rootId = artifactId(rootSha);
  const node = (sha256: string, format: string) => ({
    artifact_id: artifactId(sha256),
    format: [
      "directory",
      "mach-o",
      "mach-o-universal",
      "elf",
      "pe",
      "plist",
    ].includes(format)
      ? format
      : "file",
    sha256,
    size: 1,
    media_type: null,
    architecture: null,
    content_state: "materialized",
    limitations: [],
  });
  const occurrence = (
    path: string,
    kind: EntryKind,
    id: string | null,
    format: ArtifactOccurrence["artifact_format"] = "file",
  ): ArtifactOccurrence => ({
    occurrence_id:
      path === "."
        ? `occ_${digestCanonicalValue({ root: rootId }, "Artifact inventory")}`
        : `occ_${digestCanonicalValue(
            { root_artifact_id: rootId, logical_path: path, entry_kind: kind },
            "Artifact inventory",
          )}`,
    artifact_id: id,
    parent_occurrence_id: null,
    logical_path: path,
    entry_kind: kind,
    artifact_kind: "resource",
    artifact_format: format,
    declared_size: null,
    compressed_size: null,
    executable: false,
    encrypted: false,
    hash_status: "verified",
    source_location: null,
    limitations: [],
  });
  const nodes = new Map([[rootId, node(rootSha, rootFormat)]]);
  const occurrences = [
    occurrence(
      ".",
      rootFormat === "directory" ? "directory" : "file",
      rootId,
      rootFormat,
    ),
  ];
  for (const {
    path,
    kind = "file",
    format = "file",
    unavailable = false,
  } of entries) {
    if (kind === "symlink" || unavailable) {
      occurrences.push({
        ...occurrence(path, kind, null, format),
        hash_status: "unavailable",
        limitations: unavailable
          ? ["Authored fixture: content was not read."]
          : [],
      });
      continue;
    }
    const contentSha = sha(`${kind}:${path}`);
    const id = artifactId(contentSha);
    nodes.set(
      id,
      node(contentSha, kind === "directory" ? "directory" : format),
    );
    occurrences.push(
      occurrence(path, kind, id, kind === "directory" ? "directory" : format),
    );
  }
  const sortedNodes = [...nodes.values()].sort((left, right) =>
    left.artifact_id.localeCompare(right.artifact_id),
  );
  const sortedOccurrences = occurrences.sort((left, right) =>
    compareUnicodeCodePoints(left.logical_path, right.logical_path),
  );
  const graphSha256 = digestCanonicalValue(
    {
      nodes: sortedNodes,
      occurrences: sortedOccurrences,
      edges: [],
      integrity_contradictions: [],
    },
    "Artifact inventory",
  );
  return createEvidence(
    {
      path: `/fixtures/${subjectName}`,
      sha256: rootSha,
      format: rootFormat,
    },
    { id: "rea-artifact-graph", name: "fixture", version: "1" },
    {
      operation: "inventory_artifact",
      parameters: {},
      confidence: "observed",
      authority: "shipped-artifact",
      result: {
        manifest: {
          manifest_id: `agm_${digestCanonicalValue(
            { root_artifact_id: rootId, graph_sha256: graphSha256 },
            "Artifact inventory",
          )}`,
          root_artifact_id: rootId,
          root_sha256: rootSha,
          root_format: rootFormat,
          graph_sha256: graphSha256,
          node_count: sortedNodes.length,
          occurrence_count: sortedOccurrences.length,
          edge_count: 0,
        },
        nodes: sortedNodes,
        occurrences: sortedOccurrences,
        edges: [],
        provenance: [],
        integrity_contradictions: [],
        coverage: { scope: "container-entries", status: "complete" },
        limitations: [],
      },
    },
  );
};

const project = (evidence: Evidence) => {
  const result = projectAppleInventory(
    parseArtifactInventoryEvidence([evidence]),
  );
  if (!result.ok) throw result.error;
  return result.value;
};

const macho = (path: string): FixtureEntry => ({ path, format: "mach-o" });

describe("macOS application roots and bundle roles", () => {
  it("treats an inventoried .app directory as its own application root", () => {
    const result = project(
      inventoryEvidence("directory", "Fixture.app", [
        { path: "Contents/Info.plist" },
        macho("Contents/MacOS/Fixture"),
        { path: "Contents/_CodeSignature/CodeResources" },
        { path: "Contents/embedded.provisionprofile" },
        macho("Contents/Library/LaunchServices/com.example.helper"),
        { path: "Contents/Library/LaunchDaemons/com.example.helper.plist" },
        { path: "Contents/Library/LaunchAgents/com.example.agent.plist" },
        macho("Contents/Helpers/tool"),
        macho("Contents/Helpers/Assistant.app/Contents/MacOS/Assistant"),
        macho(
          "Contents/Library/SystemExtensions/com.example.filter.systemextension/Contents/MacOS/com.example.filter",
        ),
        macho(
          "Contents/Library/SystemExtensions/com.example.driver.dext/driver",
        ),
        { path: "Contents/PlugIns/Preview.qlgenerator", kind: "directory" },
        macho("Contents/PlugIns/Bridge.bundle/Contents/MacOS/Bridge"),
        { path: "Contents/Resources/Strings.bundle/Info.plist" },
        { path: "Contents/SharedSupport/Data.bundle", kind: "directory" },
        macho("Contents/Resources/Embedded.app/Contents/MacOS/Embedded"),
      ]),
    );
    expect(result).toMatchObject({
      root_format: "directory",
      platforms: ["macos"],
      application_roots: ["."],
    });
    expect(
      result.bundles.map(({ path, role, layout, parent_path: parent }) => ({
        path,
        role,
        layout,
        parent,
      })),
    ).toEqual([
      { path: ".", role: "application", layout: "macos-deep", parent: null },
      {
        path: "Contents/Helpers/Assistant.app",
        role: "helper-application",
        layout: "macos-deep",
        parent: ".",
      },
      {
        path: "Contents/Library/SystemExtensions/com.example.driver.dext",
        role: "driver-extension",
        layout: "shallow",
        parent: ".",
      },
      {
        path: "Contents/Library/SystemExtensions/com.example.filter.systemextension",
        role: "system-extension",
        layout: "macos-deep",
        parent: ".",
      },
      {
        path: "Contents/PlugIns/Bridge.bundle",
        role: "plug-in",
        layout: "macos-deep",
        parent: ".",
      },
      {
        path: "Contents/PlugIns/Preview.qlgenerator",
        role: "plug-in",
        layout: "shallow",
        parent: ".",
      },
      {
        path: "Contents/Resources/Embedded.app",
        role: "nested-application",
        layout: "macos-deep",
        parent: ".",
      },
      {
        path: "Contents/Resources/Strings.bundle",
        role: "resource-bundle",
        layout: "shallow",
        parent: ".",
      },
      {
        path: "Contents/SharedSupport/Data.bundle",
        role: "bundle",
        layout: "shallow",
        parent: ".",
      },
    ]);
    expect(result.bundles[0]).toMatchObject({
      info_plist_path: "Contents/Info.plist",
      executable_candidates: ["Contents/MacOS/Fixture"],
      signing_paths: [
        "Contents/_CodeSignature/CodeResources",
        "Contents/embedded.provisionprofile",
      ],
    });
    expect(
      result.components.privileged_helpers.map(({ path }) => path),
    ).toEqual(["Contents/Library/LaunchServices/com.example.helper"]);
    expect(
      result.components.launchd_plists.map(({ path, domain }) => [
        path,
        domain,
      ]),
    ).toEqual([
      ["Contents/Library/LaunchAgents/com.example.agent.plist", "agent"],
      ["Contents/Library/LaunchDaemons/com.example.helper.plist", "daemon"],
    ]);
    expect(result.components.helpers.map(({ path }) => path)).toEqual([
      "Contents/Helpers/tool",
    ]);
  });

  it("does not make a non-application bundle directory an application root", () => {
    const result = project(
      inventoryEvidence("directory", "Service.xpc", [
        { path: "Contents/Info.plist" },
        macho("Contents/MacOS/Service"),
      ]),
    );
    expect(result.application_roots).toEqual([]);
    expect(result.bundles).toEqual([]);
    expect(result.limitations).toContain(
      "No application bundle (Payload/*.app or *.app/Contents) was present in the supplied inventory pages.",
    );
  });
});

describe("Apple bundle directory identity", () => {
  it.each([
    ["Contents", "file"],
    ["Contents", "symlink"],
    ["Versions", "file"],
    ["Versions", "symlink"],
  ] as const)("does not derive a layout from a %s %s", (name, kind) => {
    const root = "Payload/Mobile.app";
    const result = project(
      inventoryEvidence("ipa", "Mobile.ipa", [
        { path: `${root}/Info.plist`, format: "plist" },
        { path: `${root}/${name}`, kind },
      ]),
    );
    expect(result.platforms).toEqual(["ios"]);
    expect(result.bundles).toEqual([
      expect.objectContaining({
        path: root,
        layout: "shallow",
        info_plist_path: `${root}/Info.plist`,
      }),
    ]);
  });

  it.each([
    ["Contents", "macos-deep"],
    ["Versions", "versioned-framework"],
  ] as const)(
    "derives a layout from an explicit empty %s directory",
    (name, layout) => {
      const root = "Payload/Mobile.app";
      const result = project(
        inventoryEvidence("ipa", "Mobile.ipa", [
          { path: `${root}/${name}`, kind: "directory" },
        ]),
      );
      expect(result.bundles[0]).toMatchObject({ path: root, layout });
    },
  );

  it.each([
    ["Contents", "contents/Info.plist", "macos-deep"],
    ["Versions", "versions/A/Resources/Info.plist", "versioned-framework"],
  ] as const)(
    "keeps a real %s directory distinct from a same-named file",
    (name, plist, layout) => {
      const root = "Payload/Mobile.app";
      const result = project(
        inventoryEvidence("ipa", "Mobile.ipa", [
          { path: `${root}/${name}` },
          { path: `${root}/${plist}`, format: "plist" },
        ]),
      );
      expect(result.bundles[0]).toMatchObject({
        path: root,
        layout,
        info_plist_path: `${root}/${plist}`,
      });
    },
  );

  it("keeps files from shadowing anatomy directories inside bundles", () => {
    const framework = "Contents/Frameworks/Core.framework";
    const result = project(
      inventoryEvidence("directory", "Fixture.app", [
        { path: "Contents/Info.plist" },
        { path: "Contents/MacOS" },
        macho("Contents/macos/Fixture"),
        { path: "Contents/_CodeSignature" },
        { path: "Contents/_codesignature/CodeResources" },
        { path: `${framework}/Versions/A/Resources` },
        { path: `${framework}/Versions/A/resources/Info.plist` },
      ]),
    );
    expect(result.bundles[0]).toMatchObject({
      executable_candidates: ["Contents/macos/Fixture"],
      signing_paths: ["Contents/_codesignature/CodeResources"],
    });
    expect(result.bundles[1]).toMatchObject({
      path: framework,
      info_plist_path: `${framework}/Versions/A/resources/Info.plist`,
    });
  });
});

describe("Apple bundle layouts and containers", () => {
  it("follows versioned frameworks without resolving Versions/Current", () => {
    const framework = "Fixture.app/Contents/Frameworks/Core.framework";
    const result = project(
      inventoryEvidence("zip", "Fixture.zip", [
        macho("Fixture.app/Contents/MacOS/Fixture"),
        { path: `${framework}/Core`, kind: "symlink" },
        { path: `${framework}/Versions/Current`, kind: "symlink" },
        macho(`${framework}/Versions/A/Core`),
        { path: `${framework}/Versions/A/Resources/Info.plist` },
        { path: `${framework}/Versions/A/_CodeSignature/CodeResources` },
        macho(
          `${framework}/Versions/A/XPCServices/Fetch.xpc/Contents/MacOS/Fetch`,
        ),
      ]),
    );
    const core = result.bundles.find(({ path }) => path === framework);
    expect(core).toEqual({
      path: framework,
      parent_path: "Fixture.app",
      layout: "versioned-framework",
      role: "framework",
      role_basis: "path-convention",
      info_plist_path: `${framework}/Versions/A/Resources/Info.plist`,
      executable_candidates: [`${framework}/Versions/A/Core`],
      signing_paths: [`${framework}/Versions/A/_CodeSignature/CodeResources`],
    });
    expect(
      result.bundles.find(({ role }) => role === "xpc-service")?.parent_path,
    ).toBe(framework);
    expect(result.symlinks).toEqual([
      `${framework}/Core`,
      `${framework}/Versions/Current`,
    ]);
  });

  it("reports an unknown Info.plist when several framework versions exist", () => {
    const framework = "Fixture.app/Contents/Frameworks/Core.framework";
    const result = project(
      inventoryEvidence("zip", "Fixture.zip", [
        macho("Fixture.app/Contents/MacOS/Fixture"),
        { path: `${framework}/Versions/A/Resources/Info.plist` },
        { path: `${framework}/Versions/B/Resources/Info.plist` },
      ]),
    );
    expect(
      result.bundles.find(({ path }) => path === framework)?.info_plist_path,
    ).toBeNull();
    // Files beside the only real version are not versions.
    const withFiles = project(
      inventoryEvidence("zip", "Fixture.zip", [
        macho("Fixture.app/Contents/MacOS/Fixture"),
        { path: `${framework}/Versions/A/Resources/Info.plist` },
        { path: `${framework}/Versions/.DS_Store` },
        { path: `${framework}/Versions/Current`, kind: "symlink" },
      ]),
    );
    expect(
      withFiles.bundles.find(({ path }) => path === framework)?.info_plist_path,
    ).toBe(`${framework}/Versions/A/Resources/Info.plist`);
    // Only A has a plist, but Versions/Current may select B.
    const onlyA = project(
      inventoryEvidence("zip", "Fixture.zip", [
        macho("Fixture.app/Contents/MacOS/Fixture"),
        { path: `${framework}/Versions/A/Resources/Info.plist` },
        macho(`${framework}/Versions/B/Core`),
      ]),
    );
    expect(
      onlyA.bundles.find(({ path }) => path === framework)?.info_plist_path,
    ).toBeNull();
    expect(result.limitations).toContainEqual(
      expect.stringContaining("Versions/Current selects is unknown"),
    );
  });

  it("excludes AppleDouble sidecars from roots and roles", () => {
    const result = project(
      inventoryEvidence("zip", "Fixture.zip", [
        macho("Fixture.app/Contents/MacOS/Fixture"),
        { path: "Fixture.app/Contents/Library/LaunchDaemons/._helper.plist" },
        { path: "Fixture.app/Contents/Library/LaunchDaemons/helper.plist" },
        { path: "__MACOSX/Other.app/Contents/._Info.plist" },
      ]),
    );
    expect(result.application_roots).toEqual(["Fixture.app"]);
    expect(result.components.launchd_plists.map(({ path }) => path)).toEqual([
      "Fixture.app/Contents/Library/LaunchDaemons/helper.plist",
    ]);
    expect(result.limitations).toContainEqual(
      expect.stringContaining("AppleDouble sidecar entries"),
    );
  });

  it("reports a DMG without inventoried contents as partial", () => {
    const result = project(inventoryEvidence("dmg", "Fixture.dmg", []));
    expect(result.coverage).toEqual({
      status: "partial",
      inventory_complete: true,
    });
    expect(result.limitations).toContain(
      "The DMG's contents were not inventoried on this host; bundle absence is unknown.",
    );
  });

  it("keeps IPA applications shallow and iOS", () => {
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: "Payload/Fixture.app/Info.plist" },
        macho("Payload/Fixture.app/Fixture"),
        { path: "Payload/Fixture.app/embedded.mobileprovision" },
        macho("Payload/Fixture.app/PlugIns/Share.appex/Share"),
        macho("SwiftSupport/iphoneos/libswiftCore.dylib"),
      ]),
    );
    expect(result.platforms).toEqual(["ios"]);
    // IPA projection still lists archive components outside Payload/.
    expect(result.components.native_libraries.map(({ path }) => path)).toEqual([
      "SwiftSupport/iphoneos/libswiftCore.dylib",
    ]);
    expect(
      result.bundles.map(({ path, role, layout }) => [path, role, layout]),
    ).toEqual([
      ["Payload/Fixture.app", "application", "shallow"],
      ["Payload/Fixture.app/PlugIns/Share.appex", "app-extension", "shallow"],
    ]);
    expect(result.bundles[0]?.executable_candidates).toEqual([
      "Payload/Fixture.app/Fixture",
    ]);
  });

  it("rejects inventories that cannot contain an Apple application", () => {
    try {
      project(inventoryEvidence("asar", "app.asar", []));
      throw new Error("Expected an unsupported inventory format to fail");
    } catch (cause: unknown) {
      expect(cause).toBeInstanceOf(AnalysisInputError);
      expect(cause).toMatchObject({
        operation: "project_apple_application_graph",
        issues: [
          expect.objectContaining({
            path: [
              "inventory_evidence",
              0,
              "normalized_result",
              "manifest",
              "root_format",
            ],
            message:
              "Apple application projection requires IPA, directory, ZIP, or DMG inventory Evidence (got asar)",
          }),
        ],
      });
    }
  });
});

describe("Shallow bundle Info.plist", () => {
  it("reads a flattened framework's Info.plist from Resources/", () => {
    const framework = "Contents/Frameworks/Core.framework";
    const result = project(
      inventoryEvidence("directory", "Fixture.app", [
        { path: "Contents/Info.plist" },
        macho("Contents/MacOS/Fixture"),
        macho(`${framework}/Core`),
        { path: `${framework}/Resources/Info.plist` },
        { path: `${framework}/_CodeSignature/CodeResources` },
      ]),
    );
    expect(result.bundles.find(({ path }) => path === framework)).toEqual({
      path: framework,
      parent_path: ".",
      layout: "shallow",
      role: "framework",
      role_basis: "path-convention",
      info_plist_path: `${framework}/Resources/Info.plist`,
      executable_candidates: [`${framework}/Core`],
      signing_paths: [`${framework}/_CodeSignature/CodeResources`],
    });
    expect(result.platforms).toEqual(["macos"]);
    expect(result.coverage.status).toBe("complete-within-inventory");
  });

  it.each([
    {
      name: "a root Info.plist over Resources/",
      entries: [
        { path: "Core.framework/Info.plist" },
        { path: "Core.framework/Resources/Info.plist" },
      ],
      plist: "Core.framework/Info.plist",
    },
    {
      name: "a folded resources/info.plist",
      entries: [{ path: "Core.framework/resources/info.plist" }],
      plist: "Core.framework/resources/info.plist",
    },
    {
      name: "no plist from a Resources file",
      entries: [{ path: "Core.framework/Resources" }],
      plist: null,
    },
    {
      name: "no plist from a nested bundle's Resources/",
      entries: [{ path: "Core.framework/Data.bundle/Resources/Info.plist" }],
      plist: null,
    },
  ])("selects $name in a shallow bundle", ({ entries, plist }) => {
    const root = "Payload/Fixture.app";
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: `${root}/Info.plist` },
        ...entries.map(({ path }) => ({ path: `${root}/${path}` })),
      ]),
    );
    expect(
      result.bundles.find(({ path }) => path === `${root}/Core.framework`)
        ?.info_plist_path,
    ).toBe(plist === null ? null : `${root}/${plist}`);
    expect(result.platforms).toEqual(["ios"]);
  });

  it("does not classify a Resources/-only application root as iOS", () => {
    const root = "Payload/Fixture.app";
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: `${root}/Resources/Info.plist` },
      ]),
    );
    expect(result.bundles[0]).toMatchObject({
      path: root,
      layout: "shallow",
      info_plist_path: `${root}/Resources/Info.plist`,
    });
    expect(result.platforms).toEqual([]);
  });
});

describe("Apple IPA components", () => {
  it("excludes AppleDouble sidecars from IPA components", () => {
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: "Payload/Fixture.app/Info.plist" },
        macho("Payload/Fixture.app/Fixture"),
        { path: "Payload/Fixture.app/Contents/Resources/._libfoo.dylib" },
        { path: "Payload/Fixture.app/Frameworks/Foo.framework/._Foo" },
        { path: "__MACOSX/Payload/Fixture.app/libghost.dylib" },
        macho("Payload/Fixture.app/Contents/Resources/libreal.dylib"),
        macho("SwiftSupport/iphoneos/libswiftCore.dylib"),
      ]),
    );
    expect(result.components.native_libraries.map(({ path }) => path)).toEqual([
      "Payload/Fixture.app/Contents/Resources/libreal.dylib",
      "SwiftSupport/iphoneos/libswiftCore.dylib",
    ]);
    expect(result.components.frameworks).toEqual([]);
    expect(result.components.executables.map(({ path }) => path)).toEqual([
      "Payload/Fixture.app/Contents/Resources/libreal.dylib",
      "Payload/Fixture.app/Fixture",
    ]);
    expect(result.limitations).toContainEqual(
      expect.stringContaining("AppleDouble sidecar entries"),
    );
  });
});

describe("macOS application scope", () => {
  it("attributes only components inside the application roots", () => {
    const result = project(
      inventoryEvidence("zip", "Distribution.zip", [
        macho("Fixture.app/Contents/MacOS/Fixture"),
        macho("Fixture.app/Contents/Frameworks/Core.framework/Versions/A/Core"),
        {
          path: "Fixture.app/Contents/Resources/app.js",
          format: "javascript-bundle",
        },
        macho("Extras/Plugin.framework/Versions/A/Plugin"),
        macho("Extras/libextra.dylib"),
        { path: "Extras/installer.js", format: "javascript-bundle" },
        { path: "Extras/Info.plist" },
      ]),
    );
    const paths = (components: readonly { readonly path: string }[]) =>
      components.map(({ path }) => path);
    expect(paths(result.components.frameworks)).toEqual([
      "Fixture.app/Contents/Frameworks/Core.framework/Versions/A/Core",
    ]);
    expect(paths(result.components.native_libraries)).toEqual([]);
    expect(paths(result.components.javascript)).toEqual([
      "Fixture.app/Contents/Resources/app.js",
    ]);
    expect(paths(result.components.bundle_metadata)).toEqual([]);
    expect(
      result.bridge_candidates.every(
        ({ source_path: source, native_path: target }) =>
          [source, target].every((path) => path.startsWith("Fixture.app/")),
      ),
    ).toBe(true);
    expect(result.limitations).toContain(
      "4 inventoried entries outside every application root are not attributed to the application.",
    );
  });

  it("keeps a selected .app directory as the root when its contents are missing", () => {
    const empty = project(inventoryEvidence("directory", "Fixture.app", []));
    expect(empty).toMatchObject({
      application_roots: ["."],
      platforms: [],
      bundles: [
        {
          path: ".",
          role: "application",
          layout: "shallow",
          info_plist_path: null,
        },
      ],
    });
    const partial = project(
      inventoryEvidence("directory", "Fixture.app", [
        { path: "Contents/Resources/Localizable.strings" },
      ]),
    );
    expect(partial).toMatchObject({
      application_roots: ["."],
      platforms: ["macos"],
    });
  });
});

describe("Apple application bridge candidates", () => {
  it("pairs scripts and native code only within one application root", () => {
    const result = project(
      inventoryEvidence("zip", "Suite.zip", [
        macho("First.app/Contents/MacOS/First"),
        {
          path: "First.app/Contents/Resources/first.js",
          format: "javascript-bundle",
        },
        macho("Second.app/Contents/MacOS/Second"),
        {
          path: "Second.app/Contents/Resources/second.js",
          format: "javascript-bundle",
        },
      ]),
    );
    expect(result.application_roots).toEqual(["First.app", "Second.app"]);
    expect(
      result.bridge_candidates.map(
        ({ source_path: source, native_path: target }) => [source, target],
      ),
    ).toEqual([
      [
        "First.app/Contents/Resources/first.js",
        "First.app/Contents/MacOS/First",
      ],
      [
        "Second.app/Contents/Resources/second.js",
        "Second.app/Contents/MacOS/Second",
      ],
    ]);
  });

  it("reports candidate omission when one root expands beyond the bridge safety budget", () => {
    const escapedDirectory = `${"é".repeat(100)}${'"'.repeat(120)}`;
    const scripts: FixtureEntry[] = Array.from({ length: 129 }, (_, index) => ({
      path: `Payload/Fixture.app/${escapedDirectory}/script-${String(index).padStart(3, "0")}.js`,
      format: "javascript-bundle",
    }));
    const native = Array.from({ length: 128 }, (_, index) =>
      macho(
        `Payload/Fixture.app/${escapedDirectory}/lib${String(index).padStart(3, "0")}.dylib`,
      ),
    );
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [...scripts, ...native]),
    );

    expect(result.components.javascript).toHaveLength(129);
    expect(result.components.native_libraries).toHaveLength(128);
    expect(result.bridge_candidate_coverage).toMatchObject({
      status: "partial",
      total_candidates: 129 * 128,
      emitted_candidates: result.bridge_candidates.length,
      omitted_candidates: 129 * 128 - result.bridge_candidates.length,
    });
    expect(result.bridge_candidates.length).toBeGreaterThan(0);
    expect(result.bridge_candidates.length).toBeLessThan(129 * 128);
    expect(
      Buffer.byteLength(JSON.stringify(result.bridge_candidates)),
    ).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(result.coverage).toMatchObject({
      status: "partial",
      inventory_complete: true,
    });
    expect(result.limitations).toContain(
      `Bridge candidate pairs exceeded the projection safety budget; ${result.bridge_candidate_coverage.omitted_candidates} hypotheses are omitted. Component arrays still include every component from the supplied inventory pages.`,
    );
  });

  it("preserves candidate pairing for components without an application root", () => {
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: "Payload/Fixture.app/Info.plist" },
        {
          path: "Payload/Fixture.app/Resources/app.js",
          format: "javascript-bundle",
        },
        { path: "SwiftSupport/outside.js", format: "javascript-bundle" },
        { path: "SwiftSupport/liboutside.dylib", format: "mach-o" },
      ]),
    );

    expect(result.bridge_candidates).toContainEqual({
      source_path: "SwiftSupport/outside.js",
      native_path: "SwiftSupport/liboutside.dylib",
      basis: "javascript-and-native-content",
    });
    expect(result.bridge_candidate_coverage).toMatchObject({
      status: "complete",
    });
  });

  it("keeps an extensionless Mach-O without an application root as a native component", () => {
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: "Payload/Fixture.app/Info.plist" },
        macho("Payload/Fixture.app/Fixture"),
        { path: "SwiftSupport/outside.js", format: "javascript-bundle" },
        macho("SwiftSupport/HelperTool"),
        macho("SwiftSupport/iphoneos/libswiftCore.dylib"),
      ]),
    );

    expect(result.components.executables.map(({ path }) => path)).toEqual([
      "Payload/Fixture.app/Fixture",
      "SwiftSupport/HelperTool",
    ]);
    expect(result.bridge_candidates).toEqual([
      {
        source_path: "SwiftSupport/outside.js",
        native_path: "SwiftSupport/HelperTool",
        basis: "javascript-and-native-content",
      },
      {
        source_path: "SwiftSupport/outside.js",
        native_path: "SwiftSupport/iphoneos/libswiftCore.dylib",
        basis: "javascript-and-native-content",
      },
    ]);
  });
});

describe("Apple path conventions", () => {
  it("recognizes anatomy names by English case and reports the archive spelling", () => {
    const result = project(
      inventoryEvidence("directory", "Fixture.app", [
        { path: "contents/info.plist" },
        macho("contents/macos/Fixture"),
        { path: "contents/_codesignature/coderesources" },
      ]),
    );
    expect(result.bundles[0]).toMatchObject({
      layout: "macos-deep",
      info_plist_path: "contents/info.plist",
      executable_candidates: ["contents/macos/Fixture"],
      signing_paths: ["contents/_codesignature/coderesources"],
    });
    expect(result.components.bundle_metadata.map(({ path }) => path)).toEqual([
      "contents/info.plist",
    ]);
    expect(result.components.signing.map(({ path }) => path)).toEqual([
      "contents/_codesignature/coderesources",
    ]);
  });

  it("limits runtime families and bridge bases to path segments", () => {
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: "Payload/Fixture.app/Info.plist" },
        macho("Payload/Fixture.app/Fixture"),
        macho("Payload/Fixture.app/Frameworks/libfoo.dylib"),
        macho("SwiftSupport/libswiftCore.dylib"),
        macho("Payload/Fixture.app/Frameworks/MyApp.framework/MyApp"),
        macho("Payload/Fixture.app/community/libcommunity.so"),
        {
          path: "Payload/Fixture.app/main.js",
          format: "javascript-bundle",
        },
      ]),
    );
    expect(result.runtime_families).toEqual(
      expect.arrayContaining(["javascript", "native", "swift-objective-c"]),
    );
    expect(result.runtime_families).not.toContain("flutter");
    expect(result.runtime_families).not.toContain("unity");
    expect(result.runtime_families).not.toContain("react-native");
    expect(
      result.bridge_candidates.every(
        ({ basis }) => basis === "javascript-and-native-content",
      ),
    ).toBe(true);
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Runtime families are inferred from inventory formats and bounded framework path conventions, not observed runtime loading.",
        "A bridge basis is inferred from the native path and is repeated for every managed component.",
      ]),
    );
  });

  it("recognizes framework segments and does not treat a bare dylib as Swift", () => {
    const result = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: "Payload/Fixture.app/Info.plist" },
        macho("Payload/Fixture.app/Fixture"),
        macho("Payload/Fixture.app/Frameworks/Flutter.framework/Flutter"),
        macho(
          "Payload/Fixture.app/Frameworks/UnityFramework.framework/UnityFramework",
        ),
        macho("Payload/Fixture.app/Frameworks/hermes.framework/hermes"),
        macho("Payload/Fixture.app/Frameworks/libfoo.dylib"),
      ]),
    );
    expect(result.runtime_families).toEqual(
      expect.arrayContaining(["flutter", "unity", "react-native", "native"]),
    );
    expect(result.runtime_families).not.toContain("swift-objective-c");
  });

  it.each([
    // U+10000 sorts before U+FFFD by UTF-16 code unit, after it by code point.
    ["an astral and a BMP name", "\uFFFD", "\u{10000}"],
    ["two BMP names", "\uE000", "\uFFFD"],
  ])(
    "orders roots, bundles and symlinks by code point for %s",
    (_label, low, high) => {
      const result = project(
        inventoryEvidence(
          "zip",
          "Fixture.zip",
          [high, low].flatMap((name) => [
            { path: `A${name}.app/Contents/Info.plist` },
            { path: `A${name}.app/Contents/Resources/link`, kind: "symlink" },
          ]),
        ),
      );
      const roots = [`A${low}.app`, `A${high}.app`];
      expect(result.application_roots).toEqual(roots);
      expect(result.bundles.map(({ path }) => path)).toEqual(roots);
      expect(result.symlinks).toEqual(
        roots.map((root) => `${root}/Contents/Resources/link`),
      );
    },
  );
});

it.each(["file", "slice"] as const)(
  "retains non-encrypted unavailable %s facts without classifying content",
  (kind) => {
    const projection = project(
      inventoryEvidence("ipa", "Fixture.ipa", [
        { path: "Payload/Fixture.app/Info.plist", format: "plist" },
        {
          path: "Payload/Fixture.app/libentry.dylib",
          kind,
          format: "file",
          unavailable: true,
        },
      ]),
    );
    expect(projection.unavailable_components).toEqual([
      {
        path: "Payload/Fixture.app/libentry.dylib",
        artifact_id: null,
        sha256: null,
        format: "file",
        encrypted: false,
        limitations: ["Authored fixture: content was not read."],
      },
    ]);
    expect(projection.components.native_libraries).toEqual([]);
    expect(projection.coverage).toEqual({
      status: "partial",
      inventory_complete: true,
    });
  },
);

it("selects metadata and signature files before applying anatomy case preferences", () => {
  const result = project(
    inventoryEvidence("directory", "Fixture.app", [
      { path: "Contents/Info.plist", kind: "directory" },
      { path: "Contents/info.plist", format: "plist" },
      { path: "Contents/_CodeSignature/CodeResources", kind: "directory" },
      { path: "Contents/_CodeSignature/coderesources" },
      { path: "Contents/embedded.mobileprovision", kind: "directory" },
      { path: "Contents/Embedded.mobileprovision" },
    ]),
  );
  expect(result.bundles[0]).toMatchObject({
    layout: "macos-deep",
    info_plist_path: "Contents/info.plist",
    signing_paths: [
      "Contents/Embedded.mobileprovision",
      "Contents/_CodeSignature/coderesources",
    ],
  });
});

it.each([
  ["Payload/Fake.app", "file"],
  ["Payload/Fake.app", "symlink"],
  ["Fake.app/Contents", "file"],
  ["Fake.app/Contents", "symlink"],
] as const)(
  "does not invent an application root from a %s %s",
  (path, kind) => {
    const result = project(
      inventoryEvidence("zip", "Fixture.zip", [{ path, kind }]),
    );
    expect(result.application_roots).toEqual([]);
    expect(result.bundles).toEqual([]);
    expect(result.platforms).toEqual([]);
  },
);

it.each(["Core.framework", "Core.FRAMEWORK"])(
  "uses the recognized %s role for framework components",
  (name) => {
    const framework = `Fixture.app/Contents/Frameworks/${name}`;
    const result = project(
      inventoryEvidence("directory", "Fixture.app", [
        macho(`${framework}/Core`),
        { path: `${framework}/Info.plist` },
      ]),
    );
    expect(result.components.frameworks.map(({ path }) => path)).toEqual([
      `${framework}/Core`,
      `${framework}/Info.plist`,
    ]);
  },
);

it("preserves observed unavailable bundle metadata and signing paths without inventing executable content", () => {
  const root = "Payload/Mobile.app";
  const result = project(
    inventoryEvidence("ipa", "Mobile.ipa", [
      { path: `${root}/Info.plist`, unavailable: true },
      { path: `${root}/_CodeSignature/CodeResources`, unavailable: true },
      { path: `${root}/Main`, unavailable: true },
    ]),
  );
  expect(result.bundles[0]).toMatchObject({
    info_plist_path: `${root}/Info.plist`,
    signing_paths: [`${root}/_CodeSignature/CodeResources`],
    executable_candidates: [],
  });
  expect(result.platforms).toEqual(["ios"]);
  expect(result.unavailable_components).toHaveLength(3);
});

it.each(["zip", "directory", "dmg"] as const)(
  "does not apply IPA roots to a %s inventory",
  (format) => {
    const result = project(
      inventoryEvidence(format, `Sample.${format}`, [
        { path: "Payload/App.app/Info.plist", format: "plist" },
        { path: "Extras/Other.app/Info.plist", format: "plist" },
      ]),
    );
    expect(result.root_format).toBe(format);
    expect(result.application_roots).toEqual([]);
    expect(result.platforms).toEqual([]);
    expect(result.bundles).toEqual([]);
  },
);

it.each(["ipa", "zip", "directory", "dmg"] as const)(
  "uses only the %s root convention in a mixed inventory",
  (format) => {
    const source = inventoryEvidence(format, `Mixed.${format}`, [
      { path: "Payload/App.app/Info.plist", format: "plist" },
      { path: "Extras/Other.app/Contents/Info.plist", format: "plist" },
      macho("Extras/Other.app/Contents/MacOS/Other"),
      {
        path: "Extras/Other.app/Contents/Resources/app.js",
        format: "javascript-bundle",
      },
    ]);
    const result = project(source);
    expect(result.application_roots).toEqual([
      format === "ipa" ? "Payload/App.app" : "Extras/Other.app",
    ]);
    expect(result.platforms).toEqual([format === "ipa" ? "ios" : "macos"]);
    expect(result.components.javascript).toHaveLength(1);
    expect(result.components.executables).toHaveLength(1);
  },
);
