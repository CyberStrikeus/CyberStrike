export type RiscvWord =
  | number
  | "frame"
  | { readonly frame: readonly number[] };
export type RiscvAbiParameter = readonly [
  name: string,
  type: string,
  storage: string,
  words?: Readonly<Record<string, RiscvWord>>,
  literal?: string,
];
export const RISCV_ILP32_ABI: Readonly<
  Record<
    string,
    {
      readonly return: readonly [string, string];
      readonly parameters: readonly RiscvAbiParameter[];
      readonly variadic?: Readonly<Record<string, RiscvWord>>;
    }
  >
>;
export const RISCV_ILP32_CALLBACK: {
  readonly words: Readonly<Record<string, number>>;
  readonly literals: readonly string[];
};
export interface RiscvCallSite {
  readonly target: string | undefined;
  readonly words: Readonly<
    Record<string, { word?: number; stack?: number } | undefined>
  >;
  /** Caller memory at the call, by offset from the caller's incoming `sp`. */
  readonly memory: ReadonlyMap<number, { word?: number; stack?: number }>;
}
export function riscvStorageLocations(storage: string): readonly string[];
export function assertRiscvIlp32TableConsistent(): void;
export function parseRiscvCallSites(listing: string): readonly RiscvCallSite[];
export function inspectRiscvCallSites(path: string): Promise<{
  command: string;
  version: string | undefined;
  calls: readonly RiscvCallSite[];
}>;
export function assertRiscvIlp32CallSites(
  calls: readonly RiscvCallSite[],
): void;
export function assertRiscvIlp32Storage(
  boundaries: Record<string, unknown>,
  options?: { readonly stripped?: boolean },
): void;
export function assertRiscvIlp32Caller(
  pseudocode: string,
  addresses: Readonly<Record<string, string>>,
  options?: { readonly stripped?: boolean },
): void;
