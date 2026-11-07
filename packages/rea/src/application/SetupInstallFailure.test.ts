import { describe, expect, it } from "vitest";

import { HOPPER_PUBLISHER } from "../domain/hopperPublisher.js";
import { setupInstallFailure } from "./SetupInstallFailure.js";

describe("macOS Hopper setup failure projection", () => {
  it("projects a publisher mismatch onto its own code and recovery", () => {
    expect(setupInstallFailure("publisher_verification_failed")).toEqual({
      status: "failed",
      code: "publisher_verification_failed",
      remediation: `The mounted Hopper application is not signed by the publisher REA pins (${HOPPER_PUBLISHER.bundleIdentifier}, Apple team ${HOPPER_PUBLISHER.teamIdentifier}); nothing was copied or launched. Install Hopper yourself and set HOPPER_LAUNCHER_PATH to its launcher, then rerun rea setup.`,
    });
  });

  it("keeps a broken bundle distinct from a publisher mismatch", () => {
    expect(setupInstallFailure("bundle")).toEqual({
      status: "failed",
      code: "bundle_invalid",
      remediation:
        "The mounted package did not contain the expected Hopper application bundle. Retry setup; if it repeats, update REA before installing.",
    });
  });
});

describe("Linux package-manager setup failure projection", () => {
  it("quotes the failing command and a sanitized bounded diagnostic", () => {
    const result = setupInstallFailure("authorization_or_package_manager", {
      command: 'pkexec pacman -U "/tmp/hopper package.pkg.tar.xz"',
      exitCode: 1,
      stdout: "",
      stderr: "\u001b[31merror:\u001b[0m package conflict\nrefused",
      outputTruncated: false,
    });
    expect(result).toMatchObject({
      status: "failed",
      code: "authorization_or_package_manager_failed",
    });
    if (result.status !== "failed") throw new Error("expected failure");
    expect(result.remediation).toContain(
      'pkexec pacman -U "/tmp/hopper package.pkg.tar.xz"; exit 1',
    );
    expect(result.remediation).toContain("error: package conflict refused");
    expect(result.remediation).not.toContain("\u001b");
    expect(result.remediation).not.toContain("\n");
  });

  it("preserves the established remediation if no package output exists", () => {
    expect(setupInstallFailure("authorization_or_package_manager")).toEqual({
      status: "failed",
      code: "authorization_or_package_manager_failed",
      remediation:
        "Allow the system package-manager operation or install the planned Hopper package and Linux runtime dependencies, then rerun rea setup.",
    });
  });

  it("keeps truncated package output within its excerpt budget", () => {
    const result = setupInstallFailure("authorization_or_package_manager", {
      command: "pacman -U hopper.pkg.tar.xz",
      exitCode: 1,
      stdout: "",
      stderr: `${"warning ".repeat(100)}final package conflict`,
      outputTruncated: true,
    });
    if (result.status !== "failed") throw new Error("expected failure");
    const excerpt = result.remediation
      .split("its output: ")[1]
      ?.split(" Resolve")[0];
    expect(excerpt).toContain("output truncated");
    expect(excerpt?.length).toBeLessThanOrEqual(400);
  });
});

it.each([
  ["destination_inspection", "destination_inspection_failed"],
  ["archive_write", "archive_write_failed"],
  ["launcher_inspection", "launcher_inspection_failed"],
] as const)("retains %s as a distinct setup failure", (reason, code) => {
  expect(setupInstallFailure(reason).code).toBe(code);
});
