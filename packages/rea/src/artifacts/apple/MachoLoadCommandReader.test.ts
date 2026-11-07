import { createHash } from "node:crypto";
import { mkdir, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CPU,
  FILE_TYPE,
  LC,
  codeSignatureCommand,
  buildVersionCommand,
  dyldEnvironmentCommand,
  dylibCommand,
  dylibUseCommand,
  fatImage,
  lazyLoadDylibInfoCommand,
  lazyLoadDylibInfoPayload,
  machoImage,
  machoImageWithLazyLoadDylibInfo,
  segmentCommand,
  readerOf,
  rpathCommand,
  versionMinCommand,
} from "./MachoImage.fixture.js";
import {
  MAX_LAZY_INFO_DEPENDENCIES,
  MAX_LAZY_INFO_SYMBOL_REFERENCES,
  MAX_LOAD_COMMAND_BYTES,
  readMachoImage,
} from "./MachoLoadCommandReader.js";
import { hasMachoMagic } from "../../domain/apple/machoContainer.js";
import { traceDylibResolution } from "./DylibResolutionReader.js";
import { DirectoryArtifactReader } from "../DirectoryArtifactReader.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { javaClassFile } from "../../../tests/fixtures/javaClassFile.js";

const read = (bytes: Uint8Array) =>
  readMachoImage(readerOf(bytes), bytes.length);

it.skipIf(process.platform === "win32")(
  "keeps non-UTF-8 symlink targets distinct from a real replacement character",
  async () => {
    const root = await createTestTempDirectory("rea-dylib-raw-symlink-");
    const executable = machoImage({
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.LOAD_DYLIB, "@loader_path/raw-link"),
        dylibCommand(LC.LOAD_DYLIB, "@loader_path/unicode-link"),
      ],
    });
    await writeFile(join(root, "App"), executable);
    await writeFile(
      join(root, "lib\ufffd"),
      machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [buildVersionCommand(1)],
      }),
    );
    await symlink(
      Buffer.from([0x6c, 0x69, 0x62, 0xff]),
      join(root, "raw-link"),
    );
    await symlink("lib\ufffd", join(root, "unicode-link"));
    const trace = await traceDylibResolution({
      rootPath: root,
      targetPath: join(root, "App"),
      targetSha256: createHash("sha256").update(executable).digest("hex"),
      enumerateRoots: false,
      parameters: { roots: ["App"] },
    });
    expect(trace.edges.map((edge) => edge.resolution)).toEqual([
      { status: "undetermined", image: null },
      { status: "resolved", image: "lib\ufffd" },
    ]);
    expect(trace.coverage.status).toBe("partial");
    expect(trace.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"raw-link":"6c6962ff"'),
      ]),
    );
    await expect(
      traceDylibResolution({
        rootPath: root,
        targetPath: join(root, "App"),
        targetSha256: createHash("sha256").update(executable).digest("hex"),
        enumerateRoots: false,
        parameters: { roots: ["raw-link"] },
      }),
    ).rejects.toMatchObject({
      issues: [
        {
          path: ["roots", 0],
          message: expect.stringContaining("non-UTF-8 target bytes 6c6962ff"),
        },
      ],
    });
  },
);

it("retains unknown executable-root traversal after a complete callback and keeps known image facts", async () => {
  const root = await createTestTempDirectory("rea-dylib-traversal-callback-");
  const bytes = machoImage({ commands: [buildVersionCommand(1)] });
  const path = join(root, "main");
  await writeFile(path, bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const reason = "Controlled producer executable-root uncertainty";
  const entries = DirectoryArtifactReader.prototype.entries;
  const spy = vi
    .spyOn(DirectoryArtifactReader.prototype, "entries")
    .mockImplementation(async function* (
      this: DirectoryArtifactReader,
      signal,
      options,
    ) {
      yield* entries.call(this, signal, options);
      if (typeof options === "function") return;
      options?.onCoverage?.({
        status: "unknown",
        examinedEntries: 1,
        limitations: [reason],
      });
      options?.onCoverage?.({
        status: "complete",
        examinedEntries: 1,
        limitations: [],
      });
    });
  try {
    const trace = await traceDylibResolution({
      rootPath: root,
      targetPath: path,
      targetSha256: digest,
      enumerateRoots: true,
      parameters: {},
    });
    expect(trace.coverage).toMatchObject({
      status: "partial",
      unparsed_images: [],
      roots_without_architecture: [],
    });
    expect(trace.roots).toEqual([{ image: "main", architecture: "arm64" }]);
    expect(trace.images).toContainEqual(
      expect.objectContaining({
        path: "main",
        sha256: digest,
        parse_status: "parsed",
        slices: [
          expect.objectContaining({
            architecture: "arm64",
            file_type: "execute",
            platform: 1,
          }),
        ],
      }),
    );
    expect(trace.limitations).toContain(reason);
  } finally {
    spy.mockRestore();
  }
});

// Legacy `LC_VERSION_MIN_*` commands carry no simulator flag: per dyld
// rules Intel images are simulator, ARM images are device (tvOS simulator
// is x86_64 only). A legacy simulator executable must not fail resolution
// against a modern simulator dylib.
it.each([
  { command: LC.VERSION_MIN_IPHONEOS, cpu: CPU.i386, platform: 7 },
  { command: LC.VERSION_MIN_IPHONEOS, cpu: CPU.x86_64, platform: 7 },
  { command: LC.VERSION_MIN_IPHONEOS, cpu: CPU.arm64, platform: 2 },
  { command: LC.VERSION_MIN_TVOS, cpu: CPU.i386, platform: 3 },
  { command: LC.VERSION_MIN_TVOS, cpu: CPU.x86_64, platform: 8 },
  { command: LC.VERSION_MIN_TVOS, cpu: CPU.arm64, platform: 3 },
  { command: LC.VERSION_MIN_WATCHOS, cpu: CPU.i386, platform: 9 },
  { command: LC.VERSION_MIN_WATCHOS, cpu: CPU.arm64, platform: 4 },
  { command: LC.VERSION_MIN_MACOSX, cpu: CPU.x86_64, platform: 1 },
] as const)(
  "classifies legacy command $command on $cpu.type as platform $platform",
  async ({ command, cpu, platform }) => {
    const facts = await read(
      machoImage({ cpu, commands: [versionMinCommand(command)] }),
    );
    if (facts.status !== "parsed") throw new Error(facts.status);
    expect(facts.slices[0]).toMatchObject({ platform, platforms: [platform] });
  },
);

it("uses legacy simulator and device platform facts when resolving dylibs", async () => {
  const root = await createTestTempDirectory("rea-macho-legacy-platform-");
  const dylibPath = "Frameworks/libThing.dylib";
  const installName = "@rpath/libThing.dylib";
  const intelExecutable = machoImage({
    cpu: CPU.x86_64,
    commands: [
      versionMinCommand(LC.VERSION_MIN_IPHONEOS),
      rpathCommand("@executable_path/Frameworks"),
      dylibCommand(LC.LOAD_DYLIB, installName),
    ],
  });
  const armExecutable = machoImage({
    cpu: CPU.arm64,
    commands: [
      versionMinCommand(LC.VERSION_MIN_IPHONEOS),
      rpathCommand("@executable_path/Frameworks"),
      dylibCommand(LC.LOAD_DYLIB, installName),
    ],
  });
  const simulatorDylib = fatImage([
    {
      cpu: CPU.x86_64,
      bytes: machoImage({
        cpu: CPU.x86_64,
        fileType: FILE_TYPE.dylib,
        commands: [
          buildVersionCommand(7),
          dylibCommand(LC.ID_DYLIB, installName),
        ],
      }),
    },
    {
      cpu: CPU.arm64,
      bytes: machoImage({
        cpu: CPU.arm64,
        fileType: FILE_TYPE.dylib,
        commands: [
          buildVersionCommand(7),
          dylibCommand(LC.ID_DYLIB, installName),
        ],
      }),
    },
  ]);
  await mkdir(join(root, "Frameworks"), { recursive: true });
  await writeFile(join(root, "Intel"), intelExecutable);
  await writeFile(join(root, "Arm"), armExecutable);
  await writeFile(join(root, dylibPath), simulatorDylib);

  const trace = async (target: string, architecture: "arm64" | "x86_64") => {
    const bytes = target === "Intel" ? intelExecutable : armExecutable;
    return traceDylibResolution({
      rootPath: root,
      targetPath: join(root, target),
      targetSha256: createHash("sha256").update(bytes).digest("hex"),
      enumerateRoots: false,
      parameters: { roots: [target], architecture },
    });
  };
  const intelTrace = await trace("Intel", "x86_64");
  const armTrace = await trace("Arm", "arm64");

  expect(intelTrace.edges).toContainEqual(
    expect.objectContaining({
      loader: "Intel",
      resolution: expect.objectContaining({
        status: "resolved",
        image: dylibPath,
      }),
    }),
  );
  expect(armTrace.edges).toContainEqual(
    expect.objectContaining({
      loader: "Arm",
      candidates: expect.arrayContaining([
        expect.objectContaining({ outcome: "platform-mismatch" }),
      ]),
    }),
  );
});

it("selects the ARMv7s FAT dylib slice before ARMv7 independent of FAT order", async () => {
  const workspace = await createTestTempDirectory("rea-macho-arm-fat-order-");
  const armv7 = { type: 12, subtype: 9 };
  const armv7s = { type: 12, subtype: 11 };
  const app = machoImage({
    cpu: armv7s,
    wide: false,
    commands: [
      versionMinCommand(LC.VERSION_MIN_IPHONEOS),
      dylibCommand(LC.LOAD_DYLIB, "@loader_path/lib.dylib"),
    ],
  });
  const generic = machoImage({
    cpu: armv7,
    wide: false,
    fileType: FILE_TYPE.dylib,
    commands: [
      versionMinCommand(LC.VERSION_MIN_IPHONEOS),
      dylibCommand(LC.LOAD_DYLIB, "@loader_path/generic-child.dylib"),
    ],
  });
  const specialized = machoImage({
    cpu: armv7s,
    wide: false,
    fileType: FILE_TYPE.dylib,
    commands: [
      versionMinCommand(LC.VERSION_MIN_IPHONEOS),
      dylibCommand(LC.LOAD_DYLIB, "@loader_path/specialized-child.dylib"),
    ],
  });
  const child = machoImage({
    cpu: armv7,
    wide: false,
    fileType: FILE_TYPE.dylib,
    commands: [versionMinCommand(LC.VERSION_MIN_IPHONEOS)],
  });
  const traceWithSlices = async (
    name: string,
    slices: readonly { cpu: typeof armv7; bytes: Uint8Array }[],
  ) => {
    const root = join(workspace, name);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "App"), app);
    await writeFile(join(root, "lib.dylib"), fatImage(slices));
    await writeFile(join(root, "generic-child.dylib"), child);
    await writeFile(join(root, "specialized-child.dylib"), child);
    return traceDylibResolution({
      rootPath: root,
      targetPath: join(root, "App"),
      targetSha256: createHash("sha256").update(app).digest("hex"),
      enumerateRoots: false,
      parameters: { roots: ["App"] },
    });
  };

  for (const [name, slices] of [
    [
      "generic-first",
      [
        { cpu: armv7, bytes: generic },
        { cpu: armv7s, bytes: specialized },
      ],
    ],
    [
      "specialized-first",
      [
        { cpu: armv7s, bytes: specialized },
        { cpu: armv7, bytes: generic },
      ],
    ],
  ] as const) {
    const trace = await traceWithSlices(name, slices);
    expect(
      trace.images.find(({ path }) => path === "App")?.slices[0],
    ).toMatchObject({
      architecture: "arm",
      cpu_type: armv7s.type,
      cpu_subtype: armv7s.subtype,
    });
    expect(trace.edges.find(({ loader }) => loader === "App")).toMatchObject({
      resolution: { status: "resolved", image: "lib.dylib" },
    });
    expect(
      trace.edges.find(({ loader }) => loader === "lib.dylib"),
    ).toMatchObject({
      install_name: "@loader_path/specialized-child.dylib",
      resolution: { status: "resolved", image: "specialized-child.dylib" },
    });
  }

  const fallback = await traceWithSlices("armv7-fallback", [
    { cpu: armv7, bytes: generic },
  ]);
  expect(
    fallback.edges.find(({ loader }) => loader === "lib.dylib"),
  ).toMatchObject({
    install_name: "@loader_path/generic-child.dylib",
    resolution: { status: "resolved", image: "generic-child.dylib" },
  });
});

