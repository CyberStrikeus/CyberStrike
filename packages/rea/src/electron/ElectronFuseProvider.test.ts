import { resolveElectronFuseTarget } from "./ElectronFusePath.js";
import { RegularFileChangedError } from "../filesystem/RegularFile.js";
import {
  mkdir,
  symlink,
  writeFile,
  truncate,
  rename,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  elfFuseImage,
  fuseWire,
  FUSE_SENTINEL,
  OBSIDIAN_FUSE_BYTES,
  peFuseImage,
  sentinelFreeMacho,
  thinFuseImage,
  thinMacho,
  truncatedFuseImage,
  twoSentinelElf,
  universalFuseImage,
} from "../../tests/fixtures/electron/fuseImage.js";
import { ELECTRON_FUSE_STATE_BYTES } from "../domain/electron/electronFuses.js";
import { ElectronFuseProvider } from "./ElectronFuseProvider.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { readElectronFuseImage } from "./ElectronFuseReader.js";

const provider = new ElectronFuseProvider();

const symlinkDirectory = (target: string, path: string): Promise<void> =>
  symlink(target, path, process.platform === "win32" ? "dir" : undefined);

const inspect = async (path: string) => {
  const result = await provider.inspect({ path });
  if (!result.ok) throw result.error;
  return result.value;
};

it.skipIf(process.platform === "win32")(
  "rejects undecodable symlink targets rather than selecting a replacement sibling",
  async () => {
    const root = await createTestTempDirectory("rea-electron-link-encoding-");
    const framework = join(root, "Electron Framework.framework");
    await mkdir(framework);
    await writeFile(join(framework, "\uFFFD"), thinFuseImage([0x31]).bytes);
    const alias = join(framework, "alias");
    await symlink(Buffer.from([0xff]), alias);
    await expect(stat(alias)).rejects.toMatchObject({ code: "ENOENT" });
    const result = await provider.inspect({ path: alias });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        issues: [
          {
            reason: "invalid_value",
            message: expect.stringContaining("not valid UTF-8"),
          },
        ],
      });
    const validName = "\uFEFFbinary";
    await writeFile(join(framework, validName), thinFuseImage([0x31]).bytes);
    const validAlias = join(framework, "valid-alias");
    await symlink(validName, validAlias);
    expect(
      (await inspect(validAlias)).slices[0]?.sentinels[0]?.fuses[0]?.state,
    ).toBe("enabled");
  },
);

it.skipIf(process.platform === "win32")(
  "rejects framework links whose terminal separator requires a directory",
  async () => {
    const root = await createTestTempDirectory("rea-electron-link-directory-");
    const framework = join(root, "Electron Framework.framework");
    await mkdir(join(framework, "Versions", "A"), { recursive: true });
    await writeFile(
      join(framework, "Versions", "A", "Electron Framework"),
      thinFuseImage([0x31]).bytes,
    );
    for (const suffix of ["/", "/."]) {
      const alias = join(framework, `alias${suffix.length}`);
      await symlink(`Versions/A/Electron Framework${suffix}`, alias);
      await expect(stat(alias)).rejects.toMatchObject({ code: "ENOTDIR" });
      const result = await provider.inspect({ path: alias });
      expect(result.ok).toBe(false);
    }
    await symlink("A/", join(framework, "Versions", "Current"));
    const validAlias = join(framework, "Electron Framework");
    await symlink("Versions/Current/Electron Framework", validAlias);
    const report = await inspect(validAlias);
    expect(report.slices[0]?.sentinels[0]?.fuses[0]?.state).toBe("enabled");
  },
);

