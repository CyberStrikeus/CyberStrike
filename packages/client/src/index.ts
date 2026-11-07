export * from "./generated/index"
export type { EventsSubscribeOutput as CyberStrikeEvent } from "./generated/types"

import type { make } from "./generated/client"
export type CyberStrikeClient = ReturnType<typeof make>
