import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/parseConfig.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { silentLogger } from "../logger.js";
import {
  ghidraSeedFailure,
  ghidraSeedLimitations,
  parseGhidraSeeds,
  resolveGhidraAnalysisSeeds,
  snapshotGhidraAnalysisSeeds,
  type GhidraSeedCommitment,
  type GhidraSeedReport,
} from "./GhidraAnalysisSeeds.js";
import { ghidraProfileInstallationHost as host } from "./GhidraInstallation.fixture.js";
import { GhidraProvider } from "./GhidraProvider.js";

const directories: string[] = [];
let resources = new ArtifactResourceScope();
afterEach(async () => {
  await resources.close();
  resources = new ArtifactResourceScope();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const workspace = async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-ghidra-seeds-"));
  directories.push(directory);
  return directory;
};

const SEEDS = [
  "# comment and blank lines are ignored",
  "",
  "0x401000\tfunction\tentry",
  "0x00401046\tfunction",
  "0x40A1C4\tcode\r",
  "0x402200\tlabel\tExample::render",
  "",
].join("\n");
const CANONICAL =
  "0x401000\tfunction\tentry\n0x401046\tfunction\n0x40a1c4\tcode\n0x402200\tlabel\tExample::render\n";

describe("Ghidra seed parsing", () => {
  it("accepts the documented line forms", () => {
    const parsed = parseGhidraSeeds(SEEDS);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.value.map((entry) => entry.kind)).toEqual([
      "function",
      "function",
      "code",
      "label",
    ]);
  });

  it.each([
    ["401000\tfunction", "line 1: address must be 0x-prefixed hex"],
    ["0x401000\tdata", "line 1: kind must be function, code or label"],
    ["0x401000", "line 1: expected address<TAB>kind[<TAB>name]"],
    ["0x401000\tlabel", "line 1: a label seed requires a name"],
    [
      "0x401000\tcode\tname",
      "line 1: a code seed takes no name; add a label seed",
    ],
    [
      "0x401000\tfunction\ttwo words",
      "line 1: name must be 1..2000 characters without whitespace",
    ],
    [
      "0x401000\tcode\n0x0401000\tcode",
      "line 2: duplicate code seed at 0x0401000",
    ],
  ])("rejects %j", (text, constraint) => {
    const parsed = parseGhidraSeeds(text);
    if (parsed.ok) throw new Error("Expected a seed error");
    expect(parsed.error.settings).toEqual([
      { setting: "REA_GHIDRA_SEED_FILE", constraint },
    ]);
  });
});

