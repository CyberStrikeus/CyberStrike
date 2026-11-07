import type { ObjdumpSelection } from "../domain/reverseEngineering.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

export const OBJDUMP_PROVIDER_IDENTITY = {
  id: "gnu.objdump",
  name: "GNU objdump",
  version: null,
} as const;

/** Build GNU objdump argv without invoking a shell or following DWARF links by default. */
export const objdumpCommand = (input: ObjdumpSelection): readonly string[] => {
  if (input.operation === "architectures") return ["-i"];
  const argumentsByOperation = {
    file_headers: ["-f"],
    section_headers: ["-h"],
    symbols: ["-t"],
    relocations: ["-r"],
    dwarf: ["-W", input.follow_debug_links ? "-WK" : "-WN"],
    disassemble:
      input.operation === "disassemble" && input.symbol !== undefined
        ? [`--disassemble=${input.symbol}`]
        : ["-d"],
    disassemble_all: ["-D"],
  } satisfies Record<typeof input.operation, readonly string[]>;
  return [
    ...argumentsByOperation[input.operation],
    absoluteCallerPath(input.path),
  ];
};
