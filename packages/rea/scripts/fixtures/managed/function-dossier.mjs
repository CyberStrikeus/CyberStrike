import { functionDossierSchema } from "../../../dist/domain/native/functionDossier.js";

/** Validated synthetic native observations shared by managed verification lanes. */
export const functionDossier = (name) =>
  functionDossierSchema.parse({
    procedure: {
      address: "0x401000",
      name,
      classification: {
        external: false,
        thunk: false,
        thunk_target: null,
        provenance: "synthetic-provider",
      },
      body: {
        available: false,
        reason: "Synthetic provider does not supply function body ranges.",
      },
      signature: null,
      locals: [],
    },
    pseudocode: "",
    assembly: [],
    comments: [],
    callers: [],
    callees: [],
    incoming_references: [],
    outgoing_references: [],
    referenced_strings: [],
    referenced_names: [],
    basic_blocks: [],
    native_api: null,
    native_value_flow: null,
    limitations: [],
  });
