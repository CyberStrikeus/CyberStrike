import { RuntimeControlUnavailableError } from "./RuntimeControlUnavailableError.js";

/** Expected failure when a runtime root's privacy boundary is unavailable. */
export class PrivateRuntimeRootUnavailableError extends RuntimeControlUnavailableError {
  readonly code = "private-runtime-root-authority-unavailable";

  constructor(
    message: string,
    options?: ErrorOptions & { readonly retryable?: boolean },
  ) {
    super(message, options);
    this.name = "PrivateRuntimeRootUnavailableError";
  }
}