it("preserves the hidden ARM64 marker through fuse scanning and reporting", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-fuses-hidden-arm64-",
  );
  const universal = universalFuseImage();
  // Model Apple's ARM32/hidden-ARM64 layout: keep both physical FAT rows,
  // but declare only the visible ARM32 row in nfat_arch.
  universal.bytes.writeUInt32BE(1, 4);
  universal.bytes.writeUInt32BE(12, 8);
  universal.bytes.writeUInt32BE(9, 12);
  universal.bytes.writeUInt32LE(0xfeedface, universal.left.fileOffset);
  universal.bytes.writeUInt32LE(12, universal.left.fileOffset + 4);
  universal.bytes.writeUInt32LE(9, universal.left.fileOffset + 8);
  const path = join(root, "hidden-arm64");
  await writeFile(path, universal.bytes);

  const report = await inspect(path);
  expect(report.slices).toHaveLength(2);
  expect(report.slices[0]).not.toHaveProperty("hidden");
  expect(report.slices[1]).toMatchObject({
    architecture: "arm64",
    hidden: true,
    file_offset: universal.right.fileOffset,
    sentinel_count: 1,
    sentinels: [
      { sentinel_offset: universal.right.sentinelOffset, complete: true },
    ],
  });
});

describe("Electron fuse wire reading", () => {
  it("reads thin Mach-O, universal Mach-O, PE, and ELF wires", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-");
    const thin = thinFuseImage(OBSIDIAN_FUSE_BYTES);
    const universal = universalFuseImage();
    const pe = peFuseImage(OBSIDIAN_FUSE_BYTES);
    const elf = elfFuseImage([
      ELECTRON_FUSE_STATE_BYTES.enabled,
      ELECTRON_FUSE_STATE_BYTES.removed,
      0x99,
    ]);
    await writeFile(join(root, "thin"), thin.bytes);
    await writeFile(join(root, "universal"), universal.bytes);
    await writeFile(join(root, "app.exe"), pe.bytes);
    await writeFile(join(root, "app.elf"), elf.bytes);

    const thinReport = await inspect(join(root, "thin"));
    expect(thinReport.slices[0]).not.toHaveProperty("hidden");
    expect(thinReport.artifact).toMatchObject({
      format: "mach-o",
      bytes: thin.bytes.length,
    });
    expect(thinReport.slices).toMatchObject([
      {
        architecture: "arm64",
        sentinel_count: 1,
        sentinels: [
          {
            sentinel_offset: thin.sentinelOffset,
            wire_version: 1,
            declared_length: 8,
            complete: true,
          },
        ],
      },
    ]);
    expect(
      thinReport.slices[0]?.sentinels[0]?.fuses.map((fuse) => fuse.state),
    ).toEqual([
      "disabled",
      "enabled",
      "disabled",
      "disabled",
      "disabled",
      "disabled",
      "disabled",
      "enabled",
    ]);

    const universalReport = await inspect(join(root, "universal"));
    for (const slice of universalReport.slices)
      expect(slice).not.toHaveProperty("hidden");
    expect(universalReport.artifact.format).toBe("mach-o-universal");
    expect(universalReport.slices).toMatchObject([
      {
        file_offset: universal.left.fileOffset,
        architecture: "x86_64",
        sentinels: [{ sentinel_offset: universal.left.sentinelOffset }],
      },
      {
        file_offset: universal.right.fileOffset,
        architecture: "arm64",
        sentinels: [{ sentinel_offset: universal.right.sentinelOffset }],
      },
    ]);
    expect(
      universalReport.runtime_implications.filter(
        (item) => item.subject === "node_cli_inspect_arguments",
      ),
    ).toEqual([
      expect.objectContaining({
        slice_index: 0,
        outcome: "not_honored",
        sentinel_offset: universal.left.sentinelOffset,
      }),
      expect.objectContaining({
        slice_index: 1,
        outcome: "honored",
        sentinel_offset: universal.right.sentinelOffset,
      }),
    ]);

    const peReport = await inspect(join(root, "app.exe"));
    expect(peReport.artifact.format).toBe("pe");
    expect(peReport.slices[0]?.sentinels[0]?.sentinel_offset).toBe(
      pe.sentinelOffset,
    );
    const elfReport = await inspect(join(root, "app.elf"));
    expect(elfReport.slices[0]?.sentinels[0]?.fuses).toMatchObject([
      { name: "RunAsNode", state: "enabled", raw_byte: 0x31 },
      { name: "EnableCookieEncryption", state: "removed", raw_byte: 0x72 },
      {
        name: "EnableNodeOptionsEnvironmentVariable",
        state: "unknown",
        raw_byte: 0x99,
      },
    ]);
    expect(elfReport.runtime_implications).toEqual([
      expect.objectContaining({
        subject: "electron_run_as_node",
        outcome: "honored",
      }),
    ]);
  });

  it("keeps a truncated wire, duplicate sentinels, and a missing sentinel", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-partial-");
    await writeFile(join(root, "truncated"), truncatedFuseImage());
    const duplicated = twoSentinelElf();
    await writeFile(join(root, "duplicated"), duplicated.bytes);
    await writeFile(join(root, "empty"), sentinelFreeMacho());

    const truncated = await inspect(join(root, "truncated"));
    expect(truncated.slices[0]?.sentinels[0]).toMatchObject({
      wire_version: 1,
      declared_length: 4,
      complete: false,
      fuses: [{ index: 0, state: "enabled", raw_byte: 0x31 }],
    });
    expect(truncated.limitations.join(" ")).toContain("truncated");

    const duplicates = await inspect(join(root, "duplicated"));
    expect(duplicates.slices[0]?.sentinel_count).toBe(2);
    expect(
      duplicates.slices[0]?.sentinels.map((item) => item.sentinel_offset),
    ).toEqual([...duplicated.offsets]);
    expect(duplicates.limitations.join(" ")).toContain("none is selected");

    const missing = await inspect(join(root, "empty"));
    expect(missing.slices[0]?.sentinel_count).toBe(0);
    expect(missing.runtime_implications).toEqual([]);
    expect(missing.limitations.join(" ")).toContain("unknown, not disabled");
  });
});

