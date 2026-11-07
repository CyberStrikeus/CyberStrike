import type { Client } from "@modelcontextprotocol/client";
export function verifyCompleteToolCatalog(
  client: Pick<Client, "listTools" | "callTool">,
  options?: Parameters<Client["listTools"]>[1],
): Promise<string[]>;
export function pathExists(path: string): Promise<boolean>;
