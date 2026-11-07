import { GhidraAdmissionError } from "./GhidraAdmissionError.js";
import { createHash } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

import type { AnalysisOperation } from "../application/AnalysisProvider.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  readGhidraProfileArtifact,
  writeGhidraProfileArtifact,
  ghidraFileFailure,
} from "./GhidraFileArtifacts.js";
import { NonRegularFileReadError } from "../filesystem/RegularFile.js";
import { err, ok, type Result } from "../domain/result.js";

/** Seed file format admitted by this adapter. */
export const GHIDRA_SEED_FORMAT = "rea-ghidra-seeds-v1";
export const MAX_GHIDRA_SEED_BYTES = 32 * 1024 * 1024;
export const MAX_GHIDRA_SEED_ENTRIES = 1_000_000;
export const MAX_GHIDRA_SEED_NAME_LENGTH = 2000;

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.int().nonnegative();

/** Caller-declared seeds committed into the analysis profile before import. */
export const ghidraSeedCommitmentSchema = z.strictObject({
  format: z.literal(GHIDRA_SEED_FORMAT),
  path: z.string().refine(isAbsolute, "Seed path must be absolute"),
  configured_path: z.string().refine(isAbsolute, "Seed path must be absolute"),
  sha256: digest,
  entries: z.strictObject({ function: count, code: count, label: count }),
});
export type GhidraSeedCommitment = z.infer<typeof ghidraSeedCommitmentSchema>;

/** What the pre-analysis script applied, as reported by the bridge handshake. */
export const ghidraSeedReportSchema = z.strictObject({
  format: z.literal(GHIDRA_SEED_FORMAT),
  sha256: digest,
  entries: count,
  function_created: count,
  function_existing: count,
  function_failed: count,
  code_decoded: count,
  code_failed: count,
  label_applied: count,
  label_failed: count,
  unmapped: count,
});
export type GhidraSeedReport = z.infer<typeof ghidraSeedReportSchema>;

type SeedKind = "function" | "code" | "label";
interface SeedEntry {
  readonly address: bigint;
  readonly kind: SeedKind;
  readonly name?: string;
}

const seedLineError = (line: number, constraint: string) =>
  new ConfigurationError("Invalid REA environment configuration", {
    settings: [
      {
        setting: "REA_GHIDRA_SEED_FILE",
        constraint: `line ${line}: ${constraint}`,
      },
    ],
  });

/**
 * Parse `address<TAB>kind[<TAB>name]` lines. Blank lines and `#` comments are
 * ignored. Addresses are hexadecimal offsets in the default address space.
 */
export const parseGhidraSeeds = (
  text: string,
): Result<readonly SeedEntry[], ConfigurationError> => {
  const entries: SeedEntry[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "" || line.startsWith("#")) continue;
    const number = index + 1;
    const fields = line.split("\t");
    if (fields.length < 2 || fields.length > 3)
      return err(seedLineError(number, "expected address<TAB>kind[<TAB>name]"));
    const [address, kind, name] = fields;
    if (address === undefined || !/^0x[0-9a-fA-F]{1,16}$/u.test(address))
      return err(seedLineError(number, "address must be 0x-prefixed hex"));
    if (kind !== "function" && kind !== "code" && kind !== "label")
      return err(seedLineError(number, "kind must be function, code or label"));
    if (
      name !== undefined &&
      (name.length === 0 ||
        name.length > MAX_GHIDRA_SEED_NAME_LENGTH ||
        /[\s\0]/u.test(name))
    )
      return err(
        seedLineError(
          number,
          `name must be 1..${MAX_GHIDRA_SEED_NAME_LENGTH} characters without whitespace`,
        ),
      );
    if (kind === "label" && name === undefined)
      return err(seedLineError(number, "a label seed requires a name"));
    if (kind === "code" && name !== undefined)
      return err(
        seedLineError(number, "a code seed takes no name; add a label seed"),
      );
    const value = BigInt(address);
    const key = `${value.toString(16)}:${kind}`;
    if (seen.has(key))
      return err(seedLineError(number, `duplicate ${kind} seed at ${address}`));
    seen.add(key);
    entries.push({
      address: value,
      kind,
      ...(name === undefined ? {} : { name }),
    });
    if (entries.length > MAX_GHIDRA_SEED_ENTRIES)
      return err(
        seedLineError(
          number,
          `more than ${MAX_GHIDRA_SEED_ENTRIES} seed entries`,
        ),
      );
  }
  return ok(entries);
};

/** Canonical script input: lowercase addresses, fixed field order, LF endings. */
const normalizedSeeds = (entries: readonly SeedEntry[]): string =>
  entries
    .map(
      (entry) =>
        `0x${entry.address.toString(16)}\t${entry.kind}${entry.name === undefined ? "" : `\t${entry.name}`}\n`,
    )
    .join("");

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Parse seed facts before final close so later cleanup cannot replace invalid input. */
const readSeeds = (
  path: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<readonly SeedEntry[]> =>
  readGhidraProfileArtifact(
    path,
    MAX_GHIDRA_SEED_BYTES,
    resources,
    signal,
    (bytes) => {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw seedLineError(0, "file is not valid UTF-8");
      }
      const parsed = parseGhidraSeeds(text);
      if (!parsed.ok) throw parsed.error;
      return parsed.value;
    },
  );

