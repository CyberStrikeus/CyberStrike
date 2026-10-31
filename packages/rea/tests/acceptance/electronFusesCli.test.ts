import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, parse, sep } from "node:path";
import { createHash } from "node:crypto";
import { expect } from "vitest";

import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  elfHeaderFuseImage,
  OBSIDIAN_FUSE_BYTES,
  peHeaderFuseImage,
  sentinelFreeMacho,
  thinFuseImage,
  universalFuseImage,
} from "../fixtures/electron/fuseImage.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

// Windows resolves dot components before directory links in Win32 paths.
cliTest.skipIf(process.platform === "win32").for([
  { kind: "binary", mode: "absolute" },
  { kind: "binary", mode: "relative" },
  { kind: "bundle", mode: "absolute" },
  { kind: "bundle", mode: "relative" },
] as const)(
  "preserves $mode $kind selections containing a symlink before a parent segment",
  async ({ kind, mode }, { cli }) => {
    const root = await createTestTempDirectory("rea-electron-fuses-cli-path-");
    const framework = "Contents/Frameworks/Electron Framework.framework";
    const directory =
      kind === "binary"
        ? join(root, "Fixture.app", framework, "Versions")
        : root;
    const selectedTail =
      kind === "binary" ? "A/Electron Framework" : "Fixture.app";
    const binaryTail =
      kind === "binary"
        ? selectedTail
        : `Fixture.app/${framework}/Versions/A/Electron Framework`;
    const binary = join(directory, "nested", binaryTail);
    const sibling = join(directory, binaryTail);
    const image = thinFuseImage([0x31, 0x30, 0x30, 0x31]);
    const otherImage = thinFuseImage([0x30, 0x30, 0x30, 0x30]);
    await mkdir(dirname(binary), { recursive: true });
    await mkdir(dirname(sibling), { recursive: true });
    await mkdir(join(directory, "nested", "B"), { recursive: true });
    await writeFile(binary, image.bytes);
    await writeFile(sibling, otherImage.bytes);
    await symlink("nested/B", join(directory, "Current"));
    const selected = `${directory}/Current/../${selectedTail}`;
    expect(await realpath(selected)).toBe(
      kind === "binary" ? binary : join(root, "nested", "Fixture.app"),
    );

    const result = await cli.run({
      arguments: [
        "inspect-electron-fuses",
        mode === "absolute" ? selected : selected.slice(root.length + 1),
        "--json",
      ],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_electron_fuses").outputSchema.parse(
      result.json,
    );
    const digest = createHash("sha256").update(image.bytes).digest("hex");
    expect(evidence.normalized_result.artifact).toMatchObject({
      selected_path: selected,
      resolved_path:
        kind === "binary"
          ? binary
          : `${selected}/${framework}/Versions/A/Electron Framework`,
      sha256: digest,
    });
    expect(
      await realpath(evidence.normalized_result.artifact.resolved_path),
    ).toBe(binary);
    expect(evidence.subject?.local_path).toBe(
      evidence.normalized_result.artifact.resolved_path,
    );
    expect(evidence.subject?.digest.sha256).toBe(digest);
    expect(evidence.normalized_result.runtime_implications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "electron_run_as_node",
          outcome: "honored",
        }),
        expect.objectContaining({
          subject: "node_cli_inspect_arguments",
          outcome: "honored",
        }),
      ]),
    );

    const control = await cli.run({
      arguments: ["inspect-electron-fuses", sibling, "--json"],
    });
    expect(control.exitCode, control.stderr).toBe(0);
    const siblingEvidence = toolContract(
      "inspect_electron_fuses",
    ).outputSchema.parse(control.json);
    expect(siblingEvidence.normalized_result.artifact.sha256).toBe(
      createHash("sha256").update(otherImage.bytes).digest("hex"),
    );
    expect(siblingEvidence.normalized_result.runtime_implications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "electron_run_as_node",
          outcome: "not_honored",
        }),
        expect.objectContaining({
          subject: "node_cli_inspect_arguments",
          outcome: "not_honored",
        }),
      ]),
    );
  },
);

