/** Source-owned PE fixtures; these are encoded bytes, not compiled programs. */
/** @type {readonly ["x86_64", "x86", "arm", "arm64"]} */
export const WINDOWS_GHIDRA_FIXTURE_ARCHITECTURES = Object.freeze([
  "x86_64",
  "x86",
  "arm",
  "arm64",
]);

export const WINDOWS_GHIDRA_FIXTURE_FLAGS = Object.freeze([
  "--x86",
  "--arm",
  "--arm64",
  "--dll",
]);

/** Select one architecture without interpreting positional paths as flags. */
/** @param {readonly string[]} arguments_ */
export const windowsGhidraFixtureOptions = (arguments_) => {
  const selected = WINDOWS_GHIDRA_FIXTURE_ARCHITECTURES.filter(
    (architecture) =>
      architecture !== "x86_64" && arguments_.includes(`--${architecture}`),
  );
  if (selected.length > 1)
    throw new Error("Choose one Windows PE fixture architecture.");
  const architecture = selected[0] ?? "x86_64";
  const dll = arguments_.includes("--dll");
  const pe32 = architecture === "x86" || architecture === "arm";
  const imageBase = pe32 ? 0x400000n : 0x140000000n;
  const calleeRva = architecture.startsWith("arm") ? 0x1020 : 0x1010;
  return {
    architecture,
    dll,
    pe32,
    imageBase,
    calleeRva,
    machine: { x86: 0x14c, x86_64: 0x8664, arm: 0x1c4, arm64: 0xaa64 }[
      architecture
    ],
    filename: `rea-ghidra-windows${architecture === "x86_64" ? "" : `-${architecture}`}.${dll ? "dll" : "exe"}`,
    languageId:
      architecture === "arm"
        ? "ARM:LE:32:v8"
        : architecture === "arm64"
          ? "AARCH64:LE:64:v8A"
          : `x86:LE:${pe32 ? 32 : 64}:default`,
    callerAddress: `0x${(imageBase + 0x1000n).toString(16)}`,
    calleeAddress: `0x${(imageBase + BigInt(calleeRva)).toString(16)}`,
  };
};