describe("ELF embedded ASAR integrity applicability", () => {
  it("preserves an enabled ASAR integrity fuse without claiming enforcement on ELF", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-elf-asar-");
    const fuses = [
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.enabled,
    ];
    const image = elfFuseImage(fuses);
    const path = join(root, "electron");
    await writeFile(path, image.bytes);
    const report = await inspect(path);
    expect(report.artifact.format).toBe("elf");
    expect(report.slices[0]?.sentinels[0]?.fuses[4]).toMatchObject({
      index: 4,
      name: "EnableEmbeddedAsarIntegrityValidation",
      state: "enabled",
      raw_byte: ELECTRON_FUSE_STATE_BYTES.enabled,
    });
    expect(
      report.runtime_implications.find(
        (item) => item.subject === "embedded_asar_integrity_validation",
      ),
    ).toMatchObject({
      relationship: "derivation",
      fuse_index: 4,
      outcome: "unknown",
      sentinel_offset: image.sentinelOffset,
    });
    expect(report.limitations.join(" ")).toContain("only on macOS and Windows");
  });
});

describe("Electron fuse reader resource boundaries", () => {
  it("rejects invalid scan window sizes before allocating or scanning", async () => {
    const root = await createTestTempDirectory(
      "rea-electron-fuses-window-limit-",
    );
    const path = join(root, "window");
    await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
    for (const chunkBytes of [0, -1, 1.5, 256 * 1024 + 1])
      await expect(readElectronFuseImage(path, { chunkBytes })).rejects.toThrow(
        /chunkBytes must be an integer between/,
      );
  });

  it("rejects overlapping universal Mach-O slices before repeated searching", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-overlap-");
    const image = universalFuseImage().bytes;
    const firstOffset = image.readUInt32BE(16);
    const firstSize = image.readUInt32BE(20);
    image.writeUInt32BE(0x01000007, 28);
    image.writeUInt32BE(firstOffset, 36);
    image.writeUInt32BE(firstSize, 40);
    const path = join(root, "overlapping");
    await writeFile(path, image);

    const result = await provider.inspect({ path });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        issues: [
          expect.objectContaining({
            path: ["path"],
            reason: "invalid_format",
            message: expect.stringContaining("slices 0 and 1 overlap"),
          }),
        ],
      });
  });
});

