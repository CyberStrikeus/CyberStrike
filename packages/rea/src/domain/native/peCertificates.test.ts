import { expect, it } from "vitest";
import {
  inspectPeCertificatesInputSchema,
  peCertificateTypeName,
  peCertificatesSchema,
} from "./peCertificates.js";

it("maps WIN_CERTIFICATE type numbers without inventing unknown names", () => {
  expect(peCertificateTypeName(1)).toBe("x509");
  expect(peCertificateTypeName(2)).toBe("pkcs7");
  expect(peCertificateTypeName(3)).toBe("reserved");
  expect(peCertificateTypeName(4)).toBe("ts_stack_signed");
  expect(peCertificateTypeName(99)).toBe("unknown");
});

it("rejects a relative path in the advertised input schema", () => {
  const relative = inspectPeCertificatesInputSchema.safeParse({
    path: "app.exe",
  });
  expect(relative.success).toBe(false);
  if (relative.success) throw new Error("relative path was accepted");
  expect(relative.error.issues[0]?.message).toMatch(/absolute/u);
  expect(
    inspectPeCertificatesInputSchema.safeParse({
      path: "/artifacts/app.exe",
    }).success,
  ).toBe(true);
});

it("rejects extra caller arguments and admits an absent certificate table", () => {
  expect(
    inspectPeCertificatesInputSchema.safeParse({
      path: "/artifacts/app.exe",
      extra: true,
    }).success,
  ).toBe(false);
  const report = peCertificatesSchema.parse({
    artifact: {
      path: "/artifacts/app.exe",
      sha256: "a".repeat(64),
      bytes: 512,
    },
    format: "pe32",
    machine: 0x14c,
    table: null,
    entries: [],
    coverage: { status: "complete", examined_entries: 0, certificates: 0 },
    limitations: ["IMAGE_DIRECTORY_ENTRY_SECURITY is absent."],
  });
  expect(report.table).toBeNull();
  expect(report.entries).toEqual([]);
});
