import { expect, it, onTestFinished } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { gpuCodeObjectsPartialSchema } from "../../../src/domain/gpu/gpuCodeObjects.js";
import { GpuCodeObjectsProvider } from "../../../src/gpu/GpuCodeObjectsProvider.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  cudaFixture,
  cubinFixture,
  ccobFixture,
  hipFixture,
  peGpuFixture,
  elfFixture,
  ptxFixture,
  amdFixture,
  amdNoteFixture,
  llvmBitcodeFixture,
} from "../../fixtures/gpu/codeObjects.js";
const inspect = async (
  bytes: Buffer,
  options: {
    analysis?: "inventory" | "kernels";
    targets?: string[];
    object_ids?: string[];
    expected_sha256?: string;
  } = {},
) => {
  const root = await createTestTempDirectory("rea-gpu-"),
    path = join(root, "no-format-extension");
  await writeFile(path, bytes);
  const provider = new GpuCodeObjectsProvider();
  onTestFinished(() => provider.close());
  return provider.inspect({ path, analysis: "kernels", ...options });
};
it.each(["none", "zstd"] as const)(
  "reads selected CUDA metadata and PTX with %s compression",
  async (compression) => {
    const result = await inspect(cudaFixture(compression));
    if (!result.ok) throw result.error;
    expect(result.value.coverage).toMatchObject({
      discovery: "complete",
      payloads: "complete",
    });
    expect(
      result.value.kernels.map((row) => [
        row.name,
        row.parameter_count,
        row.parameter_bytes,
        row.shared_bytes,
        row.registers.physical,
      ]),
    ).toEqual([
      ["add_one", 2, 12, 32, null],
      ["add_one", 2, 12, 1056, 10],
    ]);
    expect(result.value.ptx_artifacts[0]!.text).toBe(ptxFixture);
    expect(
      result.value.kernels[1]!.parameters.map((row) => [
        row.ordinal,
        row.offset,
        row.size,
      ]),
    ).toEqual([
      [0, 0, 8],
      [1, 8, 4],
    ]);
  },
);
it("retains the unsupported legacy CUDA compression declaration and extents", async () => {
  const result = await inspect(
    cudaFixture("legacy", [
      { kind: 1, target: 80, bytes: Buffer.from(ptxFixture), flags: 4 },
    ]),
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]).toMatchObject({
    compression: "unsupported",
    compression_id: expect.stringContaining("cuda-flags:0x1015"),
    encoded_size: deflateSync(Buffer.from(ptxFixture)).length,
    decoded_size: Buffer.byteLength(ptxFixture),
    inspection: "unsupported",
  });
  expect(result.value.ptx_artifacts).toEqual([]);
  expect(result.value.kernels).toEqual([]);
  expect(result.value.objects[0]!.limitations.join(" ")).toContain(
    "compression/version is not supported",
  );
});
it.each([1, 2, 3] as const)(
  "reads CCOB v%d zlib/Zstd and retains exact decoded provenance",
  async (version) => {
    for (const method of ["zlib", "zstd"] as const) {
      const result = await inspect(ccobFixture(version, method));
      if (!result.ok) throw result.error;
      expect(result.value.kernels[0]).toMatchObject({
        name: "add_one",
        parameter_count: 2,
        parameter_bytes: 12,
        registers: { sgpr: 6, vgpr: 2 },
        shared_bytes: 0,
      });
      expect(result.value.objects[2]!.location.container_id).toBe(
        result.value.objects[0]!.id,
      );
    }
  },
);
it("does not decode unselected payloads and keeps stable positional identities", async () => {
  const bytes = cudaFixture("zstd");
  const inventory = await inspect(bytes, { analysis: "inventory" }),
    selected = await inspect(bytes, { targets: ["sm_90"] });
  if (!inventory.ok) throw inventory.error;
  if (!selected.ok) throw selected.error;
  expect(inventory.value.kernels).toEqual([]);
  expect(selected.value.objects.map((row) => row.id)).toEqual(
    inventory.value.objects.map((row) => row.id),
  );
  expect(selected.value.ptx_artifacts).toEqual([]);
  expect(selected.value.kernels).toHaveLength(1);
  expect(selected.value.coverage.payloads).toBe("partial");
});
it.each(["cubin", "ptx"] as const)(
  "retains conflicting container and %s target declarations as partial facts",
  async (kind) => {
    const bytes = cudaFixture("none", [
      {
        kind: kind === "cubin" ? 2 : 1,
        target: 80,
        bytes:
          kind === "cubin"
            ? cubinFixture({ architecture: 90 })
            : Buffer.from(ptxFixture.replace("sm_80", "sm_90")),
      },
    ]);
    const result = await inspect(bytes, { targets: ["sm_80"] });
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]).toMatchObject({
      target: "sm_80",
      payload_target: "sm_90",
      target_consistency: "conflict",
      inspection: "partial",
    });
    expect(result.value.coverage.payloads).toBe("partial");
    expect(result.value.kernels).toHaveLength(1);
    expect(result.value.kernels[0]!.limitations.join(" ")).toContain(
      "inventory sm_80; payload sm_90",
    );
    const unexamined = await inspect(bytes, { targets: ["sm_90"] });
    if (!unexamined.ok) throw unexamined.error;
    expect(unexamined.value.objects[0]).toMatchObject({
      target: "sm_80",
      payload_target: null,
      target_consistency: "unexamined",
      inspection: "not-selected",
    });
    expect(unexamined.value.coverage.payloads).toBe("partial");
  },
);
it("keeps CUBIN base-only agreement distinct from verified feature-profile agreement", async () => {
  const bytes = cudaFixture("none", [
    { kind: 2, target: 90, bytes: cubinFixture({ architecture: 90 }) },
  ]);
  bytes.writeBigUInt64LE(bytes.readBigUInt64LE(16 + 40) | 0x100000n, 16 + 40);
  const result = await inspect(bytes, { targets: ["sm_90a"] });
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]).toMatchObject({
    target: "sm_90a",
    payload_target: "sm_90",
    target_consistency: "base-only",
    inspection: "complete",
  });
});
it.each([
  [100, 0x06006402],
  [101, 0x06006502],
  [103, 0x05006702],
  [120, 0x06007802],
  [121, 0x06007902],
])(
  "reads ABI-qualified CUDA target sm_%d from released NVIDIA header flags",
  async (architecture, flags) => {
    const result = await inspect(cubinFixture({ osAbi: 0x41, flags }));
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]).toMatchObject({
      target: `sm_${architecture}`,
      payload_target: `sm_${architecture}`,
      target_consistency: "single-source",
      inspection: "complete",
      cuda_target_header: {
        os_abi: 0x41,
        flags: `0x${flags.toString(16).padStart(8, "0")}`,
      },
    });
  },
);
it("keeps unsupported CUDA flag layouts unknown while retaining raw header evidence", async () => {
  const result = await inspect(
    cubinFixture({ osAbi: 0x41, flags: 0x06016402 }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]).toMatchObject({
    target: null,
    payload_target: null,
    target_consistency: "unknown",
    inspection: "partial",
    cuda_target_header: { os_abi: 0x41, flags: "0x06016402" },
  });
  expect(result.value.kernels).toHaveLength(1);
  expect(result.value.kernels[0]!.limitations.join(" ")).toContain(
    "target encoding is unknown",
  );
  const inventory = await inspect(
    cubinFixture({ osAbi: 0x41, flags: 0x06016402 }),
    { analysis: "inventory" },
  );
  if (!inventory.ok) throw inventory.error;
  expect(inventory.value.coverage.discovery).toBe("partial");
});
it("discovers standalone AMD targets before exact selection", async () => {
  const bytes = amdFixture(),
    target = "amdgcn-amd-amdhsa--gfx900";
  const inventory = await inspect(bytes, { analysis: "inventory" });
  const selected = await inspect(bytes, { targets: [target] });
  const skipped = await inspect(bytes, {
    targets: ["amdgcn-amd-amdhsa--gfx1100"],
  });
  if (!inventory.ok) throw inventory.error;
  if (!selected.ok) throw selected.error;
  if (!skipped.ok) throw skipped.error;
  expect(inventory.value.objects[0]).toMatchObject({
    target,
    inspection: "inventory",
    sha256: null,
  });
  expect(inventory.value.kernels).toEqual([]);
  expect(selected.value.objects[0]).toMatchObject({
    target,
    inspection: "complete",
    id: inventory.value.objects[0]!.id,
  });
  expect(selected.value.kernels).toHaveLength(1);
  expect(selected.value.kernels[0]).toMatchObject({
    representation: "amdgpu-metadata",
    parameter_bytes: 12,
  });
  expect(skipped.value.objects[0]).toMatchObject({
    target,
    inspection: "not-selected",
    sha256: null,
  });
  expect(skipped.value.kernels).toEqual([]);
  expect(skipped.value.coverage.payloads).toBe("partial");
});
it("derives V3 AMDGPU processor identity from ELF flags when the note omits it", async () => {
  const bytes = amdFixture(false, undefined, null);
  // EF_AMDGPU_MACH=0x2c identifies gfx900; high bits include feature flags.
  bytes.writeUInt32LE(0x12c, 48);
  const inventory = await inspect(bytes, { analysis: "inventory" });
  if (!inventory.ok) throw inventory.error;
  expect(inventory.value.objects[0]).toMatchObject({
    target: "gfx900",
    target_consistency: "single-source",
    inspection: "inventory",
  });
  const selected = await inspect(bytes, { targets: ["gfx900"] });
  if (!selected.ok) throw selected.error;
  expect(selected.value.kernels).toHaveLength(1);
  expect(selected.value.kernels[0]).toMatchObject({ parameter_bytes: 12 });
});
it("keeps AMDGPU processor identity unknown when ELF flags are unassigned", async () => {
  const bytes = amdFixture(false, undefined, null);
  bytes.writeUInt32LE(0x17f, 48);
  const result = await inspect(bytes, { analysis: "inventory" });
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]).toMatchObject({
    target: null,
    target_consistency: "unknown",
    inspection: "inventory",
  });
});
it.each([false, true])(
  "keeps HIP bitcode representation unsupported with wrapped=%s and no declared processor",
  async (wrapped) => {
    const payload = llvmBitcodeFixture(wrapped),
      bytes = hipFixture(payload, "hip-amdgcn-amd-amdhsa--");
    for (const analysis of ["inventory", "kernels"] as const) {
      const result = await inspect(bytes, { analysis });
      if (!result.ok) throw result.error;
      const row = result.value.objects.find(({ kind }) => kind === "amdgpu")!;
      expect(row).toMatchObject({
        bundle_id: "hip-amdgcn-amd-amdhsa--",
        target: null,
        payload_target: null,
        inspection: analysis === "inventory" ? "inventory" : "unsupported",
        encoded_size: payload.length,
        location: { size: payload.length },
        sha256:
          analysis === "inventory"
            ? null
            : createHash("sha256").update(payload).digest("hex"),
      });
      expect(row.limitations.join(" ")).toContain("LLVM bitcode");
      expect(row.limitations.join(" ")).not.toContain("not an ELF image");
      expect(result.value.coverage).toMatchObject({
        discovery: "partial",
        payloads: analysis === "inventory" ? "not-requested" : "partial",
      });
      expect(result.value.kernels).toEqual([]);
    }
  },
);
it.each([
  ["amdgcn", "gfx900:xnack+"],
  ["amdgcn", "gfx900+xnack"],
  ["amdgcn", "gfx900:sramecc-:xnack+"],
  ["amdgpu", "gfx900:xnack+"],
  ["amdgpu9", "gfx900:xnack+"],
  ["amdgpu9.00", "gfx900:sramecc-:xnack+"],
])(
  "preserves matching AMDGPU %s note features with ELF processor flags (%s)",
  async (triple, target) => {
    const noteTarget = `${triple}-amd-amdhsa--${target}`;
    const payload = amdFixture(false, undefined, noteTarget);
    payload.writeUInt32LE(0x12c, 48);
    const result = await inspect(
      hipFixture(payload, `hipv4-amdgcn-amd-amdhsa--${target}`),
      { targets: [target] },
    );
    if (!result.ok) throw result.error;
    expect(
      result.value.objects.find(({ kind }) => kind === "amdgpu"),
    ).toMatchObject({
      target,
      payload_target: noteTarget,
      target_consistency: "consistent",
      inspection: "complete",
    });
    expect(result.value.kernels).toHaveLength(1);
    expect(result.value.coverage.payloads).toBe("complete");
  },
);
it.each(["amdgcn", "amdgpu9.00"])(
  "does not choose between conflicting AMDGPU %s note and ELF processor identities",
  async (triple) => {
    const bytes = amdFixture(
      false,
      undefined,
      `${triple}-amd-amdhsa--gfx900:xnack+`,
    );
    bytes.writeUInt32LE(0x141, 48); // EF_AMDGPU_MACH gfx1100
    const result = await inspect(bytes);
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]).toMatchObject({
      target: null,
      target_consistency: "unknown",
      inspection: "partial",
    });
    expect(result.value.objects[0]!.limitations.join(" ")).toContain(
      "processor flags conflict with target note metadata",
    );
    expect(result.value.kernels).toHaveLength(1);
  },
);
it.each([
  "producer-specific-gpu-target",
  "amdgpu9.00-amd-amdhsa--gfx900:xnack",
])(
  "retains the unrecognized AMDGPU note target %s without substituting ELF processor flags",
  async (noteTarget) => {
    const result = await inspect(
      hipFixture(amdFixture(false, undefined, noteTarget)),
      { targets: ["gfx900"] },
    );
    if (!result.ok) throw result.error;
    const row = result.value.objects.find(({ kind }) => kind === "amdgpu");
    expect(row).toMatchObject({
      target: "gfx900",
      payload_target: noteTarget,
      target_consistency: "unknown",
      inspection: "complete",
    });
    expect(result.value.coverage.payloads).toBe("complete");
    expect(result.value.kernels).toMatchObject([
      { name: "add_one", parameter_bytes: 12, registers: { sgpr: 6, vgpr: 2 } },
    ]);
    expect(row?.limitations.join(" ")).not.toContain(
      "Conflicting target declarations",
    );
    expect(result.value.kernels[0]?.limitations.join(" ")).not.toContain(
      "Conflicting target declarations",
    );
  },
);
it("retains kernels from conflicting AMDGPU notes without choosing either note or ELF flags", async () => {
  const bytes = amdFixture(
    false,
    amdNoteFixture(false, "amdgcn-amd-amdhsa--gfx1100"),
  );
  const result = await inspect(bytes);
  if (!result.ok) throw result.error;
  expect(result.value.objects).toMatchObject([
    {
      kind: "amdgpu",
      target: null,
      payload_target: null,
      target_consistency: "unknown",
      inspection: "partial",
    },
  ]);
  expect(result.value.objects[0]?.limitations).toContain(
    "AMDGPU notes declare conflicting processor targets; processor identity is unknown",
  );
  expect(result.value.coverage).toMatchObject({
    discovery: "partial",
    payloads: "partial",
  });
  expect(result.value.kernels).toMatchObject([
    { name: "add_one", parameter_bytes: 12, registers: { sgpr: 6, vgpr: 2 } },
    { name: "add_one", parameter_bytes: 12, registers: { sgpr: 6, vgpr: 2 } },
  ]);
  expect(new Set(result.value.kernels.map(({ id }) => id)).size).toBe(2);
  const selected = await inspect(bytes, { targets: ["gfx900"] });
  if (!selected.ok) throw selected.error;
  expect(selected.value.objects[0]).toMatchObject({
    target: null,
    payload_target: null,
    target_consistency: "unknown",
    inspection: "not-selected",
  });
  expect(selected.value.kernels).toEqual([]);
});
it.each(
  [
    "amdgcn-amd-amdhsa-unknown-",
    "amdgpu9.00-amd-amdhsa--",
    "amdgpu9.00-amd-amdhsa-unknown-",
  ].flatMap((prefix) =>
    (
      [
        ["gfx900", "gfx900", "consistent"],
        ["gfx1100", "gfx900", "conflict"],
        ["gfx900", "gfx900:xnack+", "unknown"],
        ["gfx900", "gfx900+xnack", "unknown"],
        ["gfx900+xnack", "gfx900", "unknown"],
        ["GFX900", "gfx900", "unknown"],
        ["gfx900", "GFX900", "unknown"],
      ] as const
    ).map(([inventoryTarget, payloadTargetId, consistency]) => ({
      inventoryTarget,
      payloadTarget: `${prefix}${payloadTargetId}`,
      consistency,
    })),
  ),
)(
  "compares AMDGPU inventory $inventoryTarget with note $payloadTarget as $consistency",
  async ({ inventoryTarget, payloadTarget, consistency }) => {
    const bytes = hipFixture(
      amdFixture(false, undefined, payloadTarget),
      `hipv4-amdgcn-amd-amdhsa--${inventoryTarget}`,
    );
    const result = await inspect(bytes, { targets: [inventoryTarget] });
    if (!result.ok) throw result.error;
    const row = result.value.objects.find((value) => value.kind === "amdgpu")!;
    expect(row.payload_target).toBe(payloadTarget);
    expect(result.value.kernels).toHaveLength(1);
    if (consistency === "conflict") {
      expect(row).toMatchObject({
        target: inventoryTarget,
        target_consistency: "conflict",
        inspection: "partial",
      });
      expect(result.value.coverage.payloads).toBe("partial");
      expect(result.value.kernels[0]!.limitations.join(" ")).toContain(
        "Conflicting target declarations",
      );
    } else {
      expect(row).toMatchObject({
        target: inventoryTarget,
        target_consistency: consistency,
        inspection: "complete",
      });
      expect(result.value.coverage.payloads).toBe("complete");
      expect(result.value.kernels[0]!.limitations.join(" ")).not.toContain(
        "Conflicting target declarations",
      );
    }
  },
);
it.each([
  "hipv4-amdgcn-amd-amdhsa--gfx900",
  "hipv4-amdgcn-amd-amdhsa-gfx900",
  "hipv4-amdgcn-amd-amdhsa-opaque",
  "hipv4-amdgpu9.00-amd-amdhsa--gfx900",
])("keeps discovered HIP targets selectable for %s", async (targetId) => {
  const bytes = hipFixture(amdFixture(), targetId);
  const inventory = await inspect(bytes, { analysis: "inventory" });
  if (!inventory.ok) throw inventory.error;
  const row = inventory.value.objects.find((value) => value.kind === "amdgpu")!;
  expect(row.target).not.toBeNull();
  const selected = await inspect(bytes, { targets: [row.target!] });
  if (!selected.ok) throw selected.error;
  expect(selected.value.kernels).toHaveLength(1);
  expect(
    selected.value.objects.find((value) => value.kind === "amdgpu"),
  ).toMatchObject({
    target: row.target,
    payload_target: "amdgcn-amd-amdhsa--gfx900",
    target_consistency: targetId.endsWith("opaque")
      ? "single-source"
      : "consistent",
    inspection: "complete",
  });
});
it.each(["gfx11-generic", "gfx9-4-generic"] as const)(
  "preserves and exactly selects the generic AMDGPU processor %s",
  async (processor) => {
    const noteTarget = `amdgcn-amd-amdhsa--${processor}`;
    const payload = amdFixture(false, undefined, noteTarget);
    payload.writeUInt32LE(processor === "gfx11-generic" ? 0x54 : 0x5f, 48);
    const bytes = hipFixture(payload, `hipv4-amdgcn-amd-amdhsa--${processor}`);
    const result = await inspect(bytes, { targets: [processor] });
    if (!result.ok) throw result.error;
    expect(
      result.value.objects.find(({ kind }) => kind === "amdgpu"),
    ).toMatchObject({
      kind: "amdgpu",
      target: processor,
      payload_target: noteTarget,
      target_consistency: "consistent",
      inspection: "complete",
    });
    expect(result.value.kernels).toHaveLength(1);
  },
);
it("recognizes a modern AMDGPU triple inside compressed CCOB v3", async () => {
  const targetId = "hipv4-amdgpu9.00-amd-amdhsa--gfx900";
  const bytes = ccobFixture(3, "zstd", hipFixture(amdFixture(), targetId));
  const result = await inspect(bytes);
  if (!result.ok) throw result.error;
  expect(
    result.value.objects.find(({ bundle_id }) => bundle_id === targetId),
  ).toMatchObject({
    kind: "amdgpu",
    target: "gfx900",
    payload_target: "amdgcn-amd-amdhsa--gfx900",
    target_consistency: "consistent",
    inspection: "complete",
  });
  expect(result.value.kernels).toHaveLength(1);
});
it("bounds standalone AMD note discovery before retaining metadata", async () => {
  const result = await inspect(
    elfFixture(224, [
      { name: ".note", type: 7, bytes: Buffer.alloc(8 * 1024 * 1024 + 1) },
    ]),
    { analysis: "inventory" },
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]).toMatchObject({
    target: "gfx900",
    inspection: "capacity",
  });
  expect(result.value.objects[0]!.limitations).toContain(
    "AMDGPU ELF note discovery exceeds the 8 MiB retained metadata budget",
  );
  expect(result.value.kernels).toEqual([]);
});
it("reads PE raw-size fallback and ELF-host section locations", async () => {
  for (const bytes of [
    peGpuFixture(),
    elfFixture(62, [{ name: ".nv_fatbin", bytes: cudaFixture() }]),
  ]) {
    const result = await inspect(bytes);
    if (!result.ok) throw result.error;
    expect(result.value.kernels).toHaveLength(2);
    expect(result.value.objects[0]!.location.section_index).not.toBeNull();
    expect(result.value.objects[1]!.location.container_id).toBe(
      result.value.objects[0]!.id,
    );
  }
});
it("coalesces aliased CUDA metadata before expanding the temporary index", async () => {
  const bytes = cubinFixture({ globalRecords: 65536, globalAliases: 1024 });
  expect(bytes.length).toBeLessThan(1024 * 1024);
  const result = await inspect(bytes);
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]!.inspection).toBe("complete");
  expect(result.value.kernels).toHaveLength(1);
  expect(result.value.kernels[0]!.registers.physical).toBe(10);
});
it("retains unknown PTX virtual counts and partial payload coverage", async () => {
  const result = await inspect(
    Buffer.from(ptxFixture.replace("%r<9>", "r0, r1, %r<4>, %s<8>")),
  );
  if (!result.ok) throw result.error;
  expect(result.value.kernels[0]!.registers.virtual[0]).toEqual({
    type: ".b32",
    count: 14,
  });
  const unsupported = await inspect(
    Buffer.from(ptxFixture.replace("%r<9>", "%r[4]")),
  );
  if (!unsupported.ok) throw unsupported.error;
  expect(unsupported.value.objects[0]!.inspection).toBe("partial");
  expect(unsupported.value.coverage.payloads).toBe("partial");
  expect(unsupported.value.kernels[0]!.registers.virtual[0]).toEqual({
    type: ".b32",
    count: null,
  });
});
it.each(["spaced", "compact", "mixed"])(
  "counts %s PTX register keywords while retaining byte provenance",
  async (spacing) => {
    const directive = spacing === "spaced" ? ".reg " : ".reg";
    const header = ".version 8.8\n.target sm_80\n// GPU 寄存器 🎯\n";
    const entry = `.entry k() { ${directive}.b32 %r<4>; ${spacing === "mixed" ? ".reg " : directive}.b32 r0, r1, %r4; ${directive}.b64 %rd<2>; ret; }`;
    const source = header + entry;
    const result = await inspect(Buffer.from(source));
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]!.inspection).toBe("complete");
    expect(result.value.coverage.payloads).toBe("complete");
    expect(result.value.ptx_artifacts[0]!.text).toBe(source);
    const kernel = result.value.kernels[0]!;
    expect(kernel.registers.virtual).toEqual([
      { type: ".b32", count: 7 },
      { type: ".b64", count: 2 },
    ]);
    expect(kernel.location).toMatchObject({
      offset: Buffer.byteLength(header),
      size: Buffer.byteLength(entry),
    });
  },
);
it("keeps unsupported compact PTX register types partial", async () => {
  const result = await inspect(
    Buffer.from(ptxFixture.replace(".reg .b32", ".reg.v2.b32")),
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]!.inspection).toBe("partial");
  expect(result.value.coverage.payloads).toBe("partial");
  expect(result.value.kernels[0]!.registers.virtual).toEqual([
    { type: ".v2 .b32", count: null },
    { type: ".b64", count: 5 },
  ]);
});
it.each([64, 65])(
  "counts all %d scalar names in one PTX register list",
  async (count) => {
    const names = Array.from(
      { length: count },
      (_, index) => `%r${index}`,
    ).join(", ");
    const result = await inspect(
      Buffer.from(
        `.version 8.8\n.target sm_80\n.address_size 64\n.entry k() { .reg .b32 ${names}; ret; }\n`,
      ),
    );
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]!.inspection).toBe("complete");
    expect(result.value.coverage.payloads).toBe("complete");
    expect(result.value.kernels[0]!.registers.virtual).toEqual([
      { type: ".b32", count },
    ]);
  },
);
it("retains PTX kernels before and after a long scalar register list", async () => {
  const names = Array.from({ length: 65 }, (_, index) => `%r${index}`).join(
    ", ",
  );
  const result = await inspect(
    Buffer.from(
      `.version 8.8\n.target sm_80\n.address_size 64\n.entry before() { ret; }\n.entry affected() { .reg .b32 ${names}; ret; }\n.entry after() { ret; }\n`,
    ),
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]!.inspection).toBe("complete");
  expect(result.value.coverage.payloads).toBe("complete");
  expect(result.value.kernels.map((kernel) => kernel.name)).toEqual([
    "before",
    "affected",
    "after",
  ]);
  expect(result.value.kernels[1]!.registers.virtual).toEqual([
    { type: ".b32", count: 65 },
  ]);
});
it("retains later PTX kernels when a virtual register total overflows", async () => {
  const result = await inspect(
    Buffer.from(
      ".version 8.8\n.target sm_80\n.address_size 64\n.entry before() { ret; }\n.entry affected() { .reg .b32 %r<9007199254740991>, %s; ret; }\n.entry after() { ret; }\n",
    ),
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]!.inspection).toBe("partial");
  expect(result.value.coverage.payloads).toBe("partial");
  expect(result.value.kernels.map((kernel) => kernel.name)).toEqual([
    "before",
    "affected",
    "after",
  ]);
  expect(result.value.kernels[1]!.registers.virtual).toEqual([
    { type: ".b32", count: null },
  ]);
});
it.each([
  ".entry k { ret; }",
  ".entry k() { ret; }",
  ".entry k .maxntid 1 { ret; }",
])("inspects PTX entry with optional parameters: %s", async (entry) => {
  const result = await inspect(
    Buffer.from(`.version 7.0\n.target sm_80\n.address_size 64\n${entry}`),
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]!.inspection).toBe("complete");
  expect(result.value.coverage.payloads).toBe("complete");
  expect(result.value.kernels).toMatchObject([
    { name: "k", parameter_count: 0, parameter_bytes: 0, parameters: [] },
  ]);
});
it.each([
  ["parameter", ".u64 output", ".u64 .vendor_specific output"],
  ["shared", "scratch[32]", "scratch[]"],
] as const)(
  "marks unknown PTX %s declarations partial while retaining known facts",
  async (kind, from, to) => {
    const bytes = Buffer.from(ptxFixture.replace(from, to));
    const result = await inspect(bytes);
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]!.inspection).toBe("partial");
    expect(result.value.coverage.payloads).toBe("partial");
    expect(result.value.ptx_artifacts[0]!.text).toBe(bytes.toString());
    const kernel = result.value.kernels[0]!;
    expect(kernel.registers.virtual[0]).toEqual({ type: ".b32", count: 9 });
    expect(kernel.limitations.join(" ")).toContain(`PTX ${kind} declarations`);
    if (kind === "parameter") {
      expect(kernel.parameter_count).toBe(2);
      expect(kernel.parameter_bytes).toBeNull();
      expect(
        kernel.parameters.map(({ size, offset }) => [size, offset]),
      ).toEqual([
        [null, null],
        [4, null],
      ]);
      expect(kernel.shared_bytes).toBe(32);
    } else {
      expect(kernel.parameter_bytes).toBe(12);
      expect(kernel.shared_bytes).toBeNull();
    }
  },
);
it.each([
  ".ptr .global",
  ".ptr .global .align 16",
  ".ptr.global.align 16",
  ".ptr .global.align 16",
  ".ptr.global .align 16",
])(
  "keeps PTX pointer qualifiers %s complete through the provider",
  async (qualifiers) => {
    const bytes = Buffer.from(
      ptxFixture.replace(".u64 output", `.u64 ${qualifiers} output`),
    );
    const result = await inspect(bytes);
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]!.inspection).toBe("complete");
    expect(result.value.coverage.payloads).toBe("complete");
    expect(result.value.ptx_artifacts[0]!.text).toBe(bytes.toString());
    expect(result.value.kernels[0]).toMatchObject({
      parameter_count: 2,
      parameter_bytes: 12,
      parameters: [
        { name: "output", offset: 0, size: 8 },
        { name: "value", offset: 8, size: 4 },
      ],
    });
  },
);
it.each([".align 8 .b8", ".b8 .align 8"])(
  "retains PTX array parameter identity and layout with %s",
  async (type) => {
    const bytes = Buffer.from(
      ptxFixture.replace(".u64 output", `${type} payload[8]`),
    );
    const result = await inspect(bytes);
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]!.inspection).toBe("complete");
    expect(result.value.coverage.payloads).toBe("complete");
    expect(result.value.ptx_artifacts[0]!.text).toBe(bytes.toString());
    expect(result.value.kernels[0]).toMatchObject({
      parameter_count: 2,
      parameter_bytes: 12,
      parameters: [
        { name: "payload", type: ".b8", offset: 0, size: 8 },
        { name: "value", offset: 8, size: 4 },
      ],
    });
  },
);
it.each([".b8 .align 3", ".align 8 .b8 .align 8"])(
  "retains PTX names and partial layout for unsupported alignment %s",
  async (type) => {
    const bytes = Buffer.from(
      ptxFixture.replace(".u64 output", `${type} payload[8]`),
    );
    const result = await inspect(bytes);
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]!.inspection).toBe("partial");
    expect(result.value.coverage.payloads).toBe("partial");
    expect(result.value.kernels[0]).toMatchObject({
      parameter_count: 2,
      parameter_bytes: null,
      parameters: [
        { name: "payload", type: ".b8", offset: null, size: null },
        { name: "value", offset: null, size: 4 },
      ],
    });
  },
);
it.each(["whitespace", "comment"] as const)(
  "recognizes standalone PTX after more than 64 KiB of leading %s",
  async (kind) => {
    const prefix =
      kind === "whitespace"
        ? " ".repeat(70 * 1024)
        : `/*${"x".repeat(70 * 1024)}*/\n`;
    const bytes = Buffer.from(prefix + ptxFixture);
    const inventory = await inspect(bytes, { analysis: "inventory" });
    const selected = await inspect(bytes, { targets: ["sm_80"] });
    if (!inventory.ok) throw inventory.error;
    if (!selected.ok) throw selected.error;
    expect(inventory.value.objects[0]!.target).toBe("sm_80");
    expect(selected.value.kernels).toHaveLength(1);
    expect(selected.value.kernels[0]!.location.offset).toBeGreaterThan(
      64 * 1024,
    );
  },
);
it("uses a later module target when selecting standalone PTX", async () => {
  const bytes = Buffer.from(
    ".version 8.8\n.target sm_80\n.entry first() { ret; }\n.target sm_90\n",
  );
  const inventory = await inspect(bytes, { analysis: "inventory" });
  const selected = await inspect(bytes, { targets: ["sm_90"] });
  if (!inventory.ok) throw inventory.error;
  if (!selected.ok) throw selected.error;
  expect(inventory.value.objects[0]!.target).toBe("sm_90");
  expect(selected.value.kernels.map(({ name }) => name)).toEqual(["first"]);
});
it.each(["truncated", "invalid", "extension"] as const)(
  "retains earlier AMD kernel declarations after a later %s note",
  async (kind) => {
    const tail = Buffer.alloc(kind === "truncated" ? 3 : 24);
    if (kind !== "truncated") {
      tail.writeUInt32LE(7, 0);
      tail.writeUInt32LE(kind === "invalid" ? 1 : 3, 4);
      tail.writeUInt32LE(32, 8);
      tail.write("AMDGPU\0", 12);
      tail[20] = kind === "invalid" ? 0xc1 : 0xd4;
    }
    const payloadTarget = "amdgcn-amd-amdhsa--gfx900";
    for (const { bytes, target, consistency } of [
      {
        bytes: amdFixture(false, tail),
        target: payloadTarget,
        consistency: "single-source",
      },
      {
        bytes: hipFixture(amdFixture(false, tail)),
        target: "gfx900",
        consistency: "consistent",
      },
    ]) {
      const result = await inspect(bytes);
      if (!result.ok) throw result.error;
      expect(result.value.kernels).toHaveLength(1);
      expect(result.value.kernels[0]).toMatchObject({
        name: "add_one",
        parameter_bytes: 12,
        registers: { sgpr: 6, vgpr: 2 },
      });
      expect(
        result.value.objects.find((row) => row.kind === "amdgpu")!.inspection,
      ).toBe(kind === "extension" ? "unsupported" : "malformed");
      const identity = {
        target,
        payload_target: payloadTarget,
        target_consistency: consistency,
      };
      expect(
        result.value.objects.find((row) => row.kind === "amdgpu"),
      ).toMatchObject(identity);
      expect(result.value.coverage.payloads).toBe("partial");
      const selected = await inspect(bytes, { targets: [target] });
      if (!selected.ok) throw selected.error;
      expect(
        selected.value.objects.find((row) => row.kind === "amdgpu"),
      ).toMatchObject(identity);
      expect(selected.value.kernels).toEqual(result.value.kernels);
      expect(selected.value.coverage.payloads).toBe("partial");
      const skipped = await inspect(bytes, {
        targets: [target === "gfx900" ? payloadTarget : "gfx900"],
      });
      if (!skipped.ok) throw skipped.error;
      expect(
        skipped.value.objects.find((row) => row.kind === "amdgpu"),
      ).toMatchObject(
        target === payloadTarget
          ? {
              ...identity,
              inspection: kind === "extension" ? "unsupported" : "malformed",
            }
          : {
              target,
              payload_target: null,
              target_consistency: "unexamined",
              inspection: "not-selected",
            },
      );
      expect(skipped.value.kernels).toEqual([]);
    }
  },
);
it("bounds cumulative CUDA records across separate in-range metadata sections", async () => {
  const record = Buffer.from("042f0800010000000a000000", "hex"),
    records = Buffer.alloc(record.length * 131073);
  for (let offset = 0; offset < records.length; offset += record.length)
    record.copy(records, offset);
  const result = await inspect(
    elfFixture(190, [
      { name: ".nv.info", type: 0x70000000, bytes: records },
      { name: ".nv.info", type: 0x70000000, bytes: records },
    ]),
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects[0]!.inspection).toBe("capacity");
  expect(result.value.objects[0]!.limitations.join(" ")).toContain(
    "aggregate record/symbol visits",
  );
});
it.each(["section-names", "symbols"] as const)(
  "retains partial CUBIN coverage when %s are unavailable",
  async (missing) => {
    const bytes = cubinFixture();
    if (missing === "section-names") bytes.writeUInt16LE(0, 62);
    else bytes.writeUInt32LE(1, Number(bytes.readBigUInt64LE(40)) + 3 * 64 + 4);
    const result = await inspect(bytes);
    if (!result.ok) throw result.error;
    expect(result.value.objects[0]!.inspection).toBe("partial");
    expect(result.value.coverage.payloads).toBe("partial");
    expect(result.value.kernels).toHaveLength(missing === "symbols" ? 0 : 1);
    expect(result.value.objects[0]!.limitations.join(" ")).toContain(
      missing === "symbols"
        ? "kernel declaration coverage is unknown"
        : "named metadata coverage is partial",
    );
  },
);
it.each([9, 10])(
  "preserves parameters and register coverage for text count %d",
  async (textRegisters) => {
    const name = "kernel_" + "argument".repeat(64);
    const result = await inspect(
      cubinFixture({ name, textRegisters, globalRegisters: 10 }),
    );
    if (!result.ok) throw result.error;
    const conflict = textRegisters !== 10;
    expect(result.value.kernels[0]).toMatchObject({
      name,
      parameter_count: 2,
      registers: { physical: conflict ? null : 10 },
    });
    expect(result.value.objects[0]!.inspection).toBe(
      conflict ? "partial" : "complete",
    );
    expect(result.value.coverage.payloads).toBe(
      conflict ? "partial" : "complete",
    );
    expect(
      result.value.kernels[0]!.limitations.some((value) =>
        value.includes("Conflicting"),
      ),
    ).toBe(conflict);
  },
);
it("iterates flat concatenated fatbins beyond the genuine container nesting limit", async () => {
  const result = await inspect(
    Buffer.concat(Array.from({ length: 20 }, () => cudaFixture())),
  );
  if (!result.ok) throw result.error;
  expect(result.value.objects).toHaveLength(40);
  expect(result.value.kernels).toHaveLength(40);
  expect(result.value.coverage.discovery).toBe("complete");
});
it("reports checksum corruption and unknown compression as partial, retaining known entries", async () => {
  const corrupt = ccobFixture();
  corrupt[16] = corrupt[16]! ^ 1;
  const result = await inspect(corrupt);
  if (!result.ok) throw result.error;
  expect(result.value.coverage.discovery).toBe("partial");
  expect(result.value.objects[0]!.inspection).toBe("malformed");
  const unknown = ccobFixture();
  unknown.writeUInt16LE(99, 6);
  const unsupported = await inspect(unknown);
  if (!unsupported.ok) throw unsupported.error;
  expect(unsupported.value.objects[0]!.inspection).toBe("unsupported");
});
it("rejects out-of-range bundle entries without guessing a payload", async () => {
  const bytes = hipFixture();
  bytes.writeBigUInt64LE(BigInt(bytes.length + 1), 32);
  const result = await inspect(bytes);
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "BinaryTargetError" },
  });
});

