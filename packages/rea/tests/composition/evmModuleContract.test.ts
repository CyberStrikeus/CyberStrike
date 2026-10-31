import { expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { evmInterfaceModule } from "../../src/composition/evm.js";
import { wasmArtifactModule } from "../../src/composition/wasm.js";
import { CLI_COMMANDS } from "../../src/cliCommandNames.js";
import { INSPECT_EVM_INTERFACE_CONTRACT } from "../../src/contracts/evm/evmToolContracts.js";

it("rejects incompatible static bindings through the complete project typecheck", () => {
  // expect-type's negative assertions are checked by tsc, not the runtime
  // test runner. No malformed descriptor is registered or executed here.
  expectTypeOf({
    ...evmInterfaceModule,
    contract: wasmArtifactModule.contract,
  }).not.toExtend<typeof evmInterfaceModule>();
  expectTypeOf({
    ...evmInterfaceModule,
    cliCommand: CLI_COMMANDS.inspectWasmArtifact,
  }).not.toExtend<typeof evmInterfaceModule>();
  expectTypeOf({
    ...evmInterfaceModule,
    create: wasmArtifactModule.create,
  }).not.toExtend<typeof evmInterfaceModule>();
  expectTypeOf({
    ...evmInterfaceModule,
    contract: {
      ...evmInterfaceModule.contract,
      inputSchema: z.strictObject({ unrelated: z.string() }),
    },
  }).not.toExtend<typeof evmInterfaceModule>();
  expectTypeOf({
    ...evmInterfaceModule,
    contract: {
      ...evmInterfaceModule.contract,
      outputSchema: z.strictObject({ unrelated: z.string() }),
    },
  }).not.toExtend<typeof evmInterfaceModule>();
});

it("keeps the named binding and gives each caller a separate lazy service owner", async () => {
  expect(evmInterfaceModule.contract).toBe(INSPECT_EVM_INTERFACE_CONTRACT);
  expect(evmInterfaceModule.cliCommand).toBe(CLI_COMMANDS.inspectEvmInterface);
  const first = evmInterfaceModule.create({});
  const second = evmInterfaceModule.create({});
  try {
    expect(first).not.toBe(second);
    expect(first.provider).not.toBe(second.provider);
    await first.close();
    const inspect = vi.spyOn(second.provider, "inspect");
    const invalid = await second.inspect({
      path: "relative.hex",
      encoding: "hex",
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
    expect(inspect).not.toHaveBeenCalled();
  } finally {
    await first.close();
    await second.close();
  }
});
