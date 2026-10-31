import type { JsonValue } from "../domain/jsonValue.js";
import { err, type Result } from "../domain/result.js";
import type { PendingOperations } from "../process/PendingOperations.js";
import type { GhidraSessionError } from "./GhidraSessionError.js";
import { ghidraResponseResult, parseGhidraResponseLine } from "./protocol.js";
import type { GhidraRemoteError } from "./protocol.js";

/** Dependencies for correlating validated bridge responses. */
export interface GhidraResponseRouterOptions {
  readonly pending: PendingOperations<
    number,
    Result<JsonValue, GhidraSessionError>
  >;
  readonly nextId: () => number;
  readonly remoteFailure: (failure: GhidraRemoteError) => GhidraSessionError;
  readonly protocolFailure: (message: string, cause?: Error) => void;
}

/** Routes validated response IDs without giving the wire protocol client state. */
export class GhidraResponseRouter {
  readonly #options: GhidraResponseRouterOptions;

  constructor(options: GhidraResponseRouterOptions) {
    this.#options = options;
  }

  /** Parse and settle one complete response line. */
  route(line: string): void {
    const parsed = parseGhidraResponseLine(line);
    if (!parsed.ok) {
      this.#options.protocolFailure(parsed.error.message, parsed.error);
      return;
    }
    if (!this.#options.pending.has(parsed.value.id)) {
      if (parsed.value.id >= this.#options.nextId())
        this.#options.protocolFailure("Ghidra returned an unknown response id");
      return;
    }
    const result = ghidraResponseResult(parsed.value);
    this.#options.pending.settle(
      parsed.value.id,
      result.ok ? result : err(this.#options.remoteFailure(result.error)),
    );
  }
}
