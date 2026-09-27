import type { Event as SDKEvent } from "@cyberstrike-io/sdk/v2/types"
import type { Stream } from "effect"

export type EventMap = {
  [Item in SDKEvent as Item["type"]]: Item
}

export interface Event {
  subscribe<Type extends keyof EventMap>(type: Type): Stream.Stream<EventMap[Type]>
}
