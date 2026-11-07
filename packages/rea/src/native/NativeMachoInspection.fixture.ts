import {
  buildVersionCommand,
  dylibCommand,
  LC,
  machoImage,
  readerOf,
  segmentCommand,
} from "../artifacts/apple/MachoImage.fixture.js";
import { readMachoCommandNames } from "./MachoCommandNames.js";

/** Synthetic on-disk command records consumed by the production binary reader. */
export const inspectionImage = (
  options: {
    readonly uuids?: readonly string[];
    readonly fileType?: number;
    readonly commands?: readonly Uint8Array[];
  } = {},
) => {
  const build = buildVersionCommand(1);
  const buildView = new DataView(build.buffer);
  buildView.setUint32(12, 0x000d0000, true);
  buildView.setUint32(16, 0x000e0200, true);
  const segment = segmentCommand({
    name: "__TEXT",
    vmaddr: 0x100000000n,
    vmsize: 8192n,
  });
  new DataView(segment.buffer).setBigUint64(48, 8192n, true);
  const uuids = (options.uuids ?? ["01234567-89AB-CDEF-0123-456789ABCDEF"]).map(
    (uuid) => {
      const command = new Uint8Array(24);
      const view = new DataView(command.buffer);
      view.setUint32(0, 0x1b, true);
      view.setUint32(4, command.length, true);
      command.set(Buffer.from(uuid.replaceAll("-", ""), "hex"), 8);
      return command;
    },
  );
  return machoImage({
    ...(options.fileType === undefined ? {} : { fileType: options.fileType }),
    commands: options.commands ?? [
      segment,
      dylibCommand(LC.LOAD_DYLIB, "/usr/lib/libSystem.B.dylib"),
      build,
      ...uuids,
    ],
  });
};

export const inspectionReader =
  (image = inspectionImage()) =>
  () =>
    readMachoCommandNames(readerOf(image), image.length, 1024 * 1024, 10000);

/** Encryption facts for inspections whose assertions do not involve them. */
export const unreadEncryption = () =>
  Promise.resolve({
    status: "unread",
    reason: "not read in this test",
  } as const);
