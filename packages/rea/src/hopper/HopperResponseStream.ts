import {
  parseBridgeMessageLine,
  type HopperBridgeMessage,
} from "./protocol.js";
import { DecodedNdjsonLineBuffer } from "../process/DecodedNdjsonLineBuffer.js";

export interface HopperResponseStreamOptions {
  readonly accept: (message: HopperBridgeMessage) => boolean;
  readonly hasQueued: (id: number) => boolean;
  readonly nextRequestId: () => number;
  readonly abort: (message: string, cause?: Error) => void;
}

/** Incrementally validates Hopper NDJSON response frames. */
export class HopperResponseStream {
  readonly #lines = new DecodedNdjsonLineBuffer();

  constructor(readonly options: HopperResponseStreamOptions) {}

  push(chunk: string): void {
    for (const line of this.#lines.push(chunk))
      if (!this.#acceptLine(line)) break;
  }

  reset(): void {
    this.#lines.reset();
  }

  #acceptLine(line: string): boolean {
    const parsed = parseBridgeMessageLine(line);
    if (!parsed.ok) {
      this.options.abort(parsed.error.message, parsed.error);
      return false;
    }
    if (this.options.accept(parsed.value)) return true;
    if (
      parsed.value.id >= this.options.nextRequestId() ||
      this.options.hasQueued(parsed.value.id)
    ) {
      this.options.abort("Hopper returned an unknown response id");
      return false;
    }
    return true;
  }
}
