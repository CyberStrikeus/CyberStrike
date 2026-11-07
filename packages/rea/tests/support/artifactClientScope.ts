import { onTestFinished } from "vitest";
import type { AnalysisClient } from "../../src/application/AnalysisProvider.js";
import { ArtifactProvider } from "../../src/artifacts/ArtifactProvider.js";
import type { BinaryTarget } from "../../src/domain/binaryTargetTypes.js";

/** Retain test ownership until every artifact client is closed. */
export const createOwnedArtifactClient = (
  target: BinaryTarget,
): AnalysisClient => {
  const client = new ArtifactProvider(process.env).createClient(target);
  onTestFinished(async () => {
    const closed = await client.close();
    if (!closed.ok) throw closed.error;
  });
  return client;
};

export const withArtifactClient = async <T>(
  target: BinaryTarget,
  action: (client: AnalysisClient) => Promise<T>,
): Promise<T> => {
  const client = createOwnedArtifactClient(target);
  let outcome:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown };
  try {
    outcome = { ok: true, value: await action(client) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const closed = await client.close();
  if (!closed.ok) {
    if (!outcome.ok)
      throw new AggregateError(
        [outcome.error, closed.error],
        "Artifact operation and client cleanup failed",
      );
    throw closed.error;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
};
