import type { JsonValue } from "../jsonValue.js";

/** Wire-boundary controls; these do not establish real Ghidra behavior. */
export const compactReference = () => ({
  source_address: "0x401000",
  target_address: "0x402000",
  type: "COMPUTED_CALL",
  call: true,
  jump: false,
  indirect: false,
  computed: true,
  operand_index: 1,
  data: false,
  read: false,
  write: false,
  primary: false,
  provenance: "ghidra-reference-manager",
  source: "analysis",
});

export const compactInstruction = (references: JsonValue[] = []) => ({
  address: "0x401000",
  status: "decoded",
  procedure: "0x401000",
  architecture: "x86:LE:32:default",
  mode: "default",
  bytes: "ffd0",
  length: 2,
  mnemonic: "CALL",
  raw_disassembly: "CALL EAX",
  operands: [],
  flow: {
    kind: "call",
    conditional: false,
    computed: true,
    direct_destinations: [],
  },
  references,
  limitations: ["Static references do not establish runtime targets."],
});

export const compactCallTargets = (references: JsonValue[] = []) => ({
  call_site: "0x401000",
  procedure: "0x401000",
  status: references.length === 0 ? "unresolved" : "resolved-indirect",
  mechanism: "computed",
  targets:
    references.length === 0
      ? []
      : [
          {
            address: "0x402000",
            procedure: null,
            status: "resolved-indirect",
            basis: "provider-reference",
            references,
          },
        ],
  limitations: ["Static references do not establish runtime targets."],
});
