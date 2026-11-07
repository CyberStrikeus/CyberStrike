import { expect, it } from "vitest";
import { evmInterfaceSchema } from "./evmInterface.js";
import { evmInterfaceFixture } from "../../../tests/fixtures/evm/interface.js";

it("accepts historical metadata omission as an unknown facet without changing the source", () => {
  const value = evmInterfaceFixture();
  const { metadata: _metadata, ...oldBytecode } = value.bytecode;
  const old = { ...value, bytecode: oldBytecode };
  expect(evmInterfaceSchema.parse(old).bytecode.metadata).toBeNull();
  expect(old.bytecode).not.toHaveProperty("metadata");
});

it.each(["byte-count", "body-offset", "selector", "authenticity"])(
  "rejects false interface evidence: %s",
  (problem) => {
    const value = evmInterfaceFixture();
    const raw = {
      ...value,
      ...(problem === "authenticity"
        ? {
            bytecode: {
              ...value.bytecode,
              deployment_authenticity: "verified",
            },
          }
        : {}),
    };
    if (problem === "byte-count") raw.bytecode.bytes++;
    if (problem === "body-offset" || problem === "selector")
      raw.functions.push({
        selector: problem === "selector" ? "bad" : "0xaabbccdd",
        bytecode_offset: problem === "body-offset" ? 5 : 0,
        dispatch: "abi",
        inferred_arguments: null,
        inferred_state_mutability: null,
      });
    expect(evmInterfaceSchema.safeParse(raw).success).toBe(false);
  },
);
