import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { RustBinaryProvider } from "../../../src/rust/RustBinaryProvider.js";
import { RUST_BINARY_INPUT_BYTES } from "../../../src/rust/RustAuditableReader.js";
import { createRustHashOverflowImage } from "../../fixtures/rust/image.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("refuses extra rustc paths without asking the caller to wait", async () => {
  const root = await createTestTempDirectory("rea-rust-hash-budget-");
  const path = join(root, "many-hashes.elf");
  await writeFile(path, createRustHashOverflowImage());
  const result = await new RustBinaryProvider().inspect({ path });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a hash-capacity refusal");
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    retryable: false,
    details: {
      resource: "capacity",
      reported_limits: { maximum_rustc_hashes: 64 },
    },
  });
  expect(projected.remediation.action).toContain("rustc commit-path inventory");
  expect(projected.remediation.action).not.toMatch(
    /Wait for an active analysis/u,
  );
});

it("refuses an oversized Rust input without evidence-reply advice", async () => {
  const root = await createTestTempDirectory("rea-rust-input-budget-");
  const path = join(root, "large.elf");
  await writeFile(path, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  await truncate(path, RUST_BINARY_INPUT_BYTES + 1);
  const result = await new RustBinaryProvider().inspect({ path });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected an input-size refusal");
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    retryable: false,
    details: {
      resource: "file-size",
      reported_limits: { maximum_input_bytes: RUST_BINARY_INPUT_BYTES },
    },
  });
  expect(projected.remediation.action).toContain("does not admit this input");
  expect(projected.remediation.action).not.toMatch(
    /file-size allowance for the evidence reply/u,
  );
});
