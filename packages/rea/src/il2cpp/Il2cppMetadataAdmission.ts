import { jsonStringByteLength } from "../domain/jsonStringByteLength.js";
import type {
  Il2cppMetadataReadOptions,
  Il2cppMetadataRowCounts,
} from "./Il2cppMetadataFile.js";

// Minimum serialized row shapes; actual integer widths and the report envelope
// are checked exactly after decoding. This lower bound never refuses a fitting report.
const emptyRows = {
  images: { name: "", type_start: 0, type_count: 0 },
  types: {
    name: "",
    namespace: "",
    method_start: 0,
    method_count: 0,
    nested_type_start: 0,
    nested_type_count: 0,
    declaring_type: 0,
  },
  methods: { name: "", declaring_type: 0 },
  fields: { name: "", declaring_type: 0 },
  properties: { name: "", declaring_type: 0 },
  events: { name: "", declaring_type: 0 },
  parameters: { name: "", method: 0 },
  string_literals: { value: "", value_base64: null },
};

/**
 * Smallest serialized generic method instance row; checked against the
 * remaining budget for the whole genericMethodTable before any row resolves.
 */
export const IL2CPP_GENERIC_INSTANCE_MINIMUM_BYTES = JSON.stringify({
  state: "unknown",
  address: null,
  rva: null,
  method_spec: 0,
  method: 0,
  name: null,
}).length;

/** Per-snapshot admission, before text expansion and each retained fact. */
export const createIl2cppMetadataAdmission = (
  limit: number,
  exceed: () => never,
  linked = false,
): Required<Il2cppMetadataReadOptions> => {
  let used = 0;
  // Keys/decoded names/literal spans are immutable within this one decoder run.
  const lengths = new Map<string, number>();
  const text = (value: string): number => {
    const cached = lengths.get(value);
    if (cached !== undefined) return cached;
    const length = jsonStringByteLength(value, limit - used);
    lengths.set(value, length);
    return length;
  };
  return {
    beforeRows(counts: Il2cppMetadataRowCounts) {
      let minimum = 0;
      for (const key of Object.keys(emptyRows) as (keyof typeof emptyRows)[])
        minimum += counts[key] * JSON.stringify(emptyRows[key]).length;
      if (linked)
        minimum +=
          counts.methods *
            (JSON.stringify({ state: "code", address: null, rva: null })
              .length +
              JSON.stringify({ type: 0, name: "" }).length) +
          (counts.fields + counts.parameters) *
            JSON.stringify({ type: 0, name: "" }).length;
      if (minimum > limit) exceed();
    },
    beforeText(bytes) {
      if (bytes > limit - used) exceed();
    },
    onRow(row) {
      let bytes = 2,
        first = true;
      for (const [key, value] of Object.entries(row)) {
        bytes += (first ? 0 : 1) + text(key) + 1;
        first = false;
        bytes +=
          typeof value === "string" ? text(value) : value === null ? 4 : 1;
        if (used + bytes > limit) exceed();
      }
      used += bytes;
    },
  };
};