cliTest.skipIf(process.platform !== "win32")(
  "retains Windows drive, root, and mixed-separator path resolution",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-fuses-win-path-");
    const tail =
      "Fixture.app/Contents\\Frameworks/Electron Framework.framework/Versions\\A/Electron Framework";
    const binary = join(root, tail);
    const image = thinFuseImage([0x31]);
    await mkdir(dirname(binary), { recursive: true });
    await writeFile(binary, image.bytes);
    const volume = parse(root).root;
    for (const input of [
      binary.replaceAll("\\", "/"),
      tail,
      `${volume.slice(0, -1)}${tail}`,
      binary.slice(volume.length - 1),
    ]) {
      const result = await cli.run({
        arguments: ["inspect-electron-fuses", input, "--json"],
        cwd: root,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = toolContract(
        "inspect_electron_fuses",
      ).outputSchema.parse(result.json);
      expect(evidence.normalized_result.artifact).toMatchObject({
        selected_path: binary,
        resolved_path: binary,
        sha256: createHash("sha256").update(image.bytes).digest("hex"),
      });
    }
  },
);

cliTest(
  "reads thin and universal Electron fuse wires through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-fuses-cli-");
    const thin = thinFuseImage(OBSIDIAN_FUSE_BYTES);
    const universal = universalFuseImage();
    await writeFile(join(root, "thin"), thin.bytes);
    await writeFile(join(root, "universal"), universal.bytes);

    const thinResult = await cli.run({
      arguments: ["inspect-electron-fuses", "thin", "--json"],
      cwd: root,
    });
    expect(thinResult.exitCode, thinResult.stderr).toBe(0);
    const thinEvidence = toolContract(
      "inspect_electron_fuses",
    ).outputSchema.parse(thinResult.json);
    expect(thinEvidence.subject?.local_path).toBe(join(root, "thin"));
    expect(thinEvidence.subject?.digest.sha256).toBe(
      createHash("sha256").update(thin.bytes).digest("hex"),
    );
    expect(thinEvidence.subject?.architecture).toBe("arm64");
    expect(
      thinEvidence.normalized_result.slices[0]?.sentinels[0],
    ).toMatchObject({
      sentinel_offset: thin.sentinelOffset,
      wire_version: 1,
      declared_length: 8,
    });
    expect(
      thinEvidence.normalized_result.runtime_implications.find(
        (item) => item.subject === "node_cli_inspect_arguments",
      ),
    ).toMatchObject({ outcome: "not_honored", fuse_index: 3 });

    const universalResult = await cli.run({
      arguments: ["inspect-electron-fuses", join(root, "universal"), "--json"],
    });
    expect(universalResult.exitCode, universalResult.stderr).toBe(0);
    const universalEvidence = toolContract(
      "inspect_electron_fuses",
    ).outputSchema.parse(universalResult.json);
    expect(universalEvidence.normalized_result.artifact.format).toBe(
      "mach-o-universal",
    );
    expect(universalEvidence.subject?.architecture).toBeNull();
    expect(
      universalEvidence.normalized_result.slices.map((slice) => ({
        file_offset: slice.file_offset,
        sentinel_offset: slice.sentinels[0]?.sentinel_offset,
      })),
    ).toEqual([
      {
        file_offset: universal.left.fileOffset,
        sentinel_offset: universal.left.sentinelOffset,
      },
      {
        file_offset: universal.right.fileOffset,
        sentinel_offset: universal.right.sentinelOffset,
      },
    ]);
  },
);

