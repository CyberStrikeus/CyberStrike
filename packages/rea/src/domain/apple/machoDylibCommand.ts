import type { MachoDependency } from "./dylibResolution.js";
import { err, ok, type Result } from "../result.js";
import {
  readMachoCommandStringBytes,
  type MachoCommandStringFailure,
} from "./machoLoadCommands.js";

const DEPENDENCY_COMMANDS: ReadonlyMap<number, MachoDependency["command"]> =
  new Map([
    [0xc, "LC_LOAD_DYLIB"],
    [0x80000018, "LC_LOAD_WEAK_DYLIB"],
    [0x8000001f, "LC_REEXPORT_DYLIB"],
    [0x20, "LC_LAZY_LOAD_DYLIB"],
    [0x80000023, "LC_LOAD_UPWARD_DYLIB"],
  ]);

/** Dependency order follows command order; LC_ID_DYLIB does not consume an ordinal. */
export const machoDependencyCommand = (code: number) =>
  DEPENDENCY_COMMANDS.get(code) ?? null;

interface MachoDylibCommandFacts {
  readonly encoding: "dylib_command" | "dylib_use_command";
  /** Classic commands have no flags field. Unknown modern bits remain source facts. */
  readonly flags: number | null;
  readonly currentVersion: number;
  readonly compatibilityVersion: number;
  readonly timestampOrMarker: number;
  readonly nameOffset: number;
  readonly nameBytes: Uint8Array;
}

/** Decode classic or marker-bearing dylib fields without imposing text or flag policy. */
export const readMachoDylibCommandFacts = (
  body: Uint8Array,
  littleEndian: boolean,
): Result<
  MachoDylibCommandFacts,
  | {
      readonly _tag: "InvalidMachoDylibCommand";
      readonly reason: "truncated-header";
    }
  | MachoCommandStringFailure
> => {
  if (body.byteLength < 24)
    return err({
      _tag: "InvalidMachoDylibCommand",
      reason: "truncated-header",
    });
  const name = readMachoCommandStringBytes(body, 24, littleEndian);
  if (!name.ok) return name;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const timestampOrMarker = view.getUint32(12, littleEndian);
  // Recognition already establishes the modern minimum name offset of 28.
  const usesFlags =
    name.value.offset === 28 &&
    body.byteLength >= 28 &&
    timestampOrMarker === 0x1a741800;
  return ok({
    encoding: usesFlags ? "dylib_use_command" : "dylib_command",
    flags: usesFlags ? view.getUint32(24, littleEndian) : null,
    currentVersion: view.getUint32(16, littleEndian),
    compatibilityVersion: view.getUint32(20, littleEndian),
    timestampOrMarker,
    nameOffset: name.value.offset,
    nameBytes: name.value.bytes,
  });
};