describe("Electron fuse path and container admission", () => {
  it("finds a sentinel that crosses a read window", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-window-");
    const image = thinFuseImage(OBSIDIAN_FUSE_BYTES);
    const path = join(root, "window");
    await writeFile(path, image.bytes);
    const read = await readElectronFuseImage(path, { chunkBytes: 20 });
    expect(read.slices[0]?.sentinels[0]?.sentinel_offset).toBe(
      image.sentinelOffset,
    );
    expect(read.slices[0]?.sentinels[0]?.fuses).toHaveLength(8);
  });

  it("resolves an app bundle and a framework symlink inside the bundle", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-app-");
    const image = thinFuseImage(OBSIDIAN_FUSE_BYTES);
    const app = join(root, "Fixture.app");
    const versions = join(
      app,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
    );
    await mkdir(join(versions, "A"), { recursive: true });
    const binary = join(versions, "A", "Electron Framework");
    await writeFile(binary, image.bytes);
    await symlinkDirectory("A", join(versions, "Current"));
    await symlink(
      "Versions/Current/Electron Framework",
      join(versions, "..", "Electron Framework"),
    );

    const fromApp = await inspect(app);
    expect(fromApp.artifact.selected_path).toBe(app);
    expect(fromApp.artifact.resolved_path).toBe(binary);
    expect(fromApp.slices[0]?.sentinel_count).toBe(1);

    const link = join(versions, "..", "Electron Framework");
    const fromLink = await inspect(link);
    expect(fromLink.artifact.resolved_path).toBe(binary);
    expect(fromLink.artifact.sha256).toBe(fromApp.artifact.sha256);
  });

  it("rejects an app bundle whose Versions/Current symlink leaves the framework", async () => {
    const root = await createTestTempDirectory(
      "rea-electron-fuses-framework-root-",
    );
    const app = join(root, "Fixture.app");
    const framework = join(
      app,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
    );
    await mkdir(join(framework, "Versions"), { recursive: true });
    await mkdir(join(app, "Contents", "Other"), { recursive: true });
    await writeFile(
      join(app, "Contents", "Other", "Electron Framework"),
      elfFuseImage([ELECTRON_FUSE_STATE_BYTES.enabled]).bytes,
    );
    await symlink("../../../Other", join(framework, "Versions", "Current"));

    for (const path of [app, framework]) {
      const result = await provider.inspect({ path });
      expect(result.ok, path).toBe(false);
      if (result.ok) continue;
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        issues: [
          expect.objectContaining({
            path: ["path"],
            message: expect.stringContaining("escapes"),
          }),
        ],
      });
    }
  });

  it("refuses a framework symlink that leaves the bundle", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-escape-");
    const versions = join(
      root,
      "Fixture.app",
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
    );
    await mkdir(versions, { recursive: true });
    await symlink("/etc", join(versions, "Current"));
    const result = await provider.inspect({
      path: join(root, "Fixture.app"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        expect.objectContaining({
          path: ["path"],
          message: expect.stringContaining("escapes"),
        }),
      ],
    });
  });

  it("rejects an unrecognized container and a big-endian Mach-O image", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-reject-");
    const text = join(root, "notes.txt");
    const bigEndian = join(root, "big");
    const java = join(root, "Main.class");
    await writeFile(text, "This is not an executable container.");
    const header = Buffer.alloc(32);
    header.writeUInt32BE(0xfeedfacf, 0);
    await writeFile(bigEndian, header);
    await writeFile(
      java,
      Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x37]),
    );
    for (const path of [text, bigEndian, java]) {
      const result = await provider.inspect({ path });
      expect(result.ok, path).toBe(false);
      if (!result.ok)
        expect(result.error._tag).toBe("AnalysisUnsupportedTargetError");
    }
  });

  it("does not invent a sentinel from bytes that only straddle two slices", async () => {
    const root = await createTestTempDirectory("rea-electron-fuses-span-");
    const left = thinMacho(0x01000007, Buffer.alloc(16));
    const right = thinMacho(0x0100000c, Buffer.alloc(16));
    const overhang = 10;
    FUSE_SENTINEL.copy(left, left.length - overhang);
    const gap = Buffer.alloc(FUSE_SENTINEL.length - overhang);
    FUSE_SENTINEL.copy(gap, 0, overhang);
    const tableEnd = 48;
    const rightOffset = tableEnd + left.length + gap.length;
    const table = Buffer.alloc(tableEnd);
    table.writeUInt32BE(0xcafebabe, 0);
    table.writeUInt32BE(2, 4);
    table.writeUInt32BE(0x01000007, 8);
    table.writeUInt32BE(tableEnd, 16);
    table.writeUInt32BE(left.length, 20);
    table.writeUInt32BE(0x0100000c, 28);
    table.writeUInt32BE(rightOffset, 36);
    table.writeUInt32BE(right.length, 40);
    const path = join(root, "split");
    await writeFile(path, Buffer.concat([table, left, gap, right]));
    const report = await inspect(path);
    expect(report.slices.map((item) => item.sentinel_count)).toEqual([0, 0]);
  });
});

