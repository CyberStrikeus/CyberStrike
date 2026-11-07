import { CdpCommandRejection } from "./CdpCommandRejection.js";
import { CdpConnection } from "./CdpConnection.js";

/** Execute an optional CDP method while preserving transport and cancellation failures. */
export const optionalCdpCommand = async (
  context: {
    readonly connection: CdpConnection;
    readonly sessionId: string | undefined;
    readonly signal?: AbortSignal;
  },
  method: string,
  parameters: Readonly<Record<string, unknown>>,
  limitations: string[],
): Promise<unknown | undefined> => {
  try {
    return await context.connection.send(
      method,
      parameters,
      context.sessionId,
      context.signal,
    );
  } catch (cause: unknown) {
    if (!(cause instanceof CdpCommandRejection) || cause.code !== -32_601)
      throw cause;
    limitations.push(`${method} was unavailable from this browser target.`);
    return undefined;
  }
};