it.each([false, true] as const)(
  "applies macOS dyld's implicit platform to a platform-less dylib and traces its required child present=%s",
  async (childPresent) => {
    const root = await createTestTempDirectory("rea-dylib-platform-unknown-");
    const executablePath = "Contents/MacOS/probe";
    const dylibPath = "Contents/Frameworks/libA.dylib";
    const fallbackPath = "Contents/Fallbacks/libA.dylib";
    const childPath = "Contents/Frameworks/libMissing.dylib";
    const fallbackChildPath = "Contents/Fallbacks/libFallbackOnly.dylib";
    const executable = machoImage({
      cpu: CPU.arm64,
      commands: [
        buildVersionCommand(1),
        rpathCommand("@executable_path/../Frameworks"),
        rpathCommand("@executable_path/../Fallbacks"),
        dylibCommand(LC.LOAD_DYLIB, "@rpath/libA.dylib"),
      ],
    });
    const dylib = machoImage({
      cpu: CPU.arm64,
      fileType: FILE_TYPE.dylib,
      commands: [
        rpathCommand("@loader_path"),
        dylibCommand(LC.LOAD_DYLIB, "@rpath/libMissing.dylib"),
      ],
    });
    const child = machoImage({
      cpu: CPU.arm64,
      fileType: FILE_TYPE.dylib,
      commands: [buildVersionCommand(1)],
    });
    const fallback = machoImage({
      cpu: CPU.arm64,
      fileType: FILE_TYPE.dylib,
      commands: [
        rpathCommand("@loader_path"),
        dylibCommand(LC.LOAD_DYLIB, "@rpath/libFallbackOnly.dylib"),
      ],
    });
    const fallbackChild = machoImage({
      cpu: CPU.arm64,
      fileType: FILE_TYPE.dylib,
      commands: [buildVersionCommand(1)],
    });
    await mkdir(join(root, "Contents/MacOS"), { recursive: true });
    await mkdir(join(root, "Contents/Frameworks"), { recursive: true });
    await mkdir(join(root, "Contents/Fallbacks"), { recursive: true });
    await writeFile(join(root, executablePath), executable);
    await writeFile(join(root, dylibPath), dylib);
    await writeFile(join(root, fallbackPath), fallback);
    await writeFile(join(root, fallbackChildPath), fallbackChild);
    if (childPresent) await writeFile(join(root, childPath), child);

    const trace = await traceDylibResolution({
      rootPath: root,
      targetPath: join(root, executablePath),
      targetSha256: createHash("sha256").update(executable).digest("hex"),
      enumerateRoots: false,
      parameters: { roots: [executablePath] },
    });

    expect(
      trace.images.find(({ path }) => path === executablePath)?.slices[0],
    ).toMatchObject({ platform: 1, platforms: [1] });
    expect(
      trace.images.find(({ path }) => path === dylibPath)?.slices[0],
    ).toMatchObject({ platform: null, platforms: [] });
    expect(trace.edges[0]).toMatchObject({
      loader: executablePath,
      install_name: "@rpath/libA.dylib",
      candidates: [
        {
          outcome: "resolved",
          resolved_path: dylibPath,
          platform_basis: "macos-dyld-implicit",
        },
      ],
      resolution: { status: "resolved", image: dylibPath },
    });
    expect(trace.edges[1]).toMatchObject({
      loader: dylibPath,
      install_name: "@rpath/libMissing.dylib",
      resolution: childPresent
        ? { status: "resolved", image: childPath }
        : { status: "unresolved", image: null },
      loader_conditional: false,
    });
    expect(trace.images.map(({ path }) => path)).toEqual(
      childPresent
        ? [executablePath, childPath, dylibPath].sort()
        : [executablePath, dylibPath].sort(),
    );
    expect(trace.images.map(({ path }) => path)).not.toContain(fallbackPath);
    expect(trace.images.map(({ path }) => path)).not.toContain(
      fallbackChildPath,
    );
    expect(trace.coverage.status).toBe("complete");
    expect(trace.limitations).toContainEqual(
      expect.stringContaining(dylibPath),
    );
    expect(trace.findings.map(({ kind }) => kind)).toEqual(
      childPresent ? [] : ["required-load-unresolved"],
    );
  },
);

