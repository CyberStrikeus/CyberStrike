/** Typed failure from a pure PyInstaller parser before the reader adapts it. */
export interface PyInstallerFailure {
  readonly reason: "format" | "integrity" | "limit";
  readonly message: string;
}

export const pyInstallerFailure = (
  reason: PyInstallerFailure["reason"],
  message: string,
): PyInstallerFailure => ({ reason, message });
