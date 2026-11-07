import {
  MAX_GHIDRA_SEED_BYTES,
  MAX_GHIDRA_SEED_ENTRIES,
  MAX_GHIDRA_SEED_NAME_LENGTH,
} from "../ghidra/GhidraAnalysisSeeds.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
const OPERATION = "inspect_il2cpp_metadata";
const capacity = (
  message: string,
  allowance: string,
  kind: "bytes" | "count",
) =>
  new AnalysisResourceConstraintError(
    OPERATION,
    "capacity",
    message,
    {
      maximum_seed_bytes: MAX_GHIDRA_SEED_BYTES,
      maximum_seed_entries: MAX_GHIDRA_SEED_ENTRIES,
      maximum_seed_name_characters: MAX_GHIDRA_SEED_NAME_LENGTH,
    },
    fixedAllowanceOptions(allowance, kind),
  );
import type { Il2cppMetadata } from "../domain/il2cpp/il2cppMetadata.js";

/** A linked metadata report reduced to Ghidra function seeds. */
export interface Il2cppGhidraSeeds {
  /** `address<TAB>function<TAB>name` lines in the REA_GHIDRA_SEED_FILE format. */
  readonly text: string;
  readonly functions: number;
  /** Methods whose code address another method already seeded (identical code folding). */
  readonly folded: number;
  /** Each folded address with the name its function seed kept and the names it shares. */
  readonly folded_groups: readonly {
    readonly address: string;
    readonly kept: string;
    readonly also: readonly string[];
  }[];
  /** Methods without native code: abstract, interface, or generic definitions. */
  readonly without_address: number;
  readonly no_body: number;
  readonly unknown: number;
  /** Generic instance rows seeded or folded; null when the report did not link them. */
  readonly generic_instances: number | null;
  /** Generic instance rows left unseeded (no code or no name); null as above. */
  readonly generic_without_seed: number | null;
}

/**
 * Where Ghidra's default loaders place the binary: an ELF linked at 0 goes to
 * 0x100000, while Mach-O and PE images keep their link base.
 */
export const ghidraDefaultBase = (
  binary: NonNullable<Il2cppMetadata["binary"]>,
): bigint => {
  const linked = BigInt(binary.image_base);
  return binary.format === "elf" && linked === 0n ? 0x100000n : linked;
};

/** `Namespace.Outer.Inner` for a type, following declaring_type to the outermost type. */
const typeName = (report: Il2cppMetadata, index: number): string => {
  const parts: string[] = [];
  let namespace = "";
  const seen = new Set<number>();
  let length = 0;
  for (let at = index; at !== -1;) {
    if (seen.has(at))
      throw new AnalysisInputError(OPERATION, undefined, [
        {
          path: ["types", at],
          reason: "invalid_format",
          message: "Cyclic type ancestry cannot name a seed.",
        },
      ]);
    seen.add(at);
    const type = report.types[at];
    if (type === undefined)
      throw new AnalysisInputError(OPERATION, undefined, [
        {
          path: ["types", at],
          reason: "invalid_format",
          message: "Seed type owner is unavailable.",
        },
      ]);
    length += type.name.length + 1;
    if (length > MAX_GHIDRA_SEED_NAME_LENGTH)
      throw capacity(
        "Qualified seed type name exceeds the Ghidra name limit.",
        "The IL2CPP Ghidra seed-name allowance",
        "count",
      );
    parts.unshift(type.name);
    namespace = type.namespace;
    if (length + namespace.length > MAX_GHIDRA_SEED_NAME_LENGTH)
      throw capacity(
        "Qualified seed type name exceeds the Ghidra name limit.",
        "The IL2CPP Ghidra seed-name allowance",
        "count",
      );
    at = type.declaring_type;
  }
  return namespace === "" ? parts.join(".") : `${namespace}.${parts.join(".")}`;
};

/**
 * Name every linked method `Type$$Method`, the Il2CppDumper convention, at
 * `base + rva`. Whitespace becomes `_` because seed names cannot contain it.
 * The first method at an address names its function, since a seed file holds
 * one function seed per address. The other methods at that address are listed
 * in `#` comment lines after the seeds, so a reader of the file or the
 * decompilation can see that the kept name is one of several.
 */
