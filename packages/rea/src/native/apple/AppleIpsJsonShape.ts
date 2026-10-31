import type { InspectAppleIpsInput } from "../../domain/native/appleIps.js";
import {
  AppleIpsFormatFailure,
  AppleIpsResourceFailure,
  type AppleIpsFixedBoundary,
} from "./AppleIps.errors.js";
import {
  parseLosslessJson,
  LosslessJsonFailure,
  type JsonShape,
  type LosslessJson,
} from "./losslessJson.js";

/** IPS JSON is at most a handful of levels deep; deeper input is not a crash report shape. */
const MAX_IPS_JSON_DEPTH = 64;
/** Unlisted member names retained per documented object. */
const MAX_UNLISTED_KEYS = 1024;
/** termination.reasons entries; real reports carry a few. */
const MAX_TERMINATION_REASONS = 256;

const SCALAR: JsonShape = { kind: "scalar" };

const scalarMembers = (
  ...names: readonly string[]
): Record<string, JsonShape> =>
  Object.fromEntries(names.map((name) => [name, SCALAR]));

const fixedAllowance =
  (boundary: AppleIpsFixedBoundary, maximum: number, noun: string) =>
  (count: number) => {
    if (count > maximum)
      throw new AppleIpsResourceFailure(
        boundary,
        maximum,
        `Crash report lists more than ${String(maximum)} ${noun}`,
      );
  };

const unlistedKeys = fixedAllowance(
  "unlisted_keys",
  MAX_UNLISTED_KEYS,
  "unlisted keys in one object",
);

/** One running count per selected row collection, checked before each row. */
const selectedAllowances = (input: InspectAppleIpsInput) => {
  const counts = { threads: 0, frames: 0, images: 0, registers: 0 };
  const take =
    (boundary: keyof typeof counts, maximum: number, noun: string) => () => {
      counts[boundary] += 1;
      if (counts[boundary] > maximum)
        throw new AppleIpsResourceFailure(
          boundary,
          maximum,
          `Crash report lists more than ${String(maximum)} ${noun}, above the selected ${String(maximum)}-entry ${boundary} allowance`,
        );
    };
  return {
    threads: take("threads", input.max_threads, "threads"),
    frames: take("frames", input.max_frames, "frames"),
    images: take("images", input.max_images, "usedImages rows"),
    registers: take(
      "registers",
      input.max_registers,
      "threadState register slots",
    ),
  };
};

const threadShape = (
  take: ReturnType<typeof selectedAllowances>,
): JsonShape => {
  const register: JsonShape = {
    kind: "object",
    members: scalarMembers("value", "description"),
  };
  return {
    kind: "object",
    members: {
      ...scalarMembers("id", "triggered", "name", "queue"),
      frames: {
        kind: "array",
        items: {
          kind: "object",
          members: scalarMembers(
            "imageIndex",
            "imageOffset",
            "symbol",
            "symbolLocation",
            "inline",
          ),
        },
        beforeItem: take.frames,
      },
      threadState: {
        kind: "object",
        members: {
          flavor: SCALAR,
          x: { kind: "array", items: register, beforeItem: take.registers },
          // Rosetta-translated processes nest their translator registers.
          rosetta: {
            kind: "object",
            members: {},
            rest: register,
            beforeRest: take.registers,
          },
        },
        rest: register,
        beforeRest: take.registers,
      },
    },
  };
};

const terminationShape = (): JsonShape => {
  const reasonLimit = fixedAllowance(
    "termination_reasons",
    MAX_TERMINATION_REASONS,
    "termination reasons",
  );
  let reasons = 0;
  return {
    kind: "object",
    members: {
      ...scalarMembers(
        "namespace",
        "code",
        "indicator",
        "flags",
        "byPid",
        "byProc",
      ),
      reasons: {
        kind: "array",
        items: SCALAR,
        beforeItem: () => {
          reasons += 1;
          reasonLimit(reasons);
        },
      },
    },
    beforeUnlisted: unlistedKeys,
  };
};

/**
 * Projection of the documented IPS crash body. Budget callbacks fire before
 * each row is parsed, so selected allowances bound allocation rather than
 * output, and members the report does not interpret are never materialized.
 */
export const ipsBodyShape = (input: InspectAppleIpsInput): JsonShape => {
  const take = selectedAllowances(input);
  return {
    kind: "object",
    members: {
      ...scalarMembers(
        "procName",
        "procPath",
        "pid",
        "parentPid",
        "parentProc",
        "cpuType",
        "translated",
        "faultingThread",
      ),
      osVersion: {
        kind: "object",
        members: scalarMembers("train", "build", "releaseType", "isEmbedded"),
        beforeUnlisted: unlistedKeys,
      },
      exception: {
        kind: "object",
        members: scalarMembers("type", "signal", "subtype", "codes", "message"),
        beforeUnlisted: unlistedKeys,
      },
      termination: terminationShape(),
      threads: {
        kind: "array",
        items: threadShape(take),
        beforeItem: take.threads,
      },
      usedImages: {
        kind: "array",
        items: {
          kind: "object",
          members: scalarMembers(
            "source",
            "arch",
            "base",
            "size",
            "uuid",
            "name",
            "path",
          ),
        },
        beforeItem: take.images,
      },
    },
    beforeUnlisted: unlistedKeys,
  };
};

/** Projection of the first-line IPS metadata object. */
export const IPS_METADATA_SHAPE: JsonShape = {
  kind: "object",
  members: scalarMembers(
    "bug_type",
    "timestamp",
    "os_version",
    "bundleID",
    "incident_id",
    "name",
    "build_version",
    "platform",
  ),
  beforeUnlisted: unlistedKeys,
};

/** Parse one complete JSON value under a projection, mapping failures to IPS errors. */
export const consumeJson = (
  text: string,
  label: string,
  shape: JsonShape,
): LosslessJson => {
  try {
    const parsed = parseLosslessJson(text, 0, shape, {
      maxDepth: MAX_IPS_JSON_DEPTH,
    });
    if (!/^[\u0020\u0009\u000a\u000d]*$/u.test(text.slice(parsed.end)))
      throw new AppleIpsFormatFailure(
        "malformed",
        `${label} has trailing JSON text after the first complete value`,
      );
    return parsed.value;
  } catch (cause) {
    if (
      cause instanceof AppleIpsFormatFailure ||
      cause instanceof AppleIpsResourceFailure
    )
      throw cause;
    if (cause instanceof LosslessJsonFailure && cause.reason === "depth")
      throw new AppleIpsResourceFailure(
        "nesting",
        cause.maximum ?? MAX_IPS_JSON_DEPTH,
        `${label}: ${cause.message}`,
      );
    const message =
      cause instanceof LosslessJsonFailure ? cause.message : String(cause);
    throw new AppleIpsFormatFailure("malformed", `${label}: ${message}`);
  }
};