describe("Ghidra seed commitment", () => {
  it("digests the canonical form and snapshots exactly that", async () => {
    const directory = await workspace();
    const path = join(directory, "seeds.tsv");
    await writeFile(path, SEEDS);
    const resolved = await resolveGhidraAnalysisSeeds(path, resources);
    if (!resolved.ok) throw resolved.error;
    const commitment = resolved.value;
    if (commitment === undefined) throw new Error("Expected a commitment");
    expect(commitment).toMatchObject({
      format: "rea-ghidra-seeds-v1",
      configured_path: path,
      sha256: createHash("sha256").update(CANONICAL).digest("hex"),
      entries: { function: 2, code: 1, label: 1 },
    });
    const runtime = await workspace();
    const snapshot = await snapshotGhidraAnalysisSeeds(
      commitment,
      runtime,
      resources,
    );
    expect(await readFile(snapshot, "utf8")).toBe(CANONICAL);
  });

  it("is absent when no seed file is configured", async () => {
    const resolved = await resolveGhidraAnalysisSeeds(undefined, resources);
    expect(resolved.ok && resolved.value).toBeUndefined();
  });

  it("refuses a seed file that changed after the profile was committed", async () => {
    const directory = await workspace();
    const path = join(directory, "seeds.tsv");
    await writeFile(path, SEEDS);
    const resolved = await resolveGhidraAnalysisSeeds(path, resources);
    if (!resolved.ok || resolved.value === undefined)
      throw new Error("Expected a commitment");
    await writeFile(path, `${SEEDS}0x401100\tcode\n`);
    await expect(
      snapshotGhidraAnalysisSeeds(resolved.value, await workspace(), resources),
    ).rejects.toMatchObject({
      _tag: "ProviderAdapterError",
      diagnostics: {
        code: "seed_changed",
        path: resolved.value.path,
        reason: "seed_changed",
      },
    });
  });

  it("commits the resolved path behind a configured symbolic link", async () => {
    const directory = await workspace();
    const path = join(directory, "seeds.tsv");
    await writeFile(path, SEEDS);
    const link = join(directory, "link.tsv");
    await symlink(path, link);
    const resolved = await resolveGhidraAnalysisSeeds(link, resources);
    if (!resolved.ok || resolved.value === undefined)
      throw new Error("Expected a commitment");
    expect(resolved.value.path).toBe(await realpath(path));
  });

  it.skipIf(process.platform === "win32")(
    "rejects an invalid file/.. traversal instead of reading a sibling seed file",
    async () => {
      const directory = await workspace();
      await writeFile(join(directory, "file"), "not a directory");
      await writeFile(join(directory, "seeds.tsv"), SEEDS);
      const configured = `${directory}/file/../seeds.tsv`;
      await expect(open(configured)).rejects.toMatchObject({ code: "ENOTDIR" });
      const resolved = await resolveGhidraAnalysisSeeds(configured, resources);
      expect(resolved.ok).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "preserves symlink/.. lookup against a sibling decoy",
    async () => {
      const directory = await workspace();
      const selected = join(directory, "selected");
      await mkdir(join(selected, "child"), { recursive: true });
      await writeFile(join(selected, "seeds.tsv"), SEEDS);
      await writeFile(join(directory, "seeds.tsv"), "0x1234\tcode\n");
      const link = join(directory, "link");
      await symlink(join(selected, "child"), link);
      const configured = `${link}/../seeds.tsv`;
      const resolved = await resolveGhidraAnalysisSeeds(configured, resources);
      if (!resolved.ok || resolved.value === undefined)
        throw new Error("Expected a commitment");
      expect(resolved.value.configured_path).toBe(configured);
      expect(resolved.value.path).toBe(
        await realpath(join(selected, "seeds.tsv")),
      );
      const snapshot = await snapshotGhidraAnalysisSeeds(
        resolved.value,
        await workspace(),
        resources,
      );
      expect(await readFile(snapshot, "utf8")).toBe(CANONICAL);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a configured traversal that becomes invalid before snapshotting",
    async () => {
      const directory = await workspace();
      const child = join(directory, "child");
      await mkdir(child);
      await writeFile(join(directory, "seeds.tsv"), SEEDS);
      const configured = `${child}/../seeds.tsv`;
      const resolved = await resolveGhidraAnalysisSeeds(configured, resources);
      if (!resolved.ok || resolved.value === undefined)
        throw new Error("Expected a commitment");
      await rm(child, { recursive: true });
      await writeFile(child, "not a directory");
      await expect(open(configured)).rejects.toMatchObject({ code: "ENOTDIR" });
      await expect(
        snapshotGhidraAnalysisSeeds(
          resolved.value,
          await workspace(),
          resources,
        ),
      ).rejects.toMatchObject({ _tag: "ProviderAdapterError" });
    },
  );

  it("reports an unreadable seed file as a provider error", async () => {
    const resolved = await resolveGhidraAnalysisSeeds(
      join(await workspace(), "absent.tsv"),
      resources,
    );
    if (resolved.ok) throw new Error("Expected an error");
    expect(projectAnalysisError(resolved.error)).toMatchObject({
      details: { diagnostics: { setting: "REA_GHIDRA_SEED_FILE" } },
    });
  });
});

describe("Ghidra seed session verification", () => {
  const commitment: GhidraSeedCommitment = {
    format: "rea-ghidra-seeds-v1",
    path: "/seeds.tsv",
    configured_path: "/seeds.tsv",
    sha256: "b".repeat(64),
    entries: { function: 2, code: 1, label: 1 },
  };
  const report: GhidraSeedReport = {
    format: "rea-ghidra-seeds-v1",
    sha256: "b".repeat(64),
    entries: 4,
    function_created: 1,
    function_existing: 0,
    function_failed: 1,
    code_decoded: 1,
    code_failed: 0,
    label_applied: 1,
    label_failed: 0,
    unmapped: 0,
  };

  it("accepts exactly the committed seeds and reports their outcome", () => {
    expect(ghidraSeedFailure(commitment, report, "xrefs")).toBeUndefined();
    expect(ghidraSeedFailure(undefined, undefined, "xrefs")).toBeUndefined();
    expect(ghidraSeedLimitations(commitment, report)).toEqual([
      expect.stringContaining("caller assertions, not Ghidra discoveries"),
      expect.stringContaining(
        "1 functions created, 0 already present, 1 failed",
      ),
    ]);
    expect(ghidraSeedLimitations(undefined)).toEqual([]);
  });

  it.each([
    ["a missing report", commitment, undefined],
    ["an uncommitted report", undefined, report],
    ["a different digest", commitment, { ...report, sha256: "c".repeat(64) }],
    ["a different count", commitment, { ...report, entries: 3 }],
  ])("fails closed on %s", (_label, committed, reported) => {
    expect(ghidraSeedFailure(committed, reported, "xrefs")).toBeDefined();
  });
});

describe("Ghidra seed profile", () => {
  const pe: BinaryTarget = {
    path: "/fixture.exe",
    sha256: "a".repeat(64),
    kind: "executable",
    format: "pe",
    architecture: "x86",
    availableArchitectures: ["x86"],
    executableRole: "application",
    managed: false,
  };

  it("commits the seed digest and counts into the analysis profile", async () => {
    const path = join(await workspace(), "seeds.tsv");
    await writeFile(path, SEEDS);
    const parsed = parseConfig({
      GHIDRA_INSTALL_DIR: "/ghidra",
      REA_GHIDRA_SEED_FILE: path,
    });
    if (!parsed.ok) throw parsed.error;
    const ghidra = new GhidraProvider(parsed.value, silentLogger, {}, host);
    const resolved = await ghidra.resolveAnalysisProfile(pe);
    if (!resolved.ok) throw resolved.error;
    expect(resolved.value.profile?.parameters.analysis_seeds).toMatchObject({
      format: "rea-ghidra-seeds-v1",
      entries: { function: 2, code: 1, label: 1 },
    });
  });

  it("refuses a malformed seed file before launching Ghidra", async () => {
    const path = join(await workspace(), "seeds.tsv");
    await writeFile(path, "0x401000\tdata\n");
    const parsed = parseConfig({
      GHIDRA_INSTALL_DIR: "/ghidra",
      REA_GHIDRA_SEED_FILE: path,
    });
    if (!parsed.ok) throw parsed.error;
    const ghidra = new GhidraProvider(parsed.value, silentLogger, {}, host);
    const resolved = await ghidra.resolveAnalysisProfile(pe);
    if (resolved.ok) throw new Error("Expected a configuration error");
    expect(projectAnalysisError(resolved.error)).toMatchObject({
      code: "configuration_invalid",
      details: { settings: [{ setting: "REA_GHIDRA_SEED_FILE" }] },
    });
  });

  it("requires an absolute seed path", () => {
    const parsed = parseConfig({ REA_GHIDRA_SEED_FILE: "seeds.tsv" });
    expect(parsed.ok).toBe(false);
  });
});
