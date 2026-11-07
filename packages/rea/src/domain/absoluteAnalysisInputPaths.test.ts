import { expect, it } from "vitest";
import { inspectGoBinaryInputSchema } from "./go/goBinary.js";
import { inspectRustBinaryRequestSchema } from "./rust/rustBinaryQuery.js";
import { inspectEvmInterfaceInputSchema } from "./evm/evmInterface.js";
import { inspectSqliteDatabaseInputSchema } from "./sqlite/sqliteDatabase.js";
import { inspectPeResourcesInputSchema } from "./native/peResources.js";
import { inspectElectronFusesInputSchema } from "./electron/electronFuses.js";
import { inspectPacketCaptureInputSchema } from "./captures/packetCapture.js";
import { decodeSignalRecordingInputSchema } from "./signals/signalRecording.js";

it.each([
  ["Go binary", inspectGoBinaryInputSchema],
  ["Rust binary", inspectRustBinaryRequestSchema],
  ["EVM interface", inspectEvmInterfaceInputSchema],
  ["SQLite database", inspectSqliteDatabaseInputSchema],
  ["PE resources", inspectPeResourcesInputSchema],
  ["Electron fuses", inspectElectronFusesInputSchema],
  ["packet capture", inspectPacketCaptureInputSchema],
  ["signal recording", decodeSignalRecordingInputSchema],
] as const)(
  "reports relative %s paths as a path format issue",
  (_name, schema) => {
    const parsed = schema.safeParse({ path: "relative/input" });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "invalid_format", path: ["path"] }),
        ]),
      );
  },
);