describe("absolute dyld candidate paths at the filesystem reader boundary", () => {
  it.each(["install-name", "rpath"] as const)(
    "resolves an absolute in-root %s while preserving its source path",
    async (kind) => {
      const root = await createTestTempDirectory("rea-dylib-absolute-in-root-");
      const canonicalRoot = await realpath(root);
      const bridgePath = "Frameworks/libBridge.dylib";
      const leafPath = "Frameworks/libLeaf.dylib";
      const bridgeAbsolute = `${canonicalRoot}/${bridgePath}`;
      const leafName = "@loader_path/libLeaf.dylib";
      const executable = machoImage({
        commands: [
          buildVersionCommand(1),
          ...(kind === "rpath"
            ? [rpathCommand(`${canonicalRoot}/Frameworks`)]
            : []),
          dylibCommand(
            LC.LOAD_DYLIB,
            kind === "rpath" ? "@rpath/libBridge.dylib" : bridgeAbsolute,
          ),
        ],
      });
      const bridge = machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [
          buildVersionCommand(1),
          dylibCommand(LC.LOAD_DYLIB, leafName),
        ],
      });
      const leaf = machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [buildVersionCommand(1)],
      });
      await mkdir(join(root, "Frameworks"), { recursive: true });
      await writeFile(join(root, "App"), executable);
      await writeFile(bridgeAbsolute, bridge);
      await writeFile(join(root, leafPath), leaf);

      const trace = await traceDylibResolution({
        rootPath: root,
        targetPath: join(root, "App"),
        targetSha256: createHash("sha256").update(executable).digest("hex"),
        enumerateRoots: false,
        parameters: { roots: ["App"] },
      });

      expect(trace.edges[0]).toMatchObject({
        install_name:
          kind === "rpath" ? "@rpath/libBridge.dylib" : bridgeAbsolute,
        candidates: [
          {
            path: bridgeAbsolute,
            ...(kind === "rpath"
              ? { rpath: `${canonicalRoot}/Frameworks` }
              : {}),
            outcome: "resolved",
            resolved_path: bridgePath,
          },
        ],
        resolution: { status: "resolved", image: bridgePath },
      });
      expect(trace.edges).toContainEqual(
        expect.objectContaining({
          loader: bridgePath,
          install_name: leafName,
          resolution: { status: "resolved", image: leafPath },
        }),
      );
      expect(trace.images.map(({ path }) => path)).toEqual([
        "App",
        bridgePath,
        leafPath,
      ]);
    },
  );

  it("keeps a genuinely external absolute candidate outside the analyzed root", async () => {
    const root = await createTestTempDirectory("rea-dylib-absolute-outside-");
    const canonicalRoot = await realpath(root);
    const executable = machoImage({
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"),
        dylibCommand(LC.LOAD_DYLIB, `${canonicalRoot}/../outside.dylib`),
        dylibCommand(
          LC.LOAD_DYLIB,
          `file://${canonicalRoot}/Frameworks/libBridge.dylib`,
        ),
      ],
    });
    await writeFile(join(root, "App"), executable);
    const trace = await traceDylibResolution({
      rootPath: root,
      targetPath: join(root, "App"),
      targetSha256: createHash("sha256").update(executable).digest("hex"),
      enumerateRoots: false,
      parameters: { roots: ["App"] },
    });

    expect(trace.edges[0]).toMatchObject({
      candidates: [
        {
          path: "/usr/lib/libSystem.B.dylib",
          outcome: "outside-target",
          resolved_path: null,
        },
      ],
      resolution: { status: "undetermined", image: null },
    });
    expect(trace.edges[1]).toMatchObject({
      candidates: [{ outcome: "escapes-target", resolved_path: null }],
      resolution: { status: "undetermined", image: null },
    });
    expect(trace.edges[2]).toMatchObject({
      install_name: `file://${canonicalRoot}/Frameworks/libBridge.dylib`,
      candidates: [
        {
          path: `file://${canonicalRoot}/Frameworks/libBridge.dylib`,
          outcome: "undetermined",
          resolved_path: null,
        },
      ],
      resolution: { status: "undetermined", image: null },
    });
    expect(trace.images.map(({ path }) => path)).toEqual(["App"]);
  });
});

describe("absolute dyld candidate traversal", () => {
  it("maps an absolute candidate spelled through the selected root symlink", async () => {
    const root = await createTestTempDirectory(
      "rea-dylib-absolute-root-alias-",
    );
    const aliasRoot = join(root, "bundle-alias");
    const bridgePath = "Frameworks/libBridge.dylib";
    const bridgeAbsolute = `${aliasRoot}/${bridgePath}`;
    const executable = machoImage({
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.LOAD_DYLIB, bridgeAbsolute),
      ],
    });
    const bridge = machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [buildVersionCommand(1)],
    });
    await symlink(".", aliasRoot);
    await mkdir(join(root, "Frameworks"), { recursive: true });
    await writeFile(join(root, "App"), executable);
    await writeFile(join(root, bridgePath), bridge);

    const trace = await traceDylibResolution({
      rootPath: aliasRoot,
      targetPath: `${aliasRoot}/App`,
      targetSha256: createHash("sha256").update(executable).digest("hex"),
      enumerateRoots: false,
      parameters: { roots: ["App"] },
    });

    expect(trace.edges[0]).toMatchObject({
      install_name: bridgeAbsolute,
      candidates: [
        {
          path: bridgeAbsolute,
          outcome: "resolved",
          resolved_path: bridgePath,
        },
      ],
      resolution: { status: "resolved", image: bridgePath },
    });
  });

  it.skipIf(process.platform === "win32")(
    "preserves symlink-then-parent traversal for an absolute in-root path",
    async () => {
      const root = await createTestTempDirectory("rea-dylib-absolute-symlink-");
      const canonicalRoot = await realpath(root);
      const bridgePath = "Frameworks/Versions/libBridge.dylib";
      const decoyPath = "Frameworks/libBridge.dylib";
      const sourcePath = `${canonicalRoot}/Frameworks/Current/../libBridge.dylib`;
      const executable = machoImage({
        commands: [
          buildVersionCommand(1),
          dylibCommand(LC.LOAD_DYLIB, sourcePath),
        ],
      });
      const bridge = machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [
          buildVersionCommand(1),
          dylibCommand(LC.LOAD_DYLIB, "@loader_path/libLeaf.dylib"),
        ],
      });
      const leaf = machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [buildVersionCommand(1)],
      });
      await mkdir(join(root, "Frameworks/Versions/A"), { recursive: true });
      await symlink("Versions/A", join(root, "Frameworks/Current"));
      await writeFile(join(root, "App"), executable);
      await writeFile(join(root, bridgePath), bridge);
      await writeFile(join(root, decoyPath), new Uint8Array([0, 1, 2]));
      await writeFile(join(root, "Frameworks/Versions/libLeaf.dylib"), leaf);

      const trace = await traceDylibResolution({
        rootPath: root,
        targetPath: join(root, "App"),
        targetSha256: createHash("sha256").update(executable).digest("hex"),
        enumerateRoots: false,
        parameters: { roots: ["App"] },
      });

      expect(trace.edges[0]).toMatchObject({
        candidates: [
          {
            path: sourcePath,
            outcome: "resolved",
            resolved_path: bridgePath,
          },
        ],
        resolution: { status: "resolved", image: bridgePath },
      });
      expect(trace.edges).toContainEqual(
        expect.objectContaining({
          loader: bridgePath,
          resolution: {
            status: "resolved",
            image: "Frameworks/Versions/libLeaf.dylib",
          },
        }),
      );
    },
  );
});

it("selects matching arm64e subtype slices when tracing a mixed FAT image", async () => {
  const root = await createTestTempDirectory("rea-macho-arm64e-subtypes-");
  const executablePath = "Contents/MacOS/App";
  const dylibPath = "Contents/MacOS/libVariant.dylib";
  const installName = "@executable_path/libVariant.dylib";
  const arm64eDependency = "@executable_path/libArm64e.dylib";
  const arm64eX1Dependency = "@executable_path/libArm64eX1.dylib";
  const executableSlice = (cpu: typeof CPU.arm64e | typeof CPU.arm64eX1) =>
    machoImage({
      cpu,
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.LOAD_DYLIB, installName),
      ],
    });
  const executable = fatImage([
    {
      cpu: CPU.arm64eX1,
      bytes: executableSlice(CPU.arm64eX1),
    },
    {
      cpu: CPU.arm64e,
      bytes: executableSlice(CPU.arm64e),
    },
  ]);
  const variantSlice = (
    cpu: typeof CPU.arm64e | typeof CPU.arm64eX1,
    dependencyName: string,
  ) =>
    machoImage({
      cpu,
      fileType: FILE_TYPE.dylib,
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.ID_DYLIB, installName),
        dylibCommand(LC.LOAD_DYLIB, dependencyName),
      ],
    });
  const completeDylib = fatImage([
    {
      cpu: CPU.arm64e,
      bytes: variantSlice(CPU.arm64e, arm64eDependency),
    },
    {
      cpu: CPU.arm64eX1,
      bytes: variantSlice(CPU.arm64eX1, arm64eX1Dependency),
    },
  ]);
  await mkdir(join(root, "Contents/MacOS"), { recursive: true });
  await writeFile(join(root, executablePath), executable);
  await writeFile(join(root, dylibPath), completeDylib);

  const trace = () =>
    traceDylibResolution({
      rootPath: root,
      targetPath: join(root, executablePath),
      targetSha256: createHash("sha256").update(executable).digest("hex"),
      enumerateRoots: false,
      parameters: { roots: [executablePath] },
    });

  const complete = await trace();
  expect(
    complete.edges
      .filter(({ loader }) => loader === dylibPath)
      .map(({ install_name: dependencyName }) => dependencyName),
  ).toEqual([arm64eX1Dependency, arm64eDependency]);

  const onlyArm64e = fatImage([
    {
      cpu: CPU.arm64e,
      bytes: variantSlice(CPU.arm64e, arm64eDependency),
    },
  ]);
  await writeFile(join(root, dylibPath), onlyArm64e);
  const missingVariant = await trace();
  expect(
    missingVariant.edges
      .filter(
        ({ loader, install_name: dependencyName }) =>
          loader === executablePath && dependencyName === installName,
      )
      .map(({ candidates, resolution }) => [
        candidates[0]?.outcome,
        resolution.status,
      ]),
  ).toEqual([
    ["architecture-missing", "unresolved"],
    ["resolved", "resolved"],
  ]);
});

