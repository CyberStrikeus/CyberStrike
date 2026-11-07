import { createHash } from "node:crypto";
import { inspectPeCertificatesInputSchema } from "../../domain/native/peCertificates.js";
import { peCertificateFixture } from "../../native/pe/PeCertificates.fixture.js";
import { parsePeCertificates } from "../../native/pe/PeCertificateParser.js";
import { expect, it } from "vitest";
import { PeCertificatesService } from "./PeCertificatesService.js";
import { PE_CERTIFICATES_PROVIDER } from "../../domain/investigationProviders.js";
import type { PeCertificates } from "../../domain/native/peCertificates.js";
import { ok } from "../../domain/result.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";

const identity = PE_CERTIFICATES_PROVIDER;
const report: PeCertificates = {
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
};

it("rejects a relative path and extra arguments before reading", async () => {
  let calls = 0;
  const service = new PeCertificatesService({
    identity,
    inspect: () => {
      calls += 1;
      return Promise.resolve(ok(report));
    },
  });
  const relative = await service.inspect({ path: "app.exe" });
  const extra = await service.inspect({
    path: report.artifact.path,
    extra: true,
  });
  expect(relative.ok).toBe(false);
  expect(extra.ok).toBe(false);
  if (!relative.ok) expect(relative.error).toBeInstanceOf(AnalysisInputError);
  if (!extra.ok) expect(extra.error).toBeInstanceOf(AnalysisInputError);
  expect(calls).toBe(0);
});

it("discards an observation if the caller cancels while the provider completes", async () => {
  const controller = new AbortController();
  const service = new PeCertificatesService({
    identity,
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(report));
    },
  });
  const result = await service.inspect(
    { path: report.artifact.path },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisCancelledError);
});

it("retains complete certificate provenance from the production parser", async () => {
  const parsed = parsedCertificateReport();
  const result = await new PeCertificatesService({
    identity,
    inspect: () => Promise.resolve(ok(parsed)),
  }).inspect({ path: parsed.artifact.path });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.normalized_result).toEqual(parsed);
});

it.each([
  [
    "invented examined entry",
    (value: PeCertificates) => {
      value.coverage.examined_entries += 1;
    },
  ],
  [
    "entries without a table",
    (value: PeCertificates) => {
      value.table = null;
    },
  ],
  [
    "data directory outside the artifact",
    (value: PeCertificates) => {
      value.table!.data_directory_location.offset = value.artifact.bytes;
    },
  ],
  [
    "entry outside its table",
    (value: PeCertificates) => {
      value.entries[0]!.location.offset = 0;
    },
  ],
  [
    "payload outside its entry",
    (value: PeCertificates) => {
      value.entries[0]!.payload.location.offset = 0;
    },
  ],
  [
    "certificate outside its payload",
    (value: PeCertificates) => {
      value.entries[0]!.pkcs7!.certificates[0]!.location.offset = 0;
    },
  ],
  [
    "complete coverage with undecoded unsigned attributes",
    (value: PeCertificates) => {
      value.entries[0]!.pkcs7!.signers[0]!.unsigned_attribute_oids = [
        "1.3.6.1.4.1.311.3.3.1",
      ];
    },
  ],
] as const)(
  "rejects %s before creating observed Evidence",
  async (_label, mutate) => {
    const parsed = parsedCertificateReport();
    mutate(parsed);
    const result = await new PeCertificatesService({
      identity,
      inspect: () => Promise.resolve(ok(parsed)),
    }).inspect({ path: parsed.artifact.path });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
  },
);

function parsedCertificateReport(): PeCertificates {
  const bytes = peCertificateFixture(false);
  const input = inspectPeCertificatesInputSchema.parse({
    path: report.artifact.path,
  });
  return parsePeCertificates(
    bytes,
    {
      path: input.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    input,
  );
}
