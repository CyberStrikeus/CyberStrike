// Named plugin RPC methods, registered per location directory. rpc.call dispatches to these; nothing is registered by
// default, so an unknown RPC or method is answered with a typed not-found error.
export namespace PluginRpc {
  export type Method = (input: unknown) => unknown | Promise<unknown>

  const registry = new Map<string, Map<string, Map<string, Method>>>()

  export function register(directory: string, rpcID: string, methods: Record<string, Method>) {
    const rpcs = registry.get(directory) ?? new Map<string, Map<string, Method>>()
    rpcs.set(rpcID, new Map(Object.entries(methods)))
    registry.set(directory, rpcs)
  }

  export function unregister(directory: string, rpcID: string) {
    const rpcs = registry.get(directory)
    if (!rpcs) return
    rpcs.delete(rpcID)
    if (rpcs.size === 0) registry.delete(directory)
  }

  export function lookup(directory: string, rpcID: string, method: string): Method | undefined {
    return registry.get(directory)?.get(rpcID)?.get(method)
  }
}