it.each([false, true])(
  "rejects overlapping FAT declarations before parsing payloads (hidden row: %s)",
  async (hidden) => {
    const bytes = Buffer.from(
      fatImage([
        { cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
        { cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
      ]),
    );
    bytes.writeUInt32BE(bytes.readUInt32BE(16), 36);
    bytes.writeUInt32BE(bytes.readUInt32BE(20), 40);
    if (hidden) bytes.writeUInt32BE(1, 4);
    const readAt = vi.fn(readerOf(bytes));
    expect(await readMachoImage(readAt, bytes.length)).toEqual({
      status: "malformed",
      reason: "Mach-O slices 0 and 1 overlap.",
    });
    // Header identity probes are allowed; load-command payloads are not.
    const firstOffset = bytes.readUInt32BE(16);
    expect(
      readAt.mock.calls.some(
        ([offset, length]) => offset === firstOffset && length > 4,
      ),
    ).toBe(false);
  },
);

it("keeps Apple's hidden ARM64 FAT row outside the raw declared slice list", async () => {
  const armv7 = { type: 12, subtype: 9 };
  const bytes = Buffer.from(
    fatImage([
      { cpu: armv7, bytes: machoImage({ cpu: armv7 }) },
      { cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
    ]),
  );
  bytes.writeUInt32BE(1, 4);
  const facts = await readMachoImage(readerOf(bytes), bytes.length);
  expect(facts).toMatchObject({
    status: "parsed",
    slices: [{ architecture: "arm" }],
    hiddenSlices: [{ architecture: "arm64", cpu_type: CPU.arm64.type }],
  });
});

describe("Mach-O load command reader: decodes thin-image load commands", () => {
  it("preserves leading U+FEFF in load-command strings", async () => {
    const image = machoImage({
      commands: [
        dylibCommand(LC.ID_DYLIB, "\uFEFF@rpath/libself.dylib"),
        dylibCommand(LC.LOAD_DYLIB, "\uFEFF@rpath/libother.dylib"),
        rpathCommand("\uFEFF@loader_path/Frameworks"),
        dyldEnvironmentCommand("\uFEFFDYLD_LIBRARY_PATH=/example"),
      ],
    });
    expect(await read(image)).toMatchObject({
      status: "parsed",
      slices: [
        {
          install_name: "\uFEFF@rpath/libself.dylib",
          dependencies: [{ install_name: "\uFEFF@rpath/libother.dylib" }],
          rpaths: ["\uFEFF@loader_path/Frameworks"],
          dyld_environment: ["\uFEFFDYLD_LIBRARY_PATH=/example"],
        },
      ],
    });
  });
  it("decodes dylib loading commands of a thin image", async () => {
    const image = machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [
        dylibCommand(LC.ID_DYLIB, "@rpath/Core.framework/Core"),
        dylibCommand(LC.LOAD_DYLIB, "/usr/lib/libSystem.B.dylib", {
          current: 0x050f0400,
          compatibility: 0x10000,
        }),
        dylibCommand(LC.LOAD_WEAK_DYLIB, "@rpath/libweak.dylib"),
        dylibCommand(LC.REEXPORT_DYLIB, "@loader_path/libre.dylib"),
        dylibCommand(LC.LOAD_UPWARD_DYLIB, "@rpath/libup.dylib"),
        dylibCommand(LC.LAZY_LOAD_DYLIB, "@rpath/liblazy.dylib"),
        rpathCommand("@loader_path/Frameworks"),
        rpathCommand("/usr/lib/swift"),
        dyldEnvironmentCommand("DYLD_FRAMEWORK_PATH=@executable_path"),
        codeSignatureCommand(),
      ],
    });
    const facts = await read(image);
    expect(facts.status).toBe("parsed");
    if (facts.status !== "parsed") return;
    expect(facts.slices).toHaveLength(1);
    const [slice] = facts.slices;
    expect(slice).toMatchObject({
      architecture: "arm64",
      file_type: "dylib",
      install_name: "@rpath/Core.framework/Core",
      rpaths: ["@loader_path/Frameworks", "/usr/lib/swift"],
      dyld_environment: ["DYLD_FRAMEWORK_PATH=@executable_path"],
      code_signature_present: true,
    });
    expect(
      slice?.dependencies.map(
        ({ command, install_name: name, weak, reexport, upward }) => [
          command,
          name,
          weak,
          reexport,
          upward,
        ],
      ),
    ).toEqual([
      ["LC_LOAD_DYLIB", "/usr/lib/libSystem.B.dylib", false, false, false],
      ["LC_LOAD_WEAK_DYLIB", "@rpath/libweak.dylib", true, false, false],
      ["LC_REEXPORT_DYLIB", "@loader_path/libre.dylib", false, true, false],
      ["LC_LOAD_UPWARD_DYLIB", "@rpath/libup.dylib", false, false, true],
      ["LC_LAZY_LOAD_DYLIB", "@rpath/liblazy.dylib", false, false, false],
    ]);
    expect(slice?.dependencies[0]).toMatchObject({
      encoding: "dylib_command",
      current_version: "1295.4.0",
      compatibility_version: "1.0.0",
    });
  });

  it("decodes dylib_use_command flags", async () => {
    const facts = await read(
      machoImage({
        commands: [
          dylibUseCommand(LC.LOAD_DYLIB, "@rpath/libdelay.dylib", 0x8),
          dylibUseCommand(LC.LOAD_DYLIB, "@rpath/libweakup.dylib", 0x1 | 0x4),
          dylibUseCommand(LC.LOAD_DYLIB, "@rpath/libre.dylib", 0x2),
        ],
      }),
    );
    if (facts.status !== "parsed") throw new Error(facts.status);
    expect(
      facts.slices[0]?.dependencies.map(
        ({ encoding, weak, upward, reexport, delayed_init: delayed }) => ({
          encoding,
          weak,
          upward,
          reexport,
          delayed,
        }),
      ),
    ).toEqual([
      {
        encoding: "dylib_use_command",
        weak: false,
        upward: false,
        reexport: false,
        delayed: true,
      },
      {
        encoding: "dylib_use_command",
        weak: true,
        upward: true,
        reexport: false,
        delayed: false,
      },
      {
        encoding: "dylib_use_command",
        weak: false,
        upward: false,
        reexport: true,
        delayed: false,
      },
    ]);
  });
});

describe("LC_LAZY_LOAD_DYLIB_INFO payload", () => {
  it("reads install names from the linkedit payload in load-command order", async () => {
    const payload = lazyLoadDylibInfoPayload({
      path: "@rpath/libl.dylib",
      symbols: ["_lf"],
    });
    expect(payload).toHaveLength(56);
    const image = machoImageWithLazyLoadDylibInfo({
      path: "@rpath/libl.dylib",
      symbols: ["_lf"],
      commandsBefore: [
        dylibCommand(LC.LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"),
      ],
      commandsAfter: [dylibCommand(LC.LOAD_DYLIB, "@rpath/libafter.dylib")],
    });
    const facts = await read(image);
    if (facts.status !== "parsed")
      throw new Error(
        facts.status === "not-mach-o" ? facts.status : facts.reason,
      );
    expect(
      facts.slices[0]?.dependencies.map(
        ({ command, install_name: name, encoding, weak, current_version }) => ({
          command,
          name,
          encoding,
          weak,
          current_version,
        }),
      ),
    ).toEqual([
      {
        command: "LC_LOAD_DYLIB",
        name: "/usr/lib/libSystem.B.dylib",
        encoding: "dylib_command",
        weak: false,
        current_version: "1.0.0",
      },
      {
        command: "LC_LAZY_LOAD_DYLIB_INFO",
        name: "@rpath/libl.dylib",
        encoding: "lazy_load_dylib_info",
        weak: false,
        current_version: null,
      },
      {
        command: "LC_LOAD_DYLIB",
        name: "@rpath/libafter.dylib",
        encoding: "dylib_command",
        weak: false,
        current_version: "1.0.0",
      },
    ]);
    const weak = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        flags: 0x1,
      }),
    );
    if (weak.status !== "parsed")
      throw new Error(weak.status === "not-mach-o" ? weak.status : weak.reason);
    expect(weak.slices[0]?.dependencies[0]).toMatchObject({ weak: true });
    const universal = await read(
      fatImage([
        {
          cpu: CPU.arm64,
          bytes: machoImageWithLazyLoadDylibInfo({
            path: "@rpath/libl.dylib",
            symbols: ["_lf"],
          }),
        },
      ]),
    );
    if (universal.status !== "parsed")
      throw new Error(
        universal.status === "not-mach-o" ? universal.status : universal.reason,
      );
    expect(universal.slices[0]?.dependencies[0]?.install_name).toBe(
      "@rpath/libl.dylib",
    );
  });

  it("rejects a lazy-info payload that is truncated, mis-pointed, or has unknown flags", async () => {
    const outside = machoImageWithLazyLoadDylibInfo({
      path: "@rpath/libl.dylib",
    });
    const view = new DataView(outside.buffer);
    const commandAt = 32;
    view.setUint32(commandAt + 8, outside.length, true);
    expect((await read(outside)).status).toBe("malformed");

    const badPayload = lazyLoadDylibInfoPayload({
      path: "@rpath/libl.dylib",
    });
    const badPath = machoImageWithLazyLoadDylibInfo({
      path: "@rpath/libl.dylib",
    });
    const payloadAt = badPath.length - badPayload.length;
    new DataView(badPath.buffer).setUint32(payloadAt, badPath.length, true);
    expect(await read(badPath)).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("load path"),
    });

    const unknownFlags = machoImageWithLazyLoadDylibInfo({
      path: "@rpath/libl.dylib",
      flags: 0x2,
    });
    expect(await read(unknownFlags)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("unrecognized bits"),
    });
  });
});

