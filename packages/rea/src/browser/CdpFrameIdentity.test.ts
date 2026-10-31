import { describe, expect, it } from "vitest";
import {
  selectCdpFrameIdentity,
  cdpFrameEventFacts,
} from "./CdpFrameIdentity.js";

describe("CDP frame identity ownership", () => {
  it.each([
    ["missing", {}],
    ["null", { frame: null }],
    ["non-object", { frame: "frame" }],
  ])("does not infer a root from a %s frame object", (_label, params) => {
    expect(
      selectCdpFrameIdentity(
        cdpFrameEventFacts({ method: "Page.frameNavigated", params }),
        "selected-main",
      ),
    ).toMatchObject({
      applicability: "applicable",
      selection: "unknown",
      isRootReplacement: false,
      identityIssue: "missing_frame",
      parentRelation: "unknown",
      parentId: null,
      parentIssue: null,
    });
  });

  it("recognizes a valid frame with no parent property as a root", () => {
    expect(
      selectCdpFrameIdentity(
        cdpFrameEventFacts({
          method: "Page.frameNavigated",
          params: { frame: { id: "replacement-main" } },
        }),
        "selected-main",
      ),
    ).toMatchObject({
      applicability: "applicable",
      selection: "other",
      isRootReplacement: true,
      identityIssue: null,
      parentRelation: "root",
      parentId: null,
      parentIssue: null,
    });
  });

  it("does not interpret a malformed parent value as root evidence", () => {
    expect(
      selectCdpFrameIdentity(
        cdpFrameEventFacts({
          method: "Page.frameNavigated",
          params: { frame: { id: "replacement-main", parentId: "" } },
        }),
        "selected-main",
      ),
    ).toMatchObject({
      selection: "other",
      isRootReplacement: false,
      identityIssue: null,
      parentRelation: "unknown",
      parentId: null,
      parentIssue: "invalid_parent_id",
    });
  });

  it("preserves a self-parented frame ID but leaves its parent relation unknown", () => {
    expect(
      selectCdpFrameIdentity(
        cdpFrameEventFacts({
          method: "Page.frameNavigated",
          params: {
            frame: { id: "candidate-root", parentId: "candidate-root" },
          },
        }),
        "selected-main",
      ),
    ).toMatchObject({
      selection: "other",
      isRootReplacement: false,
      frameId: "candidate-root",
      identityIssue: null,
      parentRelation: "unknown",
      parentId: null,
      parentIssue: "self_parent",
    });
  });

  it("retains the selected-main parent issue for a self-parented selected frame", () => {
    expect(
      selectCdpFrameIdentity(
        cdpFrameEventFacts({
          method: "Page.frameNavigated",
          params: { frame: { id: "selected-main", parentId: "selected-main" } },
        }),
        "selected-main",
      ),
    ).toMatchObject({
      selection: "main",
      parentRelation: "unknown",
      parentIssue: "main_frame_has_parent",
    });
  });
});
