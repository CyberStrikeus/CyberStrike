import {
  nativeAotPeFixture,
  nativeAotPeDigest,
} from "../../tests/fixtures/nativeaotPe.js";
import {
  parseNativeAotPe,
  NATIVE_AOT_MAX_REPORT_BYTES,
} from "../domain/native/nativeAotPe.js";
import { expect, it, vi } from "vitest";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { err, ok } from "../domain/result.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import {
  nativeLoadImageSchema,
  nativeLoadImagePartialObservationSchema,
} from "../domain/native/nativeLoadImage.js";
import {
  fixtureDosLoadImage,
  compareDosClientFixture,
  fixtureDosComLoadImage,
} from "./GhidraLoadImage.fixture.js";
import { fixtureRawBinaryLoadImage } from "./GhidraRawBinaryLoadImage.fixture.js";
import { attestGhidraNativeLoadImage } from "./GhidraLoadImageAttest.js";
import { limitationsFor } from "./GhidraProviderCapabilities.js";
import {
  GHIDRA_VERIFIED_LOAD_IMAGE_FORMATS,
  ghidraLoadImageVerificationNote,
  ghidraUnverifiedLoadImageReason,
} from "./GhidraVerifiedLoadImageFormats.js";
import { GhidraSessionError } from "./GhidraSessionError.js";

const dosFixture = (format: "dos-mz" | "dos-com") => {
  const fixture =
    format === "dos-mz" ? fixtureDosLoadImage() : fixtureDosComLoadImage();
  const target: BinaryTarget = {
    path: "/controlled/load-image",
    sha256: fixture.sha256,
    kind: "executable",
    format,
    architecture: "x86",
    availableArchitectures: ["x86"],
  };
  return { ...fixture, target };
};

const fixtureFor = (format: "dos-mz" | "dos-com" | "raw-binary") =>
  format === "raw-binary" ? fixtureRawBinaryLoadImage() : dosFixture(format);

it.each(["dos-mz", "dos-com", "raw-binary"] as const)(
  "retains completed %s verification under late cancellation",
  async (format) => {
    const fixture = fixtureFor(format);
    const caller = new AbortController();
    const reason = { caller: "snapshot result consumption" };
    const result = await attestGhidraNativeLoadImage({
      operation: "inspect_native_load_image",
      target: fixture.target,
      measured: fixture.observation,
      client:
        format === "dos-mz" && "bytes" in fixture
          ? {
              attestDosTargetSnapshot: async (observations) => {
                const compared = compareDosClientFixture(
                  fixture.bytes,
                  fixture.sha256,
                  observations,
                );
                caller.abort(reason);
                return compared;
              },
            }
          : "bytes" in fixture
            ? {
                readTargetSnapshot: async () => {
                  caller.abort(reason);
                  return ok({ kind: "captured", bytes: fixture.bytes });
                },
              }
            : {
                hashTargetSnapshot: async () => {
                  caller.abort(reason);
                  return ok(fixture.snapshot);
                },
              },
      mapSessionError: (cause) =>
        new ProviderAdapterError("ghidra", "inspect_native_load_image", {
          cause,
        }),
      signal: caller.signal,
    });
    if (result.ok)
      throw new Error("Expected cancellation after snapshot completion");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
    expect(result.error.cause).toBe(reason);
    expect(
      nativeLoadImagePartialObservationSchema.parse(
        result.error.partialObservation,
      ),
    ).toMatchObject({
      kind: "native-load-image",
      stage: "completed",
      result: { status: "verified", format, observations: fixture.observation },
    });
  },
);

it("records which formats receive independent load-image verification", () => {
  expect(GHIDRA_VERIFIED_LOAD_IMAGE_FORMATS).toEqual([
    "dos-mz",
    "dos-com",
    "raw-binary",
    "gamecube-dol",
  ]);
  expect(limitationsFor("inspect_native_load_image")).toContain(
    ghidraLoadImageVerificationNote(),
  );
});

it("declines another format with the owned verification reason", async () => {
  const { observation } = fixtureRawBinaryLoadImage();
  const result = await attestGhidraNativeLoadImage({
    operation: "inspect_native_load_image",
    target: {
      path: "/controlled/load-image",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "elf",
      architecture: "x86_64",
      availableArchitectures: ["x86_64"],
    },
    measured: observation,
    client: {},
    mapSessionError: (cause) =>
      new ProviderAdapterError("ghidra", "inspect_native_load_image", {
        cause,
      }),
  });
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    status: "unsupported",
    reason: ghidraUnverifiedLoadImageReason(),
  });
});

