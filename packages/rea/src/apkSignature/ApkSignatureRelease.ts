/** Identity of REA's in-process APK signature reader (no external engine, no device). */
export const APK_SIGNATURE_PROVIDER_IDENTITY = {
  id: "apk-signature",
  name: "REA APK signature reader",
  version: null,
} as const;

export const APK_SIGNATURE_LIMITS = {
  /** Pending requests retain no APK bytes; process-wide scans are serialized. */
  waitingScans: 8,
  /**
   * Whole-APK bounded read; the content digest needs the whole file. Above
   * Play's 200 MB APK ceiling with headroom for sideloaded/system APKs.
   */
  inputBytes: 512 * 1024 * 1024,
  /**
   * One v1 signature block (PKCS#7) after inflation. Real blocks hold a
   * certificate or a short chain (a few KiB); this bounds each inflation.
   */
  v1BlockBytes: 1024 * 1024,
  /** Inline result ceiling, projected before materialising and re-checked exactly; refused, not truncated. */
  outputBytes: 8 * 1024 * 1024,
} as const;
