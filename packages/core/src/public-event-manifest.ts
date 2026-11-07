export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@cyberstrike-io/schema/event"
import { EventManifest } from "@cyberstrike-io/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
