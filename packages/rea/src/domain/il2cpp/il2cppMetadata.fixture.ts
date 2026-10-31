import {
  IL2CPP_METADATA_SECTION_NAMES,
  type Il2cppMetadata,
} from "./il2cppMetadata.js";

/** Fresh empty facts for domain and application boundary tests. */
export const createEmptyIl2cppMetadataFixture = (): Il2cppMetadata => ({
  artifact: {
    path: "/artifacts/global-metadata.dat",
    sha256: "a".repeat(64),
    bytes: 1024,
  },
  magic: 0xfab11baf,
  metadata_version: 39,
  index_widths: {
    type_definition: 1,
    generic_container: 1,
    parameter: 1,
    type: 1,
    type_width_source: "interface-offsets-record",
  },
  sections: IL2CPP_METADATA_SECTION_NAMES.map((name) => ({
    name,
    offset: 380,
    size: 0,
    count: 0,
  })),
  images: [],
  types: [],
  methods: [],
  fields: [],
  properties: [],
  events: [],
  binary: null,
  method_addresses: [],
  return_types: [],
  field_types: [],
  parameter_types: [],
  generic_method_instances: null,
  parameters: [],
  string_literals: [],
  limitations: [],
});