describe("direct Electron Framework binary selection", () => {
  const frameworkFixture = async (prefix: string) => {
    const root = await createTestTempDirectory(prefix);
    const app = join(root, "Fixture.app");
    const framework = join(
      app,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
    );
    await mkdir(join(framework, "Versions"), { recursive: true });
    return { app, framework };
  };

  it("resolves a binary selected through Versions/Current to its target", async () => {
    const { framework } = await frameworkFixture("rea-electron-fuses-direct-");
    await mkdir(join(framework, "Versions", "A"), { recursive: true });
    const binary = join(framework, "Versions", "A", "Electron Framework");
    await writeFile(binary, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
    await symlink("A", join(framework, "Versions", "Current"));

    const selected = join(
      framework,
      "Versions",
      "Current",
      "Electron Framework",
    );
    const report = await inspect(selected);
    expect(report.artifact.selected_path).toBe(selected);
    expect(report.artifact.resolved_path).toBe(binary);
  });

  it("follows symlinks before parent segments in a selected binary path", async () => {
    const { framework } = await frameworkFixture("rea-electron-fuses-parent-");
    const versions = join(framework, "Versions");
    await mkdir(join(versions, "nested", "B"), { recursive: true });
    await mkdir(join(versions, "nested", "A"), { recursive: true });
    await mkdir(join(versions, "A"), { recursive: true });
    const binary = join(versions, "nested", "A", "Electron Framework");
    await writeFile(binary, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
    await writeFile(
      join(versions, "A", "Electron Framework"),
      sentinelFreeMacho(),
    );
    await symlink("nested/B", join(versions, "Current"));
    const selected = `${versions}/Current/../A/Electron Framework`;
    const report = await inspect(selected);
    expect(report.artifact.selected_path).toBe(selected);
    expect(report.artifact.resolved_path).toBe(binary);
    expect(report.slices[0]?.sentinel_count).toBe(1);
  });

  it("rejects a binary selected through a Versions/Current link that leaves the framework", async () => {
    const { app, framework } = await frameworkFixture(
      "rea-electron-fuses-direct-escape-",
    );
    await mkdir(join(app, "Contents", "Other"), { recursive: true });
    await writeFile(
      join(app, "Contents", "Other", "Electron Framework"),
      elfFuseImage([ELECTRON_FUSE_STATE_BYTES.enabled]).bytes,
    );
    await symlink("../../../Other", join(framework, "Versions", "Current"));

    const result = await provider.inspect({
      path: join(framework, "Versions", "Current", "Electron Framework"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        expect.objectContaining({
          path: ["path"],
          message: expect.stringContaining("escapes"),
        }),
      ],
    });
  });

  it.runIf(process.platform === "win32")(
    "walks a backslash-separated Windows link target before accepting a file",
    async () => {
      const { app, framework } = await frameworkFixture(
        "rea-electron-fuses-nested-escape-backslash-",
      );
      const versions = join(framework, "Versions");
      await mkdir(join(app, "Contents", "Other", "subdir"), {
        recursive: true,
      });
      await writeFile(
        join(app, "Contents", "Other", "subdir", "Electron Framework"),
        elfFuseImage([ELECTRON_FUSE_STATE_BYTES.enabled]).bytes,
      );
      await symlinkDirectory("../../../Other", join(versions, "nested"));
      await symlinkDirectory("nested\\subdir", join(versions, "Current"));

      const result = await provider.inspect({
        path: join(versions, "Current", "Electron Framework"),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        issues: [
          expect.objectContaining({
            path: ["path"],
            message: expect.stringContaining("escapes"),
          }),
        ],
      });
    },
  );

  it("rejects a framework directory that is a symlink outside the bundle", async () => {
    const root = await createTestTempDirectory(
      "rea-electron-fuses-framework-link-",
    );
    const outside = join(root, "outside");
    await mkdir(join(outside, "Versions", "A"), { recursive: true });
    await writeFile(
      join(outside, "Versions", "A", "Electron Framework"),
      thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes,
    );
    const app = join(root, "Example.app");
    const frameworks = join(app, "Contents", "Frameworks");
    await mkdir(frameworks, { recursive: true });
    const framework = join(frameworks, "Electron Framework.framework");
    await symlink(outside, framework);

    for (const path of [
      app,
      join(framework, "Versions", "A", "Electron Framework"),
    ]) {
      const result = await provider.inspect({ path });
      expect(result.ok, path).toBe(false);
      if (result.ok) continue;
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        issues: [
          expect.objectContaining({
            path: ["path"],
            message: expect.stringContaining("escapes"),
          }),
        ],
      });
    }
  });
});

