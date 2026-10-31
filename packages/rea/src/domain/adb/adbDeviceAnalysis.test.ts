import { expect, it } from "vitest";

import { adbInputSchemas } from "./adbDeviceAnalysis.js";

it("preserves ADB key, action and component admission when making advertised patterns portable", () => {
  const serial = "emulator-5554";
  const variants = [
    {
      previous: /^[A-Za-z0-9._-]+$/u,
      max: 256,
      accepts: (key: string) =>
        adbInputSchemas.read_adb_setting.safeParse({
          serial,
          namespace: "global",
          key,
        }).success,
    },
    {
      previous: /^[A-Za-z0-9._-]+$/u,
      max: 256,
      accepts: (key: string) =>
        adbInputSchemas.start_adb_activity.safeParse({
          serial,
          action: "android.intent.action.VIEW",
          extras: [{ key, type: "string", value: "payload" }],
        }).success,
    },
    {
      previous: /^[A-Za-z][A-Za-z0-9._-]*$/u,
      max: 256,
      accepts: (action: string) =>
        adbInputSchemas.start_adb_activity.safeParse({ serial, action })
          .success,
    },
    {
      previous: /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._$-]*)?$/u,
      max: 512,
      accepts: (component: string) =>
        adbInputSchemas.start_adb_activity.safeParse({
          serial,
          action: "android.intent.action.VIEW",
          component,
        }).success,
    },
  ];
  const samples = [
    "",
    "screen_brightness",
    "0",
    "_",
    ".",
    "-",
    "android.intent.action.VIEW",
    "com.example/.MainActivity",
    "com.example/.Outer$InnerActivity",
    "com.example.Outer$InnerActivity",
    "com.example/",
    "com.example/a/b",
    "a\n",
    "a\r\n",
    "é",
    "aé",
    "a b",
    "a\\b",
    "a".repeat(256),
    "a".repeat(257),
    "a".repeat(512),
    "a".repeat(513),
  ];
  for (let code = 0; code < 128; code += 1) {
    const character = String.fromCharCode(code);
    samples.push(character, `a${character}`, `a${character}b`);
  }
  for (const variant of variants)
    for (const sample of samples)
      expect(
        variant.accepts(sample),
        JSON.stringify({ pattern: variant.previous.source, sample }),
      ).toBe(
        sample.length > 0 &&
          sample.length <= variant.max &&
          variant.previous.test(sample),
      );
});

it("admits empty string extras and validates typed extra text at domain admission", () => {
  const input = {
    serial: "emulator-5554",
    action: "android.intent.action.VIEW",
  };
  expect(
    adbInputSchemas.start_adb_activity.safeParse({
      ...input,
      extras: [{ key: "empty", type: "string", value: "" }],
    }).success,
  ).toBe(true);
  const accepted = [
    { type: "boolean", value: "false" },
    { type: "int", value: "-2147483648" },
    { type: "long", value: "9007199254740993" },
    { type: "float", value: "-1.25" },
    { type: "float", value: "1e-3" },
    { type: "float", value: "1E-3" },
    { type: "float", value: ".5" },
    { type: "float", value: "1." },
    { type: "float", value: "0x1.8p1" },
    { type: "float", value: "NaN" },
  ] as const;
  for (const { type, value } of accepted)
    expect(
      adbInputSchemas.start_adb_activity.safeParse({
        ...input,
        extras: [{ key: "value", type, value }],
      }).success,
      `${type}: ${value}`,
    ).toBe(true);
  const rejected = [
    { type: "boolean", value: "True" },
    { type: "int", value: "1.5" },
    { type: "long", value: "" },
    { type: "float", value: "garbage" },
    { type: "float", value: "0x1.8" },
  ] as const;
  for (const { type, value } of rejected) {
    const result = adbInputSchemas.start_adb_activity.safeParse({
      ...input,
      extras: [{ key: "value", type, value }],
    });
    expect(result.success, `${type}: ${value}`).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(["extras", 0, "value"]);
  }
  expect(
    adbInputSchemas.start_adb_activity.safeParse({
      ...input,
      extras: [{ key: "text", type: "string", value: "payload" }],
    }).success,
  ).toBe(true);
  expect(
    adbInputSchemas.start_adb_activity.safeParse({
      ...input,
      extras: [{ key: "text", type: "string", value: "x".repeat(2048) }],
    }).success,
  ).toBe(true);
  expect(
    adbInputSchemas.start_adb_activity.safeParse({
      ...input,
      extras: [{ key: "text", type: "string", value: "x".repeat(2049) }],
    }).success,
  ).toBe(false);
});