it.each([null, "caller stopped", new Error("caller stopped")])(
  "preserves an already-cancelled caller's reason and measured facts (%s)",
  async (reason) => {
    const fixture = dosFixture("dos-mz");
    const caller = new AbortController();
    caller.abort(reason);
    const read = vi.fn();
    const result = await attestGhidraNativeLoadImage({
      operation: "inspect_native_load_image",
      target: fixture.target,
      measured: fixture.observation,
      client: { attestDosTargetSnapshot: read },
      mapSessionError: () => {
        throw new Error("No source failure expected");
      },
      signal: caller.signal,
    });
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cause).toBe(reason);
    expect(
      nativeLoadImagePartialObservationSchema.parse(
        result.error.partialObservation,
      ),
    ).toMatchObject({
      kind: "native-load-image",
      observations: fixture.observation,
      stage: "measured",
    });
    expect(read).not.toHaveBeenCalled();
  },
);

it("preserves a snapshot failure before late cancellation", async () => {
  const fixture = dosFixture("dos-mz");
  const caller = new AbortController();
  const source = new GhidraSessionError("protocol", "controlled read failure");
  const projected = new ProviderAdapterError(
    "ghidra",
    "inspect_native_load_image",
    { cause: source },
  );
  const result = await attestGhidraNativeLoadImage({
    operation: "inspect_native_load_image",
    target: fixture.target,
    measured: fixture.observation,
    client: {
      attestDosTargetSnapshot: async () => {
        caller.abort("late caller");
        return err(source);
      },
    },
    mapSessionError: () => projected,
    signal: caller.signal,
  });
  expect(result).toEqual(err(projected));
});

it("keeps ordinary DOS verification valid", async () => {
  const fixture = dosFixture("dos-mz");
  const result = await attestGhidraNativeLoadImage({
    operation: "inspect_native_load_image",
    target: fixture.target,
    measured: fixture.observation,
    client: {
      attestDosTargetSnapshot: async (observations) =>
        compareDosClientFixture(fixture.bytes, fixture.sha256, observations),
    },
    mapSessionError: () => {
      throw new Error("No source failure expected");
    },
  });
  if (!result.ok) throw result.error;
  expect(nativeLoadImageSchema.parse(result.value).status).toBe("verified");
});

it("retains completed NativeAOT facts when cancellation precedes result consumption", async () => {
  const bytes = nativeAotPeFixture();
  const sha256 = nativeAotPeDigest(bytes);
  const observations = {
    ...fixtureDosLoadImage().observation,
    image_base: "0x140000000",
  };
  const target: BinaryTarget = {
    path: "/controlled/Inert.exe",
    sha256,
    kind: "executable",
    format: "pe",
    architecture: "x86_64",
    availableArchitectures: ["x86_64"],
    peMachine: 0x8664,
    managed: false,
    executableRole: "application",
  };
  const caller = new AbortController();
  const reason = { caller: "already derived metadata" };
  caller.abort(reason);
  const result = await attestGhidraNativeLoadImage({
    target,
    operation: "inspect_native_load_image",
    measured: observations,
    client: {},
    nativeAotResult: parseNativeAotPe(
      bytes,
      sha256,
      NATIVE_AOT_MAX_REPORT_BYTES,
      observations.image_base,
    ),
    mapSessionError: () => {
      throw new Error("No source call expected");
    },
    signal: caller.signal,
  });
  if (result.ok) throw new Error("Expected late NativeAOT cancellation");
  expect(result.error.cause).toBe(reason);
  expect(
    nativeLoadImagePartialObservationSchema.parse(
      result.error.partialObservation,
    ),
  ).toMatchObject({
    kind: "native-load-image",
    stage: "completed",
    result: { observations: { metadata_recovery: [{ method_tables: 3 }] } },
  });
});

it("keeps invalid NativeAOT output primary across cancellation", async () => {
  const fixture = dosFixture("dos-mz");
  const caller = new AbortController();
  caller.abort("late caller");
  const result = await attestGhidraNativeLoadImage({
    target: {
      ...fixture.target,
      format: "pe",
      peMachine: 0x14c,
      managed: false,
      executableRole: "application",
    },
    operation: "inspect_native_load_image",
    measured: fixture.observation,
    client: {},
    mapSessionError: () => {
      throw new Error("No source call expected");
    },
    signal: caller.signal,
  });
  if (result.ok) throw new Error("Expected missing derivation failure");
  expect(result.error._tag).toBe("ProviderAdapterError");
  expect(
    nativeLoadImagePartialObservationSchema.parse(
      result.error.partialObservation,
    ),
  ).toMatchObject({
    kind: "native-load-image",
    stage: "measured",
    observations: fixture.observation,
  });
});
