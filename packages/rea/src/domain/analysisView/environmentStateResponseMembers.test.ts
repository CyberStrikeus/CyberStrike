import { expect, it } from "vitest";
import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import { environmentStateViewOf } from "../../../tests/fixtures/environmentStateWrites.js";
import type { JsonValue } from "../jsonValue.js";

const OPS = "0f8b2c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const AUDIT = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
/** A distinct request id per response. */
const rid = (n: number): string =>
  `9c0c1161-53cf-53e8-330a-${String(n).padStart(12, "0")}`;

/** A reply in an envelope that mints a request id per response. */
const reply = (n: number, data: JsonValue): JsonValue => ({
  request_id: rid(n),
  lease_id: "",
  data,
});

/** Repeated reads of `path` with nothing written between, each minting its request id. */
const repeats = (path: string, from: number, count: number) =>
  Array.from({ length: count }, (_, index): TimedCaptureRow => [
    "GET",
    path,
    reply(from + index, { keys: [AUDIT, OPS] }),
  ]);

const entityRows = (listed: string): TimedCaptureRow[] => [
  ...repeats(listed, 1, 3),
  ["GET", `/v1/entities/${OPS}`, reply(10, { id: OPS, name: "ops" })],
  ["GET", `/v1/entities/${AUDIT}`, reply(11, { id: AUDIT, name: "audit" })],
  ["DELETE", `/v1/entities/${OPS}`, null, 204],
  ["GET", `/v1/entities/${OPS}`, { errors: [] }, 404],
];

const viewOf = (rows: readonly TimedCaptureRow[], tool: string) =>
  environmentStateViewOf(timedCaptureEvidence(rows)).views.find(
    (view) => view.tool === tool,
  );

it("masks an item envelope member proved minted on every item path, and serves the write the item read checks", () => {
  const rows = entityRows("/v1/entities");
  const itemRepeats: TimedCaptureRow[] = [
    ...Array.from({ length: 3 }, (_, n): TimedCaptureRow => [
      "GET",
      `/v1/entities/${OPS}`,
      reply(10 + n, { id: OPS, name: "ops" }),
    ]),
    ...Array.from({ length: 3 }, (_, n): TimedCaptureRow => [
      "GET",
      `/v1/entities/${AUDIT}`,
      reply(20 + n, { id: AUDIT, name: "audit" }),
    ]),
  ];
  const state = environmentStateViewOf(
    timedCaptureEvidence([
      ...rows.slice(0, 3),
      ...itemRepeats,
      ...rows.slice(5),
    ]),
  );
  expect(
    state.views.find((view) => view.tool === "get_entities_by_uuid"),
  ).toMatchObject({
    shape: "item",
    pointer: "/data",
    per_response_members: ["request_id"],
  });
  expect(
    state.views.find((view) => view.tool === "get_entities"),
  ).toMatchObject({ shape: "document", per_response_members: ["request_id"] });
  expect(
    state.writes.find((write) => write.tool === "delete_entities_by_uuid"),
  ).toMatchObject({ served: true, reason: null });
});

it("does not transfer a collection envelope's minted-member proof to its item paths", () => {
  expect(
    viewOf(entityRows("/v1/entities"), "get_entities_by_uuid"),
  ).toMatchObject({
    shape: "recorded",
    reason: "envelope-varies",
  });
});

it("masks a minted member only on the paths whose reads minted it", () => {
  // The request id is minted on /v1/policies, not on the entities' own paths.
  expect(viewOf(entityRows("/v1/policies"), "get_entities_by_uuid")).toEqual({
    tool: "get_entities_by_uuid",
    shape: "recorded",
    reason: "envelope-varies",
  });
});

it("keeps a distinct item path's envelope unless its own repeats prove the member minted there", () => {
  const first = { id: 1, name: "First" };
  const second = { id: 2, name: "Second" };
  const rows: TimedCaptureRow[] = [
    ["GET", "/api/items/1", reply(1, first)],
    ["GET", "/api/items/1", reply(2, first)],
    ["GET", "/api/items/1", reply(3, first)],
    ["GET", "/api/items/2", reply(4, second)],
  ];
  expect(viewOf(rows, "get_items_by_id")).toMatchObject({
    shape: "recorded",
    reason: "envelope-varies",
  });
});

it("never takes a changing member for a minted one unless its value is a UUID or a clock", () => {
  const rows: TimedCaptureRow[] = [
    ...["queued", "running", "done"].map((status): TimedCaptureRow => [
      "GET",
      "/api/jobs/current",
      { status },
    ]),
    ["GET", "/api/notes/1", { status: "draft", note: { id: 1, text: "a" } }],
    ["GET", "/api/notes/2", { status: "kept", note: { id: 2, text: "b" } }],
  ];
  expect(viewOf(rows, "get_jobs_current")).not.toHaveProperty(
    "per_response_members",
  );
  expect(viewOf(rows, "get_notes_by_id")).toMatchObject({
    shape: "recorded",
    reason: "envelope-varies",
  });
});

it("confirms a document write by a read whose minted member differs", () => {
  const settings = (n: number, theme: string): TimedCaptureRow => [
    "GET",
    "/v1/settings",
    reply(n, { theme, density: "compact" }),
  ];
  const rows: TimedCaptureRow[] = [
    settings(1, "light"),
    settings(2, "light"),
    settings(3, "light"),
    ["PATCH", "/v1/settings", null, 204, { theme: "dark" }],
    settings(4, "dark"),
  ];
  const state = environmentStateViewOf(timedCaptureEvidence(rows));
  expect(
    state.views.find((view) => view.tool === "get_settings"),
  ).toMatchObject({ shape: "document", per_response_members: ["request_id"] });
  expect(
    state.writes.find((write) => write.tool === "patch_settings"),
  ).toMatchObject({ served: true, reason: null });
});

it("confirms a create by a list read whose envelope clock differs on every response", () => {
  const units = (at: string, names: readonly string[]): TimedCaptureRow => [
    "GET",
    "/api/units",
    {
      timestamp: `2026-10-20T05:46:${at}.183616+00:00`,
      results: names.map((name, index) => ({ id: index + 1, name })),
    },
  ];
  const rows: TimedCaptureRow[] = [
    units("47", ["gram", "cup"]),
    units("48", ["gram", "cup"]),
    units("49", ["gram", "cup"]),
    ["POST", "/api/units", { id: 3, name: "pinch" }, 201, { name: "pinch" }],
    units("51", ["gram", "cup", "pinch"]),
  ];
  const state = environmentStateViewOf(timedCaptureEvidence(rows));
  expect(state.views.find((view) => view.tool === "get_units")).toMatchObject({
    shape: "list",
    per_response_members: ["timestamp"],
  });
  expect(
    state.writes.find((write) => write.tool === "post_units"),
  ).toMatchObject({ served: true, reason: null });
});
