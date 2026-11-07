import { expect, it } from "vitest";
import { inspectSignalDecodersInputSchema } from "../../../src/domain/signals/signalDecoders.js";
import { parseDecoderDiscovery } from "../../../src/signals/parseDecoderDiscovery.js";

it("rejects malformed catalogs and the wrong decoder identity", () => {
  for (const text of [
    "",
    "Supported protocol decoders:\n",
    "Supported protocol decoders:\n  uart UART\n  uart Duplicate",
    "Supported protocol decoders:\n  malformed",
  ]) {
    expect(() =>
      parseDecoderDiscovery(text, inspectSignalDecodersInputSchema.parse({})),
    ).toThrow();
  }
  expect(() =>
    parseDecoderDiscovery(
      "ID: spi\nOptions:",
      inspectSignalDecodersInputSchema.parse({ decoder: "uart" }),
    ),
  ).toThrow();
});

it("keeps help line ordinals, blank lines and literal special characters through selection", () => {
  const text = "ID: uart\r\nOptions:\r\n\r\n- mode: A[0] (default 'x')\r\n";
  const result = parseDecoderDiscovery(
    text,
    inspectSignalDecodersInputSchema.parse({
      decoder: "uart",
      query: "[0]",
      offset: 0,
      limit: 1,
    }),
  );
  expect(result.help_lines).toEqual([
    { line_number: 4, text: "- mode: A[0] (default 'x')" },
  ]);
  expect(result.output_window.examined).toBe(4);
});

it("bounds line expansion before constructing help records", () => {
  expect(() =>
    parseDecoderDiscovery(
      "ID: uart\n" + "\n".repeat(65536),
      inspectSignalDecodersInputSchema.parse({ decoder: "uart" }),
    ),
  ).toThrow("representation budget");
});
