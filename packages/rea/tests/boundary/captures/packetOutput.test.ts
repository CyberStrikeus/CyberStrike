import { expect, it } from "vitest";
import { ZodError } from "zod";
import { parsePacketOutput } from "../../../src/captures/parsePacketOutput.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";

it("preserves repeated field values and missing fields while discarding export index metadata", () => {
  const output = JSON.stringify([
    {
      _index: "packets-2026",
      _score: null,
      _source: {
        layers: {
          "frame.number": ["2"],
          "ip.addr": ["192.0.2.1", "192.0.2.2"],
        },
      },
    },
    { _source: { layers: { "frame.number": ["7"] } } },
  ]);
  expect(parsePacketOutput(output)).toEqual([
    { "frame.number": ["2"], "ip.addr": ["192.0.2.1", "192.0.2.2"] },
    { "frame.number": ["7"] },
  ]);
});

it.each([
  {
    layers: { "ip.addr": ["192.0.2.1"] },
    issue: {
      code: "invalid_type",
      path: [0, "_source", "layers", "frame.number"],
    },
  },
  {
    layers: { "frame.number": ["1"], "ip.addr": "192.0.2.1" },
    issue: { code: "invalid_type", path: [0, "_source", "layers", "ip.addr"] },
  },
  {
    layers: { "frame.number": ["0"] },
    issue: {
      code: "invalid_format",
      path: [0, "_source", "layers", "frame.number", 0],
    },
  },
  {
    layers: { "frame.number": ["1", "2"] },
    issue: { code: "too_big", path: [0, "_source", "layers", "frame.number"] },
  },
])("rejects malformed producer fields: $layers", ({ layers, issue }) => {
  let failure: unknown;
  try {
    parsePacketOutput(JSON.stringify([{ _source: { layers } }]));
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ZodError);
  if (!(failure instanceof ZodError)) throw failure;
  expect(failure.issues).toEqual(
    expect.arrayContaining([expect.objectContaining(issue)]),
  );
});

it.each([
  [["2"], ["2"]],
  [["2"], ["1"]],
])("rejects repeated or reordered producer frames: %j then %j", (...frames) => {
  let failure: unknown;
  try {
    parsePacketOutput(
      JSON.stringify(
        frames.map((frame) => ({
          _source: { layers: { "frame.number": frame } },
        })),
      ),
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AnalysisOutputError);
  expect(failure).toMatchObject({ operation: "inspect_packet_capture" });
});

it("preserves canonical field names emitted for a selected alias", () => {
  const output = JSON.stringify([
    {
      _source: {
        layers: { "frame.number": ["1"], "dhcp.type": ["1"] },
      },
    },
  ]);
  expect(parsePacketOutput(output)).toEqual([
    { "frame.number": ["1"], "dhcp.type": ["1"] },
  ]);
});
