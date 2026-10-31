import type { ElfFamilyMetadata } from "../../../src/domain/binaryTargetTypes.js";

export interface PowerPcReadelfFacts {
  powerpc: ElfFamilyMetadata;
  symbols: Record<
    | "rea_ppc_entry"
    | "rea_ppc_leaf"
    | "rea_ppc_probe"
    | "rea_ppc_global"
    | "rea_ppc_marker",
    string
  >;
}
export function parsePowerPcReadelf(text: string): PowerPcReadelfFacts;
export function inspectPowerPcReadelf(
  path: string,
): Promise<
  PowerPcReadelfFacts & { command: string; version: string; raw: string }
>;
export function assertPowerPcLoadedImage(
  observations: unknown,
  sha256: string,
): void;
export function assertPowerPcProbe(
  move: unknown,
  branch: unknown,
  address: string,
): void;
export function assertPowerPcGlobal(bytes: string): void;
