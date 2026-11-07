/** Fail promptly if an operation never reaches its controlled lifecycle boundary. */
export const awaitAcknowledgement = async (
  acknowledgement: Promise<void>,
  operation: Promise<unknown>,
  boundary: string,
  timeoutMs = 2_000,
): Promise<void> => {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const observed = await Promise.race([
      acknowledgement.then(() => ({ kind: "acknowledged" }) as const),
      operation.then(
        (value) => ({ kind: "settled", status: "fulfilled", value }) as const,
        (cause: unknown) =>
          ({ kind: "settled", status: "rejected", cause }) as const,
      ),
      new Promise<{ readonly kind: "deadline" }>((resolve) => {
        deadline = setTimeout(() => resolve({ kind: "deadline" }), timeoutMs);
      }),
    ]);
    if (observed.kind !== "acknowledged")
      throw new Error(
        `${boundary} was not acknowledged before ${observed.kind === "deadline" ? "the gate deadline" : "the triggering operation settled"}`,
        { cause: observed },
      );
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
};
