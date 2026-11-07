/** Require fixture verifiers on Windows to use the caller's ordinary-user token. */
export const assertOrdinaryWindowsVerifierCaller = (token) => {
  if (
    typeof token !== "object" ||
    token === null ||
    !("administrator" in token) ||
    !("elevated" in token) ||
    token.administrator !== false ||
    token.elevated !== false
  ) {
    const integrity =
      typeof token === "object" &&
      token !== null &&
      "integrityLevel" in token &&
      Number.isSafeInteger(token.integrityLevel)
        ? ` (integrity level ${String(token.integrityLevel)})`
        : "";
    throw new Error(
      "Windows browser verifier requires an ordinary, non-elevated user token" +
        `${integrity}. Rerun it from a standard-user Windows session; the verifier will not change caller authority.`,
    );
  }
};

/** Observe the native caller token before a Windows browser fixture allocates resources. */
export const requireOrdinaryWindowsVerifierCaller = async () => {
  if (process.platform !== "win32") return;
  let token;
  try {
    const { requireWindowsNativeAuthority } =
      await import("../../dist/windows/WindowsNativeLoader.js");
    token = requireWindowsNativeAuthority().call("process_caller_token", []);
  } catch (cause) {
    throw new Error(
      "Windows browser verifier could not observe its caller token; use the verified Windows x64 native artifact and rerun from a standard-user session.",
      { cause },
    );
  }
  assertOrdinaryWindowsVerifierCaller(token);
};
