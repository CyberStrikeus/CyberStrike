import { createConnection, type Socket } from "node:net";

import {
  hopperCancelledBySignal,
  type HopperCancelledError,
  HopperStartError,
} from "../domain/hopperErrors.js";
import { err, ok, type Result } from "../domain/result.js";

/** Open one abort-aware Hopper Unix-socket connection attempt. */
export const connectHopperSocketOnce = (
  socketPath: string,
  signal: AbortSignal,
): Promise<Result<Socket, HopperStartError | HopperCancelledError>> =>
  new Promise((resolve) => {
    const socket = createConnection(socketPath);
    const detach = (): void => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onConnect = (): void => {
      detach();
      resolve(ok(socket));
    };
    const onError = (cause: Error): void => {
      detach();
      socket.destroy();
      resolve(err(new HopperStartError({ cause })));
    };
    const onAbort = (): void => {
      detach();
      socket.destroy();
      resolve(err(hopperCancelledBySignal(signal)));
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