describe("LC_LAZY_LOAD_DYLIB_INFO image offsets", () => {
  it("rejects flag and chain-start offsets outside the slice VM range", async () => {
    const beyondPage = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        flagImageOffset: 0x4001,
      }),
    );
    expect(beyondPage).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("flag image offset 0x4001"),
    });
    const beyondChain = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        chainStartImageOffset: 0x4001,
      }),
    );
    expect(beyondChain).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("chain start image offset 0x4001"),
    });
    const onPage = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        flagImageOffset: 0x4000,
        chainStartImageOffset: 0x4000,
      }),
    );
    expect(onPage.status).toBe("parsed");
  });

  it("measures the VM range from __TEXT and ignores __LINKEDIT", async () => {
    const text = segmentCommand({
      name: "__TEXT",
      vmaddr: 0x100000000n,
      vmsize: 0x8000n,
    });
    const inside = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        flagImageOffset: 0x8000,
        commandsBefore: [text],
      }),
    );
    expect(inside.status).toBe("parsed");
    const outside = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        chainStartImageOffset: 0x8001,
        commandsBefore: [text],
      }),
    );
    expect(outside).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("slice VM range 0x8000"),
    });
    const linkedit = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        flagImageOffset: 0x4001,
        commandsBefore: [
          segmentCommand({
            name: "__LINKEDIT",
            vmaddr: 0n,
            vmsize: 0x100000n,
          }),
        ],
      }),
    );
    expect(linkedit.status).toBe("malformed");
  });

  it("does not alias a BOM-prefixed segment name to __LINKEDIT", async () => {
    const result = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        flagImageOffset: 0x4001,
        commandsBefore: [
          segmentCommand({
            name: "\uFEFF__LINKEDIT",
            vmaddr: 0n,
            vmsize: 0x100000n,
          }),
        ],
      }),
    );
    expect(result.status).toBe("parsed");
  });
  it("keeps a short segment parseable until a lazy-info command needs its VM range", async () => {
    const short = new Uint8Array(16);
    const view = new DataView(short.buffer);
    view.setUint32(0, 0x19, true);
    view.setUint32(4, short.length, true);
    expect((await read(machoImage({ commands: [short] }))).status).toBe(
      "parsed",
    );
    const withLazy = await read(
      machoImageWithLazyLoadDylibInfo({
        path: "@rpath/libl.dylib",
        commandsBefore: [short],
      }),
    );
    expect(withLazy).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("slice VM range"),
    });
  });
});

describe("LC_LAZY_LOAD_DYLIB_INFO payload budget", () => {
  it("reads one shared payload range once", async () => {
    const payload = lazyLoadDylibInfoPayload({
      path: "@rpath/libl.dylib",
      symbols: ["_lf"],
    });
    const dataOffset = 32 + 16 + 16 + 16;
    const image = machoImage({
      commands: [
        lazyLoadDylibInfoCommand(dataOffset, payload.length),
        lazyLoadDylibInfoCommand(dataOffset, payload.length),
      ],
    });
    const bytes = new Uint8Array(image.length + payload.length);
    bytes.set(image);
    bytes.set(payload, image.length);
    let payloadReads = 0;
    const facts = await readMachoImage(async (offset, length) => {
      if (offset === image.length && length === payload.length)
        payloadReads += 1;
      return bytes.subarray(offset, offset + length);
    }, bytes.length);
    expect(payloadReads).toBe(1);
    expect(facts).toMatchObject({
      status: "parsed",
      slices: [
        {
          dependencies: [
            { install_name: "@rpath/libl.dylib" },
            { install_name: "@rpath/libl.dylib" },
          ],
        },
      ],
    });
  });

  it("refuses distinct lazy-info payloads whose combined size exceeds the aggregate limit", async () => {
    const payload = lazyLoadDylibInfoPayload({ path: "@rpath/libl.dylib" });
    const dataOffset = 32 + 16 + 32;
    const image = machoImage({
      commands: [
        lazyLoadDylibInfoCommand(dataOffset, payload.length),
        lazyLoadDylibInfoCommand(0, MAX_LOAD_COMMAND_BYTES),
      ],
    });
    const bytes = new Uint8Array(MAX_LOAD_COMMAND_BYTES);
    bytes.set(image);
    bytes.set(payload, image.length);
    expect(await read(bytes)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("aggregate limit"),
    });
  });

  it("does not reread a payload range contained in an earlier read", async () => {
    const payload = lazyLoadDylibInfoPayload({
      path: "@rpath/libl.dylib",
      symbols: ["_lf"],
    });
    const image = machoImage({
      commands: [
        lazyLoadDylibInfoCommand(0, payload.length + 8),
        lazyLoadDylibInfoCommand(0, payload.length),
      ],
    });
    const bytes = new Uint8Array(image.length + payload.length + 8);
    bytes.set(image);
    bytes.set(payload, image.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(32 + 8, image.length, true);
    view.setUint32(48 + 8, image.length, true);
    let payloadReads = 0;
    const facts = await readMachoImage(async (offset, length) => {
      if (offset === image.length) payloadReads += 1;
      return bytes.subarray(offset, offset + length);
    }, bytes.length);
    expect(payloadReads).toBe(1);
    expect(facts).toMatchObject({
      status: "parsed",
      slices: [
        {
          dependencies: [
            { install_name: "@rpath/libl.dylib" },
            { install_name: "@rpath/libl.dylib" },
          ],
        },
      ],
    });
  });

  it("parses distinct non-nested lazy-info payloads under the dependency limit", async () => {
    const count = 8;
    const payloadSize = 26;
    const payload = new Uint8Array(payloadSize);
    new DataView(payload.buffer).setUint32(0, 24, true);
    new DataView(payload.buffer).setUint32(20, 24, true);
    const dataOffset = 32 + 16 + count * 16;
    const commands = Array.from({ length: count }, (_, index) =>
      lazyLoadDylibInfoCommand(dataOffset + index * payloadSize, payloadSize),
    );
    const image = machoImage({ commands });
    const bytes = new Uint8Array(image.length + count * payloadSize);
    bytes.set(image);
    for (let index = 0; index < count; index += 1)
      bytes.set(payload, image.length + index * payloadSize);
    const facts = await read(bytes);
    if (facts.status !== "parsed")
      throw new Error(
        facts.status === "not-mach-o" ? facts.status : facts.reason,
      );
    expect(facts.slices[0]?.dependencies).toHaveLength(count);
  });
});

describe("LC_LAZY_LOAD_DYLIB_INFO dependency limit", () => {
  it("retains one result per command until the dependency limit", async () => {
    const payload = lazyLoadDylibInfoPayload({ path: "@rpath/libl.dylib" });
    const imageFor = (count: number) => {
      const dataOffset = 32 + 16 + count * 16;
      const image = machoImage({
        commands: Array.from({ length: count }, () =>
          lazyLoadDylibInfoCommand(dataOffset, payload.length),
        ),
      });
      const bytes = new Uint8Array(image.length + payload.length);
      bytes.set(image);
      bytes.set(payload, image.length);
      return bytes;
    };
    const atLimit = await read(imageFor(MAX_LAZY_INFO_DEPENDENCIES));
    if (atLimit.status !== "parsed")
      throw new Error(
        atLimit.status === "not-mach-o" ? atLimit.status : atLimit.reason,
      );
    expect(atLimit.slices[0]?.dependencies).toHaveLength(
      MAX_LAZY_INFO_DEPENDENCIES,
    );
    expect(await read(imageFor(MAX_LAZY_INFO_DEPENDENCIES + 1))).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("dependency limit"),
    });
  });
});

