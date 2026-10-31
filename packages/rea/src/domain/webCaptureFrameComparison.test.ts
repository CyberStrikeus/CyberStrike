import { describe, expect, it } from "vitest";

import type { WebPageInspection } from "./browserObservationSchemas.js";
import { fingerprintWebCaptureFrames } from "./webCaptureFrameComparison.js";

const frame = (
  id: string,
  parent: string | null = null,
  url = "https://app.example.test/frame",
): WebPageInspection["frames"][number] => ({
  frame_id: id,
  parent_frame_id: parent,
  url,
  origin: "https://app.example.test",
});

describe("capture-local frame graph normalization", () => {
  it.each([
    [frame("child", "missing")],
    [frame("same"), frame("same")],
    [frame("a", "b"), frame("b", "a")],
    [frame("self", "self")],
  ])("keeps unresolved ancestry unknown (%#)", (...frames) => {
    expect(fingerprintWebCaptureFrames(frames)).toBeNull();
  });

  it("preserves multiplicity while ignoring sibling order and frame IDs", () => {
    const left = [frame("root"), frame("a", "root"), frame("b", "root")];
    const renamed = [frame("y", "new"), frame("new"), frame("x", "new")];
    expect(fingerprintWebCaptureFrames(left)).toBe(
      fingerprintWebCaptureFrames(renamed),
    );
    expect(fingerprintWebCaptureFrames(left)).not.toBe(
      fingerprintWebCaptureFrames(left.slice(0, 2)),
    );
    expect(fingerprintWebCaptureFrames(left)).not.toBe(
      fingerprintWebCaptureFrames([
        frame("root"),
        frame("a", "root"),
        frame("b", "a"),
      ]),
    );
  });

  it("handles deep ancestry without recursive serialization", () => {
    const frames = Array.from({ length: 5000 }, (_, index) =>
      frame(String(index), index === 0 ? null : String(index - 1)),
    );
    const renamed = frames
      .map((item) => ({
        ...item,
        frame_id: "new-" + item.frame_id,
        parent_frame_id:
          item.parent_frame_id === null ? null : "new-" + item.parent_frame_id,
      }))
      .reverse();
    expect(fingerprintWebCaptureFrames(frames)).toMatch(/^[a-f0-9]{64}$/u);
    expect(fingerprintWebCaptureFrames(frames)).toBe(
      fingerprintWebCaptureFrames(renamed),
    );
  });
});
