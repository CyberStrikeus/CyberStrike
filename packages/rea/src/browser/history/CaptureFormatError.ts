/** Expected malformed, unsupported or oversized producer data at a historical decoder boundary. */
export class CaptureFormatError extends Error {
  constructor(
    readonly reason:
      | "format"
      | "unsupported"
      | "input-limit"
      | "expanded-limit"
      | "limit",
    message: string,
    readonly pointer = "",
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}
