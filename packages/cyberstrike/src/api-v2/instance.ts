import { Effect } from "effect"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"

// Runs a v1 domain call in the instance for `directory`, the same scope the v1 server gives each request.
export const inInstance = <A>(directory: string, fn: () => A | Promise<A>) =>
  Effect.promise(() => Instance.provide({ directory, init: InstanceBootstrap, fn }) as Promise<A>)
