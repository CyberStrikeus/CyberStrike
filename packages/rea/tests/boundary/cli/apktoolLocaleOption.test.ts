import { expect, it } from "vitest";

import { invokeApktoolCli } from "../../support/cli/apktoolCli.js";

/**
 * Locales the apktool input owner admits. The owner's own rejection message
 * advertises `b+zh+Hans+CN`, so the CLI cannot be narrower than this list
 * without refusing a caller-selected locale the decoding lane supports.
 */
const OWNER_ADMITTED_LOCALES = [
  "de",
  "pt-BR",
  "pt-rBR",
  "zh-rCN",
  "en-419",
  "es-419",
  "en-001",
  "ar-015",
  "b+zh+Hans+CN",
  "b+sr+Latn+RS+REVISED",
  "b+fil+Latn+419+ABCDEFGH",
] as const;

it("forwards the table-only string choice through the CLI", async () => {
  const result = await invokeApktoolCli([
    "decode-android-resources",
    "/targets/app.apk",
    "--string-tables-only",
    "--locales",
    "de",
    "--json",
  ]);
  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.requests).toEqual([
    {
      operation: "decode_android_resources",
      input: {
        path: "/targets/app.apk",
        include_strings: true,
        locales: ["de"],
        string_tables_only: true,
      },
    },
  ]);
});

it("forwards every locale the apktool input owner admits", async () => {
  for (const locale of OWNER_ADMITTED_LOCALES) {
    const result = await invokeApktoolCli([
      "decode-android-resources",
      "/targets/app.apk",
      "--locale",
      locale,
      "--json",
    ]);

    expect(result.exitCode, `exit code for locale ${locale}`).toBe(0);
    expect(result.requests, `request for locale ${locale}`).toEqual([
      {
        operation: "decode_android_resources",
        input: { path: "/targets/app.apk", include_strings: true, locale },
      },
    ]);
  }
});

it("forwards repeated --locales to project multiple localized tables", async () => {
  const result = await invokeApktoolCli([
    "decode-android-resources",
    "/targets/app.apk",
    "--locales",
    "de",
    "--locales",
    "pt-BR",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.requests).toEqual([
    {
      operation: "decode_android_resources",
      input: {
        path: "/targets/app.apk",
        include_strings: true,
        locales: ["de", "pt-BR"],
      },
    },
  ]);
});

it.each(["not a locale", "en-r419", "es-r419"])(
  "refuses the invalid locale %s before invoking Apktool",
  async (locale) => {
    const result = await invokeApktoolCli([
      "decode-android-resources",
      "/targets/app.apk",
      "--locale",
      locale,
      "--json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.requests).toEqual([]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [expect.objectContaining({ path: "locale" })],
    });
  },
);

it("forwards --no-strings with --locale preserving caller options", async () => {
  const result = await invokeApktoolCli([
    "decode-android-resources",
    "/targets/app.apk",
    "--no-strings",
    "--locale",
    "de",
    "--json",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.requests).toEqual([
    {
      operation: "decode_android_resources",
      input: {
        path: "/targets/app.apk",
        include_strings: false,
        locale: "de",
      },
    },
  ]);
});
