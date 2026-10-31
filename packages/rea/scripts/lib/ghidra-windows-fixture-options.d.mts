export const WINDOWS_GHIDRA_FIXTURE_ARCHITECTURES: readonly [
  "x86_64",
  "x86",
  "arm",
  "arm64",
];
export const WINDOWS_GHIDRA_FIXTURE_FLAGS: readonly string[];

/** Select one architecture without interpreting positional paths as flags. */
export function windowsGhidraFixtureOptions(arguments_: readonly string[]): {
  architecture: (typeof WINDOWS_GHIDRA_FIXTURE_ARCHITECTURES)[number];
  dll: boolean;
  pe32: boolean;
  imageBase: bigint;
  calleeRva: number;
  machine: number;
  filename: string;
  languageId: string;
  callerAddress: string;
  calleeAddress: string;
};
