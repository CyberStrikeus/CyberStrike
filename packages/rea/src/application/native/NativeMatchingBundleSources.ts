import { createHash } from "node:crypto";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { EvidenceBundle } from "../../domain/evidenceBundle.js";
import type { Evidence } from "../../domain/evidence.js";
import { readImmutableEvidence } from "../../domain/evidenceValidation.js";
import {
  EvidenceIntegrityError,
  EvidenceReferenceError,
} from "../../domain/evidenceErrors.js";
import { digestCanonicalValue } from "../../domain/canonicalDigest.js";
import { retainedEvidenceReferenceSchema } from "../../domain/evidenceReference.js";
import type { MatchNativeFunctionsInput } from "../../contracts/native/functionMatchingContracts.js";
import { readImmutableEvidenceBundle } from "../EvidenceBundleFiles.js";
import type { EvidenceLookup } from "../EvidenceInputResolver.js";
import type { NativeMatchingAdmission } from "./NativeMatchingAdmission.js";

import { nativeMatchingInputError } from "./NativeMatchingInputError.js";

interface SourceEntry {
  readonly file: number;
  readonly links: readonly string[];
}
interface Options {
  readonly input: MatchNativeFunctionsInput;
  readonly paths: readonly string[];
  readonly resources: ArtifactResourceScope;
  readonly admission: NativeMatchingAdmission;
}
const reference = (evidence_id: string) => ({
  kind: "retained-evidence" as const,
  evidence_id,
});
// IDs and links have authenticated ASCII digest syntax. Own these short strings
// independently of the discarded bundle's potentially large JSON backing store.
const ownId = (value: string): string =>
  Buffer.from(value, "ascii").toString("ascii");

/** IDs bind semantic payloads; subjects add the display metadata IDs intentionally omit. */
const recordSnapshot = async (
  bundle: EvidenceBundle,
  admission: NativeMatchingAdmission,
): Promise<string> => {
  const hash = createHash("sha256");
  for (const record of bundle.records) {
    await admission.checkpoint();
    hash
      .update(record.evidence_id)
      .update(digestCanonicalValue(record.subject));
  }
  return hash.digest("hex");
};

/** Index only graph metadata; keep at most the last whole bundle between passes. */
export const loadNativeMatchingBundleSources = async ({
  input,
  paths,
  resources,
  admission,
}: Options): Promise<{
  input: MatchNativeFunctionsInput;
  lookup: EvidenceLookup;
}> => {
  const records = new Map<string, Evidence>(),
    index = new Map<string, SourceEntry>();
  const rootIds: string[] = [];
  const selected: readonly (readonly [
    unknown,
    readonly (string | number)[],
  ])[] = [
    [input.left, ["left"]],
    [input.right, ["right"]],
    ...input.left_observations.map(
      (value, index) => [value, ["left_observations", index]] as const,
    ),
    ...input.right_observations.map(
      (value, index) => [value, ["right_observations", index]] as const,
    ),
  ];
  for (const [value, path] of selected) {
    const parsed = retainedEvidenceReferenceSchema.safeParse(value);
    if (parsed.success) rootIds.push(parsed.data.evidence_id);
    else {
      await admission.admit(value);
      const checked = readImmutableEvidence(value);
      if (!checked.ok)
        throw nativeMatchingInputError(
          value,
          path,
          admission.operation,
          checked.error,
        );
      const record = checked.value;
      rootIds.push(record.evidence_id);
      records.set(record.evidence_id, record);
      index.set(record.evidence_id, { file: -1, links: record.evidence_links });
    }
  }
  const snapshots: string[] = [];
  let last: { file: number; bundle: EvidenceBundle } | undefined;
  for (let file = 0; file < paths.length; file++) {
    last = undefined;
    const loaded = await readImmutableEvidenceBundle(
      paths[file]!,
      admission.signal,
      resources,
      admission.operation,
    );
    if (!loaded.ok) throw loaded.error;
    snapshots.push(await recordSnapshot(loaded.value, admission));
    for (const record of loaded.value.records) {
      await admission.checkpoint(
        256 +
          4 *
            (record.evidence_id.length +
              record.evidence_links.reduce((sum, id) => sum + id.length, 0)),
      );
      if (!index.has(record.evidence_id))
        index.set(ownId(record.evidence_id), {
          file,
          links: record.evidence_links.map(ownId),
        });
    }
    last = { file, bundle: loaded.value };
  }
  const needed = new Set<string>(rootIds),
    files = new Set<number>();
  // Set iteration includes newly discovered nodes. Shared ancestors and cycles
  // are visited once, independent of source-file and record ordering.
  for (const id of needed) {
    await admission.checkpoint(128);
    const entry = index.get(id);
    if (entry === undefined)
      throw new EvidenceReferenceError(id, "missing", {
        expected:
          "Complete Evidence closure in the supplied bundles or inline inputs",
        actual: null,
      });
    if (entry.file >= 0) files.add(entry.file);
    for (const linked of entry.links) needed.add(linked);
  }
  const retain = async (
    bundle: EvidenceBundle,
    file: number,
  ): Promise<void> => {
    for (const record of bundle.records)
      if (
        needed.has(record.evidence_id) &&
        index.get(record.evidence_id)?.file === file
      ) {
        await admission.admit(record);
        records.set(record.evidence_id, record);
      }
  };
  if (last !== undefined && files.has(last.file)) {
    await retain(last.bundle, last.file);
    files.delete(last.file);
  }
  last = undefined;
  for (const file of files) {
    const loaded = await readImmutableEvidenceBundle(
      paths[file]!,
      admission.signal,
      resources,
      admission.operation,
    );
    if (!loaded.ok) throw loaded.error;
    if ((await recordSnapshot(loaded.value, admission)) !== snapshots[file])
      throw new EvidenceIntegrityError(
        `Evidence bundle records changed during closure lookup: ${paths[file]}`,
      );
    await retain(loaded.value, file);
  }
  const left = rootIds[0]!,
    right = rootIds[1]!;
  const split = 2 + input.left_observations.length;
  return {
    input: {
      ...input,
      left: reference(left),
      right: reference(right),
      left_observations: rootIds.slice(2, split).map(reference),
      right_observations: rootIds.slice(split).map(reference),
    },
    lookup: (id) => records.get(id),
  };
};
