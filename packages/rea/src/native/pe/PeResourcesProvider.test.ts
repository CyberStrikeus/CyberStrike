import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { redactExplicitFailure } from "../../domain/explicitSensitiveFailure.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  MAX_INSPECT_PE_DIRECTORY_ENTRIES,
  MAX_INSPECT_PE_FILE_BYTES,
  inspectPeResourcesInputSchema,
} from "../../domain/native/peResources.js";
import { kunaQueryFailureForCaller } from "../../kuna/KunaQueryErrors.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import {
  inputBudgetRemediation,
  PeResourcesProvider,
} from "./PeResourcesProvider.js";
import { peResourceFixture } from "./PeResources.fixture.js";

const inspect = async (
  path: string,
  input: {
    readonly max_file_bytes?: number;
    readonly max_entries?: number;
  } = {},
) => {
  const provider = new PeResourcesProvider();
  try {
    return await provider.inspect(
      inspectPeResourcesInputSchema.parse({ path, ...input }),
    );
  } finally {
    await provider.close();
  }
};

describe("PE resource provider budget reporting", () => {
  it("reports an input byte budget as a file-size bound", async () => {
    const root = await createTestTempDirectory("rea-pe-input-budget-");
    const path = join(root, "resource.exe");
    await writeFile(path, peResourceFixture().bytes);
    const result = await inspect(path, { max_file_bytes: 64 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a refusal");
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "file-size",
    });
    expect(result.error.message).toContain(
      "Selected artifact exceeds 64 bytes",
    );
    expect(
      (result.error as AnalysisResourceConstraintError).reportedLimits,
    ).toMatchObject({ max_file_bytes: 64 });
  });

  it("reports an entry budget as a capacity bound", async () => {
    const root = await createTestTempDirectory("rea-pe-entry-budget-");
    const path = join(root, "resource.exe");
    await writeFile(path, peResourceFixture().bytes);
    const result = await inspect(path, { max_entries: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a refusal");
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "capacity",
    });
    expect(result.error.message).toContain("entry budget exceeded");
  });

  it("reports a file-size budget without memory remediation advice", async () => {
    const root = await createTestTempDirectory("rea-pe-budget-advice-");
    const path = join(root, "resource.exe");
    await writeFile(path, peResourceFixture().bytes);
    const result = await inspect(path, { max_file_bytes: 64 });
    if (result.ok) throw new Error("Expected a refusal");
    const error = result.error as AnalysisResourceConstraintError;
    expect(error.resource).toBe("file-size");
    expect(error.remediationAction).toContain("max_file_bytes");
    expect(error.retryable).toBe(false);
    // The projected advice must not send the caller to worker write limits.
    expect(projectAnalysisError(error)).toMatchObject({
      retryable: false,
      remediation: { action: expect.stringContaining("max_file_bytes") },
    });
  });

  it("keeps an entry budget refusal non-retryable with its own advice", async () => {
    const root = await createTestTempDirectory("rea-pe-entry-advice-");
    const path = join(root, "resource.exe");
    await writeFile(path, peResourceFixture().bytes);
    const result = await inspect(path, { max_entries: 1 });
    if (result.ok) throw new Error("Expected a refusal");
    const error = result.error as AnalysisResourceConstraintError;
    expect(error.resource).toBe("capacity");
    expect(error.remediationAction).toContain("max_entries");
    expect(projectAnalysisError(error)).toMatchObject({
      retryable: false,
      remediation: { action: expect.stringContaining("max_entries") },
    });
  });

  it("keeps the boundary when a cleanup failure wraps the limit", () => {
    // A file that grows past its byte limit while its handle also fails to
    // close reaches the provider through withCleanup.
    const wrapped = ArtifactReaderFailure.withCleanup(
      new ArtifactReaderFailure("limit", "Selected artifact exceeds 64 bytes", {
        boundary: "file-size",
      }),
      { reason: "close failed", resources: ["handle"] },
    );
    expect(wrapped.boundary).toBe("file-size");
  });

  it("names the ceiling instead of an impossible bound at the schema maxima", () => {
    const base = { path: "/artifacts/application.exe" };
    expect(
      inputBudgetRemediation("file-size", {
        ...base,
        max_file_bytes: MAX_INSPECT_PE_FILE_BYTES,
        max_entries: 16384,
      }),
    ).toContain("input ceiling");
    expect(
      inputBudgetRemediation("capacity", {
        ...base,
        max_file_bytes: 67108864,
        max_entries: MAX_INSPECT_PE_DIRECTORY_ENTRIES,
      }),
    ).toContain("resource-directory ceiling");
    // Below the ceiling the advice still names the bound the caller raises.
    expect(
      inputBudgetRemediation("file-size", {
        ...base,
        max_file_bytes: 64,
        max_entries: 16384,
      }),
    ).toContain("Raise max_file_bytes above 64");
    expect(
      inputBudgetRemediation("capacity", {
        ...base,
        max_file_bytes: 67108864,
        max_entries: 1,
      }),
    ).toContain("Raise max_entries above 1");
  });

  it("preserves retryability through failure redaction and caller copies", async () => {
    const source = new AnalysisResourceConstraintError(
      "inspect_pe_resources",
      "file-size",
      "Selected artifact exceeds 64 bytes",
      { max_file_bytes: 64 },
      { retryable: false },
    );
    const redacted = redactExplicitFailure(source, ["secret"]);
    expect(redacted).toMatchObject({ retryable: false });
    const copied = kunaQueryFailureForCaller(source, "other_operation");
    expect(copied).toMatchObject({ retryable: false });
    // An undeclared retryability stays undeclared, so the shared projection
    // keeps its resource-kind default.
    const undeclared = new AnalysisResourceConstraintError(
      "inspect_pe_resources",
      "memory",
      "Result allocation exceeded the budget",
      null,
    );
    expect(redactExplicitFailure(undeclared, ["secret"])).toMatchObject({
      retryable: undefined,
    });
  });
});

it("names the fixed PE metadata allowance instead of host memory", async () => {
  const root = await createTestTempDirectory("rea-pe-metadata-budget-");
  const path = join(root, "resource.exe");
  const name = "n".repeat(200);
  const resources = Array.from({ length: 5500 }, (_, index) => ({
    type: 10,
    name: `${name}${String(index).padStart(4, "0")}`,
    language: 1033,
    payload: Buffer.alloc(0),
  }));
  await writeFile(
    path,
    peResourceFixture(false, resources, 12 * 1024 * 1024).bytes,
  );
  const result = await inspect(path);
  if (result.ok) throw new Error("Expected a metadata refusal");
  const error = result.error as AnalysisResourceConstraintError;
  expect(error.resource).toBe("memory");
  expect(error.reportedLimits).toMatchObject({
    maximum_metadata_bytes: 8 * 1024 * 1024,
  });
  const projected = projectAnalysisError(error);
  expect(projected.retryable).toBe(false);
  expect(projected.remediation.action).toContain(
    "PE resource metadata allowance",
  );
  expect(projected.remediation.action).not.toMatch(/available host memory/u);
});
