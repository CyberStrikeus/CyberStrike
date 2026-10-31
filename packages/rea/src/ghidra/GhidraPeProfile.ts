import { jsonStringByteLength } from "../domain/jsonStringByteLength.js";
import type {
  BinaryTarget,
  PeCodeViewRecord,
} from "../domain/binaryTargetTypes.js";
import {
  ghidraPdbLimitations,
  type GhidraSessionInfo,
} from "./GhidraSessionValues.js";

const PDB_LOCATOR_INLINE_BYTE_BUDGET = 1024;

/** Establish equivalence only for the declared fields and recognized formats. */
const reportedPdbMatchesDeclaration = (
  declared: PeCodeViewRecord,
  reported: NonNullable<GhidraSessionInfo["pdb"]>,
): boolean => {
  if (
    reported.resource_limit?.omitted_attributes.some(
      (attribute) =>
        attribute === "file" || attribute === "guid" || attribute === "age",
    ) ||
    (reported.file !== declared.pdbPath &&
      reported.file !== declared.pdbFileName) ||
    reported.age === null ||
    !/^(?:0x)?[0-9a-f]+$/iu.test(reported.age) ||
    Number.parseInt(reported.age, 16) !== declared.age
  )
    return false;
  if (declared.guid === null) return reported.guid === null;
  if (reported.guid === null) return false;
  let guid = reported.guid;
  if (guid.startsWith("{") && guid.endsWith("}")) guid = guid.slice(1, -1);
  if (
    !/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu.test(
      guid,
    )
  )
    return false;
  return (
    guid.replaceAll("-", "").toLowerCase() ===
    declared.guid.replaceAll("-", "").toLowerCase()
  );
};

/** Measure JSON quotes, escapes and UTF-8 without allocating the encoded string. */
const pdbLocatorFitsInlineBudget = (value: string): boolean => {
  if (value.length * 6 + 2 <= PDB_LOCATOR_INLINE_BYTE_BUDGET) return true;
  if (value.length + 2 > PDB_LOCATOR_INLINE_BYTE_BUDGET) return false;
  return jsonStringByteLength(value) <= PDB_LOCATOR_INLINE_BYTE_BUDGET;
};

/** Use reported Program facts first, retaining declared PE facts as a fallback. */
export const ghidraPePdbLimitations = (
  target: BinaryTarget,
  pdb: GhidraSessionInfo["pdb"],
): readonly string[] => {
  if (target.format !== "pe") return [];
  const reported = ghidraPdbLimitations(pdb);
  if (
    target.codeView === undefined ||
    (pdb !== undefined && reportedPdbMatchesDeclaration(target.codeView, pdb))
  )
    return reported;
  const { pdbFileName, guid, age } = target.codeView;
  // Include JSON escaping in the inline budget before allocating that representation.
  const locator = pdbLocatorFitsInlineBudget(pdbFileName)
    ? JSON.stringify(pdbFileName)
    : `(declared locator omitted from this inline caveat: ${PDB_LOCATOR_INLINE_BYTE_BUDGET}-byte resource budget)`;
  const identity =
    guid === null
      ? `age (decimal) ${age}`
      : `GUID ${guid}, age (decimal) ${age}`;
  const state =
    pdb === undefined
      ? "Ghidra did not report PDB attributes; load state unknown"
      : pdb.loaded === false
        ? "Ghidra reports not loaded"
        : pdb.loaded === true
          ? "Ghidra reports a loaded PDB; this declared identity is not an independent matching-PDB attestation"
          : "Ghidra reports load state unknown";
  const comparison =
    pdb !== undefined &&
    [pdb.file, pdb.guid, pdb.age].some((value) => value !== null)
      ? " Reported and declared PDB observations are retained separately; equivalence is not established."
      : "";
  const declared = `The PE CodeView record references PDB ${locator} (${identity}); ${state}.${comparison} Original PDB names and types may be missing. Use list_procedures and address-based analysis to inspect recovered functions. REA does not admit a caller-selected PDB companion.`;
  return pdb === undefined ? [declared] : [...reported, declared];
};
