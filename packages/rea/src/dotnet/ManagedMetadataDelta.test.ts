import { expect, it } from "vitest";

import { managedMetadataDelta } from "../../tests/fixtures/managedMetadataDelta.js";
import { inspectManagedArtifactBytes } from "./ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import { inspectManagedNativeBoundariesBytes } from "./ManagedNativeBoundaryInspector.js";
import { managedPeFixtureTarget } from "./ManagedPe.fixture.js";
import {
  managedFailure,
  managedInspectionInputFailure,
} from "./ManagedReaderFailure.js";

it("keeps minimal EnC delta metadata unsupported instead of assigning standalone identities", () => {
  const { bytes, markerOffset } = managedMetadataDelta();
  const target = managedPeFixtureTarget(bytes);
  const issue = {
    code: "unsupported-metadata",
    scope: "metadata.#JTD",
    offset: markerOffset,
    detail: expect.stringContaining("baseline"),
  };
  const artifact = inspectManagedArtifactBytes(bytes, target);
  const members = inspectManagedMembersBytes(bytes, target, {
    typeNames: ["Fixture.Program"],
  });
  const boundaries = inspectManagedNativeBoundariesBytes(bytes, target);
  expect(artifact).toMatchObject({
    classification: { status: "managed", implementation: "unknown" },
    metadata: {
      status: "partial",
      version: "v4.0.30319",
      stream_names: ["#-", "#Strings", "#US", "#GUID", "#Blob", "#JTD"],
      table_row_counts: {},
    },
    coverage: { state: "partial", issues: [issue] },
    module: null,
    assembly: null,
  });
  for (const report of [members, boundaries]) {
    expect(report).toMatchObject({
      artifact: { sha256: target.sha256 },
      metadata: {
        status: "partial",
        version: "v4.0.30319",
        table_row_counts: {},
      },
      coverage: { state: "unavailable", issues: [issue] },
      module: null,
      identity_scope: { requires_mvid: null },
    });
  }
  expect(members.selection).toEqual({
    type_names: ["Fixture.Program"],
    unmatched_type_names: [],
  });
  expect(members.methods).toEqual([]);
  expect(members.types).toEqual([]);
  expect(members.fields).toEqual([]);
  expect(members.user_strings).toBeNull();
  expect(boundaries.pinvoke_imports).toEqual([]);
  expect(
    managedInspectionInputFailure(
      "inspect_managed_members",
      target.path,
      managedFailure(
        "unsupported-metadata",
        "metadata.#JTD",
        "Missing baseline",
        markerOffset,
      ),
    ),
  ).toBeUndefined();
});