describe("LC_LAZY_LOAD_DYLIB_INFO string bounds", () => {
  it("does not reuse a cached path that extends past a shorter payload", async () => {
    const payload = new Uint8Array(48);
    const view = new DataView(payload.buffer);
    const path = new TextEncoder().encode("@rpath/libl.dylib");
    view.setUint32(0, 24, true);
    view.setUint32(20, 24, true);
    payload.set(path, 24);
    const image = machoImage({
      commands: [
        lazyLoadDylibInfoCommand(0, payload.length),
        lazyLoadDylibInfoCommand(0, 24),
      ],
    });
    const bytes = new Uint8Array(image.length + payload.length);
    bytes.set(image);
    bytes.set(payload, image.length);
    const patched = new DataView(bytes.buffer);
    patched.setUint32(32 + 8, image.length, true);
    patched.setUint32(48 + 8, image.length, true);
    expect(await read(bytes)).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("outside the payload"),
    });
    const truncated = machoImage({
      commands: [
        lazyLoadDylibInfoCommand(0, payload.length),
        lazyLoadDylibInfoCommand(0, 40),
      ],
    });
    const truncatedBytes = new Uint8Array(truncated.length + payload.length);
    truncatedBytes.set(truncated);
    truncatedBytes.set(payload, truncated.length);
    const truncatedView = new DataView(truncatedBytes.buffer);
    truncatedView.setUint32(32 + 8, truncated.length, true);
    truncatedView.setUint32(48 + 8, truncated.length, true);
    expect(await read(truncatedBytes)).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("unterminated"),
    });
  });

  it("rejects a load path taken from the payload header", async () => {
    const payload = new Uint8Array(24);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 4, true);
    view.setUint32(20, 24, true);
    const image = machoImage({
      commands: [lazyLoadDylibInfoCommand(0, payload.length)],
    });
    const bytes = new Uint8Array(image.length + payload.length);
    bytes.set(image);
    bytes.set(payload, image.length);
    new DataView(bytes.buffer).setUint32(32 + 8, image.length, true);
    expect(await read(bytes)).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("inside the payload header"),
    });
    const symbolPayload = lazyLoadDylibInfoPayload({
      path: "@rpath/libl.dylib",
      symbols: ["_lf"],
    });
    new DataView(symbolPayload.buffer).setUint32(24, 4, true);
    const symbolImage = machoImage({
      commands: [lazyLoadDylibInfoCommand(0, symbolPayload.length)],
    });
    const symbolBytes = new Uint8Array(
      symbolImage.length + symbolPayload.length,
    );
    symbolBytes.set(symbolImage);
    symbolBytes.set(symbolPayload, symbolImage.length);
    new DataView(symbolBytes.buffer).setUint32(
      32 + 8,
      symbolImage.length,
      true,
    );
    expect(await read(symbolBytes)).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("symbol 0"),
    });
  });

  it("charges repeated and overlapping symbol scans against the string budget", async () => {
    const path = new TextEncoder().encode("@rpath/libl.dylib");
    const stringBytes = 64 * 1024;
    const imageFor = (symbolCount: number, step: number) => {
      const pathOffset = 24 + symbolCount * 4;
      const stringOffset = pathOffset + path.length + 1;
      const payload = new Uint8Array(stringOffset + stringBytes + 1);
      const view = new DataView(payload.buffer);
      view.setUint32(0, pathOffset, true);
      view.setUint32(16, symbolCount, true);
      view.setUint32(20, 24, true);
      payload.set(path, pathOffset);
      payload.fill(0x61, stringOffset, stringOffset + stringBytes);
      for (let symbol = 0; symbol < symbolCount; symbol += 1)
        view.setUint32(
          24 + symbol * 4,
          stringOffset + (step === 0 ? 0 : symbol % 8),
          true,
        );
      const image = machoImage({
        commands: [lazyLoadDylibInfoCommand(0, payload.length)],
      });
      const bytes = new Uint8Array(image.length + payload.length);
      bytes.set(image);
      bytes.set(payload, image.length);
      new DataView(bytes.buffer).setUint32(32 + 8, image.length, true);
      return bytes;
    };
    expect(imageFor(2, 0).length).toBeLessThan(MAX_LOAD_COMMAND_BYTES);
    expect(await read(imageFor(2, 0))).toMatchObject({
      status: "parsed",
      slices: [{ dependencies: [{ install_name: "@rpath/libl.dylib" }] }],
    });
    const over = Math.floor(MAX_LOAD_COMMAND_BYTES / (stringBytes + 1)) + 2;
    expect(await read(imageFor(over, 0))).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("string validation"),
    });
    expect(await read(imageFor(over, 1))).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("string validation"),
    });
  });
});

const lazyInfoPayloadWithSymbolCount = (
  symbolCount: number,
  pathText: string,
): Uint8Array => {
  const path = new TextEncoder().encode(pathText);
  const pathOffset = 24 + symbolCount * 4;
  // One byte after the path NUL, because a load-path terminator in the
  // payload's final byte is unterminated.
  const payload = new Uint8Array(pathOffset + path.length + 2);
  const view = new DataView(payload.buffer);
  view.setUint32(0, pathOffset, true);
  view.setUint32(16, symbolCount, true);
  view.setUint32(20, 24, true);
  payload.set(path, pathOffset);
  const emptySymbol = pathOffset + path.length;
  for (let symbol = 0; symbol < symbolCount; symbol += 1)
    view.setUint32(24 + symbol * 4, emptySymbol, true);
  return payload;
};

const imageWithLazyPayload = (payload: Uint8Array): Uint8Array => {
  const image = machoImage({
    commands: [lazyLoadDylibInfoCommand(0, payload.length)],
  });
  const bytes = new Uint8Array(image.length + payload.length);
  bytes.set(image);
  bytes.set(payload, image.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(32 + 8, image.length, true);
  view.setUint32(32 + 12, payload.length, true);
  return bytes;
};

describe("LC_LAZY_LOAD_DYLIB_INFO symbol cardinality", () => {
  it("stops before caching one string for every symbol offset", async () => {
    const atLimit = lazyInfoPayloadWithSymbolCount(
      MAX_LAZY_INFO_SYMBOL_REFERENCES,
      "@rpath/libl.dylib",
    );
    expect(await read(imageWithLazyPayload(atLimit))).toMatchObject({
      status: "parsed",
      slices: [{ dependencies: [{ install_name: "@rpath/libl.dylib" }] }],
    });
    const overLimit = lazyInfoPayloadWithSymbolCount(
      MAX_LAZY_INFO_SYMBOL_REFERENCES + 1,
      "@rpath/libl.dylib",
    );
    expect(await read(imageWithLazyPayload(overLimit))).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("65536-reference limit"),
    });
  });

  it("counts symbol references across distinct lazy-info payloads", async () => {
    const first = lazyInfoPayloadWithSymbolCount(
      MAX_LAZY_INFO_SYMBOL_REFERENCES,
      "@rpath/libl.dylib",
    );
    const second = lazyInfoPayloadWithSymbolCount(1, "@rpath/libm.dylib");
    const image = machoImage({
      commands: [
        lazyLoadDylibInfoCommand(0, first.length),
        lazyLoadDylibInfoCommand(0, second.length),
      ],
    });
    const bytes = new Uint8Array(image.length + first.length + second.length);
    bytes.set(image);
    bytes.set(first, image.length);
    bytes.set(second, image.length + first.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(32 + 8, image.length, true);
    view.setUint32(32 + 12, first.length, true);
    view.setUint32(48 + 8, image.length + first.length, true);
    view.setUint32(48 + 12, second.length, true);
    expect(await read(bytes)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("65536-reference limit"),
    });
  });
});

describe("LC_LAZY_LOAD_DYLIB_INFO path terminator", () => {
  it("rejects a load path whose NUL is the payload's final byte", async () => {
    const payload = new Uint8Array(27);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 24, true);
    view.setUint32(20, 24, true);
    payload[24] = 0x61;
    const imageFor = (size: number) => {
      const image = machoImage({
        commands: [lazyLoadDylibInfoCommand(0, size)],
      });
      const bytes = new Uint8Array(image.length + payload.length);
      bytes.set(image);
      bytes.set(payload, image.length);
      new DataView(bytes.buffer).setUint32(32 + 8, image.length, true);
      new DataView(bytes.buffer).setUint32(32 + 12, size, true);
      return bytes;
    };
    expect((await read(imageFor(payload.length))).status).toBe("parsed");
    expect(await read(imageFor(26))).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("unterminated"),
    });
  });
});

