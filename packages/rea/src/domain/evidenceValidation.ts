import { z } from "zod";

import { parseEvidence, immutableEvidence, type Evidence } from "./evidence.js";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import { describeValidationFailure } from "./validationFailure.js";
import { err, ok, type Result } from "./result.js";

/** Expected authentication failures, independent of a caller's error contract. */
export const safeParseEvidence = (
  input: unknown,
): Result<Evidence, z.ZodError> => authenticateEvidence(input, parseEvidence);

/** Authenticate and seal source records while retaining typed validation failures. */
export const safeParseImmutableEvidence = (
  input: unknown,
): Result<Evidence, z.ZodError> =>
  authenticateEvidence(input, immutableEvidence);

/** Authenticate one source record, preserving unexpected implementation failures. */
export const readEvidence = (
  input: unknown,
): Result<Evidence, EvidenceIntegrityError> => {
  const parsed = safeParseEvidence(input);
  return parsed.ok ? parsed : err(integrityFailure(parsed.error));
};

/** Authenticate and seal source records retained independently of mutable input. */
export const readImmutableEvidence = (
  input: unknown,
): Result<Evidence, EvidenceIntegrityError> => {
  const parsed = safeParseImmutableEvidence(input);
  return parsed.ok ? parsed : err(integrityFailure(parsed.error));
};

const authenticateEvidence = (
  input: unknown,
  parse: (input: unknown) => Evidence,
): Result<Evidence, z.ZodError> => {
  try {
    return ok(parse(input));
  } catch (cause: unknown) {
    if (!(cause instanceof z.ZodError)) throw cause;
    return err(cause);
  }
};

/** Validate an authenticated source payload, separately from generated output. */
export const readEvidencePayload = <Output>(
  schema: z.ZodType<Output>,
  input: unknown,
): Result<Output, EvidenceIntegrityError> => {
  const parsed = schema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err(integrityFailure(parsed.error));
};

const integrityFailure = (cause: z.ZodError): EvidenceIntegrityError => {
  const message = `Evidence validation failed ${describeValidationFailure(cause)}`;
  return new EvidenceIntegrityError(message, { cause, userMessage: message });
};
