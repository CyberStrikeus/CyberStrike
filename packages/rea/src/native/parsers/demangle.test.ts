import { describe, expect, it } from "vitest";

import { parseDemangledSymbols } from "./demangle.js";
import { swiftSymbolsSchema } from "../../contracts/native/nativeToolContracts.js";

describe("parseDemangledSymbols", () => {
  it("returns an empty array when given an empty input list", () => {
    expect(swiftSymbolsSchema.safeParse([]).success).toBe(true);
    expect(parseDemangledSymbols([], "")).toEqual([]);
    expect(parseDemangledSymbols([], "\n")).toEqual([]);
  });

  it("rejects demangler output when the input batch is empty", () => {
    expect(() => parseDemangledSymbols([], "unexpected\n")).toThrow(
      "swift-demangle emitted output for an empty input",
    );
  });

  it("parses demangled symbols successfully", () => {
    const inputs = ["$s4main4testyyF"];
    const output = "main.test() -> ()\n";
    expect(parseDemangledSymbols(inputs, output)).toEqual([
      {
        input: "$s4main4testyyF",
        output: "main.test() -> ()",
        status: "demangled",
      },
    ]);
  });

  it("identifies unchanged non-Swift symbols", () => {
    const inputs = ["_printf"];
    const output = "_printf\n";
    expect(parseDemangledSymbols(inputs, output)).toEqual([
      {
        input: "_printf",
        output: "_printf",
        status: "unchanged",
      },
    ]);
  });

  it("identifies invalid Swift symbols for every demangler mangling prefix", () => {
    const inputs = [
      "_T0Bogus",
      "$SBogus",
      "_$SBogus",
      "$sBogus",
      "_$sBogus",
      "@__swiftmacro_Bogus",
      "$eBogus",
      "_$eBogus",
      "_Tprintf",
    ];
    expect(
      parseDemangledSymbols(inputs, `${inputs.join("\n")}\n`).map(
        ({ status }) => status,
      ),
    ).toEqual([...Array<string>(8).fill("invalid"), "unchanged"]);
  });

  it("keeps the demangler's adjusted spelling of an undecoded name out of demangled", () => {
    const inputs = [
      "__T0Bogus",
      "__$sBogus",
      "___stack_chk_fail",
      "strlen",
      "Symbol",
      "entry",
      "__T04main3FooV",
      "s4main3FooV",
    ];
    const output = [
      "_T0Bogus",
      "_$sBogus",
      "__stack_chk_fail",
      "$strlen",
      "$Symbol",
      "$entry",
      "main.Foo",
      "main.Foo",
    ].join("\n");
    expect(parseDemangledSymbols(inputs, `${output}\n`)).toEqual([
      { input: "__T0Bogus", output: "_T0Bogus", status: "invalid" },
      { input: "__$sBogus", output: "_$sBogus", status: "invalid" },
      {
        input: "___stack_chk_fail",
        output: "__stack_chk_fail",
        status: "unchanged",
      },
      { input: "strlen", output: "$strlen", status: "unchanged" },
      { input: "Symbol", output: "$Symbol", status: "unchanged" },
      { input: "entry", output: "$entry", status: "unchanged" },
      { input: "__T04main3FooV", output: "main.Foo", status: "demangled" },
      { input: "s4main3FooV", output: "main.Foo", status: "demangled" },
    ]);
  });

  it("parses mixed batches preserving ordering", () => {
    const inputs = ["$s4main4testyyF", "_printf", "$sInvalidMangle"];
    const output = "main.test() -> ()\n_printf\n$sInvalidMangle\n";
    expect(parseDemangledSymbols(inputs, output)).toEqual([
      {
        input: "$s4main4testyyF",
        output: "main.test() -> ()",
        status: "demangled",
      },
      {
        input: "_printf",
        output: "_printf",
        status: "unchanged",
      },
      {
        input: "$sInvalidMangle",
        output: "$sInvalidMangle",
        status: "invalid",
      },
    ]);
  });

  it("throws TypeError when output count does not match input count", () => {
    expect(() =>
      parseDemangledSymbols(["sym1", "sym2"], "demangled1\n"),
    ).toThrow(TypeError);
    expect(() =>
      parseDemangledSymbols(["sym1"], "demangled1\ndemangled2\n"),
    ).toThrow("swift-demangle output count does not match input");
  });
});

describe("swift-demangle record correspondence", () => {
  it("retains skipped underscore inputs as invalid without claiming an empty demangling", () => {
    expect(parseDemangledSymbols(["_"], "")).toEqual([
      { input: "_", output: "", status: "invalid" },
    ]);
    expect(parseDemangledSymbols(["_", "_"], "")).toEqual([
      { input: "_", output: "", status: "invalid" },
      { input: "_", output: "", status: "invalid" },
    ]);
  });

  it("correlates real records around skipped inputs and preserves native spelling", () => {
    expect(
      parseDemangledSymbols(
        ["_", "$s4main3FooV", "_", "_Sa", "__"],
        "main.Foo\n_Sa\n_\n",
      ),
    ).toEqual([
      { input: "_", output: "", status: "invalid" },
      { input: "$s4main3FooV", output: "main.Foo", status: "demangled" },
      { input: "_", output: "", status: "invalid" },
      { input: "_Sa", output: "_Sa", status: "unchanged" },
      { input: "__", output: "_", status: "unchanged" },
    ]);
  });

  it("rejects missing, blank and excess records for non-skipped arguments", () => {
    expect(() => parseDemangledSymbols(["$s4main3FooV"], "")).toThrow(
      "output count does not match input",
    );
    expect(() => parseDemangledSymbols(["$s4main3FooV"], "\n")).toThrow(
      "omitted an output line",
    );
    expect(() => parseDemangledSymbols(["_"], "invented\n")).toThrow(
      "output count does not match input",
    );
  });
});