describe("LC_LAZY_LOAD_DYLIB_INFO resolution", () => {
  it("reports the lazy edge and does not treat an absent image as a launch failure", async () => {
    const root = await createTestTempDirectory("rea-lazy-info-");
    const executablePath = "lazy";
    const dylibPath = "lib/libl.dylib";
    const executable = machoImageWithLazyLoadDylibInfo({
      path: "@rpath/libl.dylib",
      symbols: ["_lf"],
      commandsBefore: [
        buildVersionCommand(1),
        rpathCommand("@executable_path/lib"),
        dylibCommand(LC.LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"),
      ],
    });
    const dylib = machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.ID_DYLIB, "@rpath/libl.dylib"),
        dylibCommand(LC.LOAD_DYLIB, "@rpath/libdeep.dylib"),
      ],
    });
    await mkdir(join(root, "lib"));
    await writeFile(join(root, executablePath), executable);
    await writeFile(join(root, dylibPath), dylib);
    const trace = () =>
      traceDylibResolution({
        rootPath: root,
        targetPath: join(root, executablePath),
        targetSha256: createHash("sha256").update(executable).digest("hex"),
        enumerateRoots: false,
        parameters: { roots: [executablePath] },
      });
    const present = await trace();
    expect(present.coverage.status).toBe("complete");
    expect(present.edges.map(({ install_name: name }) => name)).toEqual([
      "/usr/lib/libSystem.B.dylib",
      "@rpath/libl.dylib",
    ]);
    expect(present.edges[1]).toMatchObject({
      command: "LC_LAZY_LOAD_DYLIB_INFO",
      encoding: "lazy_load_dylib_info",
      current_version: null,
      compatibility_version: null,
      resolution: { status: "resolved", image: dylibPath },
    });
    expect(present.findings).toEqual([]);
    await rename(join(root, dylibPath), `${join(root, dylibPath)}.moved`);
    const absent = await trace();
    expect(absent.coverage.status).toBe("complete");
    expect(absent.findings.map(({ kind }) => kind)).toEqual([
      "lazy-load-unresolved",
    ]);
    expect(absent.edges[1]?.resolution.status).toBe("unresolved");
  });
});

describe("Mach-O load command reader: reads and validates universal binary slices", () => {
  it("reads every slice of FAT and FAT_64 containers in either byte order", async () => {
    for (const [wide, littleEndian] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const facts = await read(
        fatImage(
          [
            {
              cpu: CPU.arm64e,
              bytes: machoImage({
                cpu: CPU.arm64e,
                commands: [rpathCommand("@executable_path/a")],
              }),
            },
            {
              cpu: CPU.x86_64,
              bytes: machoImage({
                cpu: CPU.x86_64,
                commands: [rpathCommand("@executable_path/b")],
              }),
            },
          ],
          wide,
          littleEndian,
        ),
      );
      if (facts.status !== "parsed") throw new Error(facts.status);
      expect(
        facts.slices.map(({ architecture, rpaths }) => [architecture, rpaths]),
      ).toEqual([
        ["arm64e", ["@executable_path/a"]],
        ["x86_64", ["@executable_path/b"]],
      ]);
    }
  });

  it.each([
    [1, "arm64v8"],
    [2, "arm64e"],
    [12, "arm64e.x1"],
    [0x8000000c, "arm64e.x1"],
    [0x81000002, "arm64e"],
  ] as const)(
    "names ARM64 subtype %i as %s without losing source bits",
    async (subtype, architecture) => {
      const facts = await read(
        machoImage({ cpu: { type: CPU.arm64.type, subtype } }),
      );
      expect(facts).toMatchObject({
        status: "parsed",
        slices: [
          expect.objectContaining({ architecture, cpu_subtype: subtype }),
        ],
      });
    },
  );

  it("retains physical slice identity and declared build platform", async () => {
    const thin = machoImage({ commands: [buildVersionCommand(7)] });
    const parsedThin = await read(thin);
    expect(
      parsedThin.status === "parsed" && parsedThin.slices[0],
    ).toMatchObject({
      slice_offset: 0,
      slice_size: thin.length,
      cpu_type: CPU.arm64.type,
      cpu_subtype: CPU.arm64.subtype,
      fat_cpu_type: null,
      fat_cpu_subtype: null,
      platform: 7,
    });
    const fat = fatImage([{ cpu: CPU.arm64, bytes: thin }]);
    const parsedFat = await read(fat);
    expect(parsedFat.status === "parsed" && parsedFat.slices[0]).toMatchObject({
      slice_offset: 4096,
      slice_size: thin.length,
      fat_cpu_type: CPU.arm64.type,
      fat_cpu_subtype: CPU.arm64.subtype,
    });
  });

  it("rejects FAT table/header identity mismatches and unaligned ranges", async () => {
    const original = fatImage([{ cpu: CPU.arm64, bytes: machoImage({}) }]);
    for (const [fieldOffset, value] of [
      [8, CPU.x86_64.type],
      [12, 99],
    ] as const) {
      const mismatch = original.slice();
      new DataView(mismatch.buffer).setUint32(fieldOffset, value, false);
      expect(await read(mismatch)).toMatchObject({
        status: "malformed",
        reason: expect.stringContaining("disagrees"),
      });
    }
    const unaligned = original.slice();
    new DataView(unaligned.buffer).setUint32(16, 4097, false);
    expect(await read(unaligned)).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("not aligned"),
    });
  });

  it("preserves unknown CPU table facts when the embedded slice is Mach-O", async () => {
    const cpu = { type: 0x7fffffff, subtype: 11 };
    const facts = await read(fatImage([{ cpu, bytes: machoImage({ cpu }) }]));
    expect(facts.status === "parsed" && facts.slices[0]).toMatchObject({
      architecture: "cpu-7fffffff",
      cpu_type: cpu.type,
      cpu_subtype: cpu.subtype,
      fat_cpu_type: cpu.type,
      fat_cpu_subtype: cpu.subtype,
    });
  });
});

describe("Mach-O load command reader inputs", () => {
  it("names 32-bit and non-Mach-O inputs without guessing", async () => {
    const i386 = await read(
      machoImage({ cpu: { type: 7, subtype: 3 }, wide: false }),
    );
    expect(i386.status === "parsed" && i386.slices[0]?.architecture).toBe(
      "i386",
    );
    // A Java class file shares the FAT magic; version fields are not a slice count.
    const javaClasses = [
      javaClassFile(),
      javaClassFile(4000),
      javaClassFile(4000, true),
    ];
    for (const javaClass of javaClasses) {
      expect(hasMachoMagic(javaClass)).toBe(true);
      expect(await read(javaClass)).toEqual({ status: "not-mach-o" });
    }
    const malformedFat = Buffer.alloc(28);
    malformedFat.writeUInt32BE(0xcafebabe, 0);
    malformedFat.writeUInt32BE(1, 4);
    malformedFat.writeUInt32BE(0x0100000c, 8);
    malformedFat.writeUInt32BE(4096, 16);
    malformedFat.writeUInt32BE(32, 20);
    malformedFat.writeUInt32BE(12, 24);
    expect(await read(malformedFat)).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("slice range extends beyond the file"),
    });
    expect(await read(new TextEncoder().encode("#!/bin/sh\n"))).toEqual({
      status: "not-mach-o",
    });
    expect(await read(Uint8Array.from([0xcf, 0xfa]))).toEqual({
      status: "not-mach-o",
    });
    // A recognized magic without room for a header is a truncated image.
    expect(
      await read(Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00])),
    ).toEqual({ status: "malformed", reason: "Mach-O header is truncated" });
  });

  it("keeps oversized CAFEBABE identity unknown when class payload is sparse", async () => {
    const classPrefix = Buffer.from(javaClassFile(4000, true));
    const payloadBytes = MAX_LOAD_COMMAND_BYTES + 1;
    const attributeHeader = Buffer.alloc(6);
    attributeHeader.writeUInt16BE(5, 0);
    attributeHeader.writeUInt32BE(payloadBytes, 2);
    classPrefix.writeUInt16BE(1, classPrefix.length - 2);
    const prefix = Buffer.concat([classPrefix, attributeHeader]);
    const size = prefix.length + payloadBytes;
    const sparseReadAt = async (offset: number, length: number) => {
      const result = Buffer.alloc(Math.min(length, size - offset));
      if (offset < prefix.length)
        prefix.copy(
          result,
          0,
          offset,
          Math.min(prefix.length, offset + length),
        );
      return result;
    };

    expect(await readMachoImage(sparseReadAt, size)).toEqual({
      status: "unsupported",
      reason: expect.stringContaining(
        "class identity scan exceeds the 16 MiB limit",
      ),
    });
  });
});

