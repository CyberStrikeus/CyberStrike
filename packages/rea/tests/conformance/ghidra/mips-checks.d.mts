import type {
  MipsAbiFlags,
  MipsElfMetadata,
  MipsGnuAttributes,
} from "../../../src/domain/binaryTargetTypes.js";

import type { JsonValue } from "../../../src/domain/jsonValue.js";

export type MipsReadelfMetadata = MipsElfMetadata & {
  readonly abiFlags: MipsAbiFlags;
  readonly gnuAttributes: MipsGnuAttributes | null;
};
export function expectedMipsElfProfile(
  mips: MipsReadelfMetadata,
): Readonly<Record<string, JsonValue>>;

export type MipsFloatAbi = "hard" | "soft";
export interface MipsReadelfFacts {
  mips: MipsReadelfMetadata & { readonly gnuAttributes: null };
  symbols: Record<string, string>;
}
export function parseMipsReadelfSectionTypes(text: string): readonly string[];
export function parseMipsReadelf(
  text: string,
  byteOrder: string,
  floatAbi?: MipsFloatAbi,
  objectType?: "exec" | "rel",
): MipsReadelfFacts;
export function inspectMipsReadelf(
  path: string,
  byteOrder: string,
  floatAbi?: MipsFloatAbi,
): Promise<
  MipsReadelfFacts & { command: string; version: string; raw: string }
>;
export function assertMipsLoadedImage(
  observations: unknown,
  byteOrder: string,
  sha256: string,
): void;
export function assertMipsProbe(
  move: unknown,
  branch: unknown,
  byteOrder: string,
  address: string,
): void;
export function assertMipsGlobal(bytes: string, byteOrder: string): void;
export function carveMipsElfBeforeSectionTable(
  bytes: Buffer,
  byteOrder: string,
): { bytes: Buffer; sectionOffset: number; reason: string };
export function assertMipsCarvedTargetRefusal(
  error: unknown,
  path: string,
  reason: string,
): void;
export function assertMipsSoftFloatStorage(
  boundaries: Record<string, unknown>,
  byteOrder: string,
): void;
