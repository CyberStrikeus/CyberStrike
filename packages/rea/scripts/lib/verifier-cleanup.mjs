async function collectCleanupFailures(tasks) {
  const failures = [];
  for (const task of tasks) {
    try {
      await task();
    } catch (cause) {
      failures.push(cause);
    }
  }

  return failures;
}

/** Attempt every independent cleanup and preserve each failure. */
export async function closeVerifierResources(tasks) {
  const failures = await collectCleanupFailures(tasks);
  if (failures.length > 0)
    throw new AggregateError(failures, "Verifier cleanup failed");
}

/** Finish one operation and its cleanup without losing either failure. */
export async function withVerifierCleanup(operation, cleanupTasks) {
  let value;
  try {
    value = await operation();
  } catch (cause) {
    const failures = await collectCleanupFailures(cleanupTasks);
    if (failures.length > 0)
      throw new AggregateError(
        [cause, ...failures],
        "Verifier cleanup failed",
        { cause },
      );
    throw cause;
  }
  await closeVerifierResources(cleanupTasks);
  return value;
}