describe("Mach-O load command reader failures", () => {
  const withCommandSize = (size: number): Uint8Array => {
    const image = machoImage({ commands: [rpathCommand("@loader_path")] });
    new DataView(image.buffer).setUint32(32 + 4, size, true);
    return image;
  };

  it("reports malformed command tables with the failing command", async () => {
    expect(await read(withCommandSize(0))).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("load command 0"),
    });
    expect(await read(withCommandSize(4096))).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("invalid cmdsize"),
    });
    const extraCommand = machoImage({ commands: [rpathCommand("x")] });
    new DataView(extraCommand.buffer).setUint32(16, 2, true);
    expect(await read(extraCommand)).toMatchObject({
      status: "malformed",
      reason: "load command 1 starts beyond sizeofcmds",
    });
  });

  it("requires 8-byte command alignment in 64-bit images", async () => {
    // A command the reader does not decode; only its size is checked.
    const command = new Uint8Array(12);
    const view = new DataView(command.buffer);
    view.setUint32(0, 0x7f000001, true);
    view.setUint32(4, 12, true);
    expect(await read(machoImage({ commands: [command] }))).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("invalid cmdsize 12"),
    });
    expect(
      await read(
        machoImage({
          cpu: { type: 7, subtype: 3 },
          wide: false,
          commands: [command],
        }),
      ),
    ).toMatchObject({ status: "parsed" });
  });

  it("accepts FAT tables up to 128 records that name a Mach-O CPU", async () => {
    const slices = Array.from({ length: 24 }, () => ({
      cpu: CPU.arm64,
      bytes: machoImage({}),
    }));
    const facts = await read(fatImage(slices));
    expect(facts.status === "parsed" && facts.slices).toHaveLength(24);
    // An empty table is not a Java class file, whose major version is nonzero.
    for (const magic of [
      [0xca, 0xfe, 0xba, 0xbe],
      [0xbf, 0xba, 0xfe, 0xca],
    ])
      expect(await read(Uint8Array.from([...magic, 0, 0, 0, 0]))).toEqual({
        status: "malformed",
        reason: "FAT header declares no architectures",
      });
  });

  it("rejects string commands too short to hold their string offset", async () => {
    const short = new Uint8Array(8);
    const view = new DataView(short.buffer);
    view.setUint32(0, LC.RPATH, true);
    view.setUint32(4, 8, true);
    expect(await read(machoImage({ commands: [short] }))).toMatchObject({
      status: "malformed",
      reason: "load command 0 is too short to hold a string offset",
    });
    view.setUint32(0, LC.CODE_SIGNATURE, true);
    expect(await read(machoImage({ commands: [short] }))).toMatchObject({
      status: "malformed",
      reason: "load command 0 is too short for LC_CODE_SIGNATURE",
    });
  });

  it("rejects strings that are unterminated, misplaced or not UTF-8", async () => {
    const unterminated = rpathCommand("abcd");
    unterminated.fill(0x41, 12);
    expect(await read(machoImage({ commands: [unterminated] }))).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("unterminated"),
    });
    const misplaced = rpathCommand("abcd");
    new DataView(misplaced.buffer).setUint32(8, 4, true);
    expect(await read(machoImage({ commands: [misplaced] }))).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("string offset 4"),
    });
    const invalid = rpathCommand("ab");
    invalid[12] = 0xff;
    expect(await read(machoImage({ commands: [invalid] }))).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("not UTF-8"),
    });
  });

  it("refuses truncated, oversized, big-endian and out-of-range images", async () => {
    const image = machoImage({ commands: [rpathCommand("@loader_path")] });
    expect(await read(image.subarray(0, 20))).toMatchObject({
      status: "malformed",
      reason: "Mach-O header is truncated",
    });
    const oversized = machoImage({});
    new DataView(oversized.buffer).setUint32(
      20,
      MAX_LOAD_COMMAND_BYTES + 8,
      true,
    );
    expect(await read(oversized)).toMatchObject({ status: "unsupported" });
    const beyond = machoImage({ commands: [rpathCommand("x")] });
    new DataView(beyond.buffer).setUint32(20, beyond.length, true);
    expect(await read(beyond)).toMatchObject({
      status: "malformed",
      reason: "load commands extend beyond the Mach-O slice",
    });
    const bigEndian = Uint8Array.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0]);
    expect(await read(bigEndian)).toMatchObject({ status: "unsupported" });
    const fat = fatImage([{ cpu: CPU.arm64, bytes: machoImage({}) }]);
    expect(await read(fat.subarray(0, 4100))).toMatchObject({
      status: "malformed",
      reason: "FAT architecture 0 slice range extends beyond the file",
    });
  });

  it("preserves unsupported status for an unsupported FAT alignment exponent", async () => {
    const fat = fatImage([{ cpu: CPU.arm64, bytes: machoImage({}) }]);
    new DataView(fat.buffer).setUint32(24, 53, false);

    expect(await read(fat)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("alignment exponent 53 is unsupported"),
    });
  });
});

describe("Mach-O load command reader defect precedence", () => {
  it("keeps defect precedence when one image has several defects", async () => {
    const shortRpath = new Uint8Array(8);
    const shortView = new DataView(shortRpath.buffer);
    shortView.setUint32(0, LC.RPATH, true);
    shortView.setUint32(4, 8, true);
    const unsized = new Uint8Array(16);
    new DataView(unsized.buffer).setUint32(0, LC.RPATH, true);
    const decodeFirst = {
      status: "malformed",
      reason: "load command 0 is too short to hold a string offset",
    };
    // An earlier command's decode defect wins over a later framing defect,
    expect(await read(machoImage({ commands: [shortRpath, unsized] }))).toEqual(
      decodeFirst,
    );
    // over a missing later command,
    const missing = machoImage({ commands: [shortRpath] });
    new DataView(missing.buffer).setUint32(16, 2, true);
    expect(await read(missing)).toEqual(decodeFirst);
    // and over unconsumed command bytes.
    const unconsumed = machoImage({
      commands: [shortRpath, rpathCommand("x")],
    });
    new DataView(unconsumed.buffer).setUint32(16, 1, true);
    expect(await read(unconsumed)).toEqual(decodeFirst);

    // The command-size limit is checked before the slice bounds.
    const oversized = machoImage({});
    new DataView(oversized.buffer).setUint32(
      20,
      MAX_LOAD_COMMAND_BYTES + 8,
      true,
    );
    expect(await read(oversized)).toMatchObject({ status: "unsupported" });

    // A malformed FAT slice wins over an earlier or later unsupported one.
    const bigEndian = new Uint8Array(32);
    new DataView(bigEndian.buffer).setUint32(0, 0xfeedfacf, false);
    const overlong = machoImage({});
    new DataView(overlong.buffer).setUint32(20, overlong.byteLength, true);
    for (const slices of [
      [bigEndian, overlong],
      [overlong, bigEndian],
    ]) {
      const fat = fatImage(slices.map((bytes) => ({ cpu: CPU.arm64, bytes })));
      expect(await read(fat)).toEqual({
        status: "malformed",
        reason: "load commands extend beyond the Mach-O slice",
      });
    }

    // The first FAT range issue is reported, whatever its category.
    const ranged = fatImage([
      { cpu: CPU.arm64, bytes: machoImage({}) },
      { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
    ]);
    new DataView(ranged.buffer).setUint32(8 + 16, 53, false);
    new DataView(ranged.buffer).setUint32(8 + 20 + 12, ranged.length, false);
    expect(await read(ranged)).toEqual({
      status: "unsupported",
      reason: "FAT architecture 0 alignment exponent 53 is unsupported",
    });
  });
});

it.each([true, false])(
  "rejects unconsumed command bytes in wide=%s headers",
  async (wide) => {
    const bytes = machoImage({ wide, commands: [rpathCommand("ignored")] });
    new DataView(bytes.buffer).setUint32(16, 0, true);
    expect(await read(bytes)).toMatchObject({
      status: "malformed",
      reason: expect.stringContaining("sizeofcmds"),
    });
  },
);

it("observes only the common 28-byte header of a 64-bit slice", async () => {
  const bytes = machoImage({ fileType: FILE_TYPE.dylib }).subarray(0, 28);
  const readAt = vi.fn(readerOf(bytes));
  expect(await readMachoImage(readAt, 32)).toMatchObject({
    status: "parsed",
    slices: [{ file_type: "dylib", file_type_code: FILE_TYPE.dylib }],
  });
  expect(readAt.mock.calls).toEqual([
    [0, 8],
    [0, 28],
    [32, 0],
  ]);
  expect(await readMachoImage(readerOf(bytes), 28)).toEqual({
    status: "malformed",
    reason: "load commands extend beyond the Mach-O slice",
  });
});
