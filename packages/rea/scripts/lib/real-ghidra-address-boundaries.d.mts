import type { Client } from "@modelcontextprotocol/client";

/** Verify segmented aliases and restore the entry's observed public name. */
export function verifyGhidraAddressBoundaries(
  client: Pick<Client, "callTool">,
  entry: string,
  cli: (command: string, address: string, flags: string[]) => Promise<unknown>,
): Promise<void>;
