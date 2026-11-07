import { expect, it } from "vitest";
import { createJavaScriptApplicationNode } from "./javascriptApplicationGraph.js";
import { artifactEvidence } from "./javascriptApplicationGraph.fixture.js";
import {
  nativeExportCorrespondenceKey,
  nativeExportObservationFacts,
} from "./javascriptNativeExportFacts.js";
import type { JsonValue } from "../jsonValue.js";

const node = (
  observations: readonly {
    label: string;
    properties: Record<string, JsonValue>;
  }[],
) =>
  createJavaScriptApplicationNode({
    kind: "native-export",
    identity: {
      strategy: "artifact-local-key",
      stability: "artifact-version",
      artifact_sha256: "a".repeat(64),
      namespace: "native-export-fixture",
      key: "addon.node",
    },
    observations: observations.map((observation) => ({
      ...observation,
      evidence: artifactEvidence("a".repeat(64), "main.js"),
    })),
  });

it("preserves legacy labels and members while distinguishing omitted and empty requests", () => {
  const legacy = node([
    {
      label: "open",
      properties: { specifier: "./addon.node", members: ["open"] },
    },
  ]);
  const empty = node([
    {
      label: "open",
      properties: { specifier: "./addon.node", requested_members: [] },
    },
  ]);
  expect(nativeExportObservationFacts(legacy.observations[0]!)).toMatchObject({
    requestedPresent: false,
    members: ["open"],
    label: "open",
  });
  expect(nativeExportObservationFacts(empty.observations[0]!)).toMatchObject({
    requestedPresent: true,
    requested: [],
    label: null,
  });
  expect(nativeExportCorrespondenceKey(legacy)).not.toEqual(
    nativeExportCorrespondenceKey(empty),
  );
});

it("considers later conflicting observations and retains malformed values without inventing identity", () => {
  const first = {
    label: "summary",
    properties: { specifier: "./addon.node", requested_members: ["open"] },
  };
  const second = {
    label: "summary",
    properties: { specifier: "./addon.node", requested_members: ["close"] },
  };
  expect(nativeExportCorrespondenceKey(node([first]))).not.toBeNull();
  expect(nativeExportCorrespondenceKey(node([first, second]))).toBeNull();
  const malformed = node([
    {
      label: "legacy",
      properties: {
        specifier: "./addon.node",
        requested_members: ["open", 42],
      },
    },
  ]);
  const before = JSON.stringify(malformed);
  expect(
    nativeExportObservationFacts(malformed.observations[0]!),
  ).toMatchObject({ valid: false, requested: ["open"], label: null });
  expect(nativeExportCorrespondenceKey(malformed)).toBeNull();
  expect(JSON.stringify(malformed)).toBe(before);
});

it("preserves label-only fallback without treating display labels as structured members", () => {
  for (const requested_members of [["open"], ["close"], []])
    expect(
      nativeExportCorrespondenceKey(
        node([{ label: "same summary", properties: { requested_members } }]),
      ),
    ).toBeNull();
  expect(
    nativeExportCorrespondenceKey(node([{ label: "open", properties: {} }])),
  ).not.toBeNull();
  const first = node([
    {
      label: "summary one",
      properties: { specifier: "./addon.node", requested_members: ["open"] },
    },
  ]);
  const second = node([
    {
      label: "summary two",
      properties: { specifier: "./addon.node", requested_members: ["open"] },
    },
  ]);
  expect(nativeExportCorrespondenceKey(first)).toEqual(
    nativeExportCorrespondenceKey(second),
  );
});