it("preserves standalone PTX BOM and trailing NUL bytes in the retained text artifact", async () => {
  const bytes = Buffer.from("\uFEFF" + ptxFixture + "\0");
  const result = await inspect(bytes);
  if (!result.ok) throw result.error;
  expect(
    Buffer.compare(Buffer.from(result.value.ptx_artifacts[0]!.text), bytes),
  ).toBe(0);
  expect(result.value.ptx_artifacts[0]!.byte_length).toBe(bytes.length);
});
it("rejects a changed full-file identity before applying positional object selection", async () => {
  const bytes = cudaFixture();
  const result = await inspect(bytes, {
    expected_sha256: "0".repeat(64),
    object_ids: ["file@10"],
  });
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisArtifactChangedError" },
  });
});
it("iterates mixed plain/CCOB bundles without counting flat records as nesting", async () => {
  const records = Array.from({ length: 20 }, (_, index) =>
    index % 2 === 0 ? hipFixture() : ccobFixture(),
  );
  const result = await inspect(Buffer.concat(records));
  if (!result.ok) throw result.error;
  expect(result.value.kernels).toHaveLength(20);
  expect(result.value.coverage.discovery).toBe("complete");
});
it("does not recognize a CCOB signature after its first byte is corrupted", async () => {
  const bytes = ccobFixture(3, "zlib");
  bytes[0] = bytes[0]! | 0x80;
  const result = await inspect(bytes);
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisUnsupportedTargetError" },
  });
});
it("requires the PTX version directive before any module content", async () => {
  const result = await inspect(Buffer.from(`unexpected-prefix ${ptxFixture}`));
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisUnsupportedTargetError" },
  });
});
it("retains an embedded CCOB with a corrupted signature as unsupported", async () => {
  const bytes = ccobFixture(3, "zlib");
  bytes[0] = bytes[0]! | 0x80;
  const result = await inspect(
    elfFixture(62, [{ name: ".hip_fatbin", bytes }]),
  );
  if (!result.ok) throw result.error;
  expect(result.value.coverage.discovery).toBe("partial");
  expect(result.value.kernels).toEqual([]);
  expect(result.value.objects).toContainEqual(
    expect.objectContaining({
      kind: "native-section",
      inspection: "unsupported",
      limitations: expect.arrayContaining([
        "No supported CUDA/HIP container or PTX declarations were identified",
      ]),
    }),
  );
});
it.each([
  ["unknown COFF machine", 0xffff],
  ["x86 machine with a PE32+ optional header", 0x14c],
] as const)(
  "discovers PE GPU sections with %s",
  async (_description, machine) => {
    const bytes = peGpuFixture();
    const pe = bytes.readUInt32LE(60);
    bytes.writeUInt16LE(machine, pe + 4);
    const result = await inspect(bytes);
    if (!result.ok) throw result.error;
    expect(result.value.format).toBe("pe");
    expect(result.value.artifact.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(result.value.coverage).toMatchObject({
      discovery: "complete",
      payloads: "complete",
    });
    expect(result.value.kernels.map(({ name }) => name)).toEqual([
      "add_one",
      "add_one",
    ]);
    expect(result.value.ptx_artifacts[0]!.text).toBe(ptxFixture);
  },
);
it("does not dispatch a high-bit-corrupted DOS signature to the PE parser", async () => {
  const bytes = peGpuFixture(Buffer.from(ptxFixture));
  bytes[0] = bytes[0]! | 0x80;
  const result = await inspect(bytes);
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisUnsupportedTargetError" },
  });
});
it.each(["zlib", "zstd"] as const)(
  "uses each legacy CCOB v1 %s stream boundary across alignment padding",
  async (codec) => {
    const first = ccobFixture(1, codec),
      second = ccobFixture(2, "zlib"),
      padding = Buffer.alloc((8 - (first.length % 8)) % 8);
    const result = await inspect(Buffer.concat([first, padding, second]));
    if (!result.ok) throw result.error;
    const bundles = result.value.objects.filter(
      ({ kind }) => kind === "hip-bundle",
    );
    expect(bundles).toHaveLength(2);
    expect(
      bundles.map(({ inspection, decoded_size }) => [inspection, decoded_size]),
    ).toEqual([
      ["complete", expect.any(Number)],
      ["complete", expect.any(Number)],
    ]);
    expect(bundles[0]!.sha256).toBe(bundles[1]!.sha256);
    expect(bundles[0]!.encoded_size).toBe(first.length - 20);
    expect(bundles[0]!.location.size).toBe(first.length - 20);
    expect(bundles[1]!.metadata_location.offset).toBe(
      first.length + padding.length,
    );
    expect(result.value.kernels).toHaveLength(2);
    expect(result.value.coverage.discovery).toBe("complete");
  },
);
it("keeps a later CCOB bundle after a truncated legacy v1 stream", async () => {
  const truncated = ccobFixture(1, "zlib").subarray(0, -1),
    later = ccobFixture(2, "zlib");
  const result = await inspect(Buffer.concat([truncated, later]));
  if (!result.ok) throw result.error;
  const bundles = result.value.objects.filter(
    ({ kind }) => kind === "hip-bundle",
  );
  expect(bundles).toHaveLength(2);
  expect(bundles.map(({ inspection }) => inspection)).toEqual([
    "malformed",
    "complete",
  ]);
  expect(result.value.kernels).toHaveLength(1);
  expect(result.value.coverage.discovery).toBe("partial");
  expect(bundles[0]!.limitations.join(" ")).toContain(
    "uncertain recovery candidate",
  );
});
it.each(["checksum", "decoded-size"] as const)(
  "preserves a completed v1 codec extent after a bad %s declaration",
  async (declaration) => {
    const bundle = hipFixture(
        Buffer.from("ordinary CCOB marker"),
        "host-other",
      ),
      compressed = deflateSync(bundle, { level: 0 }),
      header = Buffer.from(ccobFixture(1, "zlib", bundle).subarray(0, 20));
    if (declaration === "checksum") header[12] = header[12]! ^ 1;
    else header.writeUInt32LE(bundle.length + 1, 8);
    const first = Buffer.concat([header, compressed]);
    const result = await inspect(
      Buffer.concat([first, ccobFixture(2, "zlib")]),
    );
    if (!result.ok) throw result.error;
    const wrappers = result.value.objects.filter(
      ({ kind }) => kind === "hip-bundle",
    );
    expect(wrappers.map(({ inspection }) => inspection)).toEqual([
      "malformed",
      "complete",
    ]);
    expect(wrappers[0]).toMatchObject({
      encoded_size: compressed.length,
      location: { size: compressed.length },
    });
    expect(wrappers[0]!.limitations.join(" ")).not.toContain("recovery");
    expect(wrappers[1]!.metadata_location.offset).toBe(first.length);
    expect(result.value.coverage.discovery).toBe("partial");
  },
);
it("continues at the declared CCOB boundary after an unsupported codec", async () => {
  const unknown = ccobFixture();
  unknown.writeUInt16LE(99, 6);
  const result = await inspect(Buffer.concat([unknown, ccobFixture()]));
  if (!result.ok) throw result.error;
  expect(result.value.kernels).toHaveLength(1);
  expect(result.value.coverage.discovery).toBe("partial");
});

it("refuses escaped PTX report expansion while preserving bounded interrupted facts", async () => {
  const text = ptxFixture + "\n//" + "\u0001".repeat(3 * 1024 * 1024);
  const result = await inspect(Buffer.from(text));
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError" },
  });
  if (result.ok) throw new Error("expected representation capacity refusal");
  const partial = gpuCodeObjectsPartialSchema.parse(
    parseEvidence(result.error.partialObservation).normalized_result,
  );
  expect(partial.ptx_artifacts).toEqual([]);
  expect(partial.objects).toHaveLength(1);
  expect(partial.artifact.sha256).toBeNull();
});
