import { relative, resolve, sep } from "node:path";

import { parse } from "plist";
import { z } from "zod";

const systemEntitySchema = z.object({
  "dev-entry": z.string().startsWith("/dev/"),
  "mount-point": z.string().optional(),
});

const attachOutputSchema = z.object({
  "system-entities": z.array(systemEntitySchema),
});

const infoOutputSchema = z.object({
  images: z.array(
    z.object({
      "image-path": z.string().optional(),
      "system-entities": z.array(systemEntitySchema),
    }),
  ),
});

/** Parsed hdiutil image inventory used to reconcile owned mount groups. */
export type NativeDmgInfo = z.output<typeof infoOutputSchema>;
/** Parsed hdiutil attach response used to detect unresolved new devices. */
export type NativeDmgAttachOutput = z.output<typeof attachOutputSchema>;

/** Parse hdiutil's current image inventory. */
export const parseNativeDmgInfo = (stdout: string): NativeDmgInfo =>
  infoOutputSchema.parse(parse(stdout));

/** Parse hdiutil's attach response while preserving device and mount facts. */
export const parseNativeDmgAttachOutput = (
  stdout: string,
): NativeDmgAttachOutput => attachOutputSchema.parse(parse(stdout));

/** Ownership result for one fresh hdiutil inventory. */
export type NativeDmgOwnership =
  | {
      readonly status: "owned";
      readonly devices: readonly string[];
      readonly source: "info" | "attach";
    }
  | { readonly status: "none" }
  | { readonly status: "unknown"; readonly reason: string };

/** Classify only fresh image groups tied to the exclusively owned mount root. */
export const resolveNativeDmgOwnership = (input: {
  readonly info: NativeDmgInfo;
  readonly attachOutput?: NativeDmgAttachOutput;
  readonly attachOutputReturned: boolean;
  readonly mountRoot: string;
  readonly baselineDevices: ReadonlySet<string>;
}): NativeDmgOwnership => {
  const rootedImages = input.info.images.filter((image) =>
    image["system-entities"].some(
      ({ "mount-point": mountPoint }) =>
        mountPoint !== undefined && isBelowRoot(input.mountRoot, mountPoint),
    ),
  );
  if (rootedImages.length > 1)
    return {
      status: "unknown",
      reason:
        "multiple hdiutil image groups report mounts beneath the owned root",
    };
  const rootedImage = rootedImages[0];
  if (rootedImage !== undefined) {
    const hasOutsideMount = rootedImage["system-entities"].some(
      ({ "mount-point": mountPoint }) =>
        mountPoint !== undefined && !isBelowRoot(input.mountRoot, mountPoint),
    );
    const groupDevices = rootedImage["system-entities"].map(
      ({ "dev-entry": device }) => device,
    );
    const devices = topLevelDevices(groupDevices);
    const overlapsBaseline = groupDevices.some((device) =>
      input.baselineDevices.has(device),
    );
    if (hasOutsideMount || overlapsBaseline || devices.length === 0)
      return {
        status: "unknown",
        reason: hasOutsideMount
          ? "the image group contains a mount outside the owned root"
          : overlapsBaseline
            ? "the image group includes a device present before attachment"
            : "the owned mount group contains no detachable device",
      };
    return { status: "owned", devices, source: "info" };
  }

  if (input.attachOutputReturned) {
    const attachOwnership = ownershipFromAttachOutput(
      input.attachOutput,
      input.mountRoot,
      input.baselineDevices,
    );
    if (attachOwnership.status === "owned") {
      return attachOwnership;
    }
    if (attachOwnership.status === "unknown") return attachOwnership;
  }

  const newlyListedDevice = input.info.images.some((image) =>
    image["system-entities"].some(
      ({ "dev-entry": device }) => !input.baselineDevices.has(device),
    ),
  );
  if (newlyListedDevice)
    return {
      status: "unknown",
      reason:
        "hdiutil lists devices absent from the pre-attach baseline, but none is tied uniquely to the owned root; ownership is unknown",
    };
  return { status: "none" };
};

const ownershipFromAttachOutput = (
  output: NativeDmgAttachOutput | undefined,
  mountRoot: string,
  baselineDevices: ReadonlySet<string>,
): NativeDmgOwnership => {
  if (output === undefined)
    return {
      status: "unknown",
      reason: "hdiutil attach succeeded but its ownership facts were malformed",
    };
  const entities = output["system-entities"];
  const hasRootMount = entities.some(
    ({ "mount-point": mountPoint }) =>
      mountPoint !== undefined && isBelowRoot(mountRoot, mountPoint),
  );
  const hasOutsideMount = entities.some(
    ({ "mount-point": mountPoint }) =>
      mountPoint !== undefined && !isBelowRoot(mountRoot, mountPoint),
  );
  const devices = entities.map(({ "dev-entry": device }) => device);
  const uniqueDevices = topLevelDevices(devices);
  const overlapsBaseline = devices.some((device) =>
    baselineDevices.has(device),
  );

  if (hasRootMount) {
    if (hasOutsideMount || overlapsBaseline || uniqueDevices.length === 0)
      return {
        status: "unknown",
        reason: hasOutsideMount
          ? "the attach result includes a mount outside the owned root"
          : overlapsBaseline
            ? "the attach result includes a device present before attachment"
            : "the attach result's owned mount has no detachable device",
      };
    return { status: "owned", devices: uniqueDevices, source: "attach" };
  }

  if (devices.length === 0)
    return {
      status: "unknown",
      reason:
        "hdiutil attach succeeded without reporting device ownership facts",
    };
  if (devices.some((device) => !baselineDevices.has(device)))
    return {
      status: "unknown",
      reason:
        "the attach result reports new devices without a mount beneath the owned root",
    };
  return { status: "none" };
};

const topLevelDevices = (devices: readonly string[]): string[] => {
  const unique = [...new Set(devices)];
  return unique.filter(
    (device) =>
      !unique.some(
        (parent) =>
          /^\/dev\/disk\d+$/u.test(parent) &&
          device.startsWith(`${parent}s`) &&
          /^\d+$/u.test(device.slice(parent.length + 1)),
      ),
  );
};

const isBelowRoot = (root: string, path: string): boolean => {
  const child = relative(root, resolve(path));
  return (
    child !== "" &&
    child !== "." &&
    child !== ".." &&
    !child.startsWith(`..${sep}`)
  );
};
