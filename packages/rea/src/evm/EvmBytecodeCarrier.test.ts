import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  decodeEvmBytecodeCarrier,
  EvmCarrierFailure,
} from "./EvmBytecodeCarrier.js";

it.each(["6000FF", "0x6000ff", " \t0X6000FF\r\n"])(
  "decodes explicit hex without changing selected bytes: %j",
  (text) => {
    expect(
      Buffer.from(decodeEvmBytecodeCarrier(Buffer.from(text), "hex")).toString(
        "hex",
      ),
    ).toBe("6000ff");
  },
);
it.each(["0x1", "60 00", "0xzz", "\uFEFF6000", "\u00a06000"])(
  "rejects malformed carrier rather than guessing bytecode: %j",
  (text) => {
    expect(() => decodeEvmBytecodeCarrier(Buffer.from(text), "hex")).toThrow(
      EvmCarrierFailure,
    );
  },
);
it("rejects a long interior separator run without pathological backtracking", async () => {
  const moduleUrl = new URL("./EvmBytecodeCarrier.ts", import.meta.url).href;
  const source = `
    import assert from "node:assert/strict";
    import { decodeEvmBytecodeCarrier, EvmCarrierFailure } from ${JSON.stringify(moduleUrl)};
    const text = "60" + " ".repeat(1_000_000) + "00";
    assert.throws(() => decodeEvmBytecodeCarrier(Buffer.from(text), "hex"), EvmCarrierFailure);
  `;
  await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      timeout: 15_000,
      killSignal: "SIGKILL",
    },
  );
}, 20_000);
it("distinguishes raw bytes, empty code and malformed UTF-8", () => {
  const bytes = Uint8Array.from([0xff, 0x00]);
  const decoded = decodeEvmBytecodeCarrier(bytes, "raw");
  expect(decoded).toEqual(bytes);
  expect(decoded).not.toBe(bytes);
  expect(() => decodeEvmBytecodeCarrier(bytes, "hex")).toThrow("valid UTF-8");
  expect(decodeEvmBytecodeCarrier(Buffer.from("0x"), "hex")).toEqual(
    new Uint8Array(),
  );
});
