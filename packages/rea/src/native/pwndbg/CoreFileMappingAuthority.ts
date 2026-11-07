import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import {
  isLinuxCoreNote,
  type RecordedCrash,
} from "../../domain/native/recordedCrash.js";
import { err, ok, type Result } from "../../domain/result.js";

/** Interpret source-bound ELF64 NT_FILE paths once, before GDB can open them. */
export function validateCoreFileMappingAuthority(
  report: RecordedCrash,
  snapshot: Buffer,
): Result<void, AnalysisCapabilityUnavailableError> {
  for (const note of report.notes) {
    if (!isLinuxCoreNote(note, 0x46494c45)) continue;
    const refuse = (reason: string) => {
      const message = `Core mapping note ${note.index} cannot be confined to the owned debugger sysroot: ${reason}.`;
      return err(
        new AnalysisCapabilityUnavailableError(
          "pwndbg-core",
          "inspect_recorded_crash",
          message,
          {
            userMessage: `${message} Omit include_debugger_context for basic recorded evidence.`,
            capturedOutput: report.decoder_diagnostics,
          },
        ),
      );
    };
    // The provider has already bound this range and note kind to the snapshot.
    const start = Number(BigInt(note.descriptor_location.offset));
    const bytes = snapshot.subarray(
      start,
      start + Number(BigInt(note.descriptor_location.bytes)),
    );
    if (bytes.length < 16) return refuse("missing mapping table header");
    const count = bytes.readBigUInt64LE(0);
    if (count > BigInt(Math.floor((bytes.length - 16) / 24)))
      return refuse("mapping count exceeds its descriptor");
    let position = 16 + Number(count) * 24;
    for (let index = 0; index < Number(count); index++) {
      const end = bytes.indexOf(0, position);
      if (end < 0) return refuse("unterminated mapping pathname");
      const path = bytes.subarray(position, end);
      // Inspect Unix path bytes without lossy UTF-8 decoding or host resolution.
      // Relative paths bypass GDB's sysroot; dot segments can escape its prefix.
      if (path[0] !== 0x2f) return refuse("mapping pathname is not absolute");
      let component = 0;
      for (let cursor = 0; cursor <= path.length; cursor++) {
        if (cursor !== path.length && path[cursor] !== 0x2f) continue;
        const length = cursor - component;
        if (
          (length === 1 && path[component] === 0x2e) ||
          (length === 2 &&
            path[component] === 0x2e &&
            path[component + 1] === 0x2e)
        )
          return refuse("mapping pathname contains a dot segment");
        component = cursor + 1;
      }
      position = end + 1;
    }
    if (bytes.subarray(position).some((byte) => byte !== 0))
      return refuse("mapping pathname coverage is unresolved");
  }
  return ok(undefined);
}
