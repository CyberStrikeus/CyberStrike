/** A typed channel for expected success or failure. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Construct a successful result. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Construct a failed result. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
