import type { MipsReadelfFacts, MipsFloatAbi } from "./mips-checks.mjs";

export interface MipsRelocatableSection {
  index: number;
  name: string;
  type: string;
  offset: number;
  size: number;
  allocated: boolean;
}
export interface MipsRelocatableSymbol {
  index: number;
  value: number;
  type: string;
  ndx: string;
  name: string;
}
export interface MipsRelocation {
  section: string;
  offset: number;
  type: number;
  typeName: string;
  symbolIndex: number;
}
export interface MipsRelocatableFacts {
  sections: Map<number, MipsRelocatableSection>;
  symbols: Map<number, MipsRelocatableSymbol>;
  relocations: MipsRelocation[];
}
export interface MipsRelocationCoverage {
  types: Record<string, number>;
  shared_hi16: boolean;
  multiple_hi16: boolean;
  lo16_carry: boolean;
  external_code: boolean;
  external_data: boolean;
  unplaced: number;
}
export function parseMipsRelocatableReadelf(text: string): MipsRelocatableFacts;
export function inspectMipsRelocatableReadelf(
  path: string,
  byteOrder: string,
  floatAbi: MipsFloatAbi,
): Promise<
  MipsReadelfFacts & MipsRelocatableFacts & { command: string; version: string }
>;
export function assertMipsRelocations(input: {
  facts: MipsRelocatableFacts;
  fileBytes: Buffer;
  segments: readonly { name: string; start: string; end: string }[];
  mappings: readonly {
    block: string;
    start: string;
    length: number;
    file_offset: number | null;
  }[];
  ghidraRelocations: readonly {
    address: string;
    type: number;
    status: string;
  }[];
  words: Map<bigint, number>;
  names: readonly {
    address: string;
    value: string;
    symbol?: { external: boolean; type: string };
  }[];
  byteOrder: string;
}): MipsRelocationCoverage;