describe("absolute Electron Framework symlinks", () => {
  const versionedFramework = async (prefix: string) => {
    const root = await createTestTempDirectory(prefix);
    const app = join(root, "Fixture.app");
    const framework = join(
      app,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
    );
    for (const [version, state] of [
      ["A", 0x30],
      ["B", 0x31],
    ] as const) {
      await mkdir(join(framework, "Versions", version), { recursive: true });
      await writeFile(
        join(framework, "Versions", version, "Electron Framework"),
        thinFuseImage([state]).bytes,
      );
    }
    return { root, app, framework };
  };

  const expectEscapes = async (path: string) => {
    const result = await provider.inspect({ path });
    expect(result.ok, path).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        expect.objectContaining({
          path: ["path"],
          message: expect.stringContaining("escapes"),
        }),
      ],
    });
  };

  const expectHopLimit = async (path: string) => {
    const result = await provider.inspect({ path });
    expect(result.ok, path).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        expect.objectContaining({
          path: ["path"],
          message: expect.stringContaining("hop limit exceeded"),
        }),
      ],
    });
  };

  it("follows an absolute Versions/Current link that stays inside", async () => {
    const relative = await versionedFramework(
      "rea-electron-fuses-absolute-relative-",
    );
    const absolute = await versionedFramework(
      "rea-electron-fuses-absolute-inside-",
    );
    await symlink("B", join(relative.framework, "Versions", "Current"));
    await symlink(
      join(absolute.framework, "Versions", "B"),
      join(absolute.framework, "Versions", "Current"),
    );

    const fromRelative = await inspect(relative.app);
    const fromAbsolute = await inspect(absolute.app);
    const binary = join(
      absolute.framework,
      "Versions",
      "B",
      "Electron Framework",
    );
    const selected = join(
      absolute.framework,
      "Versions",
      "Current",
      "Electron Framework",
    );
    const fromSelected = await inspect(selected);
    expect(fromRelative.artifact.resolved_path).toBe(
      join(relative.framework, "Versions", "B", "Electron Framework"),
    );
    expect(fromAbsolute.artifact.resolved_path).toBe(binary);
    expect(fromAbsolute.artifact.sha256).toBe(fromRelative.artifact.sha256);
    expect(fromAbsolute.slices[0]?.sentinels[0]?.fuses[0]?.state).toBe(
      "enabled",
    );
    expect(fromSelected.artifact.resolved_path).toBe(binary);
    expect(fromSelected.artifact.sha256).toBe(fromRelative.artifact.sha256);
  });

  it("rejects an absolute Versions/Current link outside the framework", async () => {
    const { root, app, framework } = await versionedFramework(
      "rea-electron-fuses-absolute-outside-",
    );
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(
      join(outside, "Electron Framework"),
      thinFuseImage([0x31]).bytes,
    );
    await symlink(outside, join(framework, "Versions", "Current"));

    await expectEscapes(app);
  });

  it("rejects an absolute in-framework link that then hops outside", async () => {
    const { app, framework } = await versionedFramework(
      "rea-electron-fuses-absolute-hop-",
    );
    const outside = join(app, "Contents", "Other");
    await mkdir(outside);
    await writeFile(
      join(outside, "Electron Framework"),
      thinFuseImage([0x31]).bytes,
    );
    await symlink("../../../Other", join(framework, "Versions", "Gate"));
    await symlink(
      join(framework, "Versions", "Gate"),
      join(framework, "Versions", "Current"),
    );

    await expectEscapes(app);
    await expectEscapes(
      join(framework, "Versions", "Current", "Electron Framework"),
    );
  });

  it("rejects an absolute Current cycle instead of falling back to Versions/A", async () => {
    const { app, framework } = await versionedFramework(
      "rea-electron-fuses-absolute-cycle-",
    );
    const current = join(framework, "Versions", "Current");
    // A valid A binary exists, so this also proves the failed Current walk is
    // not mistaken for absence and silently replaced by the fallback.
    await symlink(current, current);

    await expectHopLimit(app);
  });
});

