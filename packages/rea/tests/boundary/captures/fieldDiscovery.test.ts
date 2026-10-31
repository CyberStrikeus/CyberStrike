import { expect, it } from "vitest";
import { inspectPacketFieldsInputSchema } from "../../../src/domain/captures/packetFields.js";
import { parseFieldDiscovery } from "../../../src/captures/parseFieldDiscovery.js";

it("keeps duplicate registrations and source ordinals instead of overwriting abbreviations", () => {
  const text =
    "P\tUSB\tusb\r\nF\tVendor\tusb.idVendor\tFT_UINT16\tusb\tBASE_HEX\t0x0\t\r\nF\tOther Vendor\tusb.idVendor\tFT_UINT32\tusb\tBASE_DEC\t0xff00\tSecond registration";
  const result = parseFieldDiscovery(
    text,
    inspectPacketFieldsInputSchema.parse({
      kind: "fields",
      query: "idVendor",
      offset: 1,
    }),
  );
  expect(result.records).toEqual([
    {
      source_line: 3,
      kind: "field",
      name: "Other Vendor",
      abbreviation: "usb.idVendor",
      field_type: "FT_UINT32",
      parent_protocol: "usb",
      display_base: "BASE_DEC",
      bitmask: "0xff00",
      description: "Second registration",
    },
  ]);
  expect(result.output_window).toEqual({
    examined: 2,
    matching: 2,
    returned: 1,
    has_more: false,
  });
});

it("rejects damaged records even outside the selected page", () => {
  for (const text of [
    "",
    "P\tmissing",
    "F\tname\tabbr",
    "P\tname\t",
    "P\tUSB\tusb\nBAD",
  ])
    expect(() =>
      parseFieldDiscovery(
        text,
        inspectPacketFieldsInputSchema.parse({ limit: 1 }),
      ),
    ).toThrow();
});

it("bounds explicit full-result expansion while allowing a page from the same large glossary", () => {
  const text = "P\t" + "Long name ".repeat(30) + "\tabbr\n";
  const glossary = text.repeat(6000);
  expect(() =>
    parseFieldDiscovery(
      glossary,
      inspectPacketFieldsInputSchema.parse({ limit: null }),
    ),
  ).toThrow("representation budget");
  const result = parseFieldDiscovery(
    glossary,
    inspectPacketFieldsInputSchema.parse({ offset: 5999, limit: 1 }),
  );
  expect(result.output_window).toEqual({
    examined: 6000,
    matching: 6000,
    returned: 1,
    has_more: false,
  });
});