export const il2cppGhidraSeeds = (
  report: Il2cppMetadata,
  base: bigint,
): Il2cppGhidraSeeds => {
  if (report.binary === null)
    throw new AnalysisInputError(OPERATION, undefined, [
      {
        path: ["binary_path"],
        reason: "invalid_value",
        message: "Ghidra seeds need a report linked with binary_path.",
      },
    ]);
  const seeded = new Map<bigint, { kept: string; also: string[] }>();
  const lines: string[] = [];
  let folded = 0;
  let withoutAddress = 0,
    noBody = 0,
    unknown = 0,
    bytes = 0;
  const typeNames = new Map<number, string>();
  const reserve = (length: number) => {
    if (length > MAX_GHIDRA_SEED_BYTES - bytes)
      throw capacity(
        "Seed file exceeds Ghidra byte admission.",
        "The IL2CPP Ghidra seed-file allowance",
        "bytes",
      );
    bytes += length;
  };
  const emit = (text: string) => {
    reserve(Buffer.byteLength(text));
    lines.push(text);
  };
  /** Seed `name` at base + rva, or fold it under the name already there. */
  const seed = (rva: string, raw: string, path: (string | number)[]) => {
    const address = base + BigInt(rva);
    if (address < 0n || address > 0xffffffffffffffffn)
      throw new AnalysisInputError(OPERATION, undefined, [
        {
          path: ["seed_base"],
          reason: "invalid_value",
          message: "Rebased seed address exceeds 64 bits.",
        },
      ]);
    if (raw.length > MAX_GHIDRA_SEED_NAME_LENGTH)
      throw capacity(
        "Qualified method seed name exceeds Ghidra character admission.",
        "The IL2CPP Ghidra seed-name allowance",
        "count",
      );
    const name = raw.replace(/\s/gu, "_");
    if (name.includes("\0"))
      throw new AnalysisInputError(OPERATION, undefined, [
        {
          path,
          reason: "invalid_format",
          message: "Seed names cannot contain NUL.",
        },
      ]);
    const group = seeded.get(address);
    if (group !== undefined) {
      folded++;
      if (group.also.length === 0)
        reserve(
          Buffer.byteLength(
            `# folded 0x${address.toString(16)} ${group.kept} also\n`,
          ),
        );
      reserve(Buffer.byteLength(` ${name}`));
      group.also.push(name);
      return;
    }
    seeded.set(address, { kept: name, also: [] });
    if (seeded.size > MAX_GHIDRA_SEED_ENTRIES)
      throw capacity(
        "Seed function count exceeds Ghidra entry admission.",
        "The IL2CPP Ghidra seed-entry allowance",
        "count",
      );
    emit(`0x${address.toString(16)}\tfunction\t${name}\n`);
  };
  report.methods.forEach((method, index) => {
    const rva = report.method_addresses[index]?.rva ?? null;
    if (rva === null) {
      withoutAddress++;
      if (report.method_addresses[index]?.state === "no-body") noBody++;
      else unknown++;
      return;
    }
    let ownerName = typeNames.get(method.declaring_type);
    if (ownerName === undefined) {
      ownerName = typeName(report, method.declaring_type);
      typeNames.set(method.declaring_type, ownerName);
    }
    if (ownerName.length + 2 + method.name.length > MAX_GHIDRA_SEED_NAME_LENGTH)
      throw capacity(
        "Qualified method seed name exceeds Ghidra character admission.",
        "The IL2CPP Ghidra seed-name allowance",
        "count",
      );
    seed(rva, `${ownerName}$$${method.name}`, ["methods", index, "name"]);
  });
  // Generic instances follow the definitions, so an instance sharing a
  // definition's code is folded under the definition's name.
  let genericInstances = 0,
    genericWithoutSeed = 0;
  report.generic_method_instances?.forEach((row, index) => {
    if (row.rva === null || row.name === null) {
      genericWithoutSeed++;
      return;
    }
    genericInstances++;
    seed(row.rva, row.name, ["generic_method_instances", index, "name"]);
  });
  const foldedGroups = [...seeded]
    .filter(([, group]) => group.also.length > 0)
    .map(([address, group]) => ({
      address: `0x${address.toString(16)}`,
      kept: group.kept,
      also: group.also,
    }));
  for (const group of foldedGroups) {
    lines.push(`# folded ${group.address} ${group.kept} also`);
    for (const name of group.also) lines.push(` ${name}`);
    lines.push("\n");
  }
  emit(
    `# metadata_sha256 ${report.artifact.sha256}\n# binary_sha256 ${report.binary.artifact.sha256}\n# link_base ${report.binary.image_base}\n# seed_base 0x${base.toString(16)}\n`,
  );
  return {
    text: lines.join(""),
    functions: seeded.size,
    folded,
    folded_groups: foldedGroups,
    without_address: withoutAddress,
    no_body: noBody,
    unknown,
    generic_instances:
      report.generic_method_instances == null ? null : genericInstances,
    generic_without_seed:
      report.generic_method_instances == null ? null : genericWithoutSeed,
  };
};