it.each(["Contents", "Frameworks"])(
  "rejects a redirected %s for every app selection form",
  async (segment) => {
    const root = await createTestTempDirectory("rea-electron-parent-link-");
    const app = join(root, "Fixture.app");
    const outside = join(root, "outside");
    const actualFramework = join(
      outside,
      ...(segment === "Contents" ? ["Frameworks"] : []),
      "Electron Framework.framework",
    );
    await mkdir(join(actualFramework, "Versions", "A"), { recursive: true });
    await writeFile(
      join(actualFramework, "Versions", "A", "Electron Framework"),
      thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes,
    );
    await symlink("A", join(actualFramework, "Versions", "Current"));
    await mkdir(segment === "Contents" ? app : join(app, "Contents"), {
      recursive: true,
    });
    await symlink(
      outside,
      join(
        app,
        "Contents",
        ...(segment === "Frameworks" ? ["Frameworks"] : []),
      ),
    );
    const framework = join(
      app,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
    );
    for (const path of [
      app,
      framework,
      join(framework, "Versions", "Current", "Electron Framework"),
    ]) {
      const result = await provider.inspect({ path });
      expect(result.ok, path).toBe(false);
      if (!result.ok) expect(result.error._tag).toBe("AnalysisInputError");
    }
  },
);

it("enforces the 32 sentinel boundary with typed and public limit details", async () => {
  const root = await createTestTempDirectory("rea-electron-sentinel-limit-");
  const wire = Buffer.concat([FUSE_SENTINEL, fuseWire(1, [0x31])]);
  for (const count of [32, 33]) {
    const path = join(root, String(count));
    await writeFile(
      path,
      thinMacho(
        0x0100000c,
        Buffer.concat(Array.from({ length: count }, () => wire)),
      ),
    );
    const result = await provider.inspect({ path });
    if (count === 32) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.slices[0]?.sentinel_count).toBe(32);
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error._tag).toBe("AnalysisResourceConstraintError");
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "resource_constraint",
          retryable: false,
          details: { reported_limits: { maximum_sentinels_per_slice: 32 } },
          remediation: {
            action: expect.stringContaining("sentinel inventory"),
          },
        });
        expect(
          projectAnalysisError(result.error).remediation.action,
        ).not.toMatch(/Wait for an active analysis/u);
      }
    }
  }
});

