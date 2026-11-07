import { expect, it } from "vitest";
import {
  androidLocaleDirectorySuffix,
  androidLocaleQualifierSchema,
  apktoolInputSchemas,
  classifyAndroidStringsTable,
  DEFAULT_APKTOOL_DECODE_TIMEOUT_MS,
  MAX_APKTOOL_DECODE_TIMEOUT_MS,
} from "./apktoolResourceAnalysis.js";

it.each([
  "de",
  "pt-rBR",
  "b+es+419",
  "b+en+001",
  "b+ar+015",
  "b+sr+Latn",
  "b+zh+Hans+CN",
  "b+sr+Latn+RS+REVISED",
  "b+fil+Latn+419+ABCDEFGH",
])("recognizes the exact selectable strings table values-%s", (suffix) => {
  expect(classifyAndroidStringsTable(suffix)).toEqual({
    kind: "locale",
    locale: suffix,
  });
});

it.each([
  "en-rUS-v21",
  "b+zh+Hans+CN-night",
  "pt-rBR-sw600dp",
  "mcc310-fr",
  "mcc310-mnc004-en-rUS-v21",
  "car",
  "night",
  "v21",
  "pt-BR",
  "en-419",
  "en-r419",
  "unknown_CONFIGURATION",
  "",
])(
  "preserves a non-selectable configuration suffix without inferring its locale: %s",
  (suffix) => {
    expect(classifyAndroidStringsTable(suffix)).toEqual({
      kind: "other",
      suffix,
    });
  },
);

it.each([
  ["pt-BR", "pt-rBR"],
  ["en-419", "b+en+419"],
  ["en-001", "b+en+001"],
  ["ar-015", "b+ar+015"],
  ["fil-419", "b+fil+419"],
  ["pt-rBR", "pt-rBR"],
  ["b+zh+Hans+CN", "b+zh+Hans+CN"],
])(
  "normalizes the request alias %s at the selection owner",
  (locale, suffix) => {
    expect(androidLocaleDirectorySuffix(locale)).toBe(suffix);
  },
);

it.each([
  "en-r419",
  "es-r419",
  "en-r001",
  "ar-r015",
  "b+fil+Latn+419+ABCDEFGH+US",
  "b+sr+Latn+RS+REVISED-v21",
  "../values-fr",
  "car",
  "night",
])(
  "refuses suffixes outside the bounded locale selection contract: %s",
  (suffix) => {
    expect(androidLocaleQualifierSchema.safeParse(suffix).success).toBe(false);
    expect(classifyAndroidStringsTable(suffix)).toEqual({
      kind: "other",
      suffix,
    });
  },
);

const decodeInput = apktoolInputSchemas.decode_android_resources;

it("keeps 600000 ms as the omitted apktool decode deadline", () => {
  const parsed = decodeInput.parse({ path: "/targets/app.apk" });
  expect(parsed).not.toHaveProperty("decode_timeout_ms");
  expect(DEFAULT_APKTOOL_DECODE_TIMEOUT_MS).toBe(600_000);
  expect(decodeInput.shape.decode_timeout_ms.description).toContain("600000");
  expect(decodeInput.shape.decode_timeout_ms.description).toContain(
    "next decode",
  );
});

it.each([1, 600_000, MAX_APKTOOL_DECODE_TIMEOUT_MS])(
  "accepts decode_timeout_ms %s",
  (decode_timeout_ms) => {
    expect(
      decodeInput.parse({ path: "/targets/app.apk", decode_timeout_ms }),
    ).toMatchObject({ decode_timeout_ms });
  },
);

it.each([0, -1, 1.5, MAX_APKTOOL_DECODE_TIMEOUT_MS + 1])(
  "rejects decode_timeout_ms %s",
  (decode_timeout_ms) => {
    expect(
      decodeInput.safeParse({ path: "/targets/app.apk", decode_timeout_ms })
        .success,
    ).toBe(false);
  },
);