cliTest.for([
  { label: "ELF x86", format: "elf", machine: 3, architecture: "x86" },
  { label: "ELF x86-64", format: "elf", machine: 62, architecture: "x86_64" },
  { label: "ELF AArch64", format: "elf", machine: 183, architecture: "arm64" },
  { label: "ELF unknown", format: "elf", machine: 0xfffe, architecture: null },
  { label: "PE x86", format: "pe", machine: 0x14c, architecture: "x86" },
  { label: "PE AMD64", format: "pe", machine: 0x8664, architecture: "x86_64" },
  { label: "PE ARM64", format: "pe", machine: 0xaa64, architecture: "arm64" },
  { label: "PE unknown", format: "pe", machine: 0x01f0, architecture: null },
] as const)(
  "reports the $label header architecture beside unchanged fuse wires",
  async ({ format, machine, architecture }, { cli }) => {
    const root = await createTestTempDirectory("rea-electron-fuses-cli-arch-");
    const image =
      format === "elf"
        ? elfHeaderFuseImage(machine, OBSIDIAN_FUSE_BYTES, {
            bits: architecture === "x86" ? 32 : 64,
            byteOrder: "little",
          })
        : peHeaderFuseImage(machine, OBSIDIAN_FUSE_BYTES);
    const path = join(root, "electron");
    await writeFile(path, image.bytes);
    const result = await cli.run({
      arguments: ["inspect-electron-fuses", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_electron_fuses").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.artifact.format).toBe(format);
    expect(evidence.subject?.architecture).toBe(architecture);
    expect(evidence.normalized_result.slices).toMatchObject([
      {
        architecture,
        sentinel_count: 1,
        sentinels: [
          {
            sentinel_offset: image.sentinelOffset,
            wire_version: 1,
            complete: true,
          },
        ],
      },
    ]);
    expect(
      evidence.normalized_result.slices[0]?.sentinels[0]?.fuses.map(
        (fuse) => fuse.raw_byte,
      ),
    ).toEqual(OBSIDIAN_FUSE_BYTES);
  },
);

cliTest(
  "reports a missing sentinel as unknown fuse state through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-fuses-cli-empty-");
    const path = join(root, "empty");
    await writeFile(path, sentinelFreeMacho());
    const result = await cli.run({
      arguments: ["inspect-electron-fuses", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_electron_fuses").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.slices[0]?.sentinel_count).toBe(0);
    expect(evidence.normalized_result.runtime_implications).toEqual([]);
    expect(evidence.limitations.join(" ")).toContain(
      "unknown, not that every fuse is disabled",
    );
    expect(evidence.limitations.join(" ")).toContain(
      "fuse state for that slice is unknown, not disabled",
    );
  },
);

cliTest(
  "resolves an Electron app bundle to its framework binary through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-fuses-cli-app-");
    const image = thinFuseImage(OBSIDIAN_FUSE_BYTES);
    const app = join(root, "Fixture.app");
    const binary = join(
      app,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Electron Framework",
    );
    await mkdir(join(binary, ".."), { recursive: true });
    await writeFile(binary, image.bytes);
    await symlink("A", join(binary, "..", "..", "Current"));
    for (const { input, cwd, selected } of [
      { input: app, cwd: root, selected: app },
      { input: `${app}/./`, cwd: root, selected: `${app}/./` },
      { input: "Fixture.app/.", cwd: root, selected: `${app}/.` },
      { input: ".", cwd: app, selected: `${app}${sep}.` },
      {
        input: "..",
        cwd: join(app, "Contents"),
        selected: `${app}${sep}Contents${sep}..`,
      },
      {
        input: ".././..",
        cwd: join(app, "Contents", "Frameworks"),
        selected: `${app}${sep}Contents${sep}Frameworks${sep}.././..`,
      },
    ]) {
      const result = await cli.run({
        arguments: ["inspect-electron-fuses", input, "--json"],
        cwd,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = toolContract(
        "inspect_electron_fuses",
      ).outputSchema.parse(result.json);
      expect(evidence.normalized_result.artifact).toMatchObject({
        selected_path: process.platform === "win32" ? app : selected,
        resolved_path: binary,
        format: "mach-o",
      });
      expect(evidence.subject?.local_path).toBe(binary);
    }

    const empty = await cli.run({
      arguments: ["inspect-electron-fuses", "", "--json"],
      cwd: app,
    });
    expect(empty.exitCode, empty.stderr).toBe(1);
    expect(empty.json).toMatchObject({
      code: "invalid_request",
      details: { operation: "inspect_electron_fuses" },
    });
  },
);

cliTest.skipIf(process.platform === "win32")(
  "refuses a terminal bundle parent segment after a directory symlink",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-electron-fuses-cli-parent-",
    );
    const app = join(root, "Fixture.app");
    const binary = join(
      app,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Electron Framework",
    );
    await mkdir(dirname(binary), { recursive: true });
    await writeFile(binary, thinFuseImage([0x31]).bytes);
    await symlink("Contents", join(app, "linked"));
    const result = await cli.run({
      arguments: ["inspect-electron-fuses", `${app}/linked//..`, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "inspect_electron_fuses",
        issues: [
          expect.objectContaining({ path: ["path"], reason: "invalid_value" }),
        ],
      },
    });
  },
);

cliTest(
  "rejects an unrecognized container through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-fuses-cli-text-");
    const path = join(root, "notes.txt");
    await writeFile(path, "This is not an executable container.");
    const result = await cli.run({
      arguments: ["inspect-electron-fuses", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "unsupported_target",
      details: { operation: "inspect_electron_fuses", path },
    });
  },
);
