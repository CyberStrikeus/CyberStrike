import { buildBinary } from "plist";
import {
  readBinaryPlistObjectOffset,
  readBinaryPlistObjectTableLayout,
} from "./binaryPlistObjectTable.js";

/** Authored UID-shaped dictionaries coexist with actual binary type-8 records. */
export const binaryKeyedArchiveUidShapes = (): Buffer => {
  // plist's builder treats a sole UID key as a typed record. Encode ordinary
  // dictionaries under same-width placeholder keys, then change only those
  // serialized string records; dictionary markers and references stay intact.
  const bytes = Buffer.from(
    buildBinary({
      $archiver: "NSKeyedArchiver",
      $objects: [
        "$null",
        {
          $class: { UID: 3 },
          ordinary: { raw: 2 },
          xmlConvention: { cf_uid: 2 },
          actual: { UID: 2 },
          shared: [{ UID: 2 }, { UID: 2 }],
        },
        { $class: { UID: 3 }, title: "Destination" },
        { $classname: "NSView", $classes: ["NSView", "NSObject"] },
      ],
      $top: { root: { UID: 1 } },
    }),
  );
  const table = readBinaryPlistObjectTableLayout(bytes);
  for (let id = 0; id < table.objectCount; id += 1) {
    const offset = readBinaryPlistObjectOffset(bytes, table, id);
    if (
      bytes[offset] === 0x53 &&
      bytes.toString("ascii", offset + 1, offset + 4) === "raw"
    )
      bytes.write("UID", offset + 1, "ascii");
    if (
      bytes[offset] === 0x56 &&
      bytes.toString("ascii", offset + 1, offset + 7) === "cf_uid"
    )
      bytes.write("CF$UID", offset + 1, "ascii");
  }
  return bytes;
};