it("rejects a sparse artifact over 1 GiB before scanning", async () => {
  const root = await createTestTempDirectory("rea-electron-input-limit-");
  const path = join(root, "large");
  await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
  await truncate(path, 1024 * 1024 * 1024 + 1);
  const result = await provider.inspect({ path });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error._tag).toBe("AnalysisResourceConstraintError");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      details: { reported_limits: { maximum_input_bytes: 1024 * 1024 * 1024 } },
      remediation: {
        action: expect.stringContaining("does not admit this input"),
      },
    });
  }
});

it("follows the active framework binary while an inactive A version remains", async () => {
  const root = await createTestTempDirectory("rea-electron-current-version-");
  const app = join(root, "Fixture.app");
  const framework = join(
    app,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
  );
  for (const [version, state] of [
    ["A", 0x30],
    ["B", 0x31],
  ] as const) {
    await mkdir(join(framework, "Versions", version), { recursive: true });
    await writeFile(
      join(framework, "Versions", version, "Electron Framework"),
      thinFuseImage([state]).bytes,
    );
  }
  await symlinkDirectory("B", join(framework, "Versions", "Current"));
  await symlink(
    "Versions/Current/Electron Framework",
    join(framework, "Electron Framework"),
  );
  for (const path of [app, framework, join(framework, "Electron Framework")]) {
    const report = await inspect(path);
    expect(report.artifact.resolved_path).toBe(
      join(framework, "Versions", "B", "Electron Framework"),
    );
    expect(report.slices[0]?.sentinels[0]?.fuses[0]?.state).toBe("enabled");
  }
});

it("rejects a checked version directory swapped before the reader opens it", async () => {
  const root = await createTestTempDirectory("rea-electron-directory-swap-");
  const app = join(root, "Fixture.app");
  const framework = join(
    app,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
  );
  const version = join(framework, "Versions", "A");
  const outside = join(root, "outside");
  await mkdir(version, { recursive: true });
  await mkdir(outside);
  await writeFile(
    join(version, "Electron Framework"),
    thinFuseImage([0x30]).bytes,
  );
  await writeFile(
    join(outside, "Electron Framework"),
    thinFuseImage([0x31]).bytes,
  );
  const located = await resolveElectronFuseTarget(app);
  await rename(version, `${version}.saved`);
  await symlink(outside, version);
  await expect(
    readElectronFuseImage(located.file.path, { selection: located.file }),
  ).rejects.toBeInstanceOf(RegularFileChangedError);
});

it("reports a checked version directory removed before open as changed", async () => {
  const root = await createTestTempDirectory("rea-electron-directory-missing-");
  const app = join(root, "Fixture.app");
  const version = join(
    app,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
  );
  await mkdir(version, { recursive: true });
  await writeFile(
    join(version, "Electron Framework"),
    thinFuseImage([0x30]).bytes,
  );
  const located = await resolveElectronFuseTarget(app);
  await rename(version, `${version}.saved`);
  await expect(
    readElectronFuseImage(located.file.path, { selection: located.file }),
  ).rejects.toBeInstanceOf(RegularFileChangedError);
});

it("retains the identity of a directory removed by a terminal parent segment", async () => {
  const root = await createTestTempDirectory("rea-electron-parent-identity-");
  const framework = join(root, "Electron Framework.framework");
  const versions = join(framework, "Versions");
  await mkdir(versions, { recursive: true });
  await writeFile(
    join(framework, "Electron Framework"),
    thinFuseImage([0x31]).bytes,
  );
  const located = await resolveElectronFuseTarget(`${versions}/..`);
  await rename(versions, `${versions}.saved`);
  await mkdir(versions);
  await expect(
    readElectronFuseImage(located.file.path, { selection: located.file }),
  ).rejects.toBeInstanceOf(RegularFileChangedError);
});
