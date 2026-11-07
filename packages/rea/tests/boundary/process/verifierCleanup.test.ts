import { expect, it } from "vitest";
import {
  closeVerifierResources,
  withVerifierCleanup,
} from "../../../scripts/lib/verifier-cleanup.mjs";

it("attempts every cleanup and reports failures when there is no primary error", async () => {
  const attempted: string[] = [];
  const tasks = [
    async () => {
      attempted.push("provider");
      throw new Error("provider close failed");
    },
    async () => {
      attempted.push("fixture");
    },
  ];

  let failure: unknown;
  try {
    await closeVerifierResources(tasks);
  } catch (cause) {
    failure = cause;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect(
    (failure as AggregateError).errors.map((error) => error.message),
  ).toEqual(["provider close failed"]);
  expect(attempted).toEqual(["provider", "fixture"]);
});

it("retains primary verification and independent cleanup failures", async () => {
  const primary = new Error("analysis assertion failed");
  const attempted: string[] = [];
  const tasks = [
    async () => {
      attempted.push("provider");
      throw new Error("provider close failed");
    },
    async () => {
      attempted.push("fixture");
      throw new Error("fixture removal failed");
    },
  ];

  let failure: unknown;
  try {
    await withVerifierCleanup(() => {
      throw primary;
    }, tasks);
  } catch (cause) {
    failure = cause;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).cause).toBe(primary);
  expect((failure as AggregateError).errors).toEqual([
    primary,
    expect.objectContaining({ message: "provider close failed" }),
    expect.objectContaining({ message: "fixture removal failed" }),
  ]);
  expect(attempted).toEqual(["provider", "fixture"]);
});

it("keeps a parent fixture when any owned child cleanup remains incomplete", async () => {
  const primary = new Error("verification failed");
  const attempted: string[] = [];
  let parentRemoved = false;
  let failure: unknown;
  try {
    await withVerifierCleanup(() => {
      throw primary;
    }, [
      async () => {
        await closeVerifierResources([
          async () => {
            attempted.push("client");
          },
          async () => {
            attempted.push("transport");
            throw new Error("transport close failed");
          },
          async () => {
            attempted.push("file-scope");
          },
        ]);
        parentRemoved = true;
      },
    ]);
  } catch (cause) {
    failure = cause;
  }

  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors[0]).toBe(primary);
  expect((failure as AggregateError).cause).toBe(primary);
  expect((failure as AggregateError).errors[1]).toBeInstanceOf(AggregateError);
  expect(attempted).toEqual(["client", "transport", "file-scope"]);
  expect(parentRemoved).toBe(false);
});

it.each([undefined, null, new Error("exact operation failure")])(
  "preserves an exact operation rejection after successful cleanup: %s",
  async (primary) => {
    const attempted: string[] = [];
    await expect(
      withVerifierCleanup(() => {
        attempted.push("operation");
        throw primary;
      }, [
        () => {
          attempted.push("cleanup");
        },
      ]),
    ).rejects.toBe(primary);
    expect(attempted).toEqual(["operation", "cleanup"]);
  },
);

it.each([undefined, null])(
  "retains an opaque operation rejection with its independent cleanup failure: %s",
  async (primary) => {
    const cleanup = new Error("independent cleanup failure");
    const outcome = await withVerifierCleanup(async () => {
      throw primary;
    }, [
      () => {
        throw cleanup;
      },
    ]).then(
      (value) => ({ kind: "fulfilled" as const, value }),
      (reason: unknown) => ({ kind: "rejected" as const, reason }),
    );
    if (outcome.kind !== "rejected")
      throw new Error("Expected both operation and cleanup failures");
    expect(outcome.reason).toBeInstanceOf(AggregateError);
    const error = outcome.reason as AggregateError;
    expect(error.errors).toEqual([primary, cleanup]);
    expect(error.errors[1]).toBe(cleanup);
    expect(Object.hasOwn(error, "cause")).toBe(true);
    expect(error.cause).toBe(primary);
  },
);

it.each([undefined, { observation: "retained value" }])(
  "returns the exact operation value after cleanup: %s",
  async (value) => {
    const attempted: string[] = [];
    const result = await withVerifierCleanup(() => {
      attempted.push("operation");
      return value;
    }, [
      async () => {
        attempted.push("cleanup");
      },
    ]);
    expect(result).toBe(value);
    expect(attempted).toEqual(["operation", "cleanup"]);
  },
);

it("does not repeat cleanup or invent a primary when cleanup alone fails", async () => {
  const attempted: string[] = [];
  const cleanup = new Error("cleanup after successful observation failed");
  const outcome = await withVerifierCleanup(() => {
    attempted.push("operation");
    return "completed";
  }, [
    async () => {
      attempted.push("provider");
      throw cleanup;
    },
    () => {
      attempted.push("fixture");
      throw undefined;
    },
    () => {
      attempted.push("independent resource");
    },
  ]).catch((reason: unknown) => reason);
  expect(outcome).toBeInstanceOf(AggregateError);
  expect((outcome as AggregateError).errors).toEqual([cleanup, undefined]);
  expect((outcome as AggregateError).errors[0]).toBe(cleanup);
  expect(Object.hasOwn(outcome as AggregateError, "cause")).toBe(false);
  expect(attempted).toEqual([
    "operation",
    "provider",
    "fixture",
    "independent resource",
  ]);
});

it("preserves nested aggregates and independent failures with the same identity", async () => {
  const shared = new Error("same reason from independent owners");
  const primary = new AggregateError([shared], "nested operation failure");
  const nested = new AggregateError([undefined, shared], "nested cleanup");
  const outcome = await withVerifierCleanup(() => {
    throw primary;
  }, [
    () => {
      throw nested;
    },
    () => {
      throw shared;
    },
    () => {
      throw shared;
    },
  ]).catch((reason: unknown) => reason);
  expect(outcome).toBeInstanceOf(AggregateError);
  const error = outcome as AggregateError;
  expect(error.cause).toBe(primary);
  expect(error.errors).toEqual([primary, nested, shared, shared]);
  expect(error.errors[0]).toBe(primary);
  expect(error.errors[1]).toBe(nested);
  expect(error.errors[2]).toBe(shared);
  expect(error.errors[3]).toBe(shared);
});
