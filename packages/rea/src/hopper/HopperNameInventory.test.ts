import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../config/parseConfig.js";
import { ok } from "../domain/result.js";
import { silentLogger } from "../logger.js";
import { HopperClient } from "./HopperClient.js";
import { HopperProvider } from "./HopperProvider.js";

import { projectHopperNameInventory } from "./HopperNameInventory.js";

describe("Hopper name inventory labels", () => {
  it("tags stripped class-object labels without rewriting source values", () => {
    const value = [
      {
        address: "0x1",
        value: "__objc_class_HuntRoot_class",
        provider_metadata: { section: "__DATA,__objc_classrefs" },
      },
      {
        address: "0x2",
        value: "__objc_class_Hunt_class_class",
        provider_metadata: { section: "__DATA,__objc_classrefs" },
      },
      { address: "0x3", value: "_OBJC_CLASS_$_Unchanged" },
      { address: "0x4", value: "prefix__objc_class_Foreign_class" },
      { address: "0x5", value: "__objc_class__class" },
      { address: "0x6", value: "__objc_class_MissingSuffix" },
      { address: "0x7", value: "__objc_class_Extra_class_suffix" },
    ];

    expect(projectHopperNameInventory(value)).toEqual({
      changed: true,
      result: [
        {
          address: "0x1",
          value: "__objc_class_HuntRoot_class",
          provider_metadata: { section: "__DATA,__objc_classrefs" },
          objc_class_label: "hopper_legacy_class_object",
        },
        {
          address: "0x2",
          value: "__objc_class_Hunt_class_class",
          provider_metadata: { section: "__DATA,__objc_classrefs" },
          objc_class_label: "hopper_legacy_class_object",
        },
        value[2],
        value[3],
        value[4],
        value[5],
        value[6],
      ],
    });
  });

  it("replaces provider-supplied label tags with the Hopper-owned classification", () => {
    const value = [
      {
        address: "0x1",
        value: "__objc_class_HuntRoot_class",
        objc_class_label: "untrusted_other_label",
        provider_metadata: { ordinal: 3 },
      },
      {
        address: "0x2",
        value: "ordinary_name",
        objc_class_label: "hopper_legacy_class_object",
        provider_metadata: { ordinal: 4 },
      },
    ];

    expect(projectHopperNameInventory(value)).toEqual({
      changed: true,
      result: [
        {
          address: "0x1",
          value: "__objc_class_HuntRoot_class",
          objc_class_label: "hopper_legacy_class_object",
          provider_metadata: { ordinal: 3 },
        },
        {
          address: "0x2",
          value: "ordinary_name",
          provider_metadata: { ordinal: 4 },
        },
      ],
    });
  });

  it("leaves malformed provider inventories untouched for the consumer to reject", () => {
    const value = [{ address: 1, value: "__objc_class_HuntRoot_class" }];
    const original = structuredClone(value);
    expect(projectHopperNameInventory(value)).toEqual({
      result: original,
      changed: false,
    });
    expect(value).toEqual(original);
  });

  it("preserves source rows and the exact raw reply through the provider boundary", async () => {
    const config = parseConfig({});
    if (!config.ok) throw config.error;
    const source = [
      {
        address: "0x1",
        value: "__objc_class_HuntRoot_class",
        symbol: { primary: false, source: "imported" },
        provider_metadata: { section: "__DATA,__objc_classrefs" },
      },
      {
        address: "0x2",
        value: "ordinary_name",
        provider_metadata: { ordinal: 2 },
        objc_class_label: "hopper_legacy_class_object",
      },
    ];
    const originalSource = structuredClone(source);
    const callTool = vi
      .spyOn(HopperClient.prototype, "callTool")
      .mockResolvedValue(ok(source));
    const provider = new HopperProvider(
      config.value,
      silentLogger,
      {},
      "linux",
    );
    const client = provider.createClient({
      path: "/tmp/fixture.hop",
      sha256: "a".repeat(64),
      kind: "database",
      format: "analysis-database",
    });

    try {
      const result = await client.execute("list_names", {});
      expect(callTool).toHaveBeenCalledOnce();
      if (!result.ok) throw result.error;
      expect(result.value.result).toEqual([
        {
          ...originalSource[0],
          objc_class_label: "hopper_legacy_class_object",
        },
        {
          address: "0x2",
          value: "ordinary_name",
          provider_metadata: { ordinal: 2 },
        },
      ]);
      expect(result.value.rawResult).toEqual(originalSource);
      expect(source).toEqual(originalSource);
    } finally {
      try {
        await client.close();
      } finally {
        callTool.mockRestore();
      }
    }
  });
});
