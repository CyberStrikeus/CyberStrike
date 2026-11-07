import { expect, it } from "vitest";
import { nativeAotSnapshotObservationSchema } from "./nativeAotSnapshotObservation.js";

const observation = {
  kind: "native-aot-snapshot",
  analysis_artifact_sha256: "a".repeat(64),
  image_base: "0x140000000",
  capture: { status: "captured", bytes: 2560 },
};

it("retains captured source coverage without raw bytes", () => {
  expect(nativeAotSnapshotObservationSchema.parse(observation)).toEqual(
    observation,
  );
  expect(
    nativeAotSnapshotObservationSchema.safeParse({
      ...observation,
      bytes: Buffer.alloc(1),
    }).success,
  ).toBe(false);
});

it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "refuses invalid source coverage %s",
  (bytes) => {
    expect(
      nativeAotSnapshotObservationSchema.safeParse({
        ...observation,
        capture: { status: "captured", bytes },
      }).success,
    ).toBe(false);
  },
);
