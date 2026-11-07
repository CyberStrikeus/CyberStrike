import type { McpServer } from "@modelcontextprotocol/server";

type RegisteredHandler = (input: unknown, context: unknown) => Promise<unknown>;

export const invokeWithLiveSignal = (
  handler: RegisteredHandler,
  input: unknown,
): Promise<unknown> =>
  handler(input, { mcpReq: { signal: new AbortController().signal } });

export const createReverseEngineeringMcpHarness = (): {
  server: McpServer;
  handler: (name: string) => RegisteredHandler;
} => {
  const registrations = new Map<string, RegisteredHandler>();
  const server = {
    registerTool: (
      name: string,
      _options: unknown,
      handler: RegisteredHandler,
    ) => registrations.set(name, handler),
  } as unknown as McpServer;

  return {
    server,
    handler: (name) => {
      const registered = registrations.get(name);
      if (registered === undefined)
        throw new Error(`${name} MCP handler was not registered`);
      return registered;
    },
  };
};
