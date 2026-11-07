import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { createDirectAnalysis } from "../../../src/composition/directAnalysis.js";
import { withArtifactClient } from "../../support/artifactClientScope.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { createPackageWithOptions, extractFile } from "@electron/asar";
import { expect, it } from "vitest";
import {
  inventoryArtifact,
  withArtifactResourceScope,
} from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { extractArtifact } from "../../../src/artifacts/extraction/ArtifactExtraction.js";

const bytes = Buffer.from("selected companion bytes");
const fixture = async () => {
  const root = await createTestTempDirectory("rea-asar-selected-companion-");
  const source = join(root, "source");
  const selected = join(root, "app.asar");
  const canonical = join(root, "stored.asar");
  await mkdir(source);
  await writeFile(join(source, "native.node"), bytes);
  await writeFile(join(source, "packed.txt"), "packed bytes");
  await createPackageWithOptions(source, selected, { unpack: "*.node" });
  await rename(selected, canonical);
  await symlink(canonical, selected);
  return { root, selected, canonical };
};

it.skipIf(process.platform === "win32")(
  "inventories and extracts the same selected ASAR companion as Electron tooling",
  async () => {
    const { root, selected } = await fixture();
    expect(extractFile(selected, "native.node").equals(bytes)).toBe(true);
    const inventory = await inventoryArtifact(selected);
    const occurrence = inventory.occurrences.find(
      ({ logical_path }) => logical_path === "native.node",
    );
    expect(occurrence?.hash_status).toBe("verified");
    expect(
      inventory.nodes.find(
        ({ artifact_id }) => artifact_id === occurrence?.artifact_id,
      )?.sha256,
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
    const result = await withArtifactResourceScope((resourceScope) =>
      extractArtifact({
        inputPath: selected,
        inputFormat: "asar",
        outputRoot: join(root, "output"),
        environment: {},
        integrityPolicy: "fail",
        resourceScope,
      }),
    );
    expect(
      (await readFile(join(result.output_root, "native.node"))).equals(bytes),
    ).toBe(true);
    expect(await readFile(join(result.output_root, "packed.txt"), "utf8")).toBe(
      "packed bytes",
    );
  },
);

it.skipIf(process.platform === "win32")(
  "does not substitute the canonical archive companion for an absent selected companion",
  async () => {
    const { selected, canonical } = await fixture();
    await rename(`${selected}.unpacked`, `${canonical}.unpacked`);
    expect(() => extractFile(selected, "native.node")).toThrow();
    const inventory = await inventoryArtifact(selected);
    expect(
      inventory.occurrences.find(
        ({ logical_path }) => logical_path === "native.node",
      )?.hash_status,
    ).toBe("unavailable");
  },
);

it.skipIf(process.platform === "win32")(
  "keeps differing selected companions distinct despite identical packed archive bytes",
  async () => {
    const { root, selected, canonical } = await fixture();
    await mkdir(`${canonical}.unpacked`);
    await writeFile(
      join(`${canonical}.unpacked`, "native.node"),
      "different canonical companion",
    );
    expect(extractFile(selected, "native.node").equals(bytes)).toBe(true);
    const selectedInventory = await inventoryArtifact(selected);
    const canonicalInventory = await inventoryArtifact(canonical, {
      integrity: "record-and-continue",
    });
    expect(selectedInventory.manifest.root_sha256).toBe(
      canonicalInventory.manifest.root_sha256,
    );
    expect(selectedInventory.manifest.manifest_id).not.toBe(
      canonicalInventory.manifest.manifest_id,
    );
    const result = await withArtifactResourceScope((resourceScope) =>
      extractArtifact({
        inputPath: selected,
        inputFormat: "asar",
        outputRoot: join(root, "output"),
        environment: {},
        integrityPolicy: "fail",
        resourceScope,
      }),
    );
    expect(
      (await readFile(join(result.output_root, "native.node"))).equals(bytes),
    ).toBe(true);
    await rm(join(`${selected}.unpacked`, "native.node"));
    await writeFile(
      join(`${selected}.unpacked`, "native.node"),
      "changed selected companion",
    );
    await expect(inventoryArtifact(selected)).rejects.toThrow();
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["canonical", "parent-symlink", "relative-alias"] as const)(
  "preserves ordinary ASAR companion lookup through %s selections",
  async (selection) => {
    const { root, selected, canonical } = await fixture();
    let inputPath = selected;
    if (selection === "relative-alias")
      inputPath = relative(process.cwd(), selected);
    else {
      await rename(`${selected}.unpacked`, `${canonical}.unpacked`);
      if (selection === "canonical") inputPath = canonical;
      else {
        const parentAlias = join(root, "parent-alias");
        await symlink(root, parentAlias);
        inputPath = join(parentAlias, "stored.asar");
      }
    }
    expect(extractFile(inputPath, "native.node").equals(bytes)).toBe(true);
    const inventory = await inventoryArtifact(inputPath);
    expect(
      inventory.occurrences.find(
        ({ logical_path }) => logical_path === "native.node",
      )?.hash_status,
    ).toBe("verified");
    const result = await withArtifactResourceScope((resourceScope) =>
      extractArtifact({
        inputPath,
        inputFormat: "asar",
        outputRoot: join(root, "output"),
        environment: {},
        integrityPolicy: "fail",
        resourceScope,
      }),
    );
    expect(
      (await readFile(join(result.output_root, "native.node"))).equals(bytes),
    ).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "public artifact admission retains an ASAR alias to an unsuffixed packed file",
  async () => {
    const { root, selected, canonical } = await fixture();
    const stored = join(root, "content-addressed-archive");
    await rename(canonical, stored);
    await rm(selected);
    await symlink(stored, selected);
    const { runProviderAnalysis } = createDirectAnalysis({});
    const observed = parseEvidence(
      await runProviderAnalysis(selected, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    expect(observed.subject?.local_path).toBe(selected);
    const inventory = artifactInventoryResultSchema.parse(
      observed.normalized_result,
    );
    expect(
      inventory.occurrences.find(
        ({ logical_path }) => logical_path === "native.node",
      )?.hash_status,
    ).toBe("verified");
  },
);

it.skipIf(process.platform === "win32")(
  "refuses an ASAR alias retargeted after target admission",
  async () => {
    const { root, selected, canonical } = await fixture();
    const admitted = await parseBinaryTarget(selected);
    if (!admitted.ok) throw admitted.error;
    expect(admitted.value.path).toBe(canonical);
    expect(admitted.value.artifactSelectedPath).toBe(selected);
    const replacement = join(root, "replacement.asar");
    await writeFile(replacement, await readFile(canonical));
    await rm(selected);
    await symlink(replacement, selected);
    await withArtifactClient(admitted.value, async (client) => {
      const result = await client.execute("inventory_artifact", {});
      expect(result.ok).toBe(false);
      if (result.ok)
        throw new Error("Retargeted archive was unexpectedly admitted");
      expect(result.error).toMatchObject({
        reason: "integrity",
        detail: expect.stringContaining(
          "no longer resolves to its admitted source",
        ),
      });
    });
  },
);

it.skipIf(process.platform === "win32")(
  "preserves symlink-parent traversal when opening the selected ASAR companion",
  async () => {
    const root = await createTestTempDirectory("rea-asar-link-parent-");
    const actual = join(root, "actual");
    await mkdir(join(actual, "sub"), { recursive: true });
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "native.node"), bytes);
    const archive = join(actual, "app.asar");
    await createPackageWithOptions(source, archive, { unpack: "*.node" });
    await symlink(join(actual, "sub"), join(root, "link"));
    const selected = `${root}/link/../app.asar`;
    const inventory = await inventoryArtifact(selected);
    expect(
      inventory.occurrences.find(
        ({ logical_path }) => logical_path === "native.node",
      )?.hash_status,
    ).toBe("verified");
    const result = await withArtifactResourceScope((resourceScope) =>
      extractArtifact({
        inputPath: selected,
        inputFormat: "asar",
        outputRoot: join(root, "output"),
        environment: {},
        integrityPolicy: "fail",
        resourceScope,
      }),
    );
    expect(
      (await readFile(join(result.output_root, "native.node"))).equals(bytes),
    ).toBe(true);
  },
);