/** Preserve native lookup semantics while allowing configured symbolic links. */
const resolveSeedPath = async (configured: string): Promise<string> => {
  // Darwin realpath may collapse file/.. even though native lookup rejects it.
  const selected = await stat(configured);
  if (!selected.isFile())
    throw new NonRegularFileReadError(configured, selected.isDirectory());
  return realpath(configured);
};

/** Resolve the configured seed file into an immutable profile commitment. */
export const resolveGhidraAnalysisSeeds = async (
  configured: string | undefined,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Result<GhidraSeedCommitment | undefined, AnalysisError>> =>
  resources
    .run(async () => {
      if (configured === undefined) return ok(undefined);
      let entries: readonly SeedEntry[];
      let path: string;
      try {
        path = await resolveSeedPath(configured);
        entries = await readSeeds(path, resources, signal);
      } catch (cause: unknown) {
        return err(
          ghidraFileFailure(cause, "resolve_analysis_profile", {
            setting: "REA_GHIDRA_SEED_FILE",
            path: configured,
          }),
        );
      }
      const normalized = normalizedSeeds(entries);
      const tally = { function: 0, code: 0, label: 0 };
      for (const entry of entries) tally[entry.kind] += 1;
      return ok<GhidraSeedCommitment>({
        format: GHIDRA_SEED_FORMAT,
        path,
        configured_path: configured,
        sha256: sha256(normalized),
        entries: tally,
      });
    })
    .catch((cause: unknown) =>
      err(
        ghidraFileFailure(cause, "resolve_analysis_profile", {
          setting: "REA_GHIDRA_SEED_FILE",
        }),
      ),
    );

/** Re-read the committed seeds and write the canonical copy the script applies. */
export const snapshotGhidraAnalysisSeeds = async (
  commitment: GhidraSeedCommitment,
  runtimeRoot: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<string> =>
  resources
    .run(async () => {
      ghidraSeedCommitmentSchema.parse(commitment);
      if (
        (await resolveSeedPath(commitment.configured_path)) !== commitment.path
      )
        throw new GhidraAdmissionError("seed_path_differs");
      const entries = await readSeeds(commitment.path, resources, signal);
      const normalized = normalizedSeeds(entries);
      if (sha256(normalized) !== commitment.sha256)
        throw new GhidraAdmissionError("seed_changed", {
          path: commitment.path,
        });
      const directory = join(runtimeRoot, "seeds");
      await mkdir(directory, { mode: 0o700 });
      const path = join(directory, "seeds.tsv");
      await writeGhidraProfileArtifact(path, normalized, resources, signal);
      return path;
    })
    .catch((cause: unknown) => {
      throw ghidraFileFailure(cause, "open_binary", {
        setting: "REA_GHIDRA_SEED_FILE",
        path: commitment.path,
      });
    });

const totalEntries = (commitment: GhidraSeedCommitment): number =>
  commitment.entries.function +
  commitment.entries.code +
  commitment.entries.label;

/** Fail closed when the session did not apply exactly the committed seeds. */
export const ghidraSeedFailure = (
  commitment: GhidraSeedCommitment | undefined,
  report: GhidraSeedReport | undefined,
  operation: AnalysisOperation,
): ProviderAdapterError | undefined => {
  if (commitment === undefined && report === undefined) return undefined;
  const reason =
    commitment === undefined
      ? "The Ghidra session reported analysis seeds that the profile did not commit."
      : report === undefined
        ? "The Ghidra session did not report the committed analysis seeds."
        : report.sha256 !== commitment.sha256 ||
            report.entries !== totalEntries(commitment)
          ? "The Ghidra session applied analysis seeds that differ from the committed profile."
          : undefined;
  return reason === undefined
    ? undefined
    : new ProviderAdapterError("ghidra", operation, {
        diagnostics: { reason },
      });
};

/** Session limitations that keep seeded facts distinct from Ghidra discoveries. */
export const ghidraSeedLimitations = (
  commitment: GhidraSeedCommitment | undefined,
  report?: GhidraSeedReport,
): readonly string[] =>
  commitment === undefined
    ? []
    : [
        `Ghidra analysis was seeded before auto-analysis from ${commitment.path} (sha256 ${commitment.sha256}: ${commitment.entries.function} function, ${commitment.entries.code} code, ${commitment.entries.label} label entries). Seeded functions, code and names are caller assertions, not Ghidra discoveries.`,
        ...(report === undefined
          ? []
          : [
              `Seed outcome: ${report.function_created} functions created, ${report.function_existing} already present, ${report.function_failed} failed; ${report.code_decoded} code seeds decoded, ${report.code_failed} failed; ${report.label_applied} labels applied, ${report.label_failed} failed; ${report.unmapped} seeds outside initialized memory.`,
            ]),
      ];
