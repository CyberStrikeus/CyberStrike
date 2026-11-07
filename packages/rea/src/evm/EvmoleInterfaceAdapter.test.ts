import { expect, it } from "vitest";
import {
  evmoleInterfaceReplySchema,
  projectEvmoleFunctions,
} from "./EvmoleInterfaceAdapter.js";

it("preserves the actual producer keys, duplicates and unknown inference absence", () => {
  const raw = {
    functions: [
      { selector: "aabbccdd", bytecodeOffset: 1, dispatch: "abi" },
      {
        selector: "aabbccdd",
        bytecodeOffset: 2,
        dispatch: "fallback",
        arguments: "uint256",
        stateMutability: "view",
      },
    ],
  };
  const producer = evmoleInterfaceReplySchema.parse(raw);
  expect(projectEvmoleFunctions(producer)).toEqual([
    {
      selector: "0xaabbccdd",
      bytecode_offset: 1,
      dispatch: "abi",
      inferred_arguments: null,
      inferred_state_mutability: null,
    },
    {
      selector: "0xaabbccdd",
      bytecode_offset: 2,
      dispatch: "fallback",
      inferred_arguments: "uint256",
      inferred_state_mutability: "view",
    },
  ]);
  expect(producer).toEqual(raw);
  expect(projectEvmoleFunctions(evmoleInterfaceReplySchema.parse({}))).toEqual(
    [],
  );
});
it("admits reported metadata and the binding's disabled undefined facets", () => {
  const metadata = {
    bytecodeOffset: 1,
    cborLength: 4,
    entries: [
      { key: "reported", value: { type: "integer", value: 9007199254740992 } },
    ],
  };
  expect(
    evmoleInterfaceReplySchema.parse({ functions: [], metadata }).metadata,
  ).toEqual(metadata);
  expect(
    evmoleInterfaceReplySchema.parse({
      functions: [],
      storage: undefined,
      transientStorage: undefined,
      disassembled: undefined,
      basicBlocks: undefined,
      controlFlowGraph: undefined,
      metadata: undefined,
    }).functions,
  ).toEqual([]);
});
it.each([
  { storage: [] },
  { functions: [{ selector: "bad", bytecodeOffset: 0, dispatch: "abi" }] },
  {
    functions: [{ selector: "aabbccdd", bytecodeOffset: -1, dispatch: "abi" }],
  },
  { metadata: {} },
  {
    metadata: {
      bytecodeOffset: 1,
      cborLength: 4,
      entries: [{ key: "reported", value: { type: "integer", value: 1.5 } }],
    },
  },
])("rejects producer representations outside the selected profile", (raw) => {
  expect(() => evmoleInterfaceReplySchema.parse(raw)).toThrow();
});
